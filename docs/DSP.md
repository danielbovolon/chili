# Chili — DSP architecture

Everything you hear is produced in `src/audio/chili-processor.js`, a single `AudioWorkletProcessor`. The main thread only sends state (pattern, parameters, samples, scale) and receives meter/visualisation data (~30 Hz).

## Signal flow

```
Clock (sample-accurate) ── steps ──┐
                                    ▼
   trigger: copy step → chaos → gate/density/chance → macros → scale quantise → ratchets/micro-timing
                                    ▼
            Voices (sampler | granular | synth) → filter (+ global filter env) → amp env → phaser → flanger → chorus → pan/surround → delay → reverb ─┐
                                                                                                                                                  ▼
                                                                                                                  sequencer bus → Heat → Rip
                                                                                                                                                  ▼
                       FX chain, free order (default: master filter → delay → reverb → comp) → fader → limiter → LUFS/peak → out
```

## Clock
- Time in samples as a double; events inside a render quantum land on their exact sample position: the block is split into segments at every event. No drift, no `setTimeout` jitter.

## Sources
- **Sampler:** windowed-sinc interpolation (Blackman-Harris, 512 phases, linear between phases). When pitched up the kernel is stretched by `1/ratio` (real anti-aliasing instead of aliasing linear resampling). At an exact integer position and pitch 0 samples are copied directly → bit-transparent. 1 ms edge fades at slice boundaries prevent clicks when cutting mid-wave.
- **Synth:** wavetables built by additive synthesis, **one table per half-octave** (24 mipmaps), each holding only harmonics below Nyquist for the highest frequency of its half-octave → alias-free even under pitch modulation. Read with 4-point Hermite.

## Modulation
- All modulators (LFOs, filter envelope, Mutate, pan) run at control rate (16 samples) and are **linearly interpolated per sample** (ramps for rate, filter g, level, pan gains, allpass coefficients, delay times). Level and pan additionally get 3 ms one-pole smoothing → no zipper noise, even with square LFOs.
- Filter: TPT/ZDF state-variable filter (Zavalishin/Simper) — linear, stable under fast modulation, no non-linearity → no alias source.
- Modulated delays (flanger, chorus, master delay with gliding time): 4-point Hermite interpolation.

## Scale quantisation (v0.6)
- The main thread sends `{ root, iv, shift }` (interval list in semitones, fractional for 24-TET).
- At trigger time, after chaos, warp and macros, the final pitch (synth: note + pitch + fine; sampler: root + pitch + fine) is snapped to the nearest scale degree (octave-wrapped, the octave above counts as a candidate), then moved by `shift` degrees. The result is split back into integer semitones and cents so the voice code is unchanged — quarter tones go through `fine`.
- Scale "off" skips the step entirely (bit-exact to v0.5).

## FX chain (v0.6)
- `ord` is an `Int8Array(4)` (0 filter, 1 comp, 2 delay, 3 reverb); the master loop runs the four modules in that order per sample. Unknown/missing entries are filled in the default order filter → delay → reverb → comp.
- Each module keeps its own on/off and dry/wet, so reordering never changes levels of modules that are off (off = bit-transparent in every position — tested for all 24 orders).

## Mutate
Per trigger: new random frequencies (0.35–2.25 × tempo, random sign) and phases for 5 dimensions, each a sum of two sines. Starts only after `attack + hold time`, 25 ms fade-in. The attack is therefore sample-identical on every repeat.

## Rip
- 8 s ring buffer of the sequencer bus.
- Reservoir: 24 leaky-tanh neurons, sparse recurrent matrix (spectral radius ≈ 0.95), 10 inputs (fast/slow envelope, transient measure, zero-crossing rate, pattern phase sin/cos, the step's rip weight, state, noise × temperature, bias), 6 outputs.
- Decision per step with exploration noise. Event: repeat 0 is live (recording), then a loop with sinc resampling (cumulative pitch drift), optionally reversed, decay per repeat, 1.5 ms window and 3 ms crossfade back to the dry signal.
- Learning (REINFORCE-like): `Wout += lr · (r − r̄) · noise · x_decision`, reward = transient strength at onset + energy − density penalty, slow pull back to the initialisation (homeostasis), weights clamped to ±3. Seed + learned weights are saved in the project.

## Master
- **Compressor:** feed-forward, stereo-linked (max peak), soft-knee curve in the dB domain, attack/release on the gain reduction. Dry/wet = parallel compression.
- **Delay:** tempo-synced, feedback with tone filter, ping-pong, **Wow** (tape modulation of the delay time), **Shimmer** (granular pitch shifter ±12 st inside the feedback path).
- **Reverb:** pre-delay → 4 Schroeder allpasses per channel → 8×8 feedback delay network with a Hadamard matrix (orthogonal, lossless except for frequency-dependent damping in the loop, T60-exact line gains).
- All dry/wet values are smoothed over 20 ms.
- **Fader:** gain = position² (−12 dB at half travel), maximum exactly 1.0 (0 dB), 15 ms smoothing.
- **Safety limiter:** 1.5 ms lookahead, sliding-window minimum (monotonic deque) + box smoothing over the window → the gain curve is guaranteed to reach the required value before the peak, without a jump. Below the ceiling g = 1 → bit-transparent. Release 80 ms.
- **LUFS momentary:** K-weighting per BS.1770 (coefficients recomputed for every sample rate), 400 ms window.

## Recording (capture)
- The input (MediaStream) is connected straight to the worklet input; channel choice (stereo/L/R) happens in the worklet.
- Sync start is fired in the same tick handler as the step triggers: start sample = event sample of step 1. Stop after `length × cycles` steps at the event sample.
- Latency compensation: the first `compN` samples are dropped and `compN` samples are written on after the stop sample → identical length, shifted content.
- Data goes to the main thread in 16384-frame blocks, is saved as 32-bit float WAV (no dither) and treated like an import.

## Macros, chaos, ratchets, surround, master filter
- **Trigger pipeline:** copy the step (scratch object, no allocation) → apply chaos → gate/density/chance → macros → scale → ratchets/micro-timing. Delayed hits live in a pre-allocated pending pool (64) and are cut into the block sample-accurately like clock events.
- **Chaos:** one channel per parameter (prev/next/cur, history up to 32). New value every `rate` steps with probability `prob`; `next = prev + rand·(U − prev)`; with `lock` a value from the loop history is repeated instead. The transition within the rate uses continuously blended curves (step/linear/cosine/cubic). Applied in normalised parameter space (lin/log/cubic like the UI), relative (±) or absolute (crossfade). Choice and switch parameters jump at thresholds. Chaos off = no effect at all, whatever the macro says.
- **Heat:** tanh with first-order antiderivative anti-aliasing, `y = (F(x) − F(x₁)) / (x − x₁)`, `F = ln cosh`; drive up to +24 dB, compensation `1/√g`, gentle fade-in. Bypassed entirely at Heat 0.
- **Master filter:** ZDF SVF; LP/BP/HP/notch as a cascade of 1–4 stages with Butterworth damping `k = 2·cos((2i+1)π/4N)`, resonance only scales the last stage; peak/shelf after Simper (A = 10^(gain/40)); comb with Hermite delay; formant from 3 parallel bandpasses. Modulation (env follower, LFO, stereo phase) at control rate with linear coefficient interpolation. Bypass bit-transparent, on/off crossfaded over 20 ms, state cleared on switch-on, NaN safety net.
- **Surround:** after the pan a one-pole lowpass (20 kHz → ~4 kHz) and −2.8 dB for "behind", side component widened; orbit modulates pan (sin) and depth (cos). Spread: M/S scaling; on the synth the side signal comes from the oscillator difference. All paths are skipped at neutral values.
- **CPU guard:** moving average of block render time; above 85 % the oldest voice (preferably in its tail) is faded out in 6 ms every 6 blocks.

## Granular & global envelopes
- **Granular:** up to 12 grains per voice (pre-allocated). A new grain every `sr/grain rate` samples (±30 % jitter) at read head + spray; pitch per grain = step rate · 2^(±spread/12); Hann window (1024 points, interpolated); read with Hermite up to rate 1, above that windowed sinc with fc = 1/rate. Normalised by 1/√overlap. The read head moves at rate · scan and wraps inside the slice.
- **Global amp envelope:** blends the step ADSR with the global one at trigger time (amount 0–1).
- **Global filter envelope:** its own ADSR per voice at control rate (16 samples), adds amount × envelope in octaves to the cutoff; forces a lowpass when the step has no filter.

## Voices
- Pool of `maxVoices + 4`, everything pre-allocated (no garbage collection on the audio thread).
- Stealing: first voices in their tail (only delay/reverb left), then the oldest, with a 4 ms fade.
- Tail fast path: after release only delay/reverb is computed; the voice ends after 100 ms below about −110 dBFS.
- Denormal protection in all feedback states.

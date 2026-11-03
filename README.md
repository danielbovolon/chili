# 🌶 Chili — v0.6

**A step sequencer like a spaceship console.** Imported audio or synth, 4–32 steps, every parameter of every step drawn directly, eight macros that reshape the sound and structure of the whole sequence, a random modulator for endless complexity, scales from melodic to microtonal — and its own systems: **Mutate**, **Chaos**, **Rip**, **TRIP**.

The app name lives in one place (`APP_NAME` in `src/main.js`) — renaming is one line.

Pure Web Audio. All sound is generated sample-accurately in a single `AudioWorklet`, no third-party libraries. Runs on desktop and phone.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # → dist/ (static, runs on any web server)
npm test           # headless DSP tests
```
Browser: Chrome/Edge recommended. `file://` does not work (AudioWorklet needs http/https).

---

## What's new in v0.6
- **Whole app in English.**
- **Start page:** one plain "Start audio" button, no animation.
- **FX chain (Vital-style):** Filter, Delay, Reverb and Comp are modules in a chain. Drag a chip to move it (or use ‹ › — on touch screens they are always visible, with a mouse they appear on hover), click its LED to switch it on/off. The rows below follow the chain order. Default: **Filter → Delay → Reverb → Comp** (compressor after the delay and reverb).
- **Scale:** root + 24 scales, from melodic to experimental — Chromatic, Major, Minor, Dorian, Phrygian, Lydian, Mixolydian, Locrian, Harmonic/Melodic Minor, Major/Minor Pentatonic, Blues, Whole Tone, Diminished, Phrygian Dominant, Double Harmonic, Hungarian Minor, Hirajoshi, In Sen, Pelog, Enigmatic, Prometheus and **Quarter-tone (24-TET)**. Like Ableton's "Use Current Scale": every pitch — drawn, rolled, TRIP, chaos, warp, macro — is snapped when the step plays. **Degree** transposes the whole sequence in scale steps (±14), staying in key.
- **Roll for all rows** moved into the sequencer bar ("All rows" 🎲 1 / 🎲 ALL), next to the pattern tools (shift, double, undo/redo).
- **Fix:** 🎲 ALL for all rows left every lane flat — it now gives every step of every row its own value.
- **Rack:** AMP-ENV moved out of the monitor column; it now sits above the FILTER (with its FILTER-ENV).

## Console layout (compact, everything visible)

| Area | Contents |
|---|---|
| **Deck** (one row) | Play · Bounce · tempo LCD (BPM / Hz / Note) · Steps · Grid · Direction · Swing · Scale + Degree · 8 macros · TRIP |
| **Sample** | compact waveform with zoom, overview, slices, live playheads · slice modes · **⟁ Peaks** |
| **Layer stack** | 15 layers, every parameter a lane across all steps · pattern tools · "All rows" dice |
| **Rack** (no tabs) | left: AMP-ENV · FILTER (with FILTER-ENV) · FX CHAIN · CHAOS — right: MONITOR (scope + spectrum) · SURROUND · REC · RIP |
| **MASTER** | fader (max 0 dB), LED meter, peak, LUFS, limiter, DSP |

At 1920×1080 the whole rack fits without scrolling; on smaller screens each rack column scrolls on its own. On a phone a tab bar splits the console into **SEQ · MACRO · RACK · MASTER**.
Ableton-style knobs: name on top, arc with needle, value below — drag, Shift = fine, mouse wheel, double-click = default.

### Navigating the sample
Wheel zooms around the cursor · Shift+wheel or horizontal swipe scrolls · dragging empty space scrolls · clicking a slice number zooms to that slice · **− + ⤢** · overview bar below: drag the window, double-click = all.
Dragging a marker moves a slice boundary — including the start of the first and the end of the last slice. Double-click adds a marker, right-click removes it.

### ⟁ Find peaks
Finds the strongest transients in the whole sample (log energy flux, min. spacing 45 ms), cuts just before each peak at the next zero crossing and puts one peak on each step.

### Granular
Every sample step can play granular (layer "Granular"): grain size 5–500 ms, grain rate 1–200/s, position, spray, scan (read speed, 0 = freeze, negative = backwards), pitch spread up to ±24 st, stereo width. Hann-windowed grains, read with sinc anti-aliasing when pitched up. Presets: Cloud, Freeze, Stutter, Shimmer, Reverse Haze.

### Global envelopes
- **AMP-ENV** acts on every step; "Amount" blends between the step's own envelope and the global one.
- **FILTER-ENV** moves every step's cutoff by ±8 octaves; steps without their own filter get a lowpass for it.
- Both show live where the most recently triggered voice is on the curve.

### Surround panner
Circular field with listener and 5.1 speakers. Every step is a dot — drag it to set pan and depth. Orbit paths are drawn, sounding voices glow.
**5 presets:** Stage · Circle · Spiral · Orbit · Swarm (plus ⟲ centre).

## 🌀 TRIP — psychedelic sequences
One click builds a psychedelic sequence: slow phaser and flanger sweeps per step, tape wobble (Mutate warp), shimmer delay with wow, big spaces, voices orbiting in surround, looping filter shapes, granular clouds, gentle chaos drift, master filter with a slow stereo LFO. Every roll is different; Ctrl/⌘+Z takes it back. With a scale set, TRIP stays in key.
**Master delay:** **Wow** (tape modulation of the delay time) and **Shimmer** (±12 semitone pitch shift in the feedback — every repeat an octave higher).

## On = on, off = off
Every switch shows what really happens: Chaos off is off even with the Chaos macro up; Comp/Delay/Reverb have their own switches — off is off even with the Space macro up. The other way round, turning a mix knob above 0 switches its module on, the Chaos macro switches Chaos on, and the Space macro above centre switches master delay and reverb on. A test checks bit-exactly that switched-off modules don't touch the signal.

## Simple to extremely complex
- **Simple:** drop a sample → it's sliced and laid onto the steps automatically → Play.
- **Quick:** turn macros, roll dice, change direction, pick a scale.
- **Deep:** draw every lane of every layer by hand, ratchets per step, chaos on individual rows.
- **Infinite:** Chaos ∞ — every parameter of every step changes on every trigger.

### Macros (neutral = no effect)
| Macro | Effect |
|---|---|
| **Heat** | saturation of the sequencer bus (tanh with ADAA, low aliasing), more resonance and filter sweep |
| **Density** | left: the pattern thins out · right: ghost notes on empty steps and sprinkled ratchets |
| **Warp** | micro-timing, pitch drift, start jitter, length variation, sometimes reversed |
| **Tone** | all filter cutoffs ±3 octaves |
| **Pitch** | transpose ±24 semitones (snapped to the scale when one is set) |
| **Length** | all note lengths ×0.1 … ×4 (staccato to drone) |
| **Space** | left dry · right more master delay/reverb, spread and surround orbit |
| **Chaos** | overall depth of the random modulator |

### Dice 🎲
- **Per row:** 🎲 **1** = one random preset (curated or generated), the same on all steps · 🎲 **ALL** = every step gets its own random value.
- **All rows (sequencer bar):** 🎲 **1** = every row one random preset (gates stay) · 🎲 **ALL** = every step of every row random, gates included. "Roll 1" is flat across steps by design — it's one preset per row; "ALL" is the one that varies per step.
- **Per lane:** 🎲 rolls only that lane.

### Chaos — random modulator (after VCV Random)
One random channel per target parameter, clocked in steps.
**Depth** · **Rate** (new value every n steps) · **Chance** (roll at all) · **Random** (jump size from the previous value) · **Shape** (step → linear → smooth → exponential, continuous) · **Lock** + **Loop** (repeat phrases like a Turing Machine) · **Relative/Absolute** · **Seed** · **Targets** (each row separately, plus gates).
"∞ Infinite" sets everything to maximum.

### Master filter
LP · BP · HP · Notch (12/24/36/48 dB/oct, Butterworth stages, resonance in the last stage) · Peak · Low/High shelf · Comb ± · Formant (vowel morph A–E–I–O–U).
Drive before the filter (ADAA) · envelope follower (amount, attack, release) · LFO (free or tempo-synced, 6 shapes) · stereo phase · L/R offset · mix · output. The response curve itself moves with the modulation — left red, right cyan. Its position in the master signal path is set in the FX chain.

### Surround & spread per step (layer "Space")
Per step: **Pan** (left/right), **Depth** (front → back), **Orbit** (circles the listener at its own rate), **Spread** (stereo width 0–200 %; on the synth spread separates the two oscillators). Plus random pan, pan modulation and autopan.
Output is stereo: "behind" is psychoacoustic (high-frequency damping as by head and pinna, quieter, wider).

### Ratchets & direction
- **Ratchet** 1–8 repeats per step, **Ratchet Dyn** (swelling/falling).
- **Direction:** forward · reverse · ping-pong · random · brown · skip.

### Slicing like Simpler/Sampler
**Auto** (transients, otherwise beat grid) · **Transient** (with sensitivity) · **Beat** (grid 1/2–1/32 at the project tempo) · **Region** (equal parts) · **Manual**: drag markers in the viewport, double-click adds one, right-click removes it.
**Slice → step mapping:** 1 2 3 … · reverse · ping-pong · random · only 1.

### Layer system
Sequence (level, chance, length, ratchet, source, rip weight) · Sample · Granular · Synth · Envelope · Filter · Space · Tremolo · Pitch-Mod · Phaser · Flanger · Chorus · Delay · Reverb · Mutate.
Show/hide layers in the bar, bypass ⏻ per layer, expand/collapse for all lanes.

| Gesture in a lane | Effect |
|---|---|
| Drag | draw, across any number of steps |
| Shift + drag | straight line / ramp |
| Alt + drag | fine and relative |
| Ctrl/⌘ + drag | all steps at once |
| Right-click / double-click | default value |
| Alt + wheel | single step, fine |
| Step number | preview |

### Mutate · Rip
- **Mutate:** the attack stays identical on every trigger; after it, Mutate re-modulates pitch, filter, space, warp and level each time.
- **Rip:** beat repeat driven by a recurrent neural network that learns from every repeat. The brain is saved with the project.

### Recording, projects, settings
- **REC:** input or master straight into a sample, synced to step 1 with count-in and latency compensation, sample-accurate.
- **Bounce:** master to WAV (16/24-bit with TPDF dither or 32-bit float).
- Projects stored locally in IndexedDB including the original audio; export/import as `.chili`.
- Settings: sample rate up to 96 kHz, latency, output device, resampling quality, voices, pan law, limiter/ceiling, reference pitch, autosave …

---

## Sound quality — measured (`npm test`, 48 kHz)

| Test | Result |
|---|---|
| Synth saw C8: strongest non-harmonic | −99 dB |
| Sampler +12 st on a 15 kHz sine, alias residue (quality High) | −115 dB |
| Sampler unchanged, all new features neutral | bit-exact |
| Heat saturation, 5 kHz sine, +24 dB drive: aliasing naive → ADAA | −47 dB → −71 dB |
| Master filter LP 48 dB/oct at 1 kHz: level at 2 kHz | −48.5 dB |
| Master filter: 10 types, resonance 1, drive 36 dB, LFO/env full | stable, no NaN |
| Chaos 100 % on 76 parameters + all macros + ratchets | stable, peak ≤ −0.3 dBFS |
| Ratchet 4 | exactly 4 hits per step |
| Global amp envelope (decay 40 ms, sustain 0) | silence after 0.4 s (−240 dB) |
| Global filter envelope −8 oct on a step without filter | 20th harmonic −59 → −126 dB |
| Granular: 12 voices × 200 grains/s, ±24 st | stable, ~15 % real-time |
| Chaos off + FX off with macro/mix at 100 % | bit-exact to the dry signal |
| FX chain: all 24 orders | stable; comp first vs. last changes the sound |
| Scale: 32 notes with chaos + warp in D minor pentatonic | all in key |
| Synced recording with count-in + latency compensation | sample-accurate |

**CPU guard:** under sustained load above 85 % the engine fades the oldest tails (delay/reverb) in 6 ms instead of risking dropouts.

## Structure
```
src/
  main.js                 app controller, layout, undo, global dice
  styles.css              spaceship console, desktop + phone
  audio/  chili-processor.js (all DSP) · engine.js · slicer.js · wav.js
  state/  params.js (params, scales) · layers.js (layers, presets) · project.js · storage.js
  ui/     deck.js (transport, scale, macros, TRIP) · viewport.js (sample bar) · lanes.js (layer stack)
          rack.js (monitor, surround, envelopes) · master.js (FX chain, filter, master) · chaos.js
          special.js (Rip) · recorder.js · pages.js · dom.js
tests/dsp.test.mjs
docs/DSP.md
```

## Limits of v0.6
- Surround is rendered as stereo (psychoacoustic); true multichannel output (quad/5.1/7.1) is the next step.
- Step parameters take effect from the next trigger; macros, master, scale and bypass from the next step.
- Delay and reverb per step run per voice — many long tails at once cost CPU (the guard kicks in then).
- Drag-and-drop in the FX chain uses the mouse; on touch screens use the ‹ › buttons.
- Code comments are still partly German; everything you see in the app is English.
- No MIDI control, no licence file.

/* Chili — Headless-DSP-Tests (Node ≥ 18): node tests/dsp.test.mjs
 * Lädt den AudioWorkletProcessor mit Mocks und prüft:
 *  1. Stabilität: keine NaN/Inf, Peak ≤ Ceiling mit allen FX, Collide und Rip aktiv
 *  2. Aliasing Synth: Sägezahn auf C8 → Energie außerhalb der Harmonischen
 *  3. Aliasing Sampler: 15-kHz-Sinus +12 st hochgepitcht (→ 30 kHz > Nyquist) muss verschwinden
 *  4. Echtzeitfaktor (CPU) */
import { makeStep, masterDefaults, collideDefaults, ripDefaults } from '../src/state/params.js';

const SR = 48000;
let Proc;
globalThis.sampleRate = SR; globalThis.currentTime = 0;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {}, onmessage: null }; } };
globalThis.registerProcessor = (_n, c) => { Proc = c; };
await import('../src/audio/chili-processor.js');

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? '✔' : '✘'} ${msg}`); if (!c) fails++; };
const db = (x) => 20 * Math.log10(Math.max(1e-12, x));

function mk(lobes = 16) { return new Proc({ processorOptions: { lobes, maxVoices: 16 } }); }
function render(p, seconds) {
  const N = 128, L = new Float32Array(Math.round(seconds * SR)), R = new Float32Array(L.length), oL = new Float32Array(N), oR = new Float32Array(N);
  for (let i = 0; i + N <= L.length; i += N) { p.process([], [[oL, oR]]); L.set(oL, i); R.set(oR, i); globalThis.currentTime += N / SR; }
  return { L, R };
}
function state(steps, extra = {}) {
  return { bpm: 120, division: '1/16', swing: 0, len: 16, steps, slices: extra.slices || [], collide: extra.collide || collideDefaults(), rip: extra.rip || ripDefaults(), master: extra.master || masterDefaults() };
}
function dft(x, f) { let re = 0, im = 0; for (let i = 0; i < x.length; i++) { const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (x.length - 1)); re += x[i] * w * Math.cos((2 * Math.PI * f * i) / SR); im -= x[i] * w * Math.sin((2 * Math.PI * f * i) / SR); } return Math.hypot(re, im) / x.length; }

/* --- Testsample: Rauschbursts + Sinus-Sweep, 2 s stereo */
const n = SR * 2, sL = new Float32Array(n), sR = new Float32Array(n);
for (let i = 0; i < n; i++) { const t = i / SR, env = Math.exp(-((t * 4) % 1) * 6); sL[i] = 0.5 * env * (Math.random() * 2 - 1) + 0.3 * Math.sin(2 * Math.PI * (200 + 2000 * t) * t); sR[i] = sL[i] * 0.8; }

/* 1. Stresstest */
{
  const p = mk(); p.onMsg({ type: 'sample', id: 's', L: sL, R: sR });
  const slices = Array.from({ length: 8 }, (_, i) => ({ sampleId: 's', a: i / 8, b: (i + 1) / 8 }));
  const steps = Array.from({ length: 32 }, (_, i) => makeStep({
    source: i % 3 === 0 ? 'synth' : 'sample', slice: i % 8, note: 40 + (i * 7) % 40, pitch: (i % 5) * 5 - 10, gate: 2, fType: 'lp', cutoff: 800, res: 0.9, fEnvAmt: 6, fEnvShape: 'random', fEnvLoop: true,
    mutate: 1, panRnd: 1, panModDepth: 1, autopan: 1, tremDepth: 1, tremShape: 'square', pmDepth: 3, phaserMix: 1, phaserFb: 0.9, flangerMix: 1, flangerFb: 0.9, chorusMix: 1,
    delayMix: 1, delayFb: 0.95, verbMix: 1, verbDecay: 12, gain: 6, reverse: i % 2 === 1, loop: i % 4 === 1,
  }));
  const master = masterDefaults(); master.comp.mix = 1; master.delay.mix = 0.5; master.delay.fb = 0.9; master.verb.mix = 0.6; master.verb.decay = 20; master.fader = 1;
  const collide = { ...collideDefaults(), on: true, energy: 1, accel: 1, ratio: 2.5 };
  const rip = { ...ripDefaults(), on: true, chance: 1, plast: 1, pitch: 12 };
  p.onMsg({ type: 'settings', panLaw: 'm3', limiter: true, ceiling: -0.3, refA: 440 });
  p.onMsg({ type: 'state', state: state(steps, { slices, master, collide, rip }) });
  p.onMsg({ type: 'play', on: true });
  const t0 = performance.now(); const out = render(p, 20); const ms = performance.now() - t0;
  let finite = true, pk = 0; for (let i = 0; i < out.L.length; i++) { const a = out.L[i], b = out.R[i]; if (!Number.isFinite(a) || !Number.isFinite(b)) { finite = false; break; } pk = Math.max(pk, Math.abs(a), Math.abs(b)); }
  ok(finite, 'Stresstest: alle Samples endlich (kein NaN/Inf)');
  ok(pk <= Math.pow(10, -0.3 / 20) + 1e-6, `Stresstest: Peak ${db(pk).toFixed(2)} dBFS ≤ −0.3 dBFS (Safety-Limiter)`);
  ok(pk > 0.01, 'Stresstest: Signal vorhanden');
  ok(p.rip.events > 0, `Rip hat ${p.rip.events} Events ausgelöst, ${p.rip.learns} Lernschritte`);
  console.log(`  ⏱  Worst-Case-Last: ${(ms / 20000 * 100).toFixed(1)} % Echtzeit (20 s Audio in ${ms.toFixed(0)} ms)`);
}

/* 2. Synth-Aliasing: Sägezahn C8 (4186 Hz) */
{
  const p = mk();
  const st = makeStep({ source: 'synth', note: 108, osc1: 'saw', osc2: 'saw', osc2Fine: 0, oscMix: 0, gate: 16, sus: 1, atk: 0, dec: 1000, gain: -6 });
  const steps = [st, ...Array.from({ length: 31 }, () => makeStep({ on: false }))];
  p.onMsg({ type: 'settings', limiter: false }); p.onMsg({ type: 'state', state: state(steps) });
  p.onMsg({ type: 'audition', step: 0 });
  const out = render(p, 0.6).L.slice(SR * 0.1, SR * 0.1 + 16384);
  const f0 = 440 * Math.pow(2, (108 - 69) / 12);
  const fund = dft(out, f0);
  let worst = 0;
  for (let f = 100; f < 23900; f += 37) { let nearH = false; for (let h = 1; h * f0 < 24000; h++) if (Math.abs(f - h * f0) < 60) nearH = true; if (!nearH) worst = Math.max(worst, dft(out, f)); }
  const rel = db(worst / fund);
  ok(rel < -80, `Synth-Saw C8: stärkste Nicht-Harmonische ${rel.toFixed(1)} dB unter Grundton (Ziel < −80 dB)`);
}

/* 3. Sampler-Aliasing: 15 kHz → +12 st */
for (const lobes of [12, 16, 24]) {
  const p = mk(lobes);
  const len = SR, a = new Float32Array(len); for (let i = 0; i < len; i++) a[i] = 0.5 * Math.sin((2 * Math.PI * 15000 * i) / SR);
  p.onMsg({ type: 'sample', id: 'x', L: a, R: a.slice() });
  const st = makeStep({ source: 'sample', slice: 0, pitch: 12, gate: 16, atk: 0, sus: 1 });
  p.onMsg({ type: 'settings', limiter: false, panLaw: 'bal' });
  p.onMsg({ type: 'state', state: state([st, ...Array.from({ length: 31 }, () => makeStep({ on: false }))], { slices: [{ sampleId: 'x', a: 0, b: 1 }] }) });
  p.onMsg({ type: 'audition', step: 0 });
  const out = render(p, 0.4).L.slice(SR * 0.05, SR * 0.35);
  let rms = 0; for (const v of out) rms += v * v; rms = Math.sqrt(rms / out.length);
  const rel = db(rms / (0.5 / Math.SQRT2));
  ok(rel < (lobes >= 16 ? -60 : -50), `Sampler ${lobes * 2} Taps: 15 kHz +12 st (Alias bei 18 kHz) → Rest ${rel.toFixed(1)} dB`);
}

/* 4. Bit-Transparenz bei Unity-Pitch */
{
  const p = mk();
  const a = new Float32Array(SR); for (let i = 0; i < SR; i++) a[i] = Math.random() * 0.5 - 0.25;
  p.onMsg({ type: 'sample', id: 'y', L: a, R: a.slice() });
  const st = makeStep({ source: 'sample', slice: 0, gate: 16, atk: 0, sus: 1 });
  p.onMsg({ type: 'settings', limiter: false, panLaw: 'bal' });
  const m = masterDefaults(); m.fader = 1;
  p.onMsg({ type: 'state', state: state([st, ...Array.from({ length: 31 }, () => makeStep({ on: false }))], { slices: [{ sampleId: 'y', a: 0, b: 1 }], master: m }) });
  for (let i = 0; i < 200; i++) render(p, 128 / SR); // Fader einschwingen
  p.onMsg({ type: 'audition', step: 0 });
  const out = render(p, 0.5).L;
  let maxErr = 0; for (let i = 2000; i < 20000; i++) maxErr = Math.max(maxErr, Math.abs(out[i] - a[i]));
  ok(maxErr < 1e-6, `Unity-Pitch, Fader 0 dB, Pan-Law Balance: bit-genau (max. Abweichung ${maxErr.toExponential(1)})`);
}

console.log(fails ? `\n${fails} Test(s) fehlgeschlagen` : '\nAlle Tests bestanden 🌶');
process.exit(fails ? 1 : 0);

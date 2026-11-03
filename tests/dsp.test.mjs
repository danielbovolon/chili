/* Chili — Headless-DSP-Tests (Node ≥ 18): node tests/dsp.test.mjs
 * Lädt den AudioWorkletProcessor mit Mocks und prüft:
 *  1. Stabilität: keine NaN/Inf, Peak ≤ Ceiling mit allen FX, Collide und Rip aktiv
 *  2. Aliasing Synth: Sägezahn auf C8 → Energie außerhalb der Harmonischen
 *  3. Aliasing Sampler: 15-kHz-Sinus +12 st hochgepitcht (→ 30 kHz > Nyquist) muss verschwinden
 *  4. Echtzeitfaktor (CPU) */
import { makeStep, masterDefaults, ripDefaults, macroDefaults, chaosDefaults, genvDefaults, MF_TYPES } from '../src/state/params.js';
import { chaosKeys, scaleState } from '../src/state/project.js';

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
  return { bpm: 120, division: '1/16', swing: 0, len: 16, steps, slices: extra.slices || [], genv: extra.genv || genvDefaults(), rip: extra.rip || ripDefaults(), master: extra.master || masterDefaults() };
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
    delayMix: 1, delayFb: 0.95, verbMix: 1, verbDecay: 12, gain: 6, reverse: i % 2 === 1, loop: i % 4 === 1, grMode: i % 3 === 2, grPitch: 12, grSpray: 1, grDensity: 200, grSize: 300,
  }));
  const master = masterDefaults(); master.comp.on = master.delay.on = master.verb.on = true; master.comp.mix = 1; master.delay.mix = 0.5; master.delay.fb = 0.95; master.delay.shift = 12; master.delay.mod = 1; master.verb.mix = 0.6; master.verb.decay = 20; master.fader = 1;
  const genv = genvDefaults(); genv.amp.on = true; genv.flt.on = true; genv.flt.amt = 8;
  const rip = { ...ripDefaults(), on: true, chance: 1, plast: 1, pitch: 12 };
  p.onMsg({ type: 'settings', panLaw: 'm3', limiter: true, ceiling: -0.3, refA: 440 });
  p.onMsg({ type: 'state', state: state(steps, { slices, master, genv, rip }) });
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

/* 5. Aufnahme: Sync-Start auf Step 1, exakte Länge, Count-in, Latenzausgleich */
{
  const p = mk(), msgs = [], chunks = [];
  p.port.postMessage = (m) => { msgs.push(m); if (m.type === 'cap') chunks.push(m); };
  p.onMsg({ type: 'state', state: { ...state(Array.from({ length: 32 }, () => makeStep({ on: false }))), bpm: 117 } }); // krummes Tempo → Steps nicht blockbündig
  const comp = 137; // Latenzausgleich in Samples
  p.onMsg({ type: 'capArm', mode: 'sync', src: 'input', passes: 2, countIn: 1, compN: comp });
  p.onMsg({ type: 'play', on: true });
  // Eingang: Sample-Zähler als Signal → prüft exakte Position
  const N = 128; let k = 0; const oL = new Float32Array(N), oR = new Float32Array(N);
  for (let b = 0; b < 6000 && !msgs.some((m) => m.type === 'capEnd'); b++) {
    const iL = new Float32Array(N), iR = new Float32Array(N); for (let i = 0; i < N; i++) { iL[i] = (k + i) / 1e6; iR[i] = -(k + i) / 1e6; }
    p.process([[iL, iR]], [[oL, oR]]); k += N;
  }
  const L = chunks.flatMap((c) => Array.from(c.L));
  const stepN = (240 / 117) * (1 / 16) * SR, want = Math.ceil(16 * 3 * stepN) - Math.ceil(16 * stepN);
  ok(L.length === want, `Sync-Aufnahme: ${L.length} Samples = 2 Durchläufe × 16 Steps (erwartet ${want})`);
  const start = Math.round(L[0] * 1e6), expected = Math.ceil(16 * stepN) + comp; // Count-in 1 Durchlauf + Ausgleich
  ok(start === expected, `Sync-Start sample-genau nach Count-in + Latenzausgleich (Sample ${start}, erwartet ${expected})`);
  ok(msgs.some((m) => m.type === 'capState' && m.state === 'countin') && msgs.some((m) => m.type === 'capState' && m.state === 'recording'), 'Status: Count-in → Aufnahme → fertig');
}

/* 6. Master-Filter: alle Typen × Flanken, Resonanz 1, Drive 36 dB, LFO + Env → stabil und begrenzt */
{
  let worst = 0, bad = 0;
  for (const [type] of MF_TYPES) for (const slope of [1, 4]) {
    const p = mk(); const a = new Float32Array(SR); for (let i = 0; i < SR; i++) a[i] = (Math.random() * 2 - 1) * 0.5;
    p.onMsg({ type: 'sample', id: 'n', L: a, R: a.slice() }); p.onMsg({ type: 'settings', limiter: false });
    const m = masterDefaults(); m.fader = 1; Object.assign(m.filter, { on: true, type, slope, res: 1, drive: 36, envAmt: 4, lfoDepth: 4, lfoRate: 7, stereo: 1, spreadOct: 1, cutoff: 600, gain: 18, vowel: 2.5 });
    const st = makeStep({ source: 'sample', slice: 0, gate: 16, sus: 1, loop: true });
    p.onMsg({ type: 'state', state: state([st, ...Array.from({ length: 31 }, () => makeStep({ on: false }))], { slices: [{ sampleId: 'n', a: 0, b: 1 }], master: m }) });
    p.onMsg({ type: 'audition', step: 0 });
    const o = render(p, 1.2); for (let i = 0; i < o.L.length; i++) { const v = Math.abs(o.L[i]) + Math.abs(o.R[i]); if (!Number.isFinite(v)) bad++; else worst = Math.max(worst, v / 2); }
  }
  ok(bad === 0, 'Master-Filter: 10 Typen × 2 Flanken, Resonanz 1, Drive +36 dB, LFO/Env voll — kein NaN/Inf');
  ok(worst < 8, `Master-Filter: Pegel bleibt begrenzt (max. ${db(worst).toFixed(1)} dBFS vor dem Limiter)`);
}
/* 7. Master-Filter-Flanke: LP 48 dB/Okt — Dämpfung eine Oktave über Cutoff */
{
  const meas = (f) => {
    const p = mk(); const a = new Float32Array(SR); for (let i = 0; i < SR; i++) a[i] = 0.25 * Math.sin((2 * Math.PI * f * i) / SR);
    p.onMsg({ type: 'sample', id: 's', L: a, R: a.slice() }); p.onMsg({ type: 'settings', limiter: false, panLaw: 'bal' });
    const m = masterDefaults(); m.fader = 1; Object.assign(m.filter, { on: true, type: 'lp', slope: 4, res: 0, cutoff: 1000 });
    p.onMsg({ type: 'state', state: state([makeStep({ source: 'sample', slice: 0, gate: 16, sus: 1, atk: 0 }), ...Array.from({ length: 31 }, () => makeStep({ on: false }))], { slices: [{ sampleId: 's', a: 0, b: 1 }], master: m }) });
    p.onMsg({ type: 'audition', step: 0 }); const o = render(p, 0.6).L.slice(SR * 0.3, SR * 0.55);
    let r = 0; for (const v of o) r += v * v; return Math.sqrt(r / o.length) / (0.25 / Math.SQRT2);
  };
  const a1 = db(meas(2000)), a0 = db(meas(250));
  ok(a1 < -40 && a0 > -1.5, `Master-Filter LP 48 dB/Okt bei 1 kHz: 250 Hz ${a0.toFixed(1)} dB, 2 kHz ${a1.toFixed(1)} dB (≈ −48 erwartet)`);
}
/* 8. Heat: ADAA-Sättigung vs. naive tanh — Aliasing eines 5-kHz-Sinus bei voller Heat */
{
  const f0 = 4987, N2 = 32768, x = new Float64Array(N2); for (let i = 0; i < N2; i++) x[i] = 0.7 * Math.sin((2 * Math.PI * f0 * i) / SR);
  const g = Math.pow(10, 24 / 20);
  const naive = Array.from(x, (v) => Math.tanh(v * g));
  const stt = new Float64Array(2), lc = (v) => (Math.abs(v) > 12 ? Math.abs(v) - Math.LN2 : Math.log(Math.cosh(v)));
  const ad = Array.from(x, (v) => { const x1 = stt[0]; stt[0] = v * g; const d = v * g - x1; return Math.abs(d) > 1e-5 ? (lc(v * g) - lc(x1)) / d : Math.tanh(0.5 * (v * g + x1)); });
  const alias = (y) => { let w = 0; for (let f = 200; f < 23800; f += 61) { let near = false; for (let hh = 1; hh * f0 < 24000; hh++) if (Math.abs(f - hh * f0) < 90) near = true; if (!near) w = Math.max(w, dft(Float32Array.from(y), f)); } return db(w / dft(Float32Array.from(y), f0)); };
  const an = alias(naive), aa = alias(ad);
  ok(aa < an - 6, `Heat-Sättigung: Alias-Produkte naiv ${an.toFixed(1)} dB → ADAA ${aa.toFixed(1)} dB (unter dem Grundton)`);
}
/* 9. Chaos + alle Makros auf Anschlag + Ratchets + Zufallsrichtung: stabil */
{
  const p = mk(); p.onMsg({ type: 'sample', id: 's', L: sL, R: sR });
  const slices = Array.from({ length: 8 }, (_, i) => ({ sampleId: 's', a: i / 8, b: (i + 1) / 8 }));
  const steps = Array.from({ length: 32 }, (_, i) => makeStep({ source: i % 2 ? 'synth' : 'sample', slice: i % 8, ratchet: 1 + (i % 4), ratchVel: 0.5, fType: 'lp', orbit: 0.7, depth: 0.5, spread: 2 }));
  const ch = { ...chaosDefaults(), on: true, depth: 1, rate: 1, shape: 2.5, lock: 0.5, targets: ['gate', 'seq', 'src', 'syn', 'env', 'flt', 'pan', 'trm', 'pmd', 'phs', 'flg', 'cho', 'dly', 'rev', 'mut'] };
  const macros = { heat: 1, density: 1, warp: 1, tone: 1, pitch: 12, length: 4, space: 1, chaos: 1 };
  const m = masterDefaults(); m.filter.on = true; m.filter.drive = 24; m.filter.res = 0.9; m.fader = 1;
  const stt = { ...state(steps, { slices, master: m }), macros, direction: 'rnd', chaos: { ...ch, keys: chaosKeys(ch.targets) } };
  p.onMsg({ type: 'settings', limiter: true, ceiling: -0.3 }); p.onMsg({ type: 'state', state: stt }); p.onMsg({ type: 'play', on: true });
  const t0 = performance.now(); const o = render(p, 10); const ms = performance.now() - t0;
  let fin = true, pk = 0; for (let i = 0; i < o.L.length; i++) { if (!Number.isFinite(o.L[i]) || !Number.isFinite(o.R[i])) { fin = false; break; } pk = Math.max(pk, Math.abs(o.L[i]), Math.abs(o.R[i])); }
  ok(fin && pk <= Math.pow(10, -0.3 / 20) + 1e-6, `Chaos 100 % auf ${stt.chaos.keys.length} Parametern + alle Makros + Ratchets: stabil, Peak ${db(pk).toFixed(2)} dBFS`);
  console.log(`  ⏱  Last dabei: ${((ms / 10000) * 100).toFixed(1)} % Echtzeit`);
}
/* 10. Ratchet: ein Step mit Ratchet 4 erzeugt genau 4 gleichmäßig verteilte Anschläge */
{
  const p = mk(); let starts = [];
  const st = makeStep({ source: 'synth', note: 60, ratchet: 4, atk: 0, dec: 5, sus: 0, rel: 5 });
  p.onMsg({ type: 'state', state: state([st, ...Array.from({ length: 31 }, () => makeStep({ on: false }))]) });
  const orig = p.startVoice.bind(p); let n = 0; p.startVoice = (...a) => { starts.push(n); return orig(...a); };
  p.onMsg({ type: 'play', on: true });
  const oL = new Float32Array(128), oR = new Float32Array(128); for (let b = 0; b < 46; b++) { p.process([], [[oL, oR]]); n += 128; }
  const stepN = (240 / 120) / 16 * SR;
  const first = starts.filter((x) => x < stepN);
  ok(first.length === 4, `Ratchet 4: ${first.length} Anschläge im ersten Step (Abstand ≈ ${Math.round(stepN / 4)} Samples, Blockraster 128)`);
}

/* 11. Globale Amp-Hüllkurve überstimmt die Step-Hüllkurve */
{
  const rms = (genvOn) => {
    const p = mk(); const g = genvDefaults(); Object.assign(g.amp, { on: genvOn, amt: 1, atk: 0, dec: 40, sus: 0, rel: 20 });
    p.onMsg({ type: 'settings', limiter: false });
    p.onMsg({ type: 'state', state: state([makeStep({ source: 'synth', note: 57, gate: 16, sus: 1, atk: 0 }), ...Array.from({ length: 31 }, () => makeStep({ on: false }))], { genv: g }) });
    p.onMsg({ type: 'audition', step: 0 }); const o = render(p, 0.6).L.slice(SR * 0.4, SR * 0.6);
    let r = 0; for (const v of o) r += v * v; return Math.sqrt(r / o.length);
  };
  const a = rms(false), b = rms(true);
  ok(a > 0.05 && b < a * 0.001, `Globale Amp-Hüllkurve (Decay 40 ms, Sustain 0): Pegel nach 0.4 s ${db(a).toFixed(1)} → ${db(b).toFixed(1)} dB`);
}
/* 12. Globale Filter-Hüllkurve: wirkt auch auf Steps ohne eigenen Filter */
{
  const hi = (on) => {
    const p = mk(); const g = genvDefaults(); Object.assign(g.flt, { on, amt: -8, atk: 0, dec: 30, sus: 1, rel: 50 });
    p.onMsg({ type: 'settings', limiter: false });
    p.onMsg({ type: 'state', state: state([makeStep({ source: 'synth', note: 45, osc1: 'saw', osc2: 'saw', gate: 16, sus: 1, atk: 0, fType: 'off', cutoff: 12000 }), ...Array.from({ length: 31 }, () => makeStep({ on: false }))], { genv: g }) });
    p.onMsg({ type: 'audition', step: 0 }); const o = render(p, 0.5).L.slice(SR * 0.25, SR * 0.25 + 8192);
    return dft(o, 440 * Math.pow(2, (45 - 69) / 12) * 20);
  };
  const a = db(hi(false)), b = db(hi(true));
  ok(b < a - 30, `Globale Filter-Hüllkurve −8 Okt auf Step ohne Filter: 20. Oberton ${a.toFixed(1)} → ${b.toFixed(1)} dB`);
}
/* 13. Granular: 12 Stimmen, Kornrate 200/s, Pitch-Streuung ±24 st → stabil, aliasarm, Last */
{
  const p = mk(); const n = SR * 2, a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = 0.5 * Math.sin((2 * Math.PI * 9000 * i) / SR);
  p.onMsg({ type: 'sample', id: 'g', L: a, R: a.slice() }); p.onMsg({ type: 'settings', limiter: false });
  const steps = Array.from({ length: 32 }, () => makeStep({ source: 'sample', slice: 0, gate: 16, sus: 1, grMode: true, grDensity: 200, grSize: 60, grPitch: 24, grSpray: 1, grScan: 1 }));
  p.onMsg({ type: 'state', state: state(steps, { slices: [{ sampleId: 'g', a: 0, b: 1 }] }) });
  for (let k = 0; k < 12; k++) p.onMsg({ type: 'audition', step: k });
  const t0 = performance.now(); const o = render(p, 4); const ms = performance.now() - t0;
  let fin = true, pk = 0; for (const v of o.L) { if (!Number.isFinite(v)) fin = false; pk = Math.max(pk, Math.abs(v)); }
  ok(fin && pk > 0.01, `Granular: 12 Stimmen × 200 Körner/s, ±24 st — stabil (Peak ${db(pk).toFixed(1)} dBFS), Last ${((ms / 4000) * 100).toFixed(1)} % Echtzeit`);
}

/* 14. Aus = wirklich aus: Chaos aus trotz Makro 100 %, FX aus trotz Mix 100 % → bit-genau wie ohne */
{
  const run = (mutate) => {
    const p = mk(); const a = new Float32Array(SR); for (let i = 0; i < SR; i++) a[i] = Math.sin(i * 0.05) * 0.3;
    p.onMsg({ type: 'sample', id: 'y', L: a, R: a.slice() }); p.onMsg({ type: 'settings', limiter: false, panLaw: 'bal' });
    const m = masterDefaults(); m.fader = 1; const st = { ...state([makeStep({ source: 'sample', slice: 0, gate: 16, atk: 0, sus: 1 }), ...Array.from({ length: 31 }, () => makeStep({ on: false }))], { slices: [{ sampleId: 'y', a: 0, b: 1 }], master: m }) };
    if (mutate) { Object.assign(m.comp, { mix: 1, on: false }); Object.assign(m.delay, { mix: 1, on: false, shift: 12 }); Object.assign(m.verb, { mix: 1, on: false }); st.macros = { ...macroDefaults(), chaos: 1 }; st.chaos = { ...chaosDefaults(), on: false, keys: chaosKeys(['flt', 'pan', 'src']) }; }
    p.onMsg({ type: 'state', state: st }); for (let i = 0; i < 200; i++) render(p, 128 / SR);
    p.onMsg({ type: 'audition', step: 0 }); return render(p, 0.4).L;
  };
  const a = run(false), b = run(true); let d = 0; for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
  ok(d === 0, `Aus = aus: Chaos aus (Makro 100 %), Comp/Delay/Reverb aus (Mix 100 %) → identisch zum Original (Abweichung ${d})`);
}

/* 15. Master chain order: all 24 orders stable; order actually changes the sound (comp before vs. after reverb) */
{
  const perms = (a) => a.length < 2 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]));
  const res = new Map(); let bad = 0;
  for (const order of perms(['filter', 'comp', 'delay', 'verb'])) {
    const p = mk(); p.onMsg({ type: 'settings', limiter: false });
    const m = masterDefaults(); m.fader = 1; m.order = order;
    Object.assign(m.filter, { on: true, type: 'lp', cutoff: 900, res: 0.7 }); Object.assign(m.comp, { on: true, mix: 1, thr: -30, ratio: 8 });
    Object.assign(m.delay, { on: true, mix: 0.5, fb: 0.6 }); Object.assign(m.verb, { on: true, mix: 0.5 });
    p.onMsg({ type: 'state', state: state([makeStep({ source: 'synth', note: 50, gate: 0.5 }), ...Array.from({ length: 31 }, () => makeStep({ on: false }))], { master: m }) });
    p.onMsg({ type: 'play', on: true }); const o = render(p, 1.5).L;
    let e = 0; for (const v of o) { if (!Number.isFinite(v)) bad++; e += v * v; } res.set(order.join('>'), e);
  }
  const a = res.get('filter>delay>verb>comp'), b = res.get('comp>filter>delay>verb');
  ok(bad === 0 && Math.abs(10 * Math.log10(a / b)) > 0.5, `Master chain: all 24 orders stable; Comp last vs. first differs by ${Math.abs(10 * Math.log10(a / b)).toFixed(1)} dB energy`);
}

/* 16. Scale quantise: every pitch lands in the scale (incl. chaos + warp), degree shift works */
{
  const p = mk(); const notes = [];
  const orig = p.startVoice.bind(p); p.startVoice = (s, ...a) => { notes.push(s.note + s.pitch + s.fine / 100); return orig(s, ...a); };
  const steps = Array.from({ length: 32 }, (_, i) => makeStep({ source: 'synth', note: 40 + ((i * 7) % 30), pitch: (i % 5) - 2, gate: 0.5 }));
  const ch = { ...chaosDefaults(), on: true, depth: 1, rate: 1, targets: ['src', 'syn'] };
  p.onMsg({ type: 'state', state: { ...state(steps), scale: scaleState({ root: 2, scale: 'pentMin', shift: 0 }), macros: { ...macroDefaults(), warp: 1 }, chaos: { ...ch, keys: chaosKeys(ch.targets) } } });
  p.onMsg({ type: 'play', on: true }); render(p, 4);
  const iv = [0, 3, 5, 7, 10], inScale = notes.every((n) => { const pc = (((n - 2) % 12) + 12) % 12; return iv.some((v) => Math.abs(pc - v) < 1e-6); });
  const p2 = mk(); let first = null; const o2 = p2.startVoice.bind(p2); p2.startVoice = (s, ...a) => { if (first === null) first = s.note + s.pitch; return o2(s, ...a); };
  p2.onMsg({ type: 'state', state: { ...state([makeStep({ source: 'synth', note: 60 }), ...Array.from({ length: 31 }, () => makeStep({ on: false }))]), scale: scaleState({ root: 0, scale: 'major', shift: 2 }) } });
  p2.onMsg({ type: 'audition', step: 0 });
  ok(notes.length > 20 && inScale && first === 64, `Scale: ${notes.length} notes with chaos + warp all in D minor pentatonic; C major +2 degrees: 60 → ${first} (E)`);
}

console.log(fails ? `\n${fails} Test(s) fehlgeschlagen` : '\nAll tests passed 🌶');
process.exit(fails ? 1 : 0);

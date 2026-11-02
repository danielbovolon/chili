/*
 * Chili v0.1 — DSP-Engine (AudioWorkletProcessor)
 *
 * Alles, was klingt, passiert hier — sample-genau, intern in 64-bit Float:
 *   Sequencer-Clock · Voices (Sampler/Synth + Step-FX) · Mutate · Collide · Rip · Master
 *
 * Qualitäts-Grundsätze (siehe docs/DSP.md):
 *  - Sample-Pitch über Windowed-Sinc-Interpolation mit Anti-Alias-Skalierung (kein lineares Resampling)
 *  - Synth-Oszillatoren aus bandbegrenzten Wavetables (halbe-Oktave-Mipmaps) → kein Aliasing
 *  - Filter: TPT/ZDF State-Variable (linear, modulationsstabil)
 *  - Alle Modulationen laufen über Control-Rate (16 Samples) mit linearer Interpolation → kein Zipper
 *  - Master-Fader max. 0 dB, geglättet; optionaler Lookahead-Safety-Limiter (bit-transparent unter Ceiling)
 */

const TAU = Math.PI * 2, PI = Math.PI, KR = 16;
const pow2 = (n) => { let p = 1; while (p < n) p <<= 1; return p; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dbLin = (db) => (db <= -120 ? 0 : Math.pow(10, db / 20));
const sig = (x) => 1 / (1 + Math.exp(-x));
const mod = (a, n) => ((a % n) + n) % n;

const SYNC = { '1/64': 1 / 64, '1/32': 1 / 32, '1/16T': 1 / 24, '1/16': 1 / 16, '1/16D': 3 / 32, '1/8T': 1 / 12, '1/8': 1 / 8, '1/8D': 3 / 16, '1/4T': 1 / 6, '1/4': 1 / 4, '1/4D': 3 / 8, '1/2': 1 / 2, '1/1': 1 };
const DIV = { '1/8': 1 / 8, '1/8T': 1 / 12, '1/16': 1 / 16, '1/16T': 1 / 24, '1/32': 1 / 32 };
const W_IDX = { sine: 0, tri: 1, saw: 2, square: 3 };
const F_IDX = { off: 0, lp: 1, hp: 2, bp: 3, notch: 4 };
const RND_SHAPES = ['rndSteps', 'rndSmooth', 'rndWalk', 'rndSpikes', 'chaos', 'rndRamps'];
const ALL_SHAPES = ['decay', 'attack', 'ad', 'rampUp', 'rampDown', 'triangle', 'sine', 'square', ...RND_SHAPES];

/* ---------------------------------------------------------------- RNG */
class Rng {
  constructor(seed = 1) { this.s = (seed >>> 0) || 0x9e3779b9; }
  next() { let x = this.s; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.s = x >>> 0; return this.s / 4294967296; }
  bi() { return this.next() * 2 - 1; }
}

/* ------------------------------------------------- Windowed-Sinc-Reader */
let SINC_LOBES = 16; const SINC_RES = 512; let SINC = null;
function buildSinc(lobes) {
  SINC_LOBES = lobes; const n = lobes * SINC_RES + 2; const t = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / SINC_RES; if (x >= lobes) { t[i] = 0; continue; }
    const s = x === 0 ? 1 : Math.sin(PI * x) / (PI * x);
    const u = x / lobes; // Blackman-Harris (4-Term), zentriert
    const w = 0.35875 + 0.48829 * Math.cos(PI * u) + 0.14128 * Math.cos(2 * PI * u) + 0.01168 * Math.cos(3 * PI * u);
    t[i] = s * w;
  }
  SINC = t;
}
const RD = new Float64Array(2);
/** Stereo-Read an Position pos; fc = Grenzfrequenz relativ zu Nyquist (<1 bei Pitch-Up → Anti-Aliasing). */
function sincRead(L, R, pos, fc) {
  const i0 = Math.floor(pos), frac = pos - i0, len = L.length;
  if (frac < 1e-10 && fc >= 1) { if (i0 >= 0 && i0 < len) { RD[0] = L[i0]; RD[1] = R[i0]; } else { RD[0] = RD[1] = 0; } return; }
  const lob = SINC_LOBES, T = SINC, span = Math.ceil(lob / fc);
  let kA = -span + 1, kB = span;
  if (i0 + kA < 0) kA = -i0; if (i0 + kB >= len) kB = len - 1 - i0;
  let sl = 0, sr = 0;
  for (let k = kA; k <= kB; k++) {
    let x = (k - frac) * fc; if (x < 0) x = -x; if (x >= lob) continue;
    const tp = x * SINC_RES, j = tp | 0, w = T[j] + (T[j + 1] - T[j]) * (tp - j), idx = i0 + k;
    sl += w * L[idx]; sr += w * R[idx];
  }
  RD[0] = sl * fc; RD[1] = sr * fc;
}
function sincReadRing(L, R, mask, pos, fc) {
  const i0 = Math.floor(pos), frac = pos - i0;
  if (frac < 1e-10 && fc >= 1) { RD[0] = L[i0 & mask]; RD[1] = R[i0 & mask]; return; }
  const lob = SINC_LOBES, T = SINC, span = Math.ceil(lob / fc);
  let sl = 0, sr = 0;
  for (let k = -span + 1; k <= span; k++) {
    let x = (k - frac) * fc; if (x < 0) x = -x; if (x >= lob) continue;
    const tp = x * SINC_RES, j = tp | 0, w = T[j] + (T[j + 1] - T[j]) * (tp - j), idx = (i0 + k) & mask;
    sl += w * L[idx]; sr += w * R[idx];
  }
  RD[0] = sl * fc; RD[1] = sr * fc;
}
/** 4-Punkt-Hermite (3. Ordnung) — für modulierte Delays */
function herm(xm1, x0, x1, x2, f) {
  const c = (x1 - xm1) * 0.5, v = x0 - x1, w = c + v, a = w + v + (x2 - x0) * 0.5, b = w + a;
  return ((a * f - b) * f + c) * f + x0;
}
function hermRead(buf, mask, w, d) {
  const rp = w - d, i = Math.floor(rp), f = rp - i;
  return herm(buf[(i - 1) & mask], buf[i & mask], buf[(i + 1) & mask], buf[(i + 2) & mask], f);
}

/* --------------------------------------- Bandbegrenzte Wavetables (Mipmaps) */
const WT_N = 4096, WT_MASK = WT_N - 1, WT_TABLES = 24; let WT = null;
function buildWavetables(sr) {
  const nyq = sr / 2, sin = new Float64Array(WT_N);
  for (let i = 0; i < WT_N; i++) sin[i] = Math.sin((TAU * i) / WT_N);
  const tri = [], saw = [], sq = [];
  let lastH = -1, lt, ls, lq;
  for (let k = 0; k < WT_TABLES; k++) {
    const fTop = 20 * Math.pow(2, (k + 1) / 2); // Tabelle k ist aliasfrei bis fTop
    const H = Math.max(1, Math.min(WT_N / 2 - 1, Math.floor(nyq / fTop)));
    if (H === lastH) { tri.push(lt); saw.push(ls); sq.push(lq); continue; }
    const a = new Float64Array(WT_N), b = new Float64Array(WT_N), c = new Float64Array(WT_N);
    for (let h = 1; h <= H; h++) {
      const as = 1 / h, odd = h & 1, at = odd ? ((((h - 1) >> 1) & 1) ? -1 : 1) / (h * h) : 0;
      for (let i = 0; i < WT_N; i++) {
        const s = sin[(h * i) & WT_MASK];
        b[i] += as * s; if (odd) { c[i] += as * s; a[i] += at * s; }
      }
    }
    lt = new Float32Array(WT_N); ls = new Float32Array(WT_N); lq = new Float32Array(WT_N);
    for (let i = 0; i < WT_N; i++) { lt[i] = a[i] * (8 / (PI * PI)) * 0.85; ls[i] = b[i] * (2 / PI) * 0.75; lq[i] = c[i] * (4 / PI) * 0.6; }
    tri.push(lt); saw.push(ls); sq.push(lq); lastH = H;
  }
  return [null, tri, saw, sq];
}
function wtIndex(f) { if (f <= 28.28) return 0; const k = Math.ceil(2 * Math.log2(f / 20)) - 1; return k < 0 ? 0 : k >= WT_TABLES ? WT_TABLES - 1 : k; }
function wtRead(tab, ph) {
  const p = ph * WT_N, i = p | 0, f = p - i;
  return herm(tab[(i - 1) & WT_MASK], tab[i & WT_MASK], tab[(i + 1) & WT_MASK], tab[(i + 2) & WT_MASK], f);
}

/* Hann-Fenster für Grains */
const WIN = new Float32Array(1025); for (let i = 0; i <= 1024; i++) WIN[i] = 0.5 - 0.5 * Math.cos((TAU * i) / 1024);

/* --------------------------------------------------------- Formen / LFO */
function genPts(kind, rng, p) {
  switch (kind) {
    case 'rndSteps': case 'rndSmooth': for (let i = 0; i < 8; i++) p[i] = rng.next(); break;
    case 'rndWalk': { let v = rng.next(); for (let i = 0; i < 16; i++) { p[i] = v; v = clamp(v + rng.bi() * 0.3, 0, 1); } break; }
    case 'chaos': { let v = 0.1 + rng.next() * 0.8; const r = 3.6 + rng.next() * 0.399; for (let i = 0; i < 16; i++) { v = r * v * (1 - v); p[i] = v; } break; }
    case 'rndSpikes': for (let i = 0; i < 4; i++) { p[i] = rng.next() * 0.85; p[i + 4] = 0.3 + rng.next() * 0.7; } break;
    case 'rndRamps': for (let i = 0; i < 6; i++) p[i] = 0.2 + rng.next() * 0.8; break;
  }
}
function shapeVal(kind, x, p) {
  switch (kind) {
    case 'decay': return Math.exp(-5 * x);
    case 'attack': return 1 - Math.exp(-5 * x);
    case 'ad': return x < 0.12 ? x / 0.12 : Math.exp((-4.5 * (x - 0.12)) / 0.88);
    case 'rampUp': return x;
    case 'rampDown': return 1 - x;
    case 'triangle': return x < 0.5 ? 2 * x : 2 - 2 * x;
    case 'sine': return 0.5 - 0.5 * Math.cos(TAU * x);
    case 'square': return x < 0.5 ? 1 : 0;
    case 'rndSteps': return p[Math.min(7, (x * 8) | 0)];
    case 'rndSmooth': { const q = x * 7, i = Math.min(7, q | 0), f = q - i, a = p[i], b = p[Math.min(7, i + 1)]; return a + (b - a) * (0.5 - 0.5 * Math.cos(PI * f)); }
    case 'rndWalk': case 'chaos': { const q = x * 15, i = Math.min(15, q | 0), f = q - i; return p[i] + (p[Math.min(15, i + 1)] - p[i]) * f; }
    case 'rndSpikes': { let v = 0; for (let i = 0; i < 4; i++) { const d = x - p[i]; if (d >= 0) { const s = p[i + 4] * Math.exp(-d * 22); if (s > v) v = s; } } return v; }
    case 'rndRamps': { const q = x * 6, i = Math.min(5, q | 0), f = q - i; return p[i] * (1 - f); }
  }
  return 0;
}
class Lfo {
  constructor() { this.ph = 0; this.a = 0; this.b = 0; }
  reset(ph, rng) { this.ph = ph; this.a = rng.bi(); this.b = rng.bi(); }
  step(inc, shape, rng) {
    let ph = this.ph + inc; if (ph >= 1) { ph -= Math.floor(ph); this.a = this.b; this.b = rng.bi(); } this.ph = ph;
    switch (shape) {
      case 'tri': return ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
      case 'square': return ph < 0.5 ? 1 : -1;
      case 'saw': return 2 * ph - 1;
      case 'sh': return this.a;
      case 'smooth': return this.a + (this.b - this.a) * (0.5 - 0.5 * Math.cos(PI * ph));
      default: return Math.sin(TAU * ph);
    }
  }
}
const PG = new Float64Array(2);
function panGains(p, law) {
  const th = ((p + 1) * PI) / 4;
  switch (law) {
    case 'eq0': PG[0] = Math.SQRT2 * Math.cos(th); PG[1] = Math.SQRT2 * Math.sin(th); break;
    case 'lin': PG[0] = (1 - p) / 2; PG[1] = (1 + p) / 2; break;
    case 'm45': PG[0] = Math.sqrt(Math.cos(th) * (1 - p) / 2); PG[1] = Math.sqrt(Math.sin(th) * (1 + p) / 2); break;
    case 'bal': PG[0] = p > 0 ? 1 - p : 1; PG[1] = p < 0 ? 1 + p : 1; break;
    default: PG[0] = Math.cos(th); PG[1] = Math.sin(th);
  }
}

/* ------------------------------------------------------ FDN-Reverb (8×8) */
const FDN_BASE = [1031, 1327, 1523, 1871, 2053, 2311, 2593, 2789];
const FO = new Float64Array(2);
class FDN {
  constructor(sr, maxSec) {
    this.sr = sr; const n = pow2(Math.ceil(maxSec * sr) + 4); this.mask = n - 1; this.w = 0;
    this.ln = []; for (let i = 0; i < 8; i++) this.ln.push(new Float32Array(n));
    this.len = new Int32Array(8); this.g = new Float64Array(8); this.lp = new Float64Array(8); this.o = new Float64Array(8); this.c = 0.5;
    this.set(0.5, 2, 0.5, 1);
  }
  set(size, t60, damp, scale) {
    const sr = this.sr, k = (sr / 48000) * (0.35 + 1.3 * clamp(size, 0, 1)) * scale;
    for (let i = 0; i < 8; i++) {
      const L = clamp(Math.round(FDN_BASE[i] * k), 8, this.mask - 4);
      this.len[i] = L; this.g[i] = Math.pow(10, (-3 * L) / (sr * Math.max(0.05, t60)));
    }
    const fc = 400 + 19000 * Math.pow(1 - clamp(damp, 0, 1), 2);
    this.c = 1 - Math.exp((-TAU * Math.min(fc, 0.45 * sr)) / sr);
  }
  clear() { for (const b of this.ln) b.fill(0); this.lp.fill(0); }
  process(xl, xr) {
    const m = this.mask, w = this.w, o = this.o, ln = this.ln, lp = this.lp, c = this.c;
    for (let i = 0; i < 8; i++) {
      const v = ln[i][(w - this.len[i]) & m]; let s = lp[i] + c * (v - lp[i]);
      if (s < 1e-30 && s > -1e-30) s = 0; lp[i] = s; o[i] = s * this.g[i];
    }
    FO[0] = (o[0] - o[2] + o[4] - o[6]) * 0.42; FO[1] = (o[1] - o[3] + o[5] - o[7]) * 0.42;
    const a0 = o[0] + o[1], a1 = o[0] - o[1], a2 = o[2] + o[3], a3 = o[2] - o[3], a4 = o[4] + o[5], a5 = o[4] - o[5], a6 = o[6] + o[7], a7 = o[6] - o[7];
    const b0 = a0 + a2, b2 = a0 - a2, b1 = a1 + a3, b3 = a1 - a3, b4 = a4 + a6, b6 = a4 - a6, b5 = a5 + a7, b7 = a5 - a7;
    const s = 0.35355339059327373, il = xl * 0.5, ir = xr * 0.5;
    ln[0][w] = (b0 + b4) * s + il; ln[1][w] = (b1 + b5) * s + ir; ln[2][w] = (b2 + b6) * s - il; ln[3][w] = (b3 + b7) * s - ir;
    ln[4][w] = (b0 - b4) * s + il; ln[5][w] = (b1 - b5) * s + ir; ln[6][w] = (b2 - b6) * s - il; ln[7][w] = (b3 - b7) * s - ir;
    this.w = (w + 1) & m;
  }
}

/* ============================================================== VOICE */
// Indizes der interpolierten Control-Werte
const C_RATE = 0, C_F1 = 1, C_F2 = 2, C_G = 3, C_LV = 4, C_PL = 5, C_PR = 6, C_PAL = 7, C_PAR = 8, C_FLL = 9, C_FLR = 10, C_CHL = 11, C_CHR = 12, C_N = 13;
const MT = new Float64Array(5);

class Voice {
  constructor(sr) {
    this.sr = sr; this.active = false; this.serial = 0;
    const dn = pow2(Math.ceil(sr * 1.25)); this.dL = new Float32Array(dn); this.dR = new Float32Array(dn); this.dMask = dn - 1; this.dDirty = false;
    const fn = pow2(Math.ceil(sr * 0.045)); this.flL = new Float32Array(fn); this.flR = new Float32Array(fn); this.chL = new Float32Array(fn); this.chR = new Float32Array(fn); this.fMask = fn - 1; this.fDirty = false;
    this.fdn = new FDN(sr, 0.12); this.vDirty = false;
    this.apL = new Float64Array(6); this.apR = new Float64Array(6);
    this.pts = new Float32Array(16);
    this.lPan = new Lfo(); this.lTrem = new Lfo(); this.lPm = new Lfo(); this.lPh = new Lfo(); this.lFl = new Lfo(); this.lCh = new Lfo();
    this.mf = new Float64Array(10); this.mp = new Float64Array(10);
    this.cv = new Float64Array(C_N); this.ci = new Float64Array(C_N);
    this.rng = new Rng(1);
    this.smK = 1 - Math.exp(-KR / (0.003 * sr));
  }

  setC(i, tgt, snap) { if (snap) { this.cv[i] = tgt; this.ci[i] = 0; } else this.ci[i] = (tgt - this.cv[i]) / KR; }

  start(E, s, o) {
    const sr = this.sr, rng = E.rng;
    this.rng.s = (rng.next() * 4294967295) >>> 0 || 1;
    this.src = s.source === 'synth' ? 1 : 0;
    if (this.src === 0) {
      const sl = E.slices[s.slice | 0]; if (!sl) return false;
      const sm = E.samples.get(sl.sampleId); if (!sm) return false;
      const n = sm.L.length, s0 = Math.floor(clamp(sl.a, 0, 1) * n), s1 = Math.floor(clamp(sl.b, 0, 1) * n);
      if (s1 - s0 < 32) return false;
      this.L = sm.L; this.R = sm.R; this.s0 = s0; this.s1 = s1;
      this.rev = !!s.reverse !== !!o.reverse;
      const off = Math.floor(clamp(s.start || 0, 0, 0.95) * (s1 - s0));
      this.pos = this.rev ? s1 - 2 - off : s0 + off;
      this.loop = !!s.loop; this.fadeN = Math.max(8, 0.001 * sr);
    } else {
      this.f0 = E.refA * Math.pow(2, ((s.note ?? 48) - 69) / 12);
      this.w1 = W_IDX[s.osc1] ?? 2; this.w2 = W_IDX[s.osc2] ?? 3;
      this.o2r = Math.pow(2, ((s.osc2Semi || 0) + (s.osc2Fine || 0) / 100) / 12);
      this.ph1 = 0; this.ph2 = 0; this.ph3 = 0;
      this.oMix = s.oscMix ?? 0.5; this.sub = s.sub || 0; this.noise = s.noise || 0;
    }
    this.srcOn = true; this.active = true; this.t = 0; this.killN = 0; this.kill = 0; this.silent = 0;
    this.serial = E.serial++; this.step = o.step;
    this.vel = dbLin(s.gain) * (o.vel ?? 1);
    this.basePitch = (s.pitch || 0) + (s.fine || 0) / 100 + (o.pitch || 0);
    // Amp-Hüllkurve
    this.atkN = Math.max(0, s.atk * 0.001 * sr);
    this.decC = Math.exp(-4.6 / Math.max(1, s.dec * 0.001 * sr));
    this.sus = clamp(s.sus, 0, 1);
    this.relC = Math.exp(-4.6 / Math.max(1, s.rel * 0.001 * sr));
    this.gateN = Math.max(32, s.gate * E.stepDur * (o.gateMul || 1)); this.env = 0; this.stage = 0;
    // Filter
    this.fT = F_IDX[s.fType] || 0; this.z1l = this.z2l = this.z1r = this.z2r = 0;
    this.cut = s.cutoff; this.fk = 1.41421356 * Math.pow(0.05 / 1.41421356, clamp(s.res, 0, 1));
    this.fAmt = s.fEnvAmt || 0; this.fEnvN = Math.max(32, s.fEnvTime * E.stepDur); this.fLoop = !!s.fEnvLoop; this.fCyc = 0;
    this.fMeta = s.fEnvShape === 'random';
    this.fShape = this.fMeta ? ALL_SHAPES[(rng.next() * ALL_SHAPES.length) | 0] : s.fEnvShape;
    genPts(this.fShape, this.rng, this.pts);
    // Pan
    this.pan0 = clamp(s.pan + rng.bi() * (s.panRnd || 0), -1, 1);
    this.panMD = s.panModDepth || 0; this.panMR = s.panModRate; this.panMS = s.panModShape;
    this.apD = s.autopan || 0; this.apHz = 1 / ((SYNC[s.autopanSync] || 0.25) * E.wholeSec); this.apPh = 0;
    this.lPan.reset(0, this.rng);
    // Tremolo / Pitch-Mod
    this.trD = s.tremDepth || 0; this.trR = s.tremRate; this.trS = s.tremShape; this.lTrem.reset(0, this.rng);
    this.pmD = s.pmDepth || 0; this.pmR = s.pmRate; this.pmS = s.pmShape; this.lPm.reset(0, this.rng);
    // Phaser
    this.phM = s.phaserMix || 0; this.phR = s.phaserRate; this.phD = s.phaserDepth; this.phFb = clamp(s.phaserFb, -0.95, 0.95);
    if (this.phM > 0) { this.apL.fill(0); this.apR.fill(0); this.phFL = this.phFR = 0; this.lPh.reset(0, this.rng); }
    // Flanger / Chorus
    this.flM = s.flangerMix || 0; this.flRt = s.flangerRate; this.flD = s.flangerDepth; this.flFb = clamp(s.flangerFb, -0.9, 0.9);
    this.chM = s.chorusMix || 0; this.chRt = s.chorusRate; this.chD = s.chorusDepth;
    if (this.flM > 0 || this.chM > 0) {
      if (this.fDirty) { this.flL.fill(0); this.flR.fill(0); this.chL.fill(0); this.chR.fill(0); }
      this.fDirty = true; this.fw = 0; this.lFl.reset(0, this.rng); this.lCh.reset(0, this.rng);
    }
    // Delay (pro Step)
    this.dM = s.delayMix || 0;
    if (this.dM > 0) {
      if (this.dDirty) { this.dL.fill(0); this.dR.fill(0); }
      this.dDirty = true; this.dw = 0; this.dlL = this.dlR = 0;
      this.dN = clamp((SYNC[s.delaySync] || 0.125) * E.wholeSec * sr, 4, this.dMask - 4);
      this.dFb = clamp(s.delayFb, 0, 0.95); this.dPP = !!s.delayPP;
      this.dC = 1 - Math.exp((-TAU * Math.min(0.45 * sr, 700 + s.delayTone * s.delayTone * 17000)) / sr);
    }
    // Reverb (pro Step)
    this.vM = s.verbMix || 0;
    if (this.vM > 0) { if (this.vDirty) this.fdn.clear(); this.vDirty = true; this.fdn.set(s.verbSize, s.verbDecay, s.verbDamp, 1); }
    // Mutate — Ansatz bleibt identisch, erst danach wird moduliert
    this.mu = clamp(s.mutate || 0, 0, 1);
    if (this.mu > 0) {
      this.muStart = this.atkN + (s.mutHold || 0) * 0.001 * sr; this.muFade = 0.025 * sr;
      this.muP = s.mutPitch; this.muF = s.mutFilter; this.muPan = s.mutPan; this.muW = s.mutWarp; this.muL = s.mutLevel;
      const rate = s.mutRate || 1;
      for (let i = 0; i < 10; i++) { this.mf[i] = rate * (0.35 + rng.next() * 1.9) * (rng.next() < 0.5 ? -1 : 1); this.mp[i] = rng.next(); }
    }
    this.lvS = 1; this.pS = this.pan0;
    this.ctl(E, true); this.kc = KR;
    return true;
  }

  ctl(E, snap) {
    const sr = this.sr, t = this.t, rng = this.rng, dtk = KR / sr;
    let mP = 0, mF = 0, mPan = 0, mW = 0, mL = 0;
    if (this.mu > 0 && t >= this.muStart) {
      const a = this.mu * Math.min(1, (t - this.muStart) / this.muFade), tt = (t - this.muStart) / sr, mf = this.mf, mp = this.mp;
      for (let i = 0; i < 5; i++) MT[i] = 0.62 * Math.sin(TAU * (mp[i] + mf[i] * tt)) + 0.38 * Math.sin(TAU * (mp[i + 5] + mf[i + 5] * tt));
      mP = MT[0] * this.muP * 7 * a; mF = MT[1] * this.muF * 3 * a; mPan = MT[2] * this.muPan * a; mW = MT[3] * this.muW * a; mL = MT[4] * this.muL * a;
    }
    // Pitch
    let semis = this.basePitch + mP + mW * 5;
    if (this.pmD > 0) semis += this.lPm.step(this.pmR * dtk, this.pmS, rng) * this.pmD;
    const ratio = Math.pow(2, semis / 12);
    if (this.src === 0) this.setC(C_RATE, ratio, snap);
    else {
      const f1 = this.f0 * ratio, f2 = f1 * this.o2r;
      this.setC(C_F1, f1, snap); this.setC(C_F2, f2, snap);
      this.tb1 = this.w1 ? WT[this.w1][wtIndex(f1)] : null; this.tb2 = this.w2 ? WT[this.w2][wtIndex(f2)] : null;
    }
    // Filter + Hüllkurve
    if (this.fT) {
      let x = t / this.fEnvN;
      if (x >= 1) {
        if (this.fLoop) {
          const c = Math.floor(x);
          if (c !== this.fCyc) { this.fCyc = c; if (this.fMeta) this.fShape = ALL_SHAPES[(rng.next() * ALL_SHAPES.length) | 0]; genPts(this.fShape, rng, this.pts); }
          x -= c;
        } else x = 1;
      }
      const v = shapeVal(this.fShape, x, this.pts);
      const fc = clamp(this.cut * Math.pow(2, this.fAmt * v + mF), 16, 0.45 * sr);
      this.setC(C_G, Math.tan((PI * fc) / sr), snap);
    }
    // Pegel (Tremolo + Mutate-Level), zusätzlich geglättet
    let lv = 1;
    if (this.trD > 0) lv = 1 - this.trD * (0.5 + 0.5 * this.lTrem.step(this.trR * dtk, this.trS, rng));
    if (mL !== 0) lv *= Math.pow(2, mL * 1.5);
    this.lvS = snap ? lv : this.lvS + (lv - this.lvS) * this.smK;
    this.setC(C_LV, this.lvS, snap);
    // Pan
    let p = this.pan0 + mPan;
    if (this.panMD > 0) p += this.panMD * this.lPan.step(this.panMR * dtk, this.panMS, rng);
    if (this.apD > 0) { this.apPh += this.apHz * dtk; this.apPh -= Math.floor(this.apPh); p += this.apD * Math.sin(TAU * this.apPh); }
    p = clamp(p, -1, 1);
    this.pS = snap ? p : this.pS + (p - this.pS) * this.smK;
    panGains(this.pS, E.panLaw); this.setC(C_PL, PG[0], snap); this.setC(C_PR, PG[1], snap);
    // Phaser
    if (this.phM > 0) {
      const l = this.lPh.step(this.phR * dtk, 'sine', rng), r = Math.sin(TAU * (this.lPh.ph + 0.25));
      const fL = Math.min(0.45 * sr, 160 * Math.pow(2, this.phD * 5.2 * (0.5 + 0.5 * l))), fR = Math.min(0.45 * sr, 160 * Math.pow(2, this.phD * 5.2 * (0.5 + 0.5 * r)));
      const tl = Math.tan((PI * fL) / sr), tr = Math.tan((PI * fR) / sr);
      this.setC(C_PAL, (tl - 1) / (tl + 1), snap); this.setC(C_PAR, (tr - 1) / (tr + 1), snap);
      for (let i = 0; i < 6; i++) { if (Math.abs(this.apL[i]) < 1e-25) this.apL[i] = 0; if (Math.abs(this.apR[i]) < 1e-25) this.apR[i] = 0; }
    }
    if (this.flM > 0) {
      const l = this.lFl.step(this.flRt * dtk, 'tri', rng), ph = this.lFl.ph + 0.25, r = (ph % 1) < 0.5 ? 4 * (ph % 1) - 1 : 3 - 4 * (ph % 1);
      this.setC(C_FLL, (0.25 + this.flD * 6 * (0.5 + 0.5 * l)) * 0.001 * sr, snap);
      this.setC(C_FLR, (0.25 + this.flD * 6 * (0.5 + 0.5 * r)) * 0.001 * sr, snap);
    }
    if (this.chM > 0) {
      const l = this.lCh.step(this.chRt * dtk, 'sine', rng), r = Math.sin(TAU * (this.lCh.ph + 0.33));
      this.setC(C_CHL, (11 + this.chD * 12 * (0.5 + 0.5 * l)) * 0.001 * sr, snap);
      this.setC(C_CHR, (13 + this.chD * 12 * (0.5 + 0.5 * r)) * 0.001 * sr, snap);
    }
  }

  render(E, bL, bR, a, b) {
    const sr = this.sr, cv = this.cv, ci = this.ci;
    for (let n = a; n < b; n++) {
      if (--this.kc <= 0) { this.ctl(E, false); this.kc = KR; }
      let xl = 0, xr = 0, L = 0, R = 0;
      if (this.stage !== 3) {
      /* ---- Quelle */
      if (this.srcOn) {
        if (this.src === 0) {
          const r = cv[C_RATE];
          sincRead(this.L, this.R, this.pos, r > 1 ? 1 / r : 1);
          const d0 = this.pos - this.s0, d1 = this.s1 - 1 - this.pos, fn = this.fadeN;
          let ef = 1; if (d0 < fn) ef = d0 / fn; if (d1 < fn && d1 / fn < ef) ef = d1 / fn; if (ef < 0) ef = 0;
          xl = RD[0] * ef; xr = RD[1] * ef;
          this.pos += this.rev ? -r : r;
          if (this.pos >= this.s1 - 1 || this.pos < this.s0) {
            if (this.loop) this.pos += (this.rev ? 1 : -1) * (this.s1 - 1 - this.s0);
            else { this.srcOn = false; if (this.stage < 2) this.stage = 2; }
          }
        } else {
          const f1 = cv[C_F1], f2 = cv[C_F2];
          const o1 = this.tb1 ? wtRead(this.tb1, this.ph1) : Math.sin(TAU * this.ph1);
          const o2 = this.tb2 ? wtRead(this.tb2, this.ph2) : Math.sin(TAU * this.ph2);
          let v = (o1 + (o2 - o1) * this.oMix) * 0.7;
          if (this.sub > 0) v += Math.sin(TAU * this.ph3) * this.sub * 0.55;
          if (this.noise > 0) v += this.rng.bi() * this.noise * 0.3;
          this.ph1 += f1 / sr; this.ph1 -= Math.floor(this.ph1);
          this.ph2 += f2 / sr; this.ph2 -= Math.floor(this.ph2);
          this.ph3 += (0.5 * f1) / sr; this.ph3 -= Math.floor(this.ph3);
          xl = xr = v;
        }
      }
      /* ---- Filter (TPT-SVF) */
      if (this.fT) {
        const g = cv[C_G], k = this.fk, a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
        let v3 = xl - this.z2l, v1 = a1 * this.z1l + a2 * v3, v2 = this.z2l + a2 * this.z1l + a3 * v3;
        this.z1l = 2 * v1 - this.z1l; this.z2l = 2 * v2 - this.z2l;
        const fl = this.fT === 1 ? v2 : this.fT === 2 ? xl - k * v1 - v2 : this.fT === 3 ? k * v1 : xl - k * v1;
        v3 = xr - this.z2r; v1 = a1 * this.z1r + a2 * v3; v2 = this.z2r + a2 * this.z1r + a3 * v3;
        this.z1r = 2 * v1 - this.z1r; this.z2r = 2 * v2 - this.z2r;
        xr = this.fT === 1 ? v2 : this.fT === 2 ? xr - k * v1 - v2 : this.fT === 3 ? k * v1 : xr - k * v1;
        xl = fl;
      }
      /* ---- Amp-Hüllkurve */
      if (this.stage === 0) { if (this.t < this.atkN) this.env = this.t / this.atkN; else { this.env = 1; this.stage = 1; } }
      else if (this.stage === 1) this.env = this.sus + (this.env - this.sus) * this.decC;
      else if (this.stage === 2) { this.env *= this.relC; if (this.env < 1e-5) { this.env = 0; this.stage = 3; } }
      if (this.stage < 2 && this.t >= this.gateN) this.stage = 2;
      const g = this.env * this.vel * cv[C_LV];
      xl *= g; xr *= g;
      /* ---- Phaser */
      if (this.phM > 0) {
        const aL = cv[C_PAL], aR = cv[C_PAR], fb = this.phFb, sL = this.apL, sR = this.apR;
        let u = xl + this.phFL * fb; for (let i = 0; i < 6; i++) { const y = aL * u + sL[i]; sL[i] = u - aL * y; u = y; } this.phFL = u;
        let w = xr + this.phFR * fb; for (let i = 0; i < 6; i++) { const y = aR * w + sR[i]; sR[i] = w - aR * y; w = y; } this.phFR = w;
        const m = this.phM * 0.5; xl += (u - xl) * m; xr += (w - xr) * m;
      }
      /* ---- Flanger / Chorus */
      if (this.flM > 0 || this.chM > 0) {
        const m = this.fMask, w = this.fw;
        if (this.flM > 0) {
          const yl = hermRead(this.flL, m, w, cv[C_FLL]), yr = hermRead(this.flR, m, w, cv[C_FLR]);
          this.flL[w] = xl + yl * this.flFb; this.flR[w] = xr + yr * this.flFb;
          const k = this.flM * 0.5; xl += (yl - xl) * k; xr += (yr - xr) * k;
        }
        if (this.chM > 0) {
          this.chL[w] = xl; this.chR[w] = xr;
          const yl = hermRead(this.chL, m, w, cv[C_CHL]), yr = hermRead(this.chR, m, w, cv[C_CHR]);
          const k = this.chM * 0.5; xl += (yl - xl) * k; xr += (yr - xr) * k;
        }
        this.fw = (w + 1) & m;
      }
      /* ---- Pan */
      L = xl * cv[C_PL]; R = xr * cv[C_PR];
      } // Ende: Tail-Fast-Path (nach Release nur noch Delay/Reverb)
      /* ---- Delay */
      if (this.dM > 0) {
        const m = this.dMask, w = this.dw;
        const oL = hermRead(this.dL, m, w, this.dN), oR = hermRead(this.dR, m, w, this.dN);
        this.dlL += this.dC * (oL - this.dlL); this.dlR += this.dC * (oR - this.dlR);
        if (this.dPP) { this.dL[w] = (L + R) * 0.5 + this.dlR * this.dFb; this.dR[w] = this.dlL * this.dFb; }
        else { this.dL[w] = L + this.dlL * this.dFb; this.dR[w] = R + this.dlR * this.dFb; }
        this.dw = (w + 1) & m;
        L += this.dlL * this.dM; R += this.dlR * this.dM;
      }
      /* ---- Reverb */
      if (this.vM > 0) { this.fdn.process(L, R); L += FO[0] * this.vM; R += FO[1] * this.vM; }
      /* ---- Voice-Steal-Fade */
      if (this.killN) { const k = this.kill / this.killN; L *= k; R *= k; if (--this.kill <= 0) { this.active = false; } }
      bL[n] += L; bR[n] += R;
      for (let j = 0; j < C_N; j++) cv[j] += ci[j];
      this.t++;
      if (!this.active) break;
      if (this.stage === 3) {
        if (this.dM <= 0 && this.vM <= 0) { this.active = false; break; }
        if ((L < 0 ? -L : L) + (R < 0 ? -R : R) < 3e-6) { if (++this.silent > sr * 0.1) { this.active = false; break; } } else this.silent = 0;
        if (this.t > this.gateN + sr * 30) { this.active = false; break; }
      }
    }
  }
}

/* ============================================================== GRAIN (Collide-Trümmer) */
class Grain {
  constructor() { this.active = false; }
  render(bL, bR, a, b) {
    for (let n = a; n < b; n++) {
      if (this.wait > 0) { this.wait--; continue; }
      const wi = this.t * this.inv * 1024, j = wi | 0, w = (WIN[j] + (WIN[j + 1] - WIN[j]) * (wi - j)) * this.amp;
      let vl, vr;
      if (this.kind === 0) { sincRead(this.L, this.R, this.pos, this.rate > 1 ? 1 / this.rate : 1); vl = RD[0]; vr = RD[1]; this.pos += this.rate; }
      else { vl = vr = Math.sin(TAU * this.ph) * 0.6; this.ph += this.fq; if (this.ph >= 1) this.ph -= 1; }
      bL[n] += vl * w * this.gl; bR[n] += vr * w * this.gr;
      if (++this.t >= this.dur) { this.active = false; break; }
    }
  }
}

/* ============================================================== RIP — neuronaler Beat-Repeat */
const RN = 24, RI = 10, RO = 6;
class Rip {
  constructor(sr) {
    this.sr = sr; const n = pow2(Math.ceil(sr * 8)); this.L = new Float32Array(n); this.R = new Float32Array(n); this.mask = n - 1; this.w = 0;
    this.x = new Float64Array(RN); this.xn = new Float64Array(RN); this.W = new Float64Array(RN * RN); this.Win = new Float64Array(RN * RI);
    this.Wout = new Float64Array(RO * RN); this.W0 = new Float64Array(RO * RN); this.u = new Float64Array(RI); this.y = new Float64Array(RO);
    this.nz = new Float64Array(RO); this.e = new Float64Array(RN);
    this.fast = 0; this.slow = 0; this.zc = 0; this.zn = 0; this.prev = 0;
    this.aF = 1 - Math.exp(-1 / (0.001 * sr)); this.rF = 1 - Math.exp(-1 / (0.03 * sr)); this.cS = 1 - Math.exp(-1 / (0.3 * sr));
    this.active = false; this.ending = false; this.k = 0; this.endAt = 0; this.mixC = 0;
    this.cMix = 1 - Math.exp(-1 / (0.003 * sr)); this.fadeN = Math.round(0.0015 * sr);
    this.rBar = 0; this.dens = 0; this.events = 0; this.learns = 0; this.rng = new Rng(0xc0ffee);
    this.p = { on: false, mix: 1, chance: 0.35, plast: 0.3, temp: 0.3, gridMin: -2, gridMax: 0, maxLen: 4, pitch: 0, decay: 0.2, freeze: false, seed: 1 };
    this.seed(1);
  }
  seed(s) {
    this.curSeed = s; const r = new Rng(((s | 0) * 2654435761) >>> 0 || 1), sc = 0.95 * Math.sqrt(3 / (RN * 0.25));
    for (let i = 0; i < RN * RN; i++) this.W[i] = r.next() < 0.25 ? r.bi() * sc : 0;
    for (let i = 0; i < RN * RI; i++) this.Win[i] = r.bi() * 0.9;
    for (let i = 0; i < RO * RN; i++) this.W0[i] = this.Wout[i] = r.bi() * 0.35;
    this.x.fill(0); this.rBar = 0; this.events = 0; this.learns = 0; this.dens = 0;
  }
  export() { return { seed: this.curSeed, Wout: Array.from(this.Wout), rBar: this.rBar, events: this.events, learns: this.learns }; }
  import(b) {
    if (!b || !b.Wout || b.Wout.length !== RO * RN) return;
    this.seed(b.seed); this.Wout.set(b.Wout); this.rBar = b.rBar || 0; this.events = b.events || 0; this.learns = b.learns || 0;
  }
  tick(E, step, weight, len) {
    const p = this.p; if (!p.on) return;
    const u = this.u;
    u[0] = Math.tanh(this.fast * 3); u[1] = Math.tanh(this.slow * 3);
    u[2] = Math.tanh(Math.log((this.fast + 1e-4) / (this.slow + 1e-4)));
    u[3] = this.zn > 0 ? clamp((this.zc / this.zn) * 8 - 1, -1, 1) : 0; this.zc = 0; this.zn = 0;
    const ph = (TAU * step) / len; u[4] = Math.sin(ph); u[5] = Math.cos(ph); u[6] = weight * 2 - 1;
    u[7] = this.active ? 1 : -1; u[8] = this.rng.bi() * p.temp; u[9] = 1;
    const x = this.x, xn = this.xn, W = this.W, Wi = this.Win;
    for (let i = 0; i < RN; i++) {
      let s = 0; for (let j = 0; j < RN; j++) s += W[i * RN + j] * x[j];
      for (let k = 0; k < RI; k++) s += Wi[i * RI + k] * u[k];
      xn[i] = 0.55 * x[i] + 0.45 * Math.tanh(s);
    }
    x.set(xn);
    for (let o = 0; o < RO; o++) { let s = 0; for (let i = 0; i < RN; i++) s += this.Wout[o * RN + i] * x[i]; this.y[o] = s; }
    let fired = 0;
    if (this.active) {
      if (!this.ending && --this.ticks <= 0) { this.ending = true; this.endAt = this.k + this.fadeN * 2; this.learn(); }
    } else {
      for (let o = 0; o < RO; o++) this.nz[o] = this.rng.bi() * (0.15 + p.temp * 0.85);
      const pr = clamp(p.chance * sig(2 * (this.y[0] + this.nz[0])) * (0.35 + 1.3 * weight), 0, 1);
      if (this.rng.next() < pr) { this.begin(E, u[2]); fired = 1; }
    }
    this.dens += 0.05 * (fired - this.dens);
  }
  begin(E, onset) {
    const p = this.p, y = this.y, nz = this.nz;
    const e = Math.round(p.gridMin + (p.gridMax - p.gridMin) * sig(y[1] + nz[1]));
    this.segN = Math.max(256, Math.round(E.stepDur * Math.pow(2, e)));
    const minTicks = Math.ceil((2 * this.segN) / E.stepDur);
    this.ticks = Math.max(minTicks, 1 + Math.round(sig(y[5] + nz[5]) * (Math.max(1, p.maxLen) - 1)));
    this.semis = Math.tanh(y[2] + nz[2]) * p.pitch;
    this.rev = sig(2 * (y[3] + nz[3])) > 0.66;
    this.dec = clamp(p.decay * sig(y[4] + nz[4]) * 1.6, 0, 0.9);
    this.t0 = this.w; this.k = 0; this.curRep = -1; this.active = true; this.ending = false;
    this.e.set(this.x); this.onset = onset; this.fast0 = this.fast; this.events++;
  }
  learn() {
    const p = this.p; if (p.freeze || p.plast <= 0) return;
    const r = 0.6 * this.onset + 0.4 * (this.fast0 > 0.01 ? 1 : -1) - 0.6 * this.dens;
    this.rBar += 0.1 * (r - this.rBar);
    const adv = r - this.rBar, lr = p.plast * 0.05;
    for (let o = 0; o < RO; o++) for (let i = 0; i < RN; i++) {
      const j = o * RN + i; let w = this.Wout[j] + lr * adv * this.nz[o] * this.e[i];
      w += lr * 0.02 * (this.W0[j] - w); this.Wout[j] = clamp(w, -3, 3);
    }
    this.learns++;
  }
  process(bL, bR, a, b) {
    const p = this.p, m = this.mask;
    for (let n = a; n < b; n++) {
      const l = bL[n], r = bR[n];
      this.L[this.w] = l; this.R[this.w] = r; this.w = (this.w + 1) & m;
      const ab = (l < 0 ? -l : l) + (r < 0 ? -r : r);
      this.fast += (ab > this.fast ? this.aF : this.rF) * (ab - this.fast);
      this.slow += this.cS * (ab - this.slow);
      const mono = l + r; if ((mono >= 0) !== (this.prev >= 0)) this.zc++; this.prev = mono; this.zn++;
      let wl = l, wr = r;
      if (this.active) {
        const seg = this.segN, rep = (this.k / seg) | 0, kk = this.k - rep * seg;
        if (rep >= 1) {
          if (rep !== this.curRep) { this.curRep = rep; this.rate = Math.pow(2, (rep * this.semis) / 12); this.gain = Math.pow(1 - this.dec, rep - 1); }
          const pp = kk * this.rate;
          if (pp < seg - 2) {
            const pos = this.rev ? seg - 2 - pp : pp;
            sincReadRing(this.L, this.R, m, this.t0 + pos, this.rate > 1 ? 1 / this.rate : 1);
            const fn = this.fadeN; let w = 1;
            if (kk < fn) w = kk / fn; const rem = seg - kk; if (rem < fn && rem / fn < w) w = rem / fn;
            const endPP = (seg - 2 - pp) / this.rate; if (endPP < fn && endPP / fn < w) w = endPP / fn;
            w *= this.gain; wl = RD[0] * w; wr = RD[1] * w;
          } else { wl = 0; wr = 0; }
        }
        this.k++;
        if (this.ending && this.k >= this.endAt) { this.active = false; this.ending = false; }
      }
      const tgt = this.active && !this.ending && p.on ? p.mix : 0;
      this.mixC += (tgt - this.mixC) * this.cMix;
      bL[n] = l + (wl - l) * this.mixC; bR[n] = r + (wr - r) * this.mixC;
    }
  }
}

/* ============================================================== MASTER */
class Comp {
  constructor(sr) { this.sr = sr; this.gr = 0; this.set({ thr: -18, ratio: 3, atk: 10, rel: 120, knee: 6, makeup: 0, mix: 0 }); }
  set(p) {
    this.thr = p.thr; this.ratio = Math.max(1, p.ratio); this.knee = Math.max(0, p.knee ?? 6);
    this.aA = Math.exp(-1 / (Math.max(0.05, p.atk) * 0.001 * this.sr)); this.aR = Math.exp(-1 / (Math.max(5, p.rel) * 0.001 * this.sr));
    this.mk = dbLin(p.makeup || 0); this.mix = clamp(p.mix, 0, 1);
  }
  gain(l, r) {
    const x = Math.max(l < 0 ? -l : l, r < 0 ? -r : r), xd = x > 1e-6 ? 20 * Math.log10(x) : -120;
    const T = this.thr, R = this.ratio, W = this.knee, d = xd - T; let y;
    if (W < 0.01) y = d > 0 ? T + d / R : xd;
    else if (2 * d < -W) y = xd;
    else if (2 * Math.abs(d) <= W) { const q = d + W / 2; y = xd + ((1 / R - 1) * q * q) / (2 * W); }
    else y = T + d / R;
    const g = y - xd;
    this.gr = g < this.gr ? this.aA * this.gr + (1 - this.aA) * g : this.aR * this.gr + (1 - this.aR) * g;
    return dbLin(this.gr) * this.mk;
  }
}
class MDelay {
  constructor(sr) {
    this.sr = sr; const n = pow2(Math.ceil(sr * 4.2)); this.L = new Float32Array(n); this.R = new Float32Array(n); this.mask = n - 1; this.w = 0;
    this.cur = sr * 0.3; this.tgt = this.cur; this.glide = 1 - Math.exp(-1 / (0.06 * sr));
    this.lpL = this.lpR = this.loL = this.loR = 0; this.hc = 1 - Math.exp((-TAU * 90) / sr);
    this.fb = 0.35; this.c = 0.5; this.pp = true;
  }
  set(p, wholeSec) {
    this.tgt = clamp((SYNC[p.sync] || 0.1875) * wholeSec * this.sr, 8, this.mask - 8);
    this.fb = clamp(p.fb, 0, 0.95); this.pp = !!p.pp;
    this.c = 1 - Math.exp((-TAU * Math.min(0.45 * this.sr, 700 + p.tone * p.tone * 17000)) / this.sr);
  }
  process(l, r) {
    this.cur += (this.tgt - this.cur) * this.glide;
    const m = this.mask, w = this.w;
    const oL = hermRead(this.L, m, w, this.cur), oR = hermRead(this.R, m, w, this.cur);
    this.lpL += this.c * (oL - this.lpL); this.lpR += this.c * (oR - this.lpR);
    this.loL += this.hc * (this.lpL - this.loL); this.loR += this.hc * (this.lpR - this.loR);
    const fL = (this.lpL - this.loL) * this.fb, fR = (this.lpR - this.loR) * this.fb;
    if (this.pp) { this.L[w] = (l + r) * 0.5 + fR; this.R[w] = fL; } else { this.L[w] = l + fL; this.R[w] = r + fR; }
    this.w = (w + 1) & m; FO[0] = this.lpL; FO[1] = this.lpR;
  }
}
class Allpass {
  constructor(n) { this.b = new Float32Array(Math.max(1, n)); this.n = this.b.length; this.i = 0; }
  p(x, g) { const d = this.b[this.i], y = -g * x + d; this.b[this.i] = x + g * y; if (++this.i >= this.n) this.i = 0; return y; }
}
class MVerb {
  constructor(sr) {
    this.sr = sr; const k = sr / 44100, n = pow2(Math.ceil(sr * 0.3));
    this.preL = new Float32Array(n); this.preR = new Float32Array(n); this.pm = n - 1; this.pw = 0; this.preN = 1;
    this.dl = [142, 107, 379, 277].map((v) => new Allpass(Math.round(v * k)));
    this.dr = [151, 113, 367, 289].map((v) => new Allpass(Math.round(v * k)));
    this.fdn = new FDN(sr, 0.32);
  }
  set(p) { this.fdn.set(p.size, p.decay, p.damp, 1.6); this.preN = clamp(Math.round(p.pre * 0.001 * this.sr), 1, this.pm - 2); }
  process(l, r) {
    const w = this.pw, m = this.pm; this.preL[w] = l; this.preR[w] = r; this.pw = (w + 1) & m;
    let xl = this.preL[(w - this.preN) & m], xr = this.preR[(w - this.preN) & m];
    for (let i = 0; i < 4; i++) { xl = this.dl[i].p(xl, 0.62); xr = this.dr[i].p(xr, 0.62); }
    this.fdn.process(xl, xr);
  }
}
class Limiter {
  constructor(sr) {
    this.la = Math.max(8, Math.round(sr * 0.0015)); const n = pow2(this.la + 4);
    this.dL = new Float32Array(n); this.dR = new Float32Array(n); this.m = n - 1; this.w = 0;
    this.qv = new Float64Array(n); this.qi = new Float64Array(n); this.qh = 0; this.qt = 0; this.cnt = 0;
    this.box = new Float64Array(this.la + 1).fill(1); this.bi = 0; this.sum = this.la + 1;
    this.g = 1; this.rel = Math.exp(-1 / (0.08 * sr)); this.ceil = dbLin(-0.3);
  }
  process(l, r) {
    const m = this.m, la = this.la, pk = Math.max(l < 0 ? -l : l, r < 0 ? -r : r);
    const req = pk > this.ceil ? this.ceil / pk : 1, i = this.cnt++;
    while (this.qt > this.qh && this.qv[(this.qt - 1) & m] >= req) this.qt--;
    this.qv[this.qt & m] = req; this.qi[this.qt & m] = i; this.qt++;
    while (this.qi[this.qh & m] <= i - (la + 1)) this.qh++;
    const mn = this.qv[this.qh & m];
    this.sum += mn - this.box[this.bi]; this.box[this.bi] = mn;
    if (++this.bi > la) { this.bi = 0; let s = 0; for (let j = 0; j <= la; j++) s += this.box[j]; this.sum = s; }
    const s = this.sum / (la + 1);
    this.g = s < this.g ? s : s + (this.g - s) * this.rel;
    const w = this.w; this.dL[w] = l; this.dR[w] = r; this.w = (w + 1) & m;
    const rd = (w - la) & m; FO[0] = this.dL[rd] * this.g; FO[1] = this.dR[rd] * this.g;
  }
}
/* ITU-R BS.1770 K-Weighting + Momentary Loudness (400 ms) */
class Lufs {
  constructor(sr) {
    let K = Math.tan((PI * 1681.974450955533) / sr), Q = 0.7071752369554196, Vh = Math.pow(10, 3.999843853973347 / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    let a0 = 1 + K / Q + K * K;
    this.s1 = [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
    K = Math.tan((PI * 38.13547087602444) / sr); Q = 0.5003270373238773; a0 = 1 + K / Q + K * K;
    this.s2 = [1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
    this.z = new Float64Array(8); this.n = Math.round(sr * 0.4); this.ring = new Float64Array(this.n); this.ri = 0; this.sum = 0;
  }
  bq(c, x, zi) { const z = this.z, y = c[0] * x + z[zi]; z[zi] = c[1] * x - c[3] * y + z[zi + 1]; z[zi + 1] = c[2] * x - c[4] * y; return y; }
  push(l, r) {
    const a = this.bq(this.s2, this.bq(this.s1, l, 0), 2), b = this.bq(this.s2, this.bq(this.s1, r, 4), 6);
    const e = a * a + b * b; this.sum += e - this.ring[this.ri]; this.ring[this.ri] = e;
    if (++this.ri >= this.n) { this.ri = 0; let s = 0; for (let i = 0; i < this.n; i++) s += this.ring[i]; this.sum = s; }
  }
  value() { const ms = Math.max(0, this.sum) / this.n; return ms > 1e-12 ? -0.691 + 10 * Math.log10(ms) : -120; }
}

/* ============================================================== PROCESSOR */
class ChiliProcessor extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    const o = (opts && opts.processorOptions) || {}, sr = sampleRate;
    this.sr = sr;
    buildSinc(o.lobes || 16); WT = buildWavetables(sr);
    this.maxVoices = o.maxVoices || 16;
    this.voices = []; for (let i = 0; i < this.maxVoices + 4; i++) this.voices.push(new Voice(sr));
    this.grains = []; for (let i = 0; i < 96; i++) this.grains.push(new Grain());
    this.samples = new Map(); this.slices = []; this.steps = []; this.len = 16;
    this.rng = new Rng((Date.now() ^ 0x5eed1234) >>> 0); this.serial = 1;
    this.bpm = 120; this.div = 1 / 16; this.swing = 0; this.refA = 440; this.panLaw = 'm3';
    this.calcTiming();
    this.playing = false; this.stepI = 0; this.tA = 0;
    this.C = { on: false, ratio: 1.5, energy: 0.5, accel: 0.2, beamB: 0.5, scatter: 7, spread: 120, level: 0.8 };
    this.posA = 0; this.nA = 0; this.posB = 8; this.nB = 8; this.sf = 1; this.justC = false;
    this.rip = new Rip(sr);
    this.comp = new Comp(sr); this.mdel = new MDelay(sr); this.mverb = new MVerb(sr); this.lim = new Limiter(sr); this.lufs = new Lufs(sr);
    this.mixC = [0, 0, 0]; this.mixT = [0, 0, 0]; this.mK = 1 - Math.exp(-1 / (0.02 * sr));
    this.fg = 0.64; this.fgT = 0.64; this.fK = 1 - Math.exp(-1 / (0.015 * sr));
    this.limOn = true;
    this.bL = new Float32Array(4096); this.bR = new Float32Array(4096);
    this.pk = [0, 0]; this.over = false; this.meterN = 0; this.meterEvery = Math.round(sr / 30); this.limMin = 1; this.cpu = 0; this.cpuT = 0;
    this.rec = false; this.recL = new Float32Array(16384); this.recR = new Float32Array(16384); this.recI = 0;
    this.port.onmessage = (e) => this.onMsg(e.data);
    this.port.postMessage({ type: 'ready', sr });
  }

  calcTiming() {
    this.wholeSec = 240 / this.bpm;
    const old = this.stepDur;
    this.stepDur = this.wholeSec * this.div * this.sr;
    if (old && this.tA > 0) this.tA *= this.stepDur / old;
  }

  onMsg(m) {
    switch (m.type) {
      case 'sample': this.samples.set(m.id, { L: m.L, R: m.R }); break;
      case 'removeSample': this.samples.delete(m.id); break;
      case 'state': this.applyState(m.state); break;
      case 'play': this.setPlaying(m.on); break;
      case 'audition': this.trigger(m.step, { force: true }); break;
      case 'panic': for (const v of this.voices) v.active = false; for (const g of this.grains) g.active = false; break;
      case 'settings':
        this.panLaw = m.panLaw || 'm3'; this.limOn = m.limiter !== false; this.lim.ceil = dbLin(m.ceiling ?? -0.3); this.refA = m.refA || 440; break;
      case 'rec':
        if (m.on) { this.rec = true; this.recI = 0; } else { this.flushRec(); this.rec = false; this.port.postMessage({ type: 'recEnd' }); }
        break;
      case 'getBrain': this.port.postMessage({ type: 'brain', id: m.id, brain: this.rip.export() }); break;
      case 'setBrain': this.rip.import(m.brain); break;
      case 'ripReset': this.rip.p.seed = m.seed; this.rip.seed(m.seed); break;
    }
  }

  applyState(s) {
    this.steps = s.steps || []; this.slices = s.slices || [];
    const newLen = s.len || 16;
    if (newLen !== this.len) { this.len = newLen; this.stepI %= newLen; }
    this.swing = clamp(s.swing || 0, 0, 0.5);
    const bpm = clamp(s.bpm || 120, 10, 999), div = DIV[s.division] || 1 / 16;
    if (bpm !== this.bpm || div !== this.div) { this.bpm = bpm; this.div = div; this.calcTiming(); }
    const c = s.collide || {};
    const wasOn = this.C.on; Object.assign(this.C, c);
    if (this.playing && c.on && !wasOn) this.initCollide(this.stepI);
    if (this.playing && !c.on && wasOn) { this.stepI = mod(Math.floor(this.posA), this.len); this.tA = 0; }
    if (s.rip) {
      const r = s.rip, seedChanged = r.seed !== undefined && r.seed !== this.rip.curSeed;
      Object.assign(this.rip.p, r); if (seedChanged) this.rip.seed(r.seed);
    }
    const M = s.master;
    if (M) {
      this.comp.set(M.comp); this.mdel.set(M.delay, this.wholeSec); this.mverb.set(M.verb);
      this.mixT[0] = clamp(M.comp.mix, 0, 1); this.mixT[1] = clamp(M.delay.mix, 0, 1); this.mixT[2] = clamp(M.verb.mix, 0, 1);
      const pos = clamp(M.fader, 0, 1); this.fgT = pos * pos; // max. 0 dB
    }
  }

  setPlaying(on) {
    if (on && !this.playing) { this.stepI = 0; this.tA = 0; this.initCollide(0); this.sf = 1; }
    this.playing = on;
  }
  initCollide(at) { this.posA = at; this.nA = at; this.posB = at + this.len / 2; this.nB = this.posB; this.justC = false; }

  /* ---- Clock */
  rB() { return Math.max(0.05, this.C.ratio * this.sf); }
  nextDt() {
    if (!this.C.on) return this.tA;
    const sd = this.stepDur, rB = this.rB(), N = this.len;
    const tA = (this.nA - this.posA) * sd, tB = ((this.posB - this.nB) * sd) / rB;
    let gap = mod(this.posB - this.posA, N); if (this.justC && gap < 0.25) gap += N;
    return Math.min(tA, tB, (gap * sd) / (1 + rB));
  }
  advance(seg) {
    if (!this.C.on) { this.tA -= seg; return; }
    const sd = this.stepDur; this.posA += seg / sd; this.posB -= (seg * this.rB()) / sd;
    const N = this.len;
    if (this.nA > 64 * N) { const k = 32 * N; this.posA -= k; this.nA -= k; }
    if (this.nB < -64 * N) { const k = 32 * N; this.posB += k; this.nB += k; }
  }
  fireDue() {
    const N = this.len;
    if (!this.C.on) {
      let guard = 0;
      while (this.tA <= 1e-7 && guard++ < 8) {
        const st = this.stepI; this.trigger(st, {});
        const s = this.steps[st]; this.rip.tick(this, st, s ? s.ripWeight ?? 0.5 : 0.5, N);
        this.tA += this.stepDur * (st % 2 === 0 ? 1 + this.swing : 1 - this.swing);
        this.stepI = (st + 1) % N; this.port.postMessage({ type: 'tick', step: st, t: currentTime });
      }
      return;
    }
    let guard = 0;
    while (this.posA >= this.nA - 1e-7 && guard++ < 8) {
      const st = mod(this.nA, N); this.trigger(st, {});
      const s = this.steps[st]; this.rip.tick(this, st, s ? s.ripWeight ?? 0.5 : 0.5, N);
      this.nA += 1; this.port.postMessage({ type: 'tick', step: st, t: currentTime });
    }
    guard = 0;
    while (this.posB <= this.nB + 1e-7 && guard++ < 16) {
      const st = mod(this.nB, N);
      if (this.C.beamB > 0) this.trigger(st, { vel: this.C.beamB, reverse: true });
      this.nB -= 1;
      if (st === 0) { // Strahl B hat eine Runde vollendet → beschleunigen
        this.sf *= 1 + this.C.accel * 0.35;
        if (this.C.ratio * this.sf > 8) { this.collision(this.posA, 1.6); this.sf = 1; this.port.postMessage({ type: 'dump', t: currentTime }); }
      }
    }
    const gap = mod(this.posB - this.posA, N);
    if (gap < 1e-6 || gap > N - 1e-6) { if (!this.justC) { this.collision(this.posA, 1); this.justC = true; } }
    else if (gap > 0.25 && gap < N - 0.25) this.justC = false;
  }

  trigger(i, o) {
    const s = this.steps[i]; if (!s) return;
    if (!o.force) { if (!s.on) return; if ((s.prob ?? 1) < 1 && this.rng.next() >= s.prob) return; }
    const v = this.allocVoice(); o.step = i;
    if (!v.start(this, s, o)) v.active = false;
  }
  allocVoice() {
    let free = null, active = 0, oldest = null;
    for (const v of this.voices) {
      if (!v.active) { if (!free) free = v; }
      else {
        active++;
        if (!v.killN && (!oldest || (v.stage === 3) > (oldest.stage === 3) || ((v.stage === 3) === (oldest.stage === 3) && v.serial < oldest.serial))) oldest = v;
      }
    }
    if (active >= this.maxVoices && oldest) { oldest.killN = oldest.kill = Math.round(0.004 * this.sr); }
    if (!free) { free = oldest || this.voices[0]; free.active = false; }
    return free;
  }

  /* ---- Collide: Kollision zweier Strahlen erzeugt einen Trümmer-Schauer */
  collision(pos, boost) {
    const N = this.len, C = this.C, rng = this.rng, sr = this.sr;
    const sA = mod(Math.round(pos), N), sB = mod(sA + 1, N);
    const en = clamp(C.energy, 0, 1) * boost;
    const count = Math.min(80, Math.round(3 + en * 26 * Math.sqrt(Math.min(4, this.sf))));
    let spawned = 0;
    for (let i = 0; i < count; i++) {
      const g = this.grains.find((x) => !x.active); if (!g) break;
      const st = this.steps[rng.next() < 0.5 ? sA : sB] || this.steps[sA]; if (!st) continue;
      const scat = (rng.bi() * C.scatter * (0.3 + en)) / 12;
      g.dur = Math.round((0.006 + rng.next() * 0.07) * sr); g.inv = 1 / g.dur; g.t = 0;
      g.wait = Math.round(-Math.log(1 - rng.next() * 0.999) * C.spread * 0.001 * sr * (0.3 + en));
      const pan = clamp(rng.bi() * (0.4 + 0.6 * Math.min(1, en)), -1, 1); panGains(pan, 'm3'); g.gl = PG[0]; g.gr = PG[1];
      g.amp = dbLin(st.gain) * C.level * (1.2 / Math.sqrt(count)) * (0.4 + rng.next() * 0.6);
      const sl = st.source !== 'synth' ? this.slices[st.slice | 0] : null, sm = sl ? this.samples.get(sl.sampleId) : null;
      if (sm) {
        const n = sm.L.length, a = Math.floor(sl.a * n), b = Math.floor(sl.b * n);
        g.kind = 0; g.L = sm.L; g.R = sm.R; g.pos = a + rng.next() * Math.max(1, (b - a) * 0.9);
        g.rate = Math.pow(2, ((st.pitch || 0) / 12) + scat);
      } else {
        g.kind = 1; g.ph = 0;
        g.fq = Math.min(0.45, (this.refA * Math.pow(2, ((st.note ?? 60) - 69) / 12 + scat + (rng.next() < 0.5 ? 1 : 2))) / sr);
      }
      g.active = true; spawned++;
    }
    this.port.postMessage({ type: 'collision', step: sA, count: spawned, big: boost > 1, t: currentTime });
  }

  flushRec() {
    if (this.recI > 0) {
      const L = this.recL.slice(0, this.recI), R = this.recR.slice(0, this.recI);
      this.port.postMessage({ type: 'rec', L, R }, [L.buffer, R.buffer]); this.recI = 0;
    }
  }

  process(_in, outputs) {
    const t0 = Date.now();
    const out = outputs[0], oL = out[0], oR = out[1] || out[0], N = oL.length;
    if (this.bL.length < N) { this.bL = new Float32Array(N); this.bR = new Float32Array(N); }
    const bL = this.bL, bR = this.bR; bL.fill(0, 0, N); bR.fill(0, 0, N);
    let a = 0;
    while (a < N) {
      let seg = N - a;
      if (this.playing) { this.fireDue(); const s = Math.max(1, Math.ceil(this.nextDt() - 1e-9)); if (s < seg) seg = s; }
      const b = a + seg;
      for (const v of this.voices) if (v.active) v.render(this, bL, bR, a, b);
      for (const g of this.grains) if (g.active) g.render(bL, bR, a, b);
      if (this.rip.p.on || this.rip.active || this.rip.mixC > 1e-6) this.rip.process(bL, bR, a, b);
      if (this.playing) this.advance(seg);
      a = b;
    }
    this.master(bL, bR, oL, oR, N);
    this.cpu += Date.now() - t0; this.cpuT += (N / this.sr) * 1000;
    return true;
  }

  master(bL, bR, oL, oR, N) {
    const mc = this.mixC, mt = this.mixT, mK = this.mK, comp = this.comp, dl = this.mdel, vb = this.mverb, lim = this.lim, lu = this.lufs;
    for (let n = 0; n < N; n++) {
      let l = bL[n], r = bR[n];
      mc[0] += (mt[0] - mc[0]) * mK; mc[1] += (mt[1] - mc[1]) * mK; mc[2] += (mt[2] - mc[2]) * mK;
      if (mc[0] > 1e-5) { const g = comp.gain(l, r), k = mc[0]; l += (l * g - l) * k; r += (r * g - r) * k; }
      else comp.gr *= 0.999;
      if (mc[1] > 1e-5 || mt[1] > 0) { dl.process(l, r); const k = mc[1]; l += (FO[0] - l) * k; r += (FO[1] - r) * k; }
      if (mc[2] > 1e-5 || mt[2] > 0) { vb.process(l, r); const k = mc[2]; l += (FO[0] - l) * k; r += (FO[1] - r) * k; }
      this.fg += (this.fgT - this.fg) * this.fK; l *= this.fg; r *= this.fg;
      if ((l > 1 || l < -1 || r > 1 || r < -1)) this.over = true;
      if (this.limOn) { lim.process(l, r); l = FO[0]; r = FO[1]; if (lim.g < this.limMin) this.limMin = lim.g; }
      lu.push(l, r);
      const al = l < 0 ? -l : l, ar = r < 0 ? -r : r; if (al > this.pk[0]) this.pk[0] = al; if (ar > this.pk[1]) this.pk[1] = ar;
      oL[n] = l; if (oR !== oL) oR[n] = r;
      if (this.rec) { this.recL[this.recI] = l; this.recR[this.recI] = r; if (++this.recI >= this.recL.length) this.flushRec(); }
    }
    this.meterN += N;
    if (this.meterN >= this.meterEvery) {
      this.meterN = 0;
      let voices = 0; for (const v of this.voices) if (v.active) voices++;
      const rp = this.rip;
      this.port.postMessage({
        type: 'meter', pk: this.pk.slice(), over: this.over, lufs: lu.value(), gr: this.comp.gr, lim: 20 * Math.log10(Math.max(1e-6, this.limMin)),
        voices, cpu: this.cpuT > 0 ? this.cpu / this.cpuT : 0, posA: this.posA, posB: this.posB, sf: this.sf, collide: this.C.on, playing: this.playing,
        rip: rp.p.on ? { x: Array.from(rp.x), y: Array.from(rp.y), active: rp.active && !rp.ending, events: rp.events, learns: rp.learns, rBar: rp.rBar } : null,
      });
      this.pk[0] = this.pk[1] = 0; this.over = false; this.limMin = 1; this.cpu = 0; this.cpuT = 0;
    }
  }
}

registerProcessor('chili-engine', ChiliProcessor);

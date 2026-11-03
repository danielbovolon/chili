/*
 * Chili v0.1 — DSP-Engine (AudioWorkletProcessor)
 *
 * Alles, was klingt, passiert hier — sample-genau, intern in 64-bit Float:
 *   Sequencer-Clock · Voices (Sampler/Granular/Synth + Step-FX) · Mutate · Chaos · Rip · Master
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
function hermRead2(L, R, pos) {
  const n = L.length, i = Math.floor(pos), f = pos - i;
  const a = i - 1 < 0 ? 0 : i - 1 >= n ? n - 1 : i - 1, b = i < 0 ? 0 : i >= n ? n - 1 : i, c = i + 1 >= n ? n - 1 : i + 1 < 0 ? 0 : i + 1, d = i + 2 >= n ? n - 1 : i + 2 < 0 ? 0 : i + 2;
  RD[0] = herm(L[a], L[b], L[c], L[d], f); RD[1] = herm(R[a], R[b], R[c], R[d], f);
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
const C_RATE = 0, C_F1 = 1, C_F2 = 2, C_G = 3, C_LV = 4, C_PL = 5, C_PR = 6, C_PAL = 7, C_PAR = 8, C_FLL = 9, C_FLR = 10, C_CHL = 11, C_CHR = 12, C_RC = 13, C_RG = 14, C_N = 15;
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
    const GN = 12; this.gOn = new Uint8Array(GN); this.gPos = new Float64Array(GN); this.gRate = new Float64Array(GN); this.gT = new Float64Array(GN); this.gDur = new Float64Array(GN); this.gGL = new Float32Array(GN); this.gGR = new Float32Array(GN);
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
      this.L = sm.L; this.R = sm.R; this.s0 = s0; this.s1 = s1; this.sid = sl.sampleId;
      this.rev = !!s.reverse !== !!o.reverse;
      const off = Math.floor(clamp(s.start || 0, 0, 0.95) * (s1 - s0));
      this.pos = this.rev ? s1 - 2 - off : s0 + off;
      this.loop = !!s.loop; this.fadeN = Math.max(8, 0.001 * sr);
      // Granular: Lesekopf wandert durch den Slice, Körner mit Hann-Fenster, Streuung in Zeit, Tonhöhe und Stereo
      this.gr = !!s.grMode;
      if (this.gr) {
        const len = s1 - s0; this.gHead = s0 + clamp(s.grPos || 0, 0, 1) * (len - 2);
        this.gSize = Math.max(64, (s.grSize || 80) * 0.001 * sr); this.gInt = sr / Math.max(0.5, s.grDensity || 30); this.gNext = 0;
        this.gSpray = s.grSpray || 0; this.gPit = s.grPitch || 0; this.gScan = s.grScan ?? 1; this.gWid = s.grWidth ?? 0.5;
        this.gNorm = 1 / Math.sqrt(Math.max(1, this.gSize / this.gInt)); this.gOn.fill(0);
      }
    } else {
      this.f0 = E.refA * Math.pow(2, ((s.note ?? 48) - 69) / 12);
      this.w1 = W_IDX[s.osc1] ?? 2; this.w2 = W_IDX[s.osc2] ?? 3;
      this.o2r = Math.pow(2, ((s.osc2Semi || 0) + (s.osc2Fine || 0) / 100) / 12);
      this.ph1 = 0; this.ph2 = 0; this.ph3 = 0;
      this.oMix = s.oscMix ?? 0.5; this.sub = s.sub || 0; this.noise = s.noise || 0; this.sid = null; this.gr = false;
    }
    this.srcOn = true; this.active = true; this.t = 0; this.killN = 0; this.kill = 0; this.silent = 0;
    this.serial = E.serial++; this.step = o.step;
    this.vel = dbLin(s.gain) * (o.vel ?? 1);
    this.basePitch = (s.pitch || 0) + (s.fine || 0) / 100 + (o.pitch || 0);
    // Amp-Hüllkurve
    let atk = s.atk, dec = s.dec, sus = s.sus, rel = s.rel; const G = E.genv;
    if (G && G.amp && G.amp.on && G.amp.amt > 0) { const a = G.amp.amt, A = G.amp; atk += (A.atk - atk) * a; dec += (A.dec - dec) * a; sus += (A.sus - sus) * a; rel += (A.rel - rel) * a; }
    this.atkN = Math.max(0, atk * 0.001 * sr);
    this.decC = Math.exp(-4.6 / Math.max(1, dec * 0.001 * sr));
    this.sus = clamp(sus, 0, 1);
    this.relC = Math.exp(-4.6 / Math.max(1, rel * 0.001 * sr));
    this.gateN = Math.max(32, s.gate * E.stepDur * (o.gateMul || 1)); this.env = 0; this.stage = 0;
    // Filter
    this.fT = F_IDX[s.fType] || 0; this.z1l = this.z2l = this.z1r = this.z2r = 0;
    this.cut = s.cutoff; this.fk = 1.41421356 * Math.pow(0.05 / 1.41421356, clamp(s.res, 0, 1));
    this.fAmt = s.fEnvAmt || 0; this.fEnvN = Math.max(32, s.fEnvTime * E.stepDur); this.fLoop = !!s.fEnvLoop; this.fCyc = 0;
    this.fMeta = s.fEnvShape === 'random';
    this.fShape = this.fMeta ? ALL_SHAPES[(rng.next() * ALL_SHAPES.length) | 0] : s.fEnvShape;
    genPts(this.fShape, this.rng, this.pts);
    // Globale Filter-Hüllkurve (ADSR, Control-Rate) — wirkt auf jeden Step; Steps ohne Filter bekommen einen Lowpass
    this.fgA = G && G.flt && G.flt.on ? G.flt.amt || 0 : 0; this.fge = 0; this.fgSt = 0;
    if (this.fgA !== 0) {
      const F = G.flt; this.fgAtkK = KR / Math.max(KR, F.atk * 0.001 * sr); this.fgDecK = Math.exp((-4.6 * KR) / Math.max(KR, F.dec * 0.001 * sr));
      this.fgSus = clamp(F.sus, 0, 1); this.fgRelK = Math.exp((-4.6 * KR) / Math.max(KR, F.rel * 0.001 * sr));
      if (!this.fT) this.fT = 1;
    }
    // Pan
    this.pan0 = clamp(s.pan + rng.bi() * (s.panRnd || 0), -1, 1);
    this.panMD = s.panModDepth || 0; this.panMR = s.panModRate; this.panMS = s.panModShape;
    this.apD = s.autopan || 0; this.apHz = 1 / ((SYNC[s.autopanSync] || 0.25) * E.wholeSec); this.apPh = 0;
    this.lPan.reset(0, this.rng);
    // Surround (Tiefe vorne→hinten, Orbit um den Hörer) und Spread (Stereobreite)
    this.dep = clamp(s.depth || 0, 0, 1); this.orb = clamp(s.orbit || 0, 0, 1); this.orbHz = s.orbitRate || 0.25; this.orbPh = rng.next();
    this.sur = this.dep > 0 || this.orb > 0; this.rlL = this.rlR = 0; this.px = this.pan0; this.py = this.dep;
    this.spr = s.spread ?? 1;
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
      let ge = 0;
      if (this.fgA !== 0) {
        if (this.fgSt === 0) { this.fge += this.fgAtkK; if (this.fge >= 1) { this.fge = 1; this.fgSt = 1; } }
        else if (this.fgSt === 1) this.fge = this.fgSus + (this.fge - this.fgSus) * this.fgDecK;
        else this.fge *= this.fgRelK;
        if (this.fgSt < 2 && t >= this.gateN) this.fgSt = 2;
        ge = this.fgA * this.fge;
      }
      const fc = clamp(this.cut * Math.pow(2, this.fAmt * v + mF + ge), 16, 0.45 * sr);
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
    if (this.sur) {
      let dE = this.dep;
      if (this.orb > 0) { this.orbPh += this.orbHz * dtk; this.orbPh -= Math.floor(this.orbPh); const th = TAU * this.orbPh; p += this.orb * Math.sin(th); dE = clamp(dE + this.orb * (0.5 - 0.5 * Math.cos(th)), 0, 1); }
      // Hinten: Höhen dunkler (Kopfschatten/Ohrmuschel), leiser, breiter
      const fc = Math.min(0.45 * sr, 20000 * Math.pow(2, -dE * 2.3));
      this.setC(C_RC, 1 - Math.exp((-TAU * fc) / sr), snap); this.setC(C_RG, 1 - 0.28 * dE, snap); this.py = dE;
    }
    p = clamp(p, -1, 1); this.px = p;
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
        if (this.src === 0 && this.gr) {
          const r = cv[C_RATE], s0 = this.s0, s1 = this.s1, len = s1 - s0;
          if (--this.gNext <= 0) {
            this.gNext += this.gInt * (0.7 + 0.6 * this.rng.next());
            for (let g = 0; g < 12; g++) if (!this.gOn[g]) {
              this.gOn[g] = 1; this.gT[g] = 0; this.gDur[g] = this.gSize;
              this.gPos[g] = clamp(this.gHead + this.rng.bi() * this.gSpray * len * 0.5, s0, s1 - 2);
              this.gRate[g] = r * Math.pow(2, (this.rng.bi() * this.gPit) / 12) * (this.rev ? -1 : 1);
              const th = ((clamp(this.rng.bi() * this.gWid, -1, 1) + 1) * PI) / 4; this.gGL[g] = Math.cos(th) * Math.SQRT2; this.gGR[g] = Math.sin(th) * Math.SQRT2;
              break;
            }
          }
          let sl = 0, srr = 0;
          for (let g = 0; g < 12; g++) {
            if (!this.gOn[g]) continue;
            const wi = (this.gT[g] / this.gDur[g]) * 1024, j = wi | 0, w = WIN[j] + (WIN[j + 1] - WIN[j]) * (wi - j);
            const rr = this.gRate[g], ar = rr < 0 ? -rr : rr;
            if (ar > 1.0001) sincRead(this.L, this.R, this.gPos[g], 1 / ar); else hermRead2(this.L, this.R, this.gPos[g]);
            sl += RD[0] * w * this.gGL[g]; srr += RD[1] * w * this.gGR[g];
            this.gPos[g] += rr; this.gT[g]++;
            if (this.gT[g] >= this.gDur[g] || this.gPos[g] < s0 || this.gPos[g] > s1 - 2) this.gOn[g] = 0;
          }
          xl = sl * this.gNorm; xr = srr * this.gNorm;
          this.gHead += r * this.gScan * (this.rev ? -1 : 1);
          if (this.gHead >= s1 - 2) this.gHead -= len - 2; else if (this.gHead < s0) this.gHead += len - 2;
        } else if (this.src === 0) {
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
          if (this.spr > 1) { const sd = (o1 - o2) * 0.35 * (this.spr - 1); xl = v + sd; xr = v - sd; } else xl = xr = v;
          this.ph1 += f1 / sr; this.ph1 -= Math.floor(this.ph1);
          this.ph2 += f2 / sr; this.ph2 -= Math.floor(this.ph2);
          this.ph3 += (0.5 * f1) / sr; this.ph3 -= Math.floor(this.ph3);
        }
      }
      if (this.spr !== 1 && this.src === 0) { const m = (xl + xr) * 0.5, d = (xl - xr) * 0.5 * this.spr; xl = m + d; xr = m - d; }
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
      if (this.sur) {
        const c = cv[C_RC], g = cv[C_RG]; this.rlL += c * (L - this.rlL); this.rlR += c * (R - this.rlR);
        const m = (this.rlL + this.rlR) * 0.5, d = (this.rlL - this.rlR) * 0.5 * (1 + (1 - g) * 2.2);
        L = (m + d) * g; R = (m - d) * g;
      }
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
    // Tape-Modulation und Shimmer (Pitch-Shift im Feedback, zwei Leseköpfe mit sin²-Überblendung)
    this.mod = 0; this.lph = 0; this.shift = 0; this.ratio = 1;
    this.sL = new Float32Array(4096); this.sR = new Float32Array(4096); this.sw = 0; this.sph = 0;
  }
  set(p, wholeSec) {
    this.tgt = clamp((SYNC[p.sync] || 0.1875) * wholeSec * this.sr, 8, this.mask - 8);
    this.fb = clamp(p.fb, 0, 0.95); this.pp = !!p.pp;
    this.c = 1 - Math.exp((-TAU * Math.min(0.45 * this.sr, 700 + p.tone * p.tone * 17000)) / this.sr);
    this.mod = clamp(p.mod || 0, 0, 1); this.shift = Math.round(p.shift || 0); this.ratio = Math.pow(2, this.shift / 12);
  }
  process(l, r) {
    this.cur += (this.tgt - this.cur) * this.glide;
    const m = this.mask, w = this.w, sr = this.sr;
    let d = this.cur;
    if (this.mod > 0) { // Wow + Flutter
      this.lph += 0.31 / sr; if (this.lph >= 1) this.lph -= 1;
      d += this.mod * sr * (0.006 * (0.5 + 0.5 * Math.sin(TAU * this.lph)) + 0.0007 * Math.sin(TAU * this.lph * 23.7));
    }
    const oL = hermRead(this.L, m, w, d), oR = hermRead(this.R, m, w, d);
    this.lpL += this.c * (oL - this.lpL); this.lpR += this.c * (oR - this.lpR);
    this.loL += this.hc * (this.lpL - this.loL); this.loR += this.hc * (this.lpR - this.loR);
    let fL = (this.lpL - this.loL) * this.fb, fR = (this.lpR - this.loR) * this.fb;
    if (this.shift !== 0) {
      const WN = 2048, pm = 4095, sw = this.sw; this.sL[sw] = fL; this.sR[sw] = fR;
      let ph = this.sph + (1 - this.ratio) / WN; ph -= Math.floor(ph); this.sph = ph;
      const p2 = ph + 0.5 >= 1 ? ph - 0.5 : ph + 0.5, g1 = Math.sin(PI * ph) ** 2, g2 = Math.sin(PI * p2) ** 2;
      fL = hermRead(this.sL, pm, sw, ph * WN + 3) * g1 + hermRead(this.sL, pm, sw, p2 * WN + 3) * g2;
      fR = hermRead(this.sR, pm, sw, ph * WN + 3) * g1 + hermRead(this.sR, pm, sw, p2 * WN + 3) * g2;
      this.sw = (sw + 1) & pm;
    }
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

/* ============================================================== ADAA-Sättigung */
/* tanh mit Antiderivative-Antialiasing 1. Ordnung (Parker/Bilbao): unterdrückt die Aliasing-Produkte der Verzerrung
 * ohne Oversampling. F(x) = ln cosh x. */
const LN2 = 0.6931471805599453;
const lcosh = (x) => { const a = x < 0 ? -x : x; return a > 12 ? a - LN2 : Math.log(Math.cosh(x)); };
function adaa(x, st, i) {
  const x1 = st[i]; st[i] = x; const d = x - x1;
  return d > 1e-5 || d < -1e-5 ? (lcosh(x) - lcosh(x1)) / d : Math.tanh(0.5 * (x + x1));
}
function toN(d, v, max) {
  const mn = d.min; if (max <= mn) return 0;
  if (d.c === 'log') return Math.log(v / mn) / Math.log(max / mn);
  if (d.c === 'cub') return Math.cbrt((v - mn) / (max - mn));
  return (v - mn) / (max - mn);
}
function fromN(d, n, max) {
  let v; if (d.c === 'log') v = d.min * Math.pow(max / d.min, n); else if (d.c === 'cub') v = d.min + (max - d.min) * n * n * n; else v = d.min + (max - d.min) * n;
  return d.int ? Math.round(v) : v;
}
function lfoAt(shape, ph, a, b) {
  switch (shape) {
    case 'tri': return ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
    case 'square': return ph < 0.5 ? 1 : -1;
    case 'saw': return 2 * ph - 1;
    case 'sh': return a;
    case 'smooth': return a + (b - a) * (0.5 - 0.5 * Math.cos(PI * ph));
    default: return Math.sin(TAU * ph);
  }
}

/* ============================================================== MASTER-FILTER */
const MF_T = { lp: 1, bp: 2, hp: 3, notch: 4, peak: 5, lshelf: 6, hshelf: 7, comb: 8, combn: 9, formant: 10 };
const VOWELS = [[730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240]];
const FGAIN = [1, 0.5, 0.28];
/* ZDF-SVF-Kaskade bis 48 dB/Okt (Butterworth-Q pro Stufe, Resonanz in der letzten), Peak/Shelf (Simper),
 * Comb ±, Formant (3 Bandpässe, Vokal-Morph), Drive mit ADAA, Hüllkurvenfolger, LFO (frei/sync), Stereo-Phase. */
class MFilter {
  constructor(sr) {
    this.sr = sr; this.t = 1; this.n = 2; this.on = false; this.mixC = 0; this.kc = 0; this.wasOn = false;
    this.z = [new Float64Array(8), new Float64Array(8)]; this.fz = [new Float64Array(6), new Float64Array(6)];
    const cn = pow2(Math.ceil(sr / 16) + 8); this.cb = [new Float32Array(cn), new Float32Array(cn)]; this.cm = cn - 1; this.cw = 0;
    this.cur = new Float64Array(10); this.inc = new Float64Array(10); this.kb = new Float64Array(4);
    this.ds = new Float64Array(2); this.env = 0; this.lph = 0; this.la = 0; this.lb = 0; this.rng = new Rng(4242);
    this.fcL = 1000; this.fcR = 1000; this.p = null; this.first = true;
  }
  set(p, wholeSec) {
    if (!p) return; this.p = p;
    this.t = MF_T[p.type] || 1; this.n = clamp(p.slope | 0, 1, 4); this.on = !!p.on;
    for (let i = 0; i < this.n; i++) this.kb[i] = 2 * Math.cos((PI * (2 * i + 1)) / (4 * this.n));
    this.dg = p.drive > 0 ? Math.pow(10, p.drive / 20) : 1; this.dc = 1 / Math.sqrt(this.dg);
    this.outG = Math.pow(10, (p.out || 0) / 20); this.A = Math.pow(10, (p.gain || 0) / 40);
    this.eA = Math.exp(-1 / (Math.max(0.5, p.envAtk) * 0.001 * this.sr)); this.eR = Math.exp(-1 / (Math.max(5, p.envRel) * 0.001 * this.sr));
    this.lHz = p.lfoSync && p.lfoSync !== 'off' ? 1 / ((SYNC[p.lfoSync] || 0.25) * wholeSec) : p.lfoRate;
  }
  ctl(snap) {
    const p = this.p, sr = this.sr, dt = KR / sr;
    let ph = this.lph + this.lHz * dt; if (ph >= 1) { ph -= Math.floor(ph); this.la = this.lb; this.lb = this.rng.bi(); } this.lph = ph;
    const lL = lfoAt(p.lfoShape, ph, this.la, this.lb), phR = (ph + p.stereo * 0.5) % 1, lR = lfoAt(p.lfoShape, phR, this.la, this.lb);
    const eo = p.envAmt * Math.min(1, this.env * 1.6);
    const oL = eo + p.lfoDepth * lL - p.spreadOct * 0.5, oR = eo + p.lfoDepth * lR + p.spreadOct * 0.5;
    const fL = clamp(p.cutoff * Math.pow(2, oL), 16, 0.45 * sr), fR = clamp(p.cutoff * Math.pow(2, oR), 16, 0.45 * sr);
    this.fcL = fL; this.fcR = fR;
    const T = this.t, tg = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    if (T === 8 || T === 9) { tg[0] = clamp(sr / fL, 2, this.cm - 4); tg[1] = clamp(sr / fR, 2, this.cm - 4); }
    else if (T === 10) {
      const v = clamp(p.vowel, 0, 4), i0 = Math.min(3, Math.floor(v)), fr = v - i0, sh = clamp(Math.sqrt(p.cutoff / 1000), 0.3, 3.5);
      for (let k = 0; k < 3; k++) {
        const f = (VOWELS[i0][k] + (VOWELS[i0 + 1][k] - VOWELS[i0][k]) * fr) * sh;
        const mL = Math.pow(2, oL * 0.5), mR = Math.pow(2, oR * 0.5);
        tg[2 + k] = Math.tan((PI * clamp(f * mL, 30, 0.45 * sr)) / sr); tg[5 + k] = Math.tan((PI * clamp(f * mR, 30, 0.45 * sr)) / sr);
      }
    } else {
      let gL = Math.tan((PI * fL) / sr), gR = Math.tan((PI * fR) / sr);
      if (T === 6) { gL /= Math.sqrt(this.A); gR /= Math.sqrt(this.A); } else if (T === 7) { gL *= Math.sqrt(this.A); gR *= Math.sqrt(this.A); }
      tg[0] = gL; tg[1] = gR;
    }
    for (let i = 0; i < 8; i++) { if (snap) { this.cur[i] = tg[i]; this.inc[i] = 0; } else this.inc[i] = (tg[i] - this.cur[i]) / KR; }
  }
  chan(x, c) {
    const T = this.t, p = this.p, z = this.z[c], cur = this.cur;
    if (T <= 4) {
      const g = cur[c], n = this.n; let y = x;
      for (let i = 0; i < n; i++) {
        let k = this.kb[i]; if (i === n - 1) k *= 1 - p.res * 0.985;
        const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2, j = i * 2;
        const v3 = y - z[j + 1], v1 = a1 * z[j] + a2 * v3, v2 = z[j + 1] + a2 * z[j] + a3 * v3;
        z[j] = 2 * v1 - z[j]; z[j + 1] = 2 * v2 - z[j + 1];
        y = T === 1 ? v2 : T === 2 ? k * v1 : T === 3 ? y - k * v1 - v2 : y - k * v1;
      }
      return y;
    }
    if (T <= 7) {
      const g = cur[c], A = this.A, k = 1 / (0.5 + p.res * 9.5);
      const kk = T === 5 ? k / A : k;
      const a1 = 1 / (1 + g * (g + kk)), a2 = g * a1, a3 = g * a2;
      const v3 = x - z[1], v1 = a1 * z[0] + a2 * v3, v2 = z[1] + a2 * z[0] + a3 * v3;
      z[0] = 2 * v1 - z[0]; z[1] = 2 * v2 - z[1];
      if (T === 5) return x + kk * (A * A - 1) * v1;
      if (T === 6) return x + k * (A - 1) * v1 + (A * A - 1) * v2;
      return A * A * x + k * (1 - A) * A * v1 + (1 - A * A) * v2;
    }
    if (T <= 9) {
      const b = this.cb[c], fb = (T === 8 ? 1 : -1) * (0.3 + 0.68 * p.res);
      const y = x + fb * hermRead(b, this.cm, this.cw, cur[c]);
      b[this.cw] = y; return y * (1 - Math.abs(fb) * 0.75);
    }
    const fz = this.fz[c], k = 0.25 - p.res * 0.2; let sum = 0;
    for (let f = 0; f < 3; f++) {
      const g = cur[2 + f + c * 3], a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2, j = f * 2;
      const v3 = x - fz[j + 1], v1 = a1 * fz[j] + a2 * v3, v2 = fz[j + 1] + a2 * fz[j] + a3 * v3;
      fz[j] = 2 * v1 - fz[j]; fz[j + 1] = 2 * v2 - fz[j + 1]; sum += FGAIN[f] * k * v1;
    }
    return sum * 1.6;
  }
  reset() { this.z[0].fill(0); this.z[1].fill(0); this.fz[0].fill(0); this.fz[1].fill(0); this.cb[0].fill(0); this.cb[1].fill(0); this.ds.fill(0); this.env = 0; }
  /** Liefert FO; gibt false zurück, wenn komplett im Bypass (bit-transparent) */
  process(l, r, mK) {
    const tgt = this.on ? clamp(this.p.mix, 0, 1) : 0;
    if (!this.on && this.mixC < 1e-6) { this.mixC = 0; this.wasOn = false; return false; }
    if (this.on && !this.wasOn) { this.reset(); this.wasOn = true; this.first = true; }
    this.mixC += (tgt - this.mixC) * mK;
    const a = Math.max(l < 0 ? -l : l, r < 0 ? -r : r); this.env = a > this.env ? a + (this.env - a) * this.eA : a + (this.env - a) * this.eR;
    if (--this.kc <= 0) { this.ctl(this.first); this.first = false; this.kc = KR; }
    let xl = l, xr = r;
    if (this.dg > 1) { xl = adaa(l * this.dg, this.ds, 0) * this.dc; xr = adaa(r * this.dg, this.ds, 1) * this.dc; }
    let yl = this.chan(xl, 0), yr = this.chan(xr, 1);
    this.cw = (this.cw + 1) & this.cm;
    for (let i = 0; i < 8; i++) this.cur[i] += this.inc[i];
    yl *= this.outG; yr *= this.outG;
    if (yl !== yl || yr !== yr || Math.abs(yl) > 1e4) { this.reset(); yl = yr = 0; } // Sicherheitsnetz
    FO[0] = l + (yl - l) * this.mixC; FO[1] = r + (yr - r) * this.mixC;
    return true;
  }
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
    this.samples = new Map(); this.slices = []; this.steps = []; this.len = 16;
    this.rng = new Rng((Date.now() ^ 0x5eed1234) >>> 0); this.serial = 1;
    this.bpm = 120; this.div = 1 / 16; this.swing = 0; this.refA = 440; this.panLaw = 'm3';
    this.calcTiming();
    this.playing = false; this.stepI = 0; this.tA = 0;
    this.genv = { amp: { on: false, amt: 0 }, flt: { on: false, amt: 0 } }; this.lastV = null;
    // Makros, Laufrichtung, Ratchets/Mikro-Timing (Pending-Trigger), Chaos-Modulator, Heat
    this.M = { heat: 0, density: 0.5, warp: 0, tone: 0, pitch: 0, length: 1, space: 0.5, chaos: 0 };
    this.dir = 'fwd'; this.ppDir = 1; this.stepCount = 0;
    this.pend = []; for (let i = 0; i < 64; i++) this.pend.push({ on: false, at: 0, i: 0, vel: 1, gm: 1, s: {} }); this.pendN = 0;
    this.scr = {};
    this.ch = { on: false, depth: 0.5, rate: 1, prob: 1, rand: 1, shape: 0, mode: 'rel', lock: 0, loop: 8 };
    this.chKeys = []; this.chSig = ''; this.chSt = []; this.chRng = new Rng(0x51ce);
    this.ord = Int8Array.from([0, 2, 3, 1]); this.heatC = 0; this.hs = new Float64Array(2); this.mf = new MFilter(sr); this.baseMix = [0, 0, 0];
    this.rip = new Rip(sr);
    this.comp = new Comp(sr); this.mdel = new MDelay(sr); this.mverb = new MVerb(sr); this.lim = new Limiter(sr); this.lufs = new Lufs(sr);
    this.mixC = [0, 0, 0]; this.mixT = [0, 0, 0]; this.mK = 1 - Math.exp(-1 / (0.02 * sr));
    this.fg = 0.64; this.fgT = 0.64; this.fK = 1 - Math.exp(-1 / (0.015 * sr));
    this.limOn = true;
    this.bL = new Float32Array(4096); this.bR = new Float32Array(4096);
    this.pk = [0, 0]; this.over = false; this.meterN = 0; this.meterEvery = Math.round(sr / 30); this.limMin = 1; this.cpu = 0; this.cpuT = 0;
    // Aufnahme in den Sequencer (Eingang oder Master-Resampling), sample-genau
    this.cap = { armed: false, active: false, mode: 'free', src: 'input', ch: 'stereo', passes: 1, countIn: 0, remaining: 0, compN: 0, skip: 0,
      ending: false, extraLeft: 0, endFrom: 0, from: 0, to: -1, stopping: false, stopReq: false, L: new Float32Array(16384), R: new Float32Array(16384), i: 0, total: 0, maxN: sr * 600 };
    this.inCh = 'stereo'; this.monitor = false; this.inPk = [0, 0]; this.inOver = false; this.inL = null; this.inR = null; this.curA = 0;
    this.shedT = 0; this.shed = 0; this.lAvg = 0;
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
      case 'play': this.setPlaying(m.on); if (!m.on) { for (const p of this.pend) p.on = false; this.pendN = 0; } break;
      case 'audition': this.trigger(m.step, { force: true }); break;
      case 'panic': for (const v of this.voices) v.active = false; for (const p of this.pend) p.on = false; this.pendN = 0; break;
      case 'settings':
        this.panLaw = m.panLaw || 'm3'; this.limOn = m.limiter !== false; this.lim.ceil = dbLin(m.ceiling ?? -0.3); this.refA = m.refA || 440; break;
      case 'rec':
        if (m.on) { this.rec = true; this.recI = 0; } else { this.flushRec(); this.rec = false; this.port.postMessage({ type: 'recEnd' }); }
        break;
      case 'capArm': {
        const c = this.cap; Object.assign(c, { mode: m.mode, src: m.src, passes: Math.max(1, m.passes | 0), countIn: m.countIn | 0, compN: Math.max(0, Math.round(m.compN || 0)),
          i: 0, total: 0, ending: false, stopping: false, stopReq: false, from: 0, to: -1 });
        if (m.mode === 'free') { c.armed = false; c.active = true; c.skip = 0; this.capState('recording'); }
        else { c.armed = true; c.active = false; this.capState(c.countIn > 0 ? 'countin' : 'armed'); }
        break;
      }
      case 'capStop': {
        const c = this.cap;
        if (c.active) c.stopReq = true;
        else if (c.armed) { c.armed = false; this.capState('idle'); this.port.postMessage({ type: 'capEnd', empty: true }); }
        break;
      }
      case 'input': this.inCh = m.ch || 'stereo'; this.monitor = !!m.monitor; break;
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
    if (s.macros) Object.assign(this.M, s.macros);
    this.scale = s.scale && s.scale.iv && s.scale.iv.length ? s.scale : null;
    this.dir = s.direction || 'fwd';
    if (s.chaos) {
      const { keys, ...cs } = s.chaos; Object.assign(this.ch, cs);
      const ks = keys || [], sig = ks.map((k) => k.k).join(',');
      if (sig !== this.chSig) { this.chSig = sig; this.chKeys = ks; this.chSt = ks.map(() => ({ prev: 0, next: 0, cur: 0, cnt: 0, hist: new Float64Array(32), hn: 0, hp: 0 })); }
      if (cs.seed !== undefined && cs.seed !== this.chSeed) { this.chSeed = cs.seed; this.chRng = new Rng(((cs.seed | 0) * 2654435761) >>> 0 || 1); }
    }
    if (s.genv) this.genv = s.genv;
    if (s.rip) {
      const r = s.rip, seedChanged = r.seed !== undefined && r.seed !== this.rip.curSeed;
      Object.assign(this.rip.p, r); if (seedChanged) this.rip.seed(r.seed);
    }
    const M = s.master;
    if (M) {
      this.comp.set(M.comp); this.mdel.set(M.delay, this.wholeSec); this.mverb.set(M.verb);
      const sp = Math.max(0, this.M.space - 0.5); // Makro „Raum": mehr Master-Delay/-Hall
      const on = (x) => x.on !== false; // FX-Schalter: aus = Mix 0, auch wenn das Raum-Makro höher steht
      this.mixT[0] = on(M.comp) ? clamp(M.comp.mix, 0, 1) : 0; this.mixT[1] = on(M.delay) ? clamp(M.delay.mix + sp * 0.6, 0, 1) : 0; this.mixT[2] = on(M.verb) ? clamp(M.verb.mix + sp * 0.8, 0, 1) : 0;
      this.mf.set(M.filter, this.wholeSec);
      const IDS = { filter: 0, comp: 1, delay: 2, verb: 3 }, o = (M.order || []).map((x) => IDS[x]).filter((x) => x !== undefined);
      for (const x of [0, 2, 3, 1]) if (!o.includes(x)) o.push(x);
      this.ord = Int8Array.from(o.slice(0, 4));
      const pos = clamp(M.fader, 0, 1); this.fgT = pos * pos; // max. 0 dB
    }
  }

  setPlaying(on) {
    if (on && !this.playing) { this.stepI = 0; this.tA = 0; this.ppDir = 1; this.stepCount = 0; }
    this.playing = on;
  }
  /* ---- Clock */
  nextDt() { return this.tA; }
  advance(seg) { this.tA -= seg; }
  fireDue() {
    const N = this.len; let guard = 0;
    while (this.tA <= 1e-7 && guard++ < 8) {
      const st = this.stepI; this.capTick(st); this.trigger(st, {});
      const s = this.steps[st]; this.rip.tick(this, st, s ? s.ripWeight ?? 0.5 : 0.5, N);
      this.tA += this.stepDur * ((this.stepCount++ & 1) === 0 ? 1 + this.swing : 1 - this.swing);
      this.chaosTick();
      this.stepI = this.nextStep(st, N); this.port.postMessage({ type: 'tick', step: st, t: currentTime });
    }
  }
  nextStep(st, N) {
    const r = this.rng;
    switch (this.dir) {
      case 'rev': return (st - 1 + N) % N;
      case 'pp': { if (N < 2) return 0; let n = st + this.ppDir; if (n >= N) { this.ppDir = -1; n = N - 2; } else if (n < 0) { this.ppDir = 1; n = 1; } return n; }
      case 'rnd': return (r.next() * N) | 0;
      case 'brown': { const x = r.next(); return (st + (x < 0.55 ? 1 : x < 0.8 ? 0 : -1) + N) % N; }
      case 'skip': return (st + 1 + (r.next() < 0.3 ? 1 + ((r.next() * 2) | 0) : 0)) % N;
      default: return (st + 1) % N;
    }
  }

  /* ---- Chaos-Zufallsmodulator: pro Ziel-Parameter ein eigener Zufallskanal, getaktet in Steps */
  chEff() { const c = this.ch; if (!c.on) return 0; const b = clamp(c.depth, 0, 1); return clamp(b + this.M.chaos * (1 - b), 0, 1); } // aus = wirklich aus
  chaosTick() {
    if (!this.chSt.length || this.chEff() <= 0) return;
    const c = this.ch, rate = Math.max(1, c.rate | 0), r = this.chRng, loop = clamp(c.loop | 0, 2, 32);
    const sh = clamp(c.shape, 0, 3), s0 = Math.floor(Math.min(2.999, sh)), sf = sh - s0;
    const ease = (k, t) => (k <= 0 ? 1 : k === 1 ? t : k === 2 ? 0.5 - 0.5 * Math.cos(PI * t) : 1 - (1 - t) * (1 - t) * (1 - t));
    for (const st of this.chSt) {
      st.cnt++;
      if (st.cnt >= rate) {
        st.cnt = 0; st.prev = st.next;
        if (r.next() < c.prob) {
          let nv;
          if (st.hn >= loop && r.next() < c.lock) nv = st.hist[st.hp % loop];
          else nv = clamp(st.prev + c.rand * (r.bi() - st.prev), -1, 1);
          st.next = nv; st.hist[st.hp % loop] = nv; st.hp = (st.hp + 1) % loop; if (st.hn < loop) st.hn++;
        }
      }
      const t = (st.cnt + 1) / rate, e = ease(s0, t) + (ease(s0 + 1, t) - ease(s0, t)) * sf;
      st.cur = st.prev + (st.next - st.prev) * e;
    }
  }
  applyChaos(s, eff) {
    const ks = this.chKeys, sts = this.chSt, abs = this.ch.mode === 'abs';
    for (let j = 0; j < ks.length; j++) {
      const d = ks[j], v = sts[j].cur, k = d.k;
      if (d.t === 'n') {
        const max = k === 'slice' ? Math.max(0, this.slices.length - 1) : d.max; if (max <= d.min) continue;
        const n0 = clamp(toN(d, s[k], max), 0, 1);
        const n = abs ? n0 + ((v + 1) / 2 - n0) * eff : n0 + v * eff * 0.75;
        s[k] = fromN(d, clamp(n, 0, 1), max);
      } else if (d.t === 'sel') {
        if (abs ? eff >= 0.5 : Math.abs(v) * eff > 0.35) s[k] = d.o[Math.min(d.o.length - 1, Math.floor(((v + 1) / 2) * d.o.length))];
      } else if (d.t === 'tog') {
        if (abs) { if (eff >= 0.5) s[k] = v > 0; } else if (v * eff > 0.5) s[k] = !s[k];
      }
    }
  }
  /* ---- Makros: alle neutral = keine Änderung */
  macroApply(s, ghost, force) {
    const M = this.M, r = this.rng;
    if (M.pitch) s.pitch += M.pitch;
    if (M.tone) s.cutoff = clamp(s.cutoff * Math.pow(2, M.tone * 3), 20, 20000);
    if (M.heat > 0) { s.res = Math.min(1, s.res + M.heat * 0.35); s.fEnvAmt *= 1 + M.heat * 0.8; }
    if (M.space !== 0.5) {
      const k = M.space - 0.5;
      if (k < 0) { const m = 1 + 2 * k; s.delayMix *= m; s.verbMix *= m; }
      else { s.orbit = clamp((s.orbit || 0) + k * 0.9, 0, 1); s.spread = Math.min(2, (s.spread ?? 1) + k * 1.2); }
    }
    if (M.warp > 0 && !force) {
      const w = M.warp; s.fine += r.bi() * w * 45; s.start = clamp(s.start + r.next() * w * 0.25, 0, 0.95);
      s.gate *= 1 + r.bi() * w * 0.6; if (r.next() < w * 0.2) s.reverse = !s.reverse;
    }
    if (ghost) { s.gain -= 10; s.ratchet = 1; }
    if (M.density > 0.5 && !force && !ghost && (s.ratchet || 1) <= 1 && r.next() < (M.density - 0.5) * 0.5) s.ratchet = 2 + ((r.next() * 3) | 0);
  }

  /* ---- Scale: snap to the nearest scale degree, then shift by n degrees (Ableton-style) */
  snap(x) {
    const { root, iv, shift } = this.scale, n = iv.length, rel = x - root, oct = Math.floor(rel / 12), pc = rel - oct * 12;
    let bi = 0, bd = Infinity;
    for (let k = 0; k <= n; k++) { const v = k < n ? iv[k] : 12, d = Math.abs(pc - v); if (d < bd) { bd = d; bi = k; } }
    let idx = oct * n + bi + (shift | 0); const o2 = Math.floor(idx / n), j = idx - o2 * n;
    return root + o2 * 12 + iv[j];
  }
  quantize(s) {
    if (s.source === 'synth') { const q = this.snap(s.note + s.pitch + (s.fine || 0) / 100); const d = q - s.note; s.pitch = Math.floor(d + 1e-9); s.fine = (d - s.pitch) * 100; }
    else { const q = this.snap(this.scale.root + s.pitch + (s.fine || 0) / 100) - this.scale.root; s.pitch = Math.floor(q + 1e-9); s.fine = (q - s.pitch) * 100; }
  }
  trigger(i, o) {
    const s0 = this.steps[i]; if (!s0) return;
    const s = this.scr; for (const k in s0) s[k] = s0[k];
    const M = this.M, rng = this.rng, eff = this.chEff();
    if (eff > 0 && this.chKeys.length) this.applyChaos(s, eff);
    let ghost = false;
    if (!o.force) {
      if (!s.on) { if (M.density > 0.5 && rng.next() < (M.density - 0.5) * 1.1) ghost = true; else return; }
      let pr = s.prob ?? 1; if (M.density < 0.5) pr *= M.density * 2;
      if (pr < 1 && rng.next() >= pr) return;
    }
    this.macroApply(s, ghost, o.force);
    if (this.scale) this.quantize(s);
    const r = clamp(Math.round(s.ratchet || 1), 1, 8), rv = clamp(s.ratchVel || 0, -1, 1);
    const sp = this.stepDur / r, gm = (o.gateMul || 1) * M.length / r;
    const dl = !o.force && M.warp > 0 ? rng.next() * M.warp * 0.3 * this.stepDur : 0;
    for (let k = 0; k < r; k++) {
      const t = r > 1 ? k / (r - 1) : 1, f = Math.max(0.05, rv >= 0 ? 1 - rv * (1 - t) : 1 + rv * t);
      const vel = (o.vel ?? 1) * f, at = dl + k * sp;
      if (at < 1) this.startVoice(s, i, vel, gm, o.reverse);
      else this.schedule(s, i, vel, gm, o.reverse, at);
    }
  }
  startVoice(s, i, vel, gm, rev) {
    const v = this.allocVoice();
    if (!v.start(this, s, { step: i, vel, gateMul: gm, reverse: rev })) v.active = false; else this.lastV = v;
  }
  schedule(s, i, vel, gm, rev, at) {
    const p = this.pend.find((x) => !x.on); if (!p) return;
    for (const k in s) p.s[k] = s[k];
    p.on = true; p.at = at; p.i = i; p.vel = vel; p.gm = gm; p.rev = rev; this.pendN++;
  }
  firePend() {
    for (const p of this.pend) if (p.on && p.at <= 1e-7) { p.on = false; this.pendN--; this.startVoice(p.s, p.i, p.vel, p.gm, p.rev); }
  }
  pendNext() { let m = Infinity; for (const p of this.pend) if (p.on && p.at < m) m = p.at; return m; }
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

  capState(state) { this.port.postMessage({ type: 'capState', state, countIn: this.cap.countIn, t: currentTime }); }
  /** Wird an jedem Step von Strahl A aufgerufen: Sync-Start auf Step 1, Stopp nach Länge × Durchläufe */
  capTick(st) {
    const c = this.cap;
    if (c.active && c.mode === 'sync' && !c.ending) {
      if (--c.remaining <= 0) { c.ending = true; c.extraLeft = c.compN; c.endFrom = this.curA; if (c.extraLeft <= 0) { c.to = this.curA; c.stopping = true; } }
    }
    if (c.armed && st === 0 && !c.active) {
      if (c.countIn > 0) { c.countIn--; this.capState('countin'); }
      else { c.armed = false; c.active = true; c.ending = false; c.remaining = this.len * c.passes; c.from = this.curA; c.to = -1; c.skip = c.compN; this.capState('recording'); }
    }
  }
  capFlush() {
    const c = this.cap;
    if (c.i > 0) { const L = c.L.slice(0, c.i), R = c.R.slice(0, c.i); this.port.postMessage({ type: 'cap', L, R }, [L.buffer, R.buffer]); c.i = 0; }
  }
  capture(oL, oR, N) {
    const c = this.cap; if (!c.active) return;
    const from = c.from, to = c.to >= 0 ? c.to : N, iL = this.inL, iR = this.inR;
    for (let n = from; n < to; n++) {
      let l, r;
      if (c.src === 'master') { l = oL[n]; r = oR[n]; }
      else { l = iL ? iL[n] : 0; r = iR ? iR[n] : 0; }
      if (c.skip > 0) { c.skip--; continue; }
      c.L[c.i] = l; c.R[c.i] = r; c.total++;
      if (++c.i >= c.L.length) this.capFlush();
      if (c.ending && c.compN > 0 && n >= c.endFrom && --c.extraLeft <= 0) { c.stopping = true; break; }
      if (c.total >= c.maxN) { c.stopping = true; break; }
    }
    c.from = 0; c.to = -1; c.endFrom = 0;
    if (c.stopping || c.stopReq) {
      this.capFlush(); c.active = false; c.stopping = false; c.stopReq = false; c.ending = false; c.armed = false;
      this.capState('idle'); this.port.postMessage({ type: 'capEnd', empty: c.total === 0 });
    }
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
    // Eingang: Kanalwahl + Pegel
    const inp = _in && _in[0];
    if (inp && inp.length) {
      const c0 = inp[0], c1 = inp[1] || inp[0];
      this.inL = this.inCh === 'R' ? c1 : c0; this.inR = this.inCh === 'L' ? c0 : c1;
      for (let n = 0; n < N; n++) {
        const a0 = Math.abs(this.inL[n]), a1 = Math.abs(this.inR[n]);
        if (a0 > this.inPk[0]) this.inPk[0] = a0; if (a1 > this.inPk[1]) this.inPk[1] = a1;
      }
      if (this.inPk[0] >= 0.999 || this.inPk[1] >= 0.999) this.inOver = true;
    } else { this.inL = this.inR = null; }
    let a = 0;
    while (a < N) {
      let seg = N - a;
      if (this.playing) { this.curA = a; this.fireDue(); const s = Math.max(1, Math.ceil(this.nextDt() - 1e-9)); if (s < seg) seg = s; }
      if (this.pendN) { this.firePend(); const pn = this.pendNext(); if (pn < Infinity) { const s = Math.max(1, Math.ceil(pn - 1e-9)); if (s < seg) seg = s; } }
      const b = a + seg;
      for (const v of this.voices) if (v.active) v.render(this, bL, bR, a, b);
      if (this.rip.p.on || this.rip.active || this.rip.mixC > 1e-6) this.rip.process(bL, bR, a, b);
      if (this.playing) this.advance(seg);
      if (this.pendN) for (const p of this.pend) if (p.on) p.at -= seg;
      a = b;
    }
    this.master(bL, bR, oL, oR, N);
    this.capture(oL, oR, N);
    const el = Date.now() - t0, bms = (N / this.sr) * 1000;
    this.cpu += el; this.cpuT += bms;
    // CPU-Schutz: bei Dauerlast > 85 % die ältesten Ausklänge (Delay/Hall-Tails) klickfrei ausblenden statt Dropouts zu riskieren
    this.lAvg = (this.lAvg || 0) + (el / bms - (this.lAvg || 0)) * 0.04;
    if (this.lAvg > 0.85 && ++this.shedT >= 6) {
      this.shedT = 0; let o = null;
      for (const v of this.voices) if (v.active && !v.killN && (!o || (v.stage === 3) > (o.stage === 3) || ((v.stage === 3) === (o.stage === 3) && v.serial < o.serial))) o = v;
      if (o) { o.killN = o.kill = Math.round(0.006 * this.sr); this.shed = (this.shed || 0) + 1; }
    }
    return true;
  }

  master(bL, bR, oL, oR, N) {
    const mc = this.mixC, mt = this.mixT, mK = this.mK, comp = this.comp, mf = this.mf, dl = this.mdel, vb = this.mverb, lim = this.lim, lu = this.lufs;
    const hT = this.M.heat, hs = this.hs, ord = this.ord;
    const h0 = this.heatC, h1 = h0 + (hT - h0) * Math.min(1, N * this.mK), hInc = (h1 - h0) / N;
    const g0 = h0 > 0 ? Math.pow(10, (h0 * 24) / 20) : 1, g1 = h1 > 0 ? Math.pow(10, (h1 * 24) / 20) : 1, gInc = (g1 - g0) / N;
    const heatOn = h0 > 1e-5 || h1 > 1e-5; this.heatC = h1 < 1e-6 && hT === 0 ? 0 : h1;
    for (let n = 0; n < N; n++) {
      let l = bL[n], r = bR[n];
      if (this.monitor && this.inL) { l += this.inL[n]; r += this.inR[n]; }
      if (heatOn) { // Heat: ADAA-Sättigung auf dem Sequencer-Bus, sanft eingeblendet
        const hv = h0 + hInc * n, g = g0 + gInc * n, comp = 1 / Math.sqrt(g), w = Math.min(1, hv * 20);
        const sl = adaa(l * g, hs, 0) * comp, sr2 = adaa(r * g, hs, 1) * comp;
        l += (sl - l) * w; r += (sr2 - r) * w;
      }
      mc[0] += (mt[0] - mc[0]) * mK; mc[1] += (mt[1] - mc[1]) * mK; mc[2] += (mt[2] - mc[2]) * mK;
      // Master chain in user order (0 filter · 1 comp · 2 delay · 3 reverb)
      for (let q = 0; q < 4; q++) {
        switch (ord[q]) {
          case 0: if (mf.process(l, r, mK)) { l = FO[0]; r = FO[1]; } break;
          case 1: if (mc[0] > 1e-5) { const g = comp.gain(l, r), k = mc[0]; l += (l * g - l) * k; r += (r * g - r) * k; } else comp.gr *= 0.999; break;
          case 2: if (mc[1] > 1e-5 || mt[1] > 0) { dl.process(l, r); const k = mc[1]; l += (FO[0] - l) * k; r += (FO[1] - r) * k; } break;
          case 3: if (mc[2] > 1e-5 || mt[2] > 0) { vb.process(l, r); const k = mc[2]; l += (FO[0] - l) * k; r += (FO[1] - r) * k; } break;
        }
      }
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
        inPk: this.inPk.slice(), inOver: this.inOver, capN: this.cap.active ? this.cap.total : -1,
        vz: this.voices.filter((v) => v.active).map((v) => ({ s: v.src === 0 ? v.sid : null, f: v.src === 0 && v.L ? (v.gr ? v.gHead : v.pos) / v.L.length : 0, e: v.env * v.vel, x: v.px, y: v.py || 0, st: v.step })),
        ch: this.chEff() > 0 ? this.chSt.slice(0, 16).map((c) => c.cur) : null,
        mf: mf.on || mf.mixC > 0.001 ? { l: mf.fcL, r: mf.fcR, e: mf.env } : null, heat: this.heatC,
        shed: this.shed || 0, voices, cpu: this.cpuT > 0 ? this.cpu / this.cpuT : 0, playing: this.playing,
        ge: this.lastV && this.lastV.active ? { t: this.lastV.t / this.sr, g: this.lastV.gateN / this.sr, st: this.lastV.stage, e: this.lastV.env, f: this.lastV.fge || 0 } : null,
        rip: rp.p.on ? { x: Array.from(rp.x), y: Array.from(rp.y), active: rp.active && !rp.ending, events: rp.events, learns: rp.learns, rBar: rp.rBar } : null,
      });
      this.pk[0] = this.pk[1] = 0; this.inPk[0] = this.inPk[1] = 0; this.inOver = false; this.over = false; this.limMin = 1; this.cpu = 0; this.cpuT = 0;
    }
  }
}

registerProcessor('chili-engine', ChiliProcessor);

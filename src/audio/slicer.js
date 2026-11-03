/* Chili — Slicing: gleichmäßig oder transienten-basiert. Ergebnis: Grenzen als Bruchteile 0..1 der Datei. */

export function equalSlices(n) {
  return Array.from({ length: n }, (_, i) => [i / n, (i + 1) / n]);
}

/**
 * Onset-Erkennung: Energie des differenzierten Signals (betont Transienten), log-Fluss,
 * adaptiver Median-Threshold. Grenzen werden 3 ms vor den Onset und auf den nächsten Nulldurchgang gelegt.
 */
export function transientSlices(buf, sens = 0.5, max = 16) {
  const sr = buf.sampleRate, len = buf.length;
  const a = buf.getChannelData(0), b = buf.numberOfChannels > 1 ? buf.getChannelData(1) : a;
  const hop = 256, win = 1024, frames = Math.max(1, Math.floor((len - win) / hop));
  const le = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0; const s = f * hop;
    for (let i = s + 1; i < s + win; i++) { const x = (a[i] + b[i]) - (a[i - 1] + b[i - 1]); e += x * x; }
    le[f] = Math.log10(e / win + 1e-10);
  }
  const flux = new Float32Array(frames);
  for (let f = 1; f < frames; f++) flux[f] = Math.max(0, le[f] - le[f - 1]);
  const cands = [], minGap = Math.round((0.06 * sr) / hop), k = 1.5 - sens * 1.2;
  for (let f = 2; f < frames - 1; f++) {
    const lo = Math.max(0, f - 10), hi = Math.min(frames, f + 10), w = Array.from(flux.subarray(lo, hi)).sort((x, y) => x - y);
    const thr = w[w.length >> 1] * (1 + k) + 0.08 * (1 - sens);
    if (flux[f] > thr && flux[f] >= flux[f - 1] && flux[f] >= flux[f + 1]) cands.push({ f, v: flux[f] });
  }
  cands.sort((x, y) => y.v - x.v);
  const picked = [];
  for (const c of cands) { if (picked.every((p) => Math.abs(p - c.f) >= minGap)) picked.push(c.f); if (picked.length >= max - 1) break; }
  picked.sort((x, y) => x - y);
  const pre = Math.round(0.003 * sr), zc = Math.round(0.001 * sr);
  const bounds = [0];
  for (const f of picked) {
    let i = Math.max(1, f * hop + (win >> 1) - pre);
    for (let j = 0; j < zc && i > 1; j++, i--) if ((a[i] >= 0) !== (a[i - 1] >= 0)) break;
    if (i / len - bounds[bounds.length - 1] > 0.01) bounds.push(i / len);
  }
  bounds.push(1);
  const out = []; for (let i = 0; i < bounds.length - 1; i++) out.push([bounds[i], bounds[i + 1]]);
  return out;
}

/** Min/Max-Peaks für die Wellenformansicht */
export function peaks(buf, cols = 1600) {
  const a = buf.getChannelData(0), b = buf.numberOfChannels > 1 ? buf.getChannelData(1) : a, step = Math.max(1, Math.floor(a.length / cols));
  const mn = new Float32Array(cols), mx = new Float32Array(cols);
  for (let c = 0; c < cols; c++) {
    let lo = 0, hi = 0; const s = c * step;
    for (let i = s; i < s + step && i < a.length; i++) { const v = (a[i] + b[i]) * 0.5; if (v < lo) lo = v; if (v > hi) hi = v; }
    mn[c] = lo; mx[c] = hi;
  }
  return { mn, mx };
}

/** Beat-Slicing wie Simpler „Beat": Raster in Notenwerten, Sample-Länge wird auf ganze Beats beim Projekttempo gerundet */
export function beatSlices(buf, bpm, grid = '1/16', max = 32) {
  const beat = 60 / bpm, dur = buf.duration, beats = Math.max(1, Math.round(dur / beat));
  const per = { '1/2': 2, '1/4': 1, '1/8': 0.5, '1/16': 0.25, '1/32': 0.125 }[grid] || 0.25;
  const n = Math.max(1, Math.min(max, Math.round(beats / per)));
  return equalSlices(n);
}
/** Auto: Transienten, wenn das Material klar perkussiv ist, sonst Beat-Raster */
export function autoSlices(buf, bpm, max = 16) {
  const t = transientSlices(buf, 0.5, max);
  return t.length >= Math.min(4, max) ? t : beatSlices(buf, bpm, '1/8', max);
}
/** Zuordnung Slice → Step */
export function mapSlices(n, L, mode) {
  const idx = Array.from({ length: L }, (_, i) => i % n);
  switch (mode) {
    case 'rev': return idx.map((_, i) => (n - 1 - (i % n) + n) % n);
    case 'pp': { const seq = []; for (let i = 0; i < n; i++) seq.push(i); for (let i = n - 2; i > 0; i--) seq.push(i); return idx.map((_, i) => seq[i % seq.length]); }
    case 'rnd': return idx.map(() => (Math.random() * n) | 0);
    case 'one': return idx.map(() => 0);
    default: return idx;
  }
}

/** Peaks finden: die n stärksten Einschwingvorgänge im ganzen Sample. Jeder Slice beginnt kurz vor einem Peak
 *  und endet am nächsten; Material vor dem ersten Peak fällt weg. Ergebnis zeitlich sortiert, mit Stärke. */
export function findPeaks(buf, n = 16) {
  const sr = buf.sampleRate, len = buf.length;
  const a = buf.getChannelData(0), b = buf.numberOfChannels > 1 ? buf.getChannelData(1) : a;
  const hop = 128, win = 512, frames = Math.max(2, Math.floor((len - win) / hop));
  const e = new Float32Array(frames);
  for (let f = 0; f < frames; f++) { let s = 0; const o = f * hop; for (let i = o; i < o + win; i++) { const x = a[i] + b[i]; s += x * x; } e[f] = Math.log10(s / win + 1e-9); }
  const on = new Float32Array(frames);
  for (let f = 2; f < frames; f++) on[f] = Math.max(0, e[f] - Math.min(e[f - 1], e[f - 2]));
  const cand = [];
  for (let f = 2; f < frames - 1; f++) if (on[f] > 0.08 && on[f] >= on[f - 1] && on[f] > on[f + 1]) cand.push({ f, v: on[f] + 0.15 * (e[f] + 9) });
  cand.sort((x, y) => y.v - x.v);
  const gap = Math.round((0.045 * sr) / hop), pick = [];
  for (const c of cand) { if (pick.every((p) => Math.abs(p.f - c.f) >= gap)) pick.push(c); if (pick.length >= n) break; }
  if (!pick.length) return equalSlices(n).map(([s, t]) => ({ a: s, b: t, w: 1 }));
  pick.sort((x, y) => x.f - y.f);
  const pre = Math.round(0.004 * sr), vmax = Math.max(...pick.map((p) => p.v));
  const st = pick.map((p) => { let i = Math.max(1, p.f * hop + (win >> 1) - pre); for (let k = 0; k < 64 && i > 1; k++, i--) if ((a[i] >= 0) !== (a[i - 1] >= 0)) break; return { s: i / len, w: p.v / vmax }; });
  return st.map((p, k) => ({ a: p.s, b: k + 1 < st.length ? st[k + 1].s : 1, w: p.w }));
}

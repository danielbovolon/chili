/* Chili — Master: Effekte (Compressor/Delay/Reverb), Master-Filter und Ausgangs-Strip (Fader max. 0 dB, Meter) */
import { h, paramRow, knob, select } from './dom.js';
import { MASTER_GROUPS, MF_TYPES, MF_DEFS } from '../state/params.js';

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const posToDb = (p) => (p <= 0 ? -Infinity : 40 * Math.log10(p)); // Gain = Position²
const dbToPos = (d) => Math.pow(10, d / 40);

/* ================================================================ MASTER-EFFEKTE */
export function masterFxView(app) {
  const M = () => app.project.master, rows = [];
  const sections = MASTER_GROUPS.map((g) => {
    const row = paramRow(g.params, (k) => M()[g.id][k], (k, v) => { M()[g.id][k] = v; app.commit(); });
    rows.push(row);
    const extra = g.id === 'comp' ? h('div', { class: 'grbar', 'data-help': 'Gain-Reduktion des Compressors.' }, h('span', {})) : null;
    return h('div', { class: `msec m-${g.id}` }, h('h4', {}, g.title, extra), row);
  });
  const grFill = sections[0].querySelector('.grbar span');
  const el = h('div', { class: 'bay-sec' }, sections);
  el.meter = (m) => { grFill.style.width = `${Math.min(100, (-m.gr / 24) * 100)}%`; };
  el.refresh = () => rows.forEach((r) => r.refresh());
  return el;
}

/* ================================================================ MASTER-FILTER */
const D = Object.fromEntries(MF_DEFS.map((d) => [d.k, d]));
export function filterView(app) {
  const F = () => app.project.master.filter;
  const set = (k, v) => { F()[k] = v; app.commit(); el.dirty = true; };
  const sw = h('button', { class: 'switch', 'data-help': 'Master-Filter ein/aus (klickfrei überblendet).', onclick: () => { F().on = !F().on; app.commit(); el.refresh(); } });
  const types = h('div', { class: 'tgrid' }, MF_TYPES.map(([v, l]) => h('button', { 'data-v': v, onclick: () => { set('type', v); el.refresh(); } }, l)));
  const slope = h('div', { class: 'seg', 'data-help': 'Flankensteilheit (für LP/BP/HP/Notch): 12 bis 48 dB pro Oktave.' }, [1, 2, 3, 4].map((n) => h('button', { 'data-n': n, onclick: () => { set('slope', n); el.refresh(); } }, `${n * 12}`)));
  const cv = h('canvas', { class: 'resp', 'data-help': 'Frequenzgang des Master-Filters. Die Linien zeigen die modulierte Position links (rot) und rechts (cyan) in Echtzeit.' });
  const k = (key, help) => { const c = knob(D[key], () => F()[key], (v) => set(key, v)); if (help) c.dataset.help = help; return c; };
  const main = h('div', { class: 'prow' }, k('cutoff'), k('res'), k('drive', 'Drive vor dem Filter — ADAA-Sättigung, aliasarm.'));
  const ctx = h('div', { class: 'prow' });
  const envRow = h('div', { class: 'prow' }, k('envAmt', 'Hüllkurvenfolger: wie stark der Eingangspegel den Cutoff verschiebt (± Oktaven).'), k('envAtk'), k('envRel'));
  const lfoSync = select(D.lfoSync, () => F().lfoSync, (v) => { set('lfoSync', v); el.refresh(); });
  const lfoShape = select(D.lfoShape, () => F().lfoShape, (v) => set('lfoShape', v));
  const lfoRate = k('lfoRate');
  const lfoRow = h('div', { class: 'prow' }, k('lfoDepth'), lfoRate, lfoSync, lfoShape);
  const stRow = h('div', { class: 'prow' }, k('stereo', 'Phasenversatz des LFO zwischen links und rechts (bis 180°).'), k('spreadOct', 'Fester Cutoff-Versatz zwischen links und rechts.'), k('mix'), k('out'));
  const el = h('div', { class: 'bay-sec mfilter' },
    h('header', { class: 'ph' }, h('span', { class: 'ptitle' }, 'Master-Filter'), sw),
    cv, types, h('div', { class: 'rowline' }, h('span', { class: 'tlabel' }, 'dB/Okt'), slope),
    h('div', { class: 'msec' }, h('h4', {}, 'Filter'), main, ctx),
    h('div', { class: 'msec' }, h('h4', {}, 'Hüllkurvenfolger'), envRow),
    h('div', { class: 'msec' }, h('h4', {}, 'LFO'), lfoRow),
    h('div', { class: 'msec' }, h('h4', {}, 'Stereo & Ausgang'), stRow));
  const knobs = () => el.querySelectorAll('.knob, .field');
  el.refresh = () => {
    const f = F();
    sw.classList.toggle('on', f.on); el.classList.toggle('off', !f.on);
    types.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === f.type));
    slope.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.n === f.slope));
    slope.style.opacity = ['lp', 'bp', 'hp', 'notch'].includes(f.type) ? '' : '0.35';
    ctx.innerHTML = '';
    if (['peak', 'lshelf', 'hshelf'].includes(f.type)) ctx.append(k('gain'));
    if (f.type === 'formant') ctx.append(k('vowel', 'Vokal-Morph A–E–I–O–U. Cutoff verschiebt die Formanten.'));
    lfoRate.style.display = f.lfoSync === 'off' ? '' : 'none';
    knobs().forEach((c) => c.update && c.update());
    el.dirty = true;
  };
  /* Frequenzgang (analytisch, wie die Engine rechnet) */
  let live = null; el.meter = (m) => { live = m.mf; };
  function mag(f) {
    const p = F(), sr = app.engine.sampleRate || 48000, fc = Math.min(p.cutoff, 0.45 * sr);
    const w = Math.tan((Math.PI * f) / sr) / Math.tan((Math.PI * fc) / sr); // vorverzerrte Frequenz
    const svf = (k) => { const re = 1 - w * w, im = k * w, den = re * re + im * im; return { lp: 1 / Math.sqrt(den), bp: (k * w) / Math.sqrt(den), hp: (w * w) / Math.sqrt(den), no: Math.abs(re) / Math.sqrt(den) }; };
    const t = p.type;
    if (['lp', 'bp', 'hp', 'notch'].includes(t)) {
      let g = 1; const n = p.slope;
      for (let i = 0; i < n; i++) { let k = 2 * Math.cos((Math.PI * (2 * i + 1)) / (4 * n)); if (i === n - 1) k *= 1 - p.res * 0.985; const r = svf(k); g *= t === 'lp' ? r.lp : t === 'hp' ? r.hp : t === 'bp' ? r.bp : r.no; }
      return g;
    }
    if (t === 'peak' || t === 'lshelf' || t === 'hshelf') {
      const A = Math.pow(10, p.gain / 40), k = 1 / (0.5 + p.res * 9.5), kk = t === 'peak' ? k / A : k;
      const ww = t === 'lshelf' ? w * Math.sqrt(A) : t === 'hshelf' ? w / Math.sqrt(A) : w;
      const dr = 1 - ww * ww, di = kk * ww, den = dr * dr + di * di;
      const lpR = dr / den, lpI = -di / den, bpR = (ww * di) / den, bpI = (ww * dr) / den;
      let hr, hi;
      if (t === 'peak') { hr = 1 + kk * (A * A - 1) * bpR; hi = kk * (A * A - 1) * bpI; }
      else if (t === 'lshelf') { hr = 1 + k * (A - 1) * bpR + (A * A - 1) * lpR; hi = k * (A - 1) * bpI + (A * A - 1) * lpI; }
      else { hr = A * A + k * (1 - A) * A * bpR + (1 - A * A) * lpR; hi = k * (1 - A) * A * bpI + (1 - A * A) * lpI; }
      return Math.hypot(hr, hi);
    }
    if (t === 'comb' || t === 'combn') { const fb = (t === 'comb' ? 1 : -1) * (0.3 + 0.68 * p.res), D = sr / fc, ph = (2 * Math.PI * f * D) / sr; const re = 1 - fb * Math.cos(ph), im = fb * Math.sin(ph); return (1 - Math.abs(fb) * 0.75) / Math.sqrt(re * re + im * im); }
    if (t === 'formant') {
      const V = [[730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240]], v = Math.min(4, Math.max(0, p.vowel)), i0 = Math.min(3, Math.floor(v)), fr = v - i0, sh = Math.min(3.5, Math.max(0.3, Math.sqrt(p.cutoff / 1000))), k = 0.25 - p.res * 0.2;
      let s = 0; [1, 0.5, 0.28].forEach((gn, j) => { const F0 = (V[i0][j] + (V[i0 + 1][j] - V[i0][j]) * fr) * sh, x = f / F0, re = 1 - x * x, im = k * x; s += (gn * k * x) / Math.sqrt(re * re + im * im); });
      return s * 1.6;
    }
    return 1;
  }
  function draw() {
    requestAnimationFrame(draw);
    if (!cv.isConnected || cv.offsetParent === null) return;
    const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; if (!W) return;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); el.dirty = true; }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const fx = (f) => (Math.log(f / 20) / Math.log(1000)) * W, dy = (d) => H * 0.42 - (d / 30) * H * 0.4;
    g.strokeStyle = css('--grid'); g.lineWidth = 1; g.font = '9px JetBrains Mono, monospace'; g.fillStyle = css('--dim');
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) { const x = Math.round(fx(f)) + 0.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); g.fillText(f >= 1000 ? `${f / 1000}k` : f, x + 2, H - 3); }
    for (const d of [-24, -12, 0, 12]) { const y = Math.round(dy(d)) + 0.5; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    const on = F().on;
    g.beginPath();
    for (let x = 0; x <= W; x += 2) { const f = 20 * Math.pow(1000, x / W), d = 20 * Math.log10(Math.max(1e-6, mag(f))); const y = dy(Math.max(-60, Math.min(36, d))); x ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.strokeStyle = on ? css('--accent') : css('--dim'); g.lineWidth = 2; g.stroke();
    g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fillStyle = on ? 'rgba(255,59,47,0.10)' : 'rgba(255,255,255,0.03)'; g.fill();
    if (on && live) {
      for (const [f, c] of [[live.l, css('--accent')], [live.r, css('--cool')]]) { const x = fx(f); g.strokeStyle = c; g.globalAlpha = 0.8; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
      g.globalAlpha = 1; g.fillStyle = css('--hud'); g.fillRect(4, 4, Math.min(1, live.e * 1.6) * 60, 3);
    }
  }
  requestAnimationFrame(draw);
  return el;
}

/* ================================================================ AUSGANG */
export function outView(app) {
  const M = () => app.project.master;
  const thumb = h('div', { class: 'f-thumb' }), track = h('div', { class: 'f-track' }, h('div', { class: 'f-fill' }), thumb);
  const scale = h('div', { class: 'f-scale' }, [0, -6, -12, -24, -40, -60].map((d) => h('span', { style: { bottom: `${dbToPos(d) * 100}%` } }, d === 0 ? '0' : String(d))));
  const fval = h('div', { class: 'f-val' });
  const meter = h('canvas', { class: 'meter' });
  const read = { pk: h('b', {}), lufs: h('b', {}), lim: h('b', {}), cpu: h('b', {}) };
  const over = h('button', { class: 'over', 'data-help': 'OVER: Signal vor dem Limiter über 0 dBFS. Klick setzt zurück.', onclick: () => over.classList.remove('on') }, 'OVER');
  const fader = h('div', { class: 'fader', tabindex: 0, 'data-help': 'Master-Fader — maximal 0 dB, klickfrei geglättet. Doppelklick: 0 dB · Shift: fein.' }, scale, track);
  const el = h('aside', { class: 'out' },
    h('div', { class: 'out-t' }, 'OUT'), over,
    h('div', { class: 'f-wrap' }, fader, meter), fval,
    h('div', { class: 'readouts' },
      h('div', { 'data-help': 'Sample-Peak (Hold).' }, h('span', {}, 'PK'), read.pk), h('div', { 'data-help': 'Lautheit Momentary nach ITU-R BS.1770.' }, h('span', {}, 'LUFS'), read.lufs),
      h('div', { 'data-help': 'Gain-Reduktion des Safety-Limiters.' }, h('span', {}, 'LIM'), read.lim), h('div', { 'data-help': 'DSP-Last und aktive Stimmen.' }, h('span', {}, 'DSP'), read.cpu)));
  const setPos = (p) => { M().fader = Math.min(1, Math.max(0, p)); app.commit(); upd(); };
  const upd = () => {
    const p = M().fader; thumb.style.bottom = `calc(${p * 100}% - 8px)`; track.firstChild.style.height = `${p * 100}%`;
    const d = posToDb(p); fval.textContent = d === -Infinity ? '−∞' : `${d > -0.05 ? '0.0' : d.toFixed(1)}`;
  };
  let y0 = 0, p0 = 0;
  fader.addEventListener('pointerdown', (e) => {
    fader.setPointerCapture(e.pointerId); y0 = e.clientY; p0 = M().fader;
    if (e.target !== thumb) { const r = track.getBoundingClientRect(); p0 = 1 - (e.clientY - r.top) / r.height; setPos(p0); }
  });
  fader.addEventListener('pointermove', (e) => { if (!fader.hasPointerCapture(e.pointerId)) return; const r = track.getBoundingClientRect(); setPos(p0 + ((y0 - e.clientY) / r.height) * (e.shiftKey ? 0.15 : 1)); });
  fader.addEventListener('pointerup', (e) => fader.releasePointerCapture(e.pointerId));
  fader.addEventListener('dblclick', () => setPos(1));
  fader.addEventListener('wheel', (e) => { e.preventDefault(); setPos(M().fader - Math.sign(e.deltaY) * (e.shiftKey ? 0.002 : 0.01)); }, { passive: false });

  const lv = [-120, -120], hold = [-120, -120], holdT = [0, 0]; let last = performance.now();
  el.meter = (m) => {
    const now = performance.now();
    for (let c = 0; c < 2; c++) { const d = 20 * Math.log10(Math.max(1e-7, m.pk[c])); if (d > lv[c]) lv[c] = d; if (d >= hold[c]) { hold[c] = d; holdT[c] = now; } }
    if (m.over) over.classList.add('on');
    read.lufs.textContent = m.lufs > -70 ? m.lufs.toFixed(1) : '—';
    read.lim.textContent = m.lim < -0.05 ? m.lim.toFixed(1) : '0.0';
    read.cpu.textContent = `${Math.round(m.cpu * 100)}%·${m.voices}`;
  };
  function draw(now) {
    requestAnimationFrame(draw);
    if (!meter.isConnected || meter.offsetParent === null) return;
    const dt = (now - last) / 1000; last = now;
    const holdS = Number(app.settings.peakHold) || 1.5;
    for (let c = 0; c < 2; c++) { lv[c] = Math.max(-120, lv[c] - 24 * dt); if (now - holdT[c] > holdS * 1000) hold[c] = Math.max(-120, hold[c] - 20 * dt); }
    const dpr = devicePixelRatio || 1, w = meter.clientWidth, hh = meter.clientHeight; if (!w) return;
    if (meter.width !== Math.round(w * dpr)) { meter.width = Math.round(w * dpr); meter.height = Math.round(hh * dpr); }
    const g = meter.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hh);
    const y = (d) => hh - Math.max(0, Math.min(1, (d + 60) / 60)) * hh, bw = (w - 4) / 2;
    for (let c = 0; c < 2; c++) {
      const x = c * (bw + 4);
      // segmentierte LED-Kette
      for (let yy = hh - 3; yy > 0; yy -= 4) {
        const dB = -60 + ((hh - yy) / hh) * 60, lit = dB <= lv[c];
        g.fillStyle = dB > -3 ? (lit ? css('--m-high') : '#2a1110') : dB > -12 ? (lit ? css('--m-mid') : '#2a2310') : lit ? css('--m-low') : '#0f2420';
        g.fillRect(x, yy, bw, 3);
      }
      g.fillStyle = hold[c] > -0.5 ? css('--m-high') : css('--text'); g.fillRect(x, y(hold[c]) - 1, bw, 2);
    }
    read.pk.textContent = Math.max(hold[0], hold[1]) > -100 ? Math.max(hold[0], hold[1]).toFixed(1) : '—';
  }
  requestAnimationFrame(draw);
  el.refresh = () => upd();
  return el;
}

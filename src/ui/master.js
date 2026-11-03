/* Chili — Master: Effekte (Compressor/Delay/Reverb), Master-Filter und Ausgangs-Strip (Fader max. 0 dB, Meter) */
import { h, paramRow, knob, select } from './dom.js';
import { MASTER_GROUPS, MF_TYPES, MF_DEFS } from '../state/params.js';

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const posToDb = (p) => (p <= 0 ? -Infinity : 40 * Math.log10(p)); // Gain = Position²
const dbToPos = (d) => Math.pow(10, d / 40);

/* ================================================================ FX CHAIN (Vital-style: drag modules to reorder) */
const FX_NAMES = { filter: 'FILTER', delay: 'DELAY', verb: 'VERB', comp: 'COMP' };
export function masterFxView(app) {
  const M = () => app.project.master;
  const isOn = (id) => (id === 'filter' ? M().filter.on : M()[id].on);
  const setOn = (id, v) => { if (id === 'filter') M().filter.on = v; else M()[id].on = v; };
  const rows = {}, rowRefresh = [];
  for (const g of MASTER_GROUPS) {
    const row = paramRow(g.params, (k) => M()[g.id][k], (k, v) => { M()[g.id][k] = v; if (!M()[g.id].on && (k === 'mix' ? v > 0 : true)) M()[g.id].on = true; app.commit(); el.refreshChain(); }, { small: true });
    row.classList.add('tight'); rowRefresh.push(row);
    const extra = g.id === 'comp' ? h('div', { class: 'grbar', 'data-help': 'Compressor gain reduction.' }, h('span', {})) : null;
    rows[g.id] = h('div', { class: `fxrow m-${g.id}` }, h('div', { class: 'fxl' }, h('span', {}, FX_NAMES[g.id]), extra), row);
  }
  const grFill = rows.comp.querySelector('.grbar span');
  const chain = h('div', { class: 'chain', 'data-help': 'Master chain — drag a module to move it, click its LED to switch it on/off. Signal flows left to right.' });
  const body = h('div', { class: 'fxbody' });
  const el = h('section', { class: 'mod fx', 'data-help': 'FX — master effects. Order is free, like the FX chain in Vital.' }, h('header', { class: 'mh' }, h('span', { class: 'mtitle' }, 'FX CHAIN')), chain, body);
  const move = (from, to) => {
    const o = [...M().order]; if (to < 0 || to >= o.length || from === to) return;
    const [x] = o.splice(from, 1); o.splice(to, 0, x); app.snapshot(); M().order = o; app.commit(); el.refreshChain();
  };
  let dragId = null;
  el.refreshChain = () => {
    const o = M().order; chain.innerHTML = '';
    o.forEach((id, i) => {
      const led = h('button', { class: `led${isOn(id) ? ' on' : ''}`, 'aria-label': `${FX_NAMES[id]} on/off`, onclick: (e) => { e.stopPropagation(); setOn(id, !isOn(id)); app.commit(); app.refreshPart('master'); } });
      const chip = h('div', { class: `fxchip${isOn(id) ? ' on' : ''}`, draggable: 'true', 'data-id': id },
        led, h('span', { class: 'nm' }, FX_NAMES[id]),
        h('span', { class: 'mv' }, h('button', { 'aria-label': 'Move left', onclick: () => move(i, i - 1) }, '‹'), h('button', { 'aria-label': 'Move right', onclick: () => move(i, i + 1) }, '›')));
      chip.addEventListener('dragstart', (e) => { dragId = id; chip.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', id); } catch {} });
      chip.addEventListener('dragend', () => { dragId = null; chip.classList.remove('dragging'); chain.querySelectorAll('.fxchip').forEach((c) => c.classList.remove('over')); });
      chip.addEventListener('dragover', (e) => { if (dragId && dragId !== id) { e.preventDefault(); chip.classList.add('over'); } });
      chip.addEventListener('dragleave', () => chip.classList.remove('over'));
      chip.addEventListener('drop', (e) => { e.preventDefault(); if (dragId) move(M().order.indexOf(dragId), M().order.indexOf(id)); });
      chain.append(chip); if (i < o.length - 1) chain.append(h('i', { class: 'arrow' }, '→'));
    });
    body.innerHTML = '';
    o.forEach((id, i) => {
      if (id === 'filter') { body.append(h('div', { class: 'fxrow fxref' }, h('div', { class: 'fxl' }, h('span', {}, 'FILTER')), h('span', { class: 'hint' }, `slot ${i + 1} — controls in the FILTER module`))); return; }
      rows[id].classList.toggle('off', !isOn(id)); body.append(rows[id]);
    });
  };
  el.meter = (m) => { grFill.style.width = `${Math.min(100, (-m.gr / 24) * 100)}%`; };
  el.refresh = () => { rowRefresh.forEach((r) => r.refresh()); el.refreshChain(); };
  return el;
}

/* ================================================================ MASTER-FILTER */
const D = Object.fromEntries(MF_DEFS.map((d) => [d.k, d]));
export function filterView(app) {
  const F = () => app.project.master.filter;
  const set = (k, v) => { F()[k] = v; app.commit(); el.dirty = true; };
  const sw = h('button', { class: 'switch', 'data-help': 'Master filter on/off (click-free crossfade).', onclick: () => { F().on = !F().on; app.commit(); el.refresh(); } });
  const typeSel = h('select', { class: 'sel', 'data-help': 'Filter type: LP, BP, HP, notch, peak, shelf, comb ±, formant.', onchange: (e) => { set('type', e.target.value); el.refresh(); } }, MF_TYPES.map(([v, l]) => h('option', { value: v }, l)));
  const slope = h('div', { class: 'seg mini', 'data-help': 'Slope (LP/BP/HP/notch): 12 to 48 dB per octave.' }, [1, 2, 3, 4].map((n) => h('button', { 'data-n': n, onclick: () => { set('slope', n); el.refresh(); } }, `${n * 12}`)));
  const cv = h('canvas', { class: 'resp', 'data-help': 'Master filter response — the curve itself moves with the modulation (left red, right cyan).' });
  const k = (key, help) => { const c = knob(D[key], () => F()[key], (v) => set(key, v), { small: true }); if (help) c.dataset.help = help; return c; };
  const ctx = h('span', { class: 'ctxk' });
  const lfoSync = h('select', { class: 'sel', 'data-help': 'LFO free (Rate knob) or tempo-synced.', onchange: (e) => { set('lfoSync', e.target.value); el.refresh(); } }, D.lfoSync.o.map(([v, l]) => h('option', { value: v }, l)));
  const lfoShape = h('select', { class: 'sel', 'data-help': 'LFO shape.', onchange: (e) => set('lfoShape', e.target.value) }, D.lfoShape.o.map(([v, l]) => h('option', { value: v }, l)));
  const lfoRate = k('lfoRate');
  const el = h('section', { class: 'mod mfilter', 'data-help': 'Master filter — its position is set in the FX chain.' },
    h('header', { class: 'mh' }, h('span', { class: 'mtitle' }, 'FILTER'), typeSel, slope, sw),
    cv,
    h('div', { class: 'prow tight' }, k('cutoff'), k('res'), k('drive', 'Drive before the filter — ADAA saturation, low aliasing.'), ctx, k('mix'), k('out')),
    h('div', { class: 'prow tight' }, k('envAmt', 'Envelope follower: the input level moves the cutoff (± octaves).'), k('envAtk'), k('envRel'), k('stereo', 'LFO phase offset between left and right (up to 180°).'), k('spreadOct', 'Fixed cutoff offset between left and right.')),
    h('div', { class: 'prow tight lfo' }, h('span', { class: 'tlabel' }, 'LFO'), k('lfoDepth'), lfoRate, h('div', { class: 'lfosel' }, lfoSync, lfoShape)));
  const knobs = () => el.querySelectorAll('.knob, .field');
  el.refresh = () => {
    const f = F();
    sw.classList.toggle('on', f.on); el.classList.toggle('off', !f.on);
    typeSel.value = f.type; lfoSync.value = f.lfoSync; lfoShape.value = f.lfoShape;
    slope.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.n === f.slope));
    slope.style.opacity = ['lp', 'bp', 'hp', 'notch'].includes(f.type) ? '' : '0.35';
    ctx.innerHTML = '';
    if (['peak', 'lshelf', 'hshelf'].includes(f.type)) ctx.append(k('gain'));
    if (!ctx.childNodes.length) ctx.append(h('span', { class: 'kph' }));
    if (f.type === 'formant') ctx.append(k('vowel', 'Vowel morph A–E–I–O–U. Cutoff shifts the formants.'));
    lfoRate.style.display = f.lfoSync === 'off' ? '' : 'none';
    knobs().forEach((c) => c.update && c.update());
    el.dirty = true;
  };
  /* Frequenzgang (analytisch, wie die Engine rechnet) */
  let live = null; el.meter = (m) => { live = m.mf; };
  function mag(f, fcIn) {
    const p = F(), sr = app.engine.sampleRate || 48000, fc = Math.min(fcIn || p.cutoff, 0.45 * sr);
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
      const V = [[730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240]], v = Math.min(4, Math.max(0, p.vowel)), i0 = Math.min(3, Math.floor(v)), fr = v - i0, sh = Math.min(3.5, Math.max(0.3, Math.sqrt(fc / 1000))), k = 0.25 - p.res * 0.2;
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
    const on = F().on, base = F().cutoff;
    const curve = (fc) => { g.beginPath(); for (let x = 0; x <= W; x += 2) { const f = 20 * Math.pow(1000, x / W), d = 20 * Math.log10(Math.max(1e-6, mag(f, fc))); const y = dy(Math.max(-60, Math.min(36, d))); x ? g.lineTo(x, y) : g.moveTo(x, y); } };
    const fl = on && live ? live.l : base, fr = on && live ? live.r : base;
    if (on && Math.abs(Math.log(fr / fl)) > 0.01) { curve(fr); g.strokeStyle = css('--cool'); g.globalAlpha = 0.75; g.lineWidth = 1.3; g.stroke(); g.globalAlpha = 1; }
    curve(fl); g.strokeStyle = on ? css('--accent') : css('--dim'); g.lineWidth = 2; g.stroke();
    g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fillStyle = on ? 'rgba(255,59,47,0.12)' : 'rgba(255,255,255,0.03)'; g.fill();
    if (on && live) { g.fillStyle = css('--hud'); g.fillRect(4, 4, Math.min(1, live.e * 1.6) * 50, 2); }
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
  const over = h('button', { class: 'over', 'data-help': 'OVER: signal above 0 dBFS before the limiter. Click to reset.', onclick: () => over.classList.remove('on') }, 'OVER');
  const fader = h('div', { class: 'fader', tabindex: 0, 'data-help': 'Master fader — max 0 dB, smoothed click-free. Double-click: 0 dB · Shift: fine.' }, scale, track);
  const el = h('aside', { class: 'out' },
    h('div', { class: 'out-t' }, 'MASTER'), over,
    h('div', { class: 'f-wrap' }, fader, meter), fval,
    h('div', { class: 'readouts' },
      h('div', { 'data-help': 'Sample peak (hold).' }, h('span', {}, 'PK'), read.pk), h('div', { 'data-help': 'Momentary loudness per ITU-R BS.1770.' }, h('span', {}, 'LUFS'), read.lufs),
      h('div', { 'data-help': 'Gain reduction of the safety limiter.' }, h('span', {}, 'LIM'), read.lim), h('div', { 'data-help': 'DSP load and active voices.' }, h('span', {}, 'DSP'), read.cpu)));
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

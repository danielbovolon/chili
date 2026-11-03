/* Sample-Leiste: kompakte Wellenform mit Zoom und Übersicht, Slices, Live-Abspielköpfe.
 *   Mausrad = Zoom um den Cursor · Shift+Rad oder horizontal wischen = verschieben · Ziehen auf freier Fläche = verschieben
 *   Marker ziehen = Slice-Grenze · Doppelklick = neuer Marker · Rechtsklick auf Marker = entfernen
 *   Klick auf Slice-Nummer = auf den Slice zoomen · Übersicht unten: Fenster ziehen, Doppelklick = alles */
import { h } from './dom.js';

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const MODES = [['auto', 'Auto'], ['trans', 'Transient'], ['beat', 'Beat'], ['region', 'Region'], ['manual', 'Manual']];
const MAPS = [['seq', '1 2 3'], ['rev', '3 2 1'], ['pp', 'Ping-Pong'], ['rnd', 'Random'], ['one', 'only 1']];

export function viewportView(app) {
  const S = () => app.slicing;
  const fileIn = h('input', { type: 'file', accept: 'audio/*', multiple: true, style: { display: 'none' }, onchange: (e) => { app.importFiles([...e.target.files]); e.target.value = ''; } });
  const sampleSel = h('select', { class: 'sel smp', 'data-help': 'Displayed sample. The slice lane can use slices from every sample in the project.', onchange: (e) => { app.viewSample = e.target.value; view0 = 0; view1 = 1; el.refresh(); } });
  const modeSel = h('select', { class: 'sel', 'data-help': 'Slice mode as in Simpler: auto, transients, beat grid, equal regions or manual (drag the markers).', onchange: (e) => { S().mode = e.target.value; el.refresh(); } }, MODES.map(([v, l]) => h('option', { value: v }, l)));
  const countSel = h('select', { class: 'sel', 'data-help': 'Number of slices.', onchange: (e) => { S().count = e.target.value; } }, ['steps', 4, 8, 12, 16, 24, 32].map((n) => h('option', { value: n }, n === 'steps' ? '=Steps' : `${n}`)));
  const gridSel = h('select', { class: 'sel', 'data-help': 'Beat grid: slice length as a note value at the project tempo.', onchange: (e) => { S().grid = e.target.value; } }, ['1/2', '1/4', '1/8', '1/16', '1/32'].map((g) => h('option', { value: g }, g)));
  const sens = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: 0.5, class: 'range', 'data-help': 'Sensitivity of the transient detection.', oninput: (e) => { S().sens = +e.target.value; } });
  const mapSel = h('select', { class: 'sel', 'data-help': 'How the slices are spread over the steps.', onchange: (e) => { S().map = e.target.value; } }, MAPS.map(([v, l]) => h('option', { value: v }, l)));
  const zb = (t, help, fn) => h('button', { class: 'ibtn', 'data-help': help, onclick: fn }, t);
  const cv = h('canvas', { class: 'wave-cv' }), ov = h('canvas', { class: 'ov-cv', 'data-help': 'Overview: drag the window to navigate, double-click shows everything.' });
  const screen = h('div', { class: 'wave-box', 'data-help': 'Wheel zooms · Shift+wheel or drag scrolls · drag markers · double-click = add marker · right-click = remove marker · slice number = zoom to it' }, cv, h('i', { class: 'scan' }));
  const bar = h('div', { class: 'sb-bar' },
    h('span', { class: 'mtitle' }, 'SAMPLE'),
    h('button', { class: 'btn accent', 'data-help': 'Import audio files — they are sliced automatically and laid onto the steps.', onclick: () => fileIn.click() }, 'Import'),
    h('button', { class: 'btn recbtn', 'data-help': 'Record: input or master straight into a new sample (REC module on the right).', onclick: () => app.toggleRecorder() }, h('i', {}), 'Rec'),
    sampleSel, h('span', { class: 'vsep' }),
    modeSel, countSel, gridSel, sens, mapSel,
    h('button', { class: 'btn', 'data-help': 'Slice: cuts the sample in the chosen mode and spreads the slices over the steps.', onclick: () => app.reslice(app.viewSample, S().mode, S().count, S().sens, true, false, S().map) }, 'Slice'),
    h('button', { class: 'btn hot', 'data-help': 'Find peaks: finds the strongest transients in the whole sample, cuts there and puts one peak on each step.', onclick: () => app.reslice(app.viewSample, 'peaks', 'steps', 0.5, true, false, S().map) }, '⟁ Peaks'),
    h('span', { class: 'grow' }),
    zb('−', 'Zoom out.', () => zoom(0.5, 1 / 1.6)), zb('+', 'Zoom in.', () => zoom(0.5, 1.6)), zb('⤢', 'Show the whole sample.', () => { view0 = 0; view1 = 1; }),
    zb('✕', 'Remove the sample from the project.', () => app.removeSample(app.viewSample)), fileIn);
  const el = h('section', { class: 'samplebar mod' }, bar, screen, ov);

  /* ---------- Ansicht */
  let view0 = 0, view1 = 1, hoverX = -1, drag = null;
  const span = () => view1 - view0, toF = (x, W) => view0 + (x / W) * span(), toX = (f, W) => ((f - view0) / span()) * W;
  function clampView() { const sp = Math.min(1, Math.max(0.0005, span())); if (view0 < 0) view0 = 0; view1 = view0 + sp; if (view1 > 1) { view1 = 1; view0 = 1 - sp; } }
  function zoom(at, k) { const f = view0 + at * span(), sp = Math.min(1, Math.max(0.0005, span() / k)); view0 = f - at * sp; view1 = view0 + sp; clampView(); }

  screen.addEventListener('dragover', (e) => { e.preventDefault(); screen.classList.add('over'); });
  screen.addEventListener('dragleave', () => screen.classList.remove('over'));
  screen.addEventListener('drop', (e) => { e.preventDefault(); screen.classList.remove('over'); app.importFiles([...e.dataTransfer.files].filter((f) => f.type.startsWith('audio') || /\.(wav|aif|aiff|mp3|flac|ogg|m4a)$/i.test(f.name))); });
  cv.addEventListener('wheel', (e) => {
    if (!app.viewSample) return; e.preventDefault();
    const r = cv.getBoundingClientRect(), at = (e.clientX - r.left) / r.width;
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { const d = (e.shiftKey ? e.deltaY : e.deltaX) / r.width; view0 += d * span(); view1 += d * span(); clampView(); }
    else zoom(at, e.deltaY < 0 ? 1.25 : 1 / 1.25);
  }, { passive: false });

  const bounds = () => { const id = app.viewSample, sl = app.project.slices.filter((s) => s.sampleId === id); return sl.length ? [sl[0].a, ...sl.map((s) => s.b)] : []; };
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('pointerdown', (e) => {
    const id = app.viewSample; if (!id) { fileIn.click(); return; }
    const r = cv.getBoundingClientRect(), W = r.width, x = e.clientX - r.left, y = e.clientY - r.top, f = toF(x, W), b = bounds();
    let hit = -1, hd = 7; for (let i = 0; i < b.length; i++) { const dd = Math.abs(toX(b[i], W) - x); if (dd < hd) { hd = dd; hit = i; } }
    if (e.button === 2) { if (hit >= 0 && b.length > 2) { app.snapshot(); b.splice(hit, 1); app.editMarkers(id, b); setManual(); } return; }
    if (y < 15) { // Slice-Nummer: hinzoomen
      const own = app.project.slices.filter((s) => s.sampleId === id), s = own.find((q) => f >= q.a && f < q.b);
      if (s) { const pad = (s.b - s.a) * 0.08; view0 = s.a - pad; view1 = s.b + pad; clampView(); return; }
    }
    cv.setPointerCapture(e.pointerId);
    if (hit >= 0) { app.snapshot(); drag = { kind: 'marker', i: hit, b }; setManual(); }
    else drag = { kind: 'pan', x0: x, v0: view0 };
  });
  cv.addEventListener('pointermove', (e) => {
    const r = cv.getBoundingClientRect(), W = r.width, x = e.clientX - r.left;
    if (drag && drag.kind === 'marker') { const b = drag.b, f = toF(x, W); const lo = drag.i > 0 ? b[drag.i - 1] + 0.002 : 0, hi = drag.i < b.length - 1 ? b[drag.i + 1] - 0.002 : 1; b[drag.i] = Math.min(hi, Math.max(lo, f)); app.editMarkers(app.viewSample, b); return; }
    if (drag && drag.kind === 'pan') { const d = ((drag.x0 - x) / W) * span(); view0 = drag.v0 + d; view1 = view0 + span(); clampView(); return; }
    const b = bounds(); let near = false; for (let i = 0; i < b.length; i++) if (Math.abs(toX(b[i], W) - x) < 7) near = true;
    cv.style.cursor = near ? 'ew-resize' : e.clientY - r.top < 15 ? 'zoom-in' : 'grab'; hoverX = x;
  });
  const end = (e) => { if (drag) { drag = null; try { cv.releasePointerCapture(e.pointerId); } catch {} } };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', () => { hoverX = -1; });
  cv.addEventListener('dblclick', (e) => {
    if (!app.viewSample) return;
    const r = cv.getBoundingClientRect(), f = toF(e.clientX - r.left, r.width), b = bounds();
    if (b.length < 2 || b.length > 64) return;
    app.snapshot(); b.push(f); app.editMarkers(app.viewSample, b); setManual();
  });
  function setManual() { S().mode = 'manual'; modeSel.value = 'manual'; el.refresh(); }
  // Übersicht
  let ovDrag = null;
  ov.addEventListener('pointerdown', (e) => {
    const r = ov.getBoundingClientRect(), f = (e.clientX - r.left) / r.width; ov.setPointerCapture(e.pointerId);
    if (f < view0 || f > view1) { const sp = span(); view0 = f - sp / 2; view1 = view0 + sp; clampView(); }
    ovDrag = { x0: e.clientX, v0: view0 };
  });
  ov.addEventListener('pointermove', (e) => { if (!ovDrag) return; const r = ov.getBoundingClientRect(), sp = span(); view0 = ovDrag.v0 + (e.clientX - ovDrag.x0) / r.width; view1 = view0 + sp; clampView(); });
  ov.addEventListener('pointerup', () => { ovDrag = null; });
  ov.addEventListener('dblclick', () => { view0 = 0; view1 = 1; });

  /* ---------- Spuren der Stimmen */
  const trails = [];
  el.meter = (m) => { if (m.vz) { trails.push({ t: performance.now(), vz: m.vz }); if (trails.length > 14) trails.shift(); } };

  function size(c) { const dpr = devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight; if (!W) return null; if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); } const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H); return { g, W, H }; }
  function minmax(id, f0, f1, cols) {
    // Bei starkem Zoom direkt aus den Samples, sonst aus der Peak-Übersicht
    const buf = app.buffers.get(id), pk = app.peaks.get(id), out = new Float32Array(cols * 2);
    if (buf && (f1 - f0) * buf.length < 600000) {
      const A = buf.getChannelData(0), B = buf.numberOfChannels > 1 ? buf.getChannelData(1) : A, n = buf.length;
      for (let c = 0; c < cols; c++) {
        const i0 = Math.floor((f0 + ((f1 - f0) * c) / cols) * n), i1 = Math.max(i0 + 1, Math.floor((f0 + ((f1 - f0) * (c + 1)) / cols) * n));
        let lo = 0, hi = 0; for (let i = Math.max(0, i0); i < Math.min(n, i1); i++) { const v = (A[i] + B[i]) * 0.5; if (v < lo) lo = v; if (v > hi) hi = v; }
        out[c * 2] = lo; out[c * 2 + 1] = hi;
      }
    } else if (pk) {
      const n = pk.mn.length;
      for (let c = 0; c < cols; c++) { const i0 = Math.floor((f0 + ((f1 - f0) * c) / cols) * n), i1 = Math.max(i0 + 1, Math.floor((f0 + ((f1 - f0) * (c + 1)) / cols) * n)); let lo = 0, hi = 0; for (let i = i0; i < Math.min(n, i1); i++) { if (pk.mn[i] < lo) lo = pk.mn[i]; if (pk.mx[i] > hi) hi = pk.mx[i]; } out[c * 2] = lo; out[c * 2 + 1] = hi; }
    }
    return out;
  }
  function draw() {
    requestAnimationFrame(draw);
    if (!cv.isConnected || cv.offsetParent === null) return;
    const A = size(cv), O = size(ov); if (!A || !O) return;
    const { g, W, H } = A, C = { grid: css('--grid'), hud: css('--hud'), acc: css('--accent'), wave: css('--wave'), dim: css('--dim'), amber: css('--ember') };
    const id = app.viewSample, P = app.project;
    if (!id || !app.peaks.get(id)) {
      g.fillStyle = C.dim; g.font = '600 10px "Chakra Petch", sans-serif'; g.textAlign = 'center';
      g.fillText(W < 520 ? '＋ DROP AUDIO · CLICK = IMPORT' : '＋  DROP AUDIO HERE  ·  CLICK = IMPORT  ·  WITHOUT A SAMPLE THE SYNTH PLAYS', W / 2, H / 2 + 4); g.textAlign = 'left'; return;
    }
    const L = P.transport.length, mid = H / 2 + 5, amp = (H - 20) / 2;
    const used = new Map(); P.steps.slice(0, L).forEach((s, i) => { if (s.on && s.source !== 'synth') { if (!used.has(s.slice)) used.set(s.slice, 0); used.set(s.slice, used.get(s.slice) + 1); } });
    let k = 0;
    P.slices.forEach((s, i) => {
      if (s.sampleId !== id) return; k++;
      if (s.b < view0 || s.a > view1) return;
      const x0 = toX(s.a, W), x1 = toX(s.b, W);
      g.fillStyle = i === app.hoverSlice ? 'rgba(255,59,47,0.22)' : k % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0)'; g.fillRect(x0, 0, x1 - x0, H);
      g.fillStyle = C.hud; g.globalAlpha = 0.5; g.fillRect(Math.round(x0), 0, 1, H); g.globalAlpha = 1;
      g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0 + 5, 0); g.lineTo(x0, 6); g.closePath(); g.fill();
      if (x1 - x0 > 14) { g.fillStyle = i === app.hoverSlice ? C.acc : C.hud; g.font = '700 9px "JetBrains Mono", monospace'; g.fillText(String(i + 1), x0 + 3, 11); }
      if (s === P.slices.filter((q) => q.sampleId === id).slice(-1)[0]) { g.fillStyle = C.hud; g.globalAlpha = 0.5; g.fillRect(Math.round(x1) - 1, 0, 1, H); g.globalAlpha = 1; g.beginPath(); g.moveTo(x1, 0); g.lineTo(x1 - 5, 0); g.lineTo(x1, 6); g.closePath(); g.fill(); }
      const u = used.get(i); if (u) { g.fillStyle = C.amber; for (let j = 0; j < Math.min(8, u); j++) g.fillRect(x0 + 3 + j * 4, H - 5, 2, 2); }
    });
    const mm = minmax(id, view0, view1, Math.floor(W));
    g.fillStyle = C.wave; g.globalAlpha = 0.9;
    for (let x = 0; x < W; x++) { const lo = mm[x * 2], hi = mm[x * 2 + 1]; g.fillRect(x, mid - hi * amp, 1, Math.max(1, (hi - lo) * amp)); }
    g.globalAlpha = 1;
    const now = performance.now();
    trails.forEach((tr, j) => {
      const age = (now - tr.t) / 500; if (age > 1) return; const last = j === trails.length - 1;
      for (const v of tr.vz) {
        if (v.s !== id || v.f < view0 || v.f > view1) continue;
        const x = toX(v.f, W), a = Math.min(1, v.e * 1.4) * (1 - age) * (last ? 1 : 0.3);
        g.fillStyle = `rgba(255,59,47,${a})`; g.fillRect(x - 1, 0, last ? 2 : 1, H);
        if (last) { g.fillStyle = `rgba(255,220,200,${a})`; g.beginPath(); g.arc(x, mid, 2.5 + v.e * 4, 0, Math.PI * 2); g.fill(); }
      }
    });
    if (hoverX >= 0) { g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(hoverX, 0, 1, H); }
    if (span() < 0.999) { g.fillStyle = C.dim; g.font = '9px "JetBrains Mono", monospace'; g.textAlign = 'right'; g.fillText(`×${(1 / span()).toFixed(1)}`, W - 4, H - 4); g.textAlign = 'left'; }
    // Übersicht
    const o = O.g, ow = O.W, oh = O.H, om = minmax(id, 0, 1, Math.floor(ow));
    o.fillStyle = C.dim; for (let x = 0; x < ow; x++) { const lo = om[x * 2], hi = om[x * 2 + 1]; o.fillRect(x, oh / 2 - hi * oh * 0.45, 1, Math.max(1, (hi - lo) * oh * 0.45)); }
    o.fillStyle = 'rgba(70,240,210,0.14)'; o.fillRect(view0 * ow, 0, (view1 - view0) * ow, oh);
    o.strokeStyle = C.hud; o.lineWidth = 1; o.strokeRect(view0 * ow + 0.5, 0.5, Math.max(2, (view1 - view0) * ow - 1), oh - 1);
    const lt = trails[trails.length - 1]; if (lt) for (const v of lt.vz) if (v.s === id) { o.fillStyle = C.acc; o.fillRect(v.f * ow, 0, 1, oh); }
  }
  requestAnimationFrame(draw);

  el.draw = () => {};
  el.refresh = () => {
    const ss = app.project.samples, s = S();
    if (!ss.find((x) => x.id === app.viewSample)) { app.viewSample = ss[0] ? ss[0].id : null; view0 = 0; view1 = 1; }
    sampleSel.innerHTML = '';
    if (!ss.length) sampleSel.append(h('option', {}, '— no sample —'));
    ss.forEach((x) => sampleSel.append(h('option', { value: x.id, selected: x.id === app.viewSample }, x.name)));
    sampleSel.disabled = !ss.length;
    modeSel.value = s.mode; countSel.value = String(s.count); gridSel.value = s.grid; mapSel.value = s.map; sens.value = s.sens;
    countSel.style.display = s.mode === 'beat' || s.mode === 'manual' ? 'none' : '';
    gridSel.style.display = s.mode === 'beat' ? '' : 'none';
    sens.style.display = s.mode === 'trans' ? '' : 'none';
  };
  return el;
}

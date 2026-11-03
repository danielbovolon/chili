/* Chili — Viewport: der Bildschirm des Schiffs.
 *   WAVE   Sample mit Slices (Marker ziehen, Doppelklick = neuer Marker, Rechtsklick = Marker weg), Live-Abspielköpfe aller Stimmen
 *   SCOPE  Oszilloskop + Spektrum (nach Master)
 *   FELD   Surround-Feld: jede Stimme als Punkt im Raum um den Hörer, dazu Goniometer */
import { h } from './dom.js';

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const MODES = [['auto', 'Auto'], ['trans', 'Transienten'], ['beat', 'Beat'], ['region', 'Region'], ['manual', 'Manuell']];
const MAPS = [['seq', '1 2 3 …'], ['rev', '… 3 2 1'], ['pp', 'Ping-Pong'], ['rnd', 'Zufall'], ['one', 'nur 1']];

export function viewportView(app) {
  const S = () => app.slicing;
  const fileIn = h('input', { type: 'file', accept: 'audio/*', multiple: true, style: { display: 'none' }, onchange: (e) => { app.importFiles([...e.target.files]); e.target.value = ''; } });
  const sampleSel = h('select', { class: 'sel smp', 'data-help': 'Angezeigtes Sample. Die Slice-Lane kann Slices aus allen Samples des Projekts verwenden.', onchange: (e) => { app.viewSample = e.target.value; el.refresh(); } });
  const modeSel = h('select', { class: 'sel', 'data-help': 'Slice-Modus wie in Simpler: Auto, Transienten, Beat-Raster, gleiche Regionen oder Manuell (Marker im Bild ziehen).', onchange: (e) => { S().mode = e.target.value; el.refresh(); } }, MODES.map(([v, l]) => h('option', { value: v }, l)));
  const countSel = h('select', { class: 'sel', 'data-help': 'Anzahl Slices (Auto/Transienten/Region).', onchange: (e) => { S().count = e.target.value; } }, ['steps', 4, 8, 12, 16, 24, 32].map((n) => h('option', { value: n }, n === 'steps' ? '= Steps' : `${n}`)));
  const gridSel = h('select', { class: 'sel', 'data-help': 'Beat-Raster: Länge eines Slices als Notenwert beim Projekttempo.', onchange: (e) => { S().grid = e.target.value; } }, ['1/2', '1/4', '1/8', '1/16', '1/32'].map((g) => h('option', { value: g }, g)));
  const sens = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: 0.5, class: 'range', 'data-help': 'Empfindlichkeit der Transienten-Erkennung.', oninput: (e) => { S().sens = +e.target.value; } });
  const mapSel = h('select', { class: 'sel', 'data-help': 'Wie die Slices auf die Steps verteilt werden.', onchange: (e) => { S().map = e.target.value; } }, MAPS.map(([v, l]) => h('option', { value: v }, l)));
  const views = h('div', { class: 'seg mini vtabs' }, ['wave', 'scope', 'field'].map((v) => h('button', { 'data-v': v, 'data-help': v === 'wave' ? 'Sample, Slices und Live-Abspielköpfe.' : v === 'scope' ? 'Oszilloskop und Spektrum des Master-Ausgangs.' : 'Surround-Feld: wo jede Stimme gerade im Raum steht.', onclick: () => { view = v; el.refresh(); } }, v === 'wave' ? 'WAVE' : v === 'scope' ? 'SCOPE' : 'FELD')));
  const cv = h('canvas', { class: 'screen-cv' });
  const screen = h('div', { class: 'screen' }, cv, h('i', { class: 'scan' }));
  const bar = h('div', { class: 'vp-bar' },
    h('button', { class: 'btn accent', 'data-help': 'Audiodateien importieren — werden automatisch gesliced und auf die Steps gelegt.', onclick: () => fileIn.click() }, 'Import'),
    h('button', { class: 'btn recbtn', 'data-help': 'Aufnahme: Eingang oder Master direkt als neues Sample.', onclick: () => app.toggleRecorder() }, h('i', {}), 'Rec'),
    sampleSel, h('span', { class: 'vsep' }),
    modeSel, countSel, gridSel, sens, mapSel,
    h('button', { class: 'btn', 'data-help': 'Slicen: schneidet das angezeigte Sample im gewählten Modus und verteilt die Slices auf die Steps.', onclick: () => app.reslice(app.viewSample, S().mode, S().count, S().sens, true, false, S().map) }, 'Slicen'),
    h('button', { class: 'ibtn', 'data-help': 'Sample aus dem Projekt entfernen.', onclick: () => app.removeSample(app.viewSample) }, '✕'),
    h('span', { class: 'grow' }), views, fileIn);
  const el = h('section', { class: 'viewport panel' }, bar, screen);
  let view = 'wave';

  /* ---------- Drag & Drop */
  screen.addEventListener('dragover', (e) => { e.preventDefault(); screen.classList.add('over'); });
  screen.addEventListener('dragleave', () => screen.classList.remove('over'));
  screen.addEventListener('drop', (e) => { e.preventDefault(); screen.classList.remove('over'); app.importFiles([...e.dataTransfer.files].filter((f) => f.type.startsWith('audio') || /\.(wav|aif|aiff|mp3|flac|ogg|m4a)$/i.test(f.name))); });

  /* ---------- Marker bearbeiten (WAVE) */
  const bounds = () => { const id = app.viewSample, sl = app.project.slices.filter((s) => s.sampleId === id); return sl.length ? [sl[0].a, ...sl.map((s) => s.b)] : []; };
  let drag = null;
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('pointerdown', (e) => {
    if (view !== 'wave') return;
    const id = app.viewSample; if (!id) { fileIn.click(); return; }
    const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, b = bounds();
    let hit = -1; for (let i = 1; i < b.length - 1; i++) if (Math.abs(b[i] - x) * r.width < 6) hit = i;
    if (e.button === 2) { if (hit > 0) { app.snapshot(); b.splice(hit, 1); app.editMarkers(id, b); S().mode = 'manual'; modeSel.value = 'manual'; } return; }
    if (hit > 0) { app.snapshot(); drag = { i: hit, b }; cv.setPointerCapture(e.pointerId); S().mode = 'manual'; modeSel.value = 'manual'; }
  });
  cv.addEventListener('pointermove', (e) => {
    const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
    if (drag) { const b = drag.b; b[drag.i] = Math.min(b[drag.i + 1] - 0.004, Math.max(b[drag.i - 1] + 0.004, x)); app.editMarkers(app.viewSample, b); return; }
    if (view !== 'wave') return;
    const b = bounds(); let near = false; for (let i = 1; i < b.length - 1; i++) if (Math.abs(b[i] - x) * r.width < 6) near = true;
    cv.style.cursor = near ? 'ew-resize' : 'crosshair';
    hoverX = x;
  });
  cv.addEventListener('pointerup', (e) => { if (drag) { drag = null; try { cv.releasePointerCapture(e.pointerId); } catch {} } });
  cv.addEventListener('pointerleave', () => { hoverX = -1; });
  cv.addEventListener('dblclick', (e) => {
    if (view !== 'wave' || !app.viewSample) return;
    const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, b = bounds();
    if (b.length < 2 || b.length > 64) return;
    app.snapshot(); b.push(x); app.editMarkers(app.viewSample, b); S().mode = 'manual'; modeSel.value = 'manual';
  });
  let hoverX = -1;

  /* ---------- Spuren für Animationen */
  const trails = []; // [{t, vz}]
  el.meter = (m) => { if (m.vz) { trails.push({ t: performance.now(), vz: m.vz }); if (trails.length > 18) trails.shift(); } };
  const peakHold = new Float32Array(512).fill(-200);

  function draw() {
    requestAnimationFrame(draw);
    if (!cv.isConnected || cv.offsetParent === null) return;
    const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; if (!W) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const C = { grid: css('--grid'), hud: css('--hud'), acc: css('--accent'), cool: css('--cool'), wave: css('--wave'), dim: css('--dim'), text: css('--text'), amber: css('--ember') };
    // Raster
    g.strokeStyle = C.grid; g.lineWidth = 1;
    for (let x = 0; x < W; x += 32) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke(); }
    for (let y = 0; y < H; y += 32) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke(); }
    const sc = app.engine.running ? app.engine.scope() : null;
    if (view === 'wave') drawWave(g, W, H, C, sc);
    else if (view === 'scope') drawScope(g, W, H, C, sc);
    else drawField(g, W, H, C, sc);
  }

  function drawWave(g, W, H, C, sc) {
    const id = app.viewSample, pk = id && app.peaks.get(id), P = app.project;
    if (!pk) {
      // Kein Sample: Synth-Oszilloskop als Bildschirm
      if (sc) traceScope(g, sc.L, 0, 0, W, H, C.acc, 1.6, 0.9);
      g.fillStyle = C.dim; g.font = '600 11px "Chakra Petch", sans-serif'; g.textAlign = 'center';
      g.fillText('＋  AUDIO HIER ABLEGEN  ·  KLICK = IMPORT', W / 2, H - 14); g.textAlign = 'left';
      return;
    }
    const L = P.transport.length, mid = H / 2 + 6, amp = (H - 34) / 2;
    const own = []; P.slices.forEach((s, i) => { if (s.sampleId === id) own.push([s, i]); });
    const used = new Map(); P.steps.slice(0, L).forEach((s, i) => { if (s.on && s.source !== 'synth') { if (!used.has(s.slice)) used.set(s.slice, []); used.get(s.slice).push(i); } });
    own.forEach(([s, i], k) => {
      const x0 = s.a * W, x1 = s.b * W;
      g.fillStyle = i === app.hoverSlice ? 'rgba(255,59,47,0.20)' : k % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0)'; g.fillRect(x0, 0, x1 - x0, H);
      // Marker
      g.fillStyle = C.hud; g.globalAlpha = 0.55; g.fillRect(Math.round(x0), 0, 1, H); g.globalAlpha = 1;
      g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0 + 6, 0); g.lineTo(x0, 7); g.closePath(); g.fill();
      g.fillStyle = i === app.hoverSlice ? C.acc : C.hud; g.font = '700 10px "JetBrains Mono", monospace'; g.fillText(String(i + 1), x0 + 4, 18);
      // welche Steps spielen diesen Slice
      const st = used.get(i); if (st) { g.fillStyle = C.amber; st.slice(0, 8).forEach((n, j) => g.fillRect(x0 + 4 + j * 5, H - 8, 3, 3)); }
    });
    // Wellenform
    const n = pk.mn.length; const grad = g.createLinearGradient(0, mid - amp, 0, mid + amp);
    grad.addColorStop(0, C.wave); grad.addColorStop(0.5, '#ffffff'); grad.addColorStop(1, C.wave);
    g.fillStyle = grad; g.globalAlpha = 0.85;
    for (let x = 0; x < W; x++) { const i = Math.floor((x / W) * n), y0 = mid - pk.mx[i] * amp, y1 = mid - pk.mn[i] * amp; g.fillRect(x, y0, 1, Math.max(1, y1 - y0)); }
    g.globalAlpha = 1;
    g.fillStyle = C.hud; g.globalAlpha = 0.25; g.fillRect(0, mid, W, 1); g.globalAlpha = 1;
    // Live-Abspielköpfe mit Spur
    const now = performance.now();
    trails.forEach((tr, k) => {
      const age = (now - tr.t) / 600; if (age > 1) return;
      for (const v of tr.vz) {
        if (v.s !== id) continue;
        const x = v.f * W, a = Math.min(1, v.e * 1.4) * (1 - age) * (k === trails.length - 1 ? 1 : 0.35);
        g.fillStyle = `rgba(255,59,47,${a})`; g.fillRect(x - 1, 0, k === trails.length - 1 ? 2 : 1, H);
        if (k === trails.length - 1) { g.fillStyle = `rgba(255,210,190,${a})`; g.beginPath(); g.arc(x, mid, 3 + v.e * 5, 0, Math.PI * 2); g.fill(); }
      }
    });
    if (hoverX >= 0) { g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(hoverX * W, 0, 1, H); }
    // Mini-Scope oben rechts
    if (sc) { const w = Math.min(160, W * 0.22), hh = 44; g.fillStyle = 'rgba(4,7,8,0.75)'; g.fillRect(W - w - 6, 22, w, hh); g.strokeStyle = C.grid; g.strokeRect(W - w - 6 + 0.5, 22.5, w, hh); traceScope(g, sc.L, W - w - 6, 22, w, hh, C.cool, 1, 0.9); }
  }

  function trig(buf) { const n = buf.length; for (let i = 1; i < n / 2; i++) if (buf[i - 1] < 0 && buf[i] >= 0) return i; return 0; }
  function traceScope(g, buf, x, y, w, hh, col, lw, amp) {
    const st = trig(buf), len = Math.min(1024, buf.length - st);
    g.strokeStyle = col; g.lineWidth = lw; g.shadowColor = col; g.shadowBlur = 6; g.beginPath();
    for (let i = 0; i < len; i++) { const px = x + (i / (len - 1)) * w, py = y + hh / 2 - buf[st + i] * (hh / 2) * amp; i ? g.lineTo(px, py) : g.moveTo(px, py); }
    g.stroke(); g.shadowBlur = 0;
  }

  function drawScope(g, W, H, C, sc) {
    if (!sc) return;
    const sw = Math.round(W * 0.38);
    traceScope(g, sc.R, 6, 6, sw - 12, H - 12, C.cool, 1.2, 0.95);
    traceScope(g, sc.L, 6, 6, sw - 12, H - 12, C.acc, 1.6, 0.95);
    g.fillStyle = C.grid; g.fillRect(sw, 0, 1, H);
    // Spektrum (log, 20 Hz – 20 kHz)
    const x0 = sw + 10, w = W - x0 - 8, bins = sc.FL.length, nyq = sc.sr / 2, cols = 160;
    const fy = (d) => 8 + (1 - Math.max(0, Math.min(1, (d + 96) / 90))) * (H - 24);
    g.font = '9px "JetBrains Mono", monospace'; g.fillStyle = C.dim;
    for (const f of [100, 1000, 10000]) { const x = x0 + (Math.log(f / 20) / Math.log(1000)) * w; g.fillRect(x, 0, 1, H); g.fillText(f >= 1000 ? `${f / 1000}k` : f, x + 3, H - 4); }
    const grad = g.createLinearGradient(0, H, 0, 0); grad.addColorStop(0, 'rgba(70,240,210,0.05)'); grad.addColorStop(0.6, 'rgba(255,162,26,0.35)'); grad.addColorStop(1, 'rgba(255,59,47,0.7)');
    g.beginPath(); g.moveTo(x0, H);
    for (let c = 0; c <= cols; c++) {
      const f0 = 20 * Math.pow(1000, c / cols), f1 = 20 * Math.pow(1000, (c + 1) / cols);
      let i0 = Math.floor((f0 / nyq) * bins), i1 = Math.max(i0 + 1, Math.floor((f1 / nyq) * bins)), m = -200;
      for (let i = i0; i < i1 && i < bins; i++) m = Math.max(m, (sc.FL[i] + sc.FR[i]) * 0.5);
      if (m > peakHold[c]) peakHold[c] = m; else peakHold[c] -= 0.6;
      g.lineTo(x0 + (c / cols) * w, fy(m));
    }
    g.lineTo(x0 + w, H); g.closePath(); g.fillStyle = grad; g.fill();
    g.fillStyle = C.text; for (let c = 0; c <= cols; c += 1) g.fillRect(x0 + (c / cols) * w, fy(peakHold[c]), 2, 1);
  }

  function drawField(g, W, H, C, sc) {
    const cx = W / 2, cy = H / 2, r = Math.min(W * 0.42, H * 0.44);
    // Goniometer im Hintergrund
    if (sc) {
      g.fillStyle = 'rgba(70,240,210,0.35)';
      for (let i = 0; i < sc.L.length; i += 3) { const m = (sc.L[i] + sc.R[i]) * 0.7071, s = (sc.L[i] - sc.R[i]) * 0.7071; g.fillRect(cx + s * r * 0.9, cy - m * r * 0.9, 1, 1); }
    }
    g.strokeStyle = C.grid; g.lineWidth = 1;
    for (const k of [1, 0.66, 0.33]) { g.beginPath(); g.arc(cx, cy, r * k, 0, Math.PI * 2); g.stroke(); }
    g.beginPath(); g.moveTo(cx - r, cy); g.lineTo(cx + r, cy); g.moveTo(cx, cy - r); g.lineTo(cx, cy + r); g.stroke();
    // Lautsprecher (5.1-Winkel)
    g.font = '700 9px "JetBrains Mono", monospace'; g.textAlign = 'center';
    for (const [deg, lab] of [[-30, 'L'], [30, 'R'], [0, 'C'], [-110, 'LS'], [110, 'RS']]) {
      const a = (deg * Math.PI) / 180, x = cx + Math.sin(a) * r, y = cy - Math.cos(a) * r;
      g.fillStyle = C.hud; g.fillRect(x - 4, y - 4, 8, 8); g.fillStyle = C.dim; g.fillText(lab, x, y - 9);
    }
    // Hörer
    g.fillStyle = C.text; g.beginPath(); g.arc(cx, cy, 5, 0, Math.PI * 2); g.fill(); g.beginPath(); g.moveTo(cx - 3, cy - 4); g.lineTo(cx, cy - 10); g.lineTo(cx + 3, cy - 4); g.fill();
    g.textAlign = 'left';
    // Stimmen mit Spur
    const now = performance.now(), pos = (v) => [cx + v.x * r * 0.85, cy - r * 0.6 + v.y * r * 1.45];
    trails.forEach((tr, k) => {
      const age = (now - tr.t) / 600; if (age > 1) return;
      for (const v of tr.vz) {
        const [x, y] = pos(v), a = Math.min(1, 0.25 + v.e) * (1 - age), last = k === trails.length - 1;
        g.fillStyle = v.s ? `rgba(255,90,61,${a * (last ? 1 : 0.3)})` : `rgba(255,209,102,${a * (last ? 1 : 0.3)})`;
        g.beginPath(); g.arc(x, y, last ? 3 + v.e * 9 : 2, 0, Math.PI * 2); g.fill();
        if (last && v.e > 0.05) { g.fillStyle = C.text; g.font = '9px "JetBrains Mono", monospace'; g.fillText(String(v.st + 1), x + 8, y + 3); }
      }
    });
    g.fillStyle = C.dim; g.font = '600 10px "Chakra Petch", sans-serif'; g.fillText('▲ VORNE', 8, 14); g.fillText('▼ HINTEN', 8, H - 8);
  }
  requestAnimationFrame(draw);

  el.draw = () => {};
  el.refresh = () => {
    const ss = app.project.samples, s = S();
    if (!ss.find((x) => x.id === app.viewSample)) app.viewSample = ss[0] ? ss[0].id : null;
    sampleSel.innerHTML = '';
    if (!ss.length) sampleSel.append(h('option', {}, '— kein Sample —'));
    ss.forEach((x) => sampleSel.append(h('option', { value: x.id, selected: x.id === app.viewSample }, x.name)));
    sampleSel.disabled = !ss.length;
    modeSel.value = s.mode; countSel.value = String(s.count); gridSel.value = s.grid; mapSel.value = s.map; sens.value = s.sens;
    countSel.style.display = s.mode === 'beat' || s.mode === 'manual' ? 'none' : '';
    gridSel.style.display = s.mode === 'beat' ? '' : 'none';
    sens.style.display = s.mode === 'trans' ? '' : 'none';
    views.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === view));
  };
  return el;
}

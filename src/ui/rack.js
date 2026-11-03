/* Rack-Module: Monitor (Oszilloskop + Spektrum), Surround-Panner mit Presets, globale Amp-/Filter-Hüllkurve */
import { h, knob } from './dom.js';
import { GENV_AMP, GENV_FLT } from '../state/params.js';

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function fit(c) {
  const dpr = devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight; if (!W || !H) return null;
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H); return { g, W, H };
}
const visible = (c) => c.isConnected && c.offsetParent !== null;

/* ================================================================ MONITOR */
export function monitorView(app) {
  const sc = h('canvas', { class: 'mon-cv', 'data-help': 'Oscilloscope of the master output: left red, right cyan, triggered.' });
  const sp = h('canvas', { class: 'mon-cv', 'data-help': 'Spectrum of the master output, 20 Hz – 20 kHz, with peak hold.' });
  const el = h('section', { class: 'mod monitor' }, h('header', { class: 'mh' }, h('span', { class: 'mtitle' }, 'MONITOR')), h('div', { class: 'mon' }, sc, sp));
  const hold = new Float32Array(200).fill(-200);
  const trig = (b) => { for (let i = 1; i < b.length / 2; i++) if (b[i - 1] < 0 && b[i] >= 0) return i; return 0; };
  function trace(g, buf, W, H, col, lw) {
    const st = trig(buf), n = Math.min(900, buf.length - st);
    g.strokeStyle = col; g.lineWidth = lw; g.shadowColor = col; g.shadowBlur = 5; g.beginPath();
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * W, y = H / 2 - buf[st + i] * H * 0.46; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke(); g.shadowBlur = 0;
  }
  function draw() {
    requestAnimationFrame(draw);
    if (!visible(sc)) return;
    const a = fit(sc), b = fit(sp); if (!a || !b) return;
    const d = app.engine.running ? app.engine.scope() : null, grid = css('--grid');
    for (const { g, W, H } of [a, b]) { g.strokeStyle = grid; g.lineWidth = 1; for (let x = 0; x < W; x += 20) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke(); } g.beginPath(); g.moveTo(0, H / 2 + 0.5); g.lineTo(W, H / 2 + 0.5); g.stroke(); }
    if (!d) return;
    trace(a.g, d.R, a.W, a.H, css('--cool'), 1); trace(a.g, d.L, a.W, a.H, css('--accent'), 1.4);
    const { g, W, H } = b, bins = d.FL.length, nyq = d.sr / 2, cols = 64, bw = W / cols;
    for (let c = 0; c < cols; c++) {
      const f0 = 20 * Math.pow(1000, c / cols), f1 = 20 * Math.pow(1000, (c + 1) / cols);
      const i0 = Math.floor((f0 / nyq) * bins), i1 = Math.max(i0 + 1, Math.floor((f1 / nyq) * bins)); let m = -200;
      for (let i = i0; i < i1 && i < bins; i++) m = Math.max(m, (d.FL[i] + d.FR[i]) * 0.5);
      if (m > hold[c]) hold[c] = m; else hold[c] -= 0.5;
      const n = Math.max(0, Math.min(1, (m + 96) / 86)), hn = Math.max(0, Math.min(1, (hold[c] + 96) / 86));
      const grad = g.createLinearGradient(0, H, 0, 0); grad.addColorStop(0, '#0d6b5d'); grad.addColorStop(0.65, '#ffa21a'); grad.addColorStop(1, '#ff3b2f');
      g.fillStyle = grad; g.fillRect(c * bw + 0.5, H - n * H, bw - 1, n * H);
      g.fillStyle = css('--text'); g.fillRect(c * bw + 0.5, H - hn * H - 1, bw - 1, 1);
    }
  }
  requestAnimationFrame(draw);
  return el;
}

/* ================================================================ SURROUND-PANNER */
/* Feld: x = Pan (links/rechts), y = Tiefe (vorne oben → hinten unten). Jeder Step ist ein Punkt, direkt ziehbar. */
const PRESETS = [
  ['buehne', 'Stage', 'Stage: all steps in front, lined up left to right.'],
  ['kreis', 'Circle', 'Circle: the steps stand evenly around the listener.'],
  ['spirale', 'Spiral', 'Spiral: from the centre outwards, two turns.'],
  ['orbit', 'Orbit', 'Orbit: every step circles the listener at its own speed.'],
  ['schwarm', 'Swarm', 'Swarm: scattered randomly in space, with random pan and a light orbit.'],
];
export function surroundView(app) {
  const cv = h('canvas', { class: 'sur-cv', 'data-help': 'Surround panner: every dot is a step — drag to set pan (left/right) and depth (front/back). Glowing dots are the voices sounding right now.' });
  const P = () => app.project;
  const apply = (id) => {
    app.snapshot(); const st = P().steps, L = P().transport.length;
    for (let i = 0; i < L; i++) {
      const s = st[i], t = i / L; s.orbit = 0; s.panRnd = 0;
      if (id === 'buehne') { s.pan = L > 1 ? -0.9 + (1.8 * i) / (L - 1) : 0; s.depth = 0; s.spread = 1.2; }
      if (id === 'kreis') { const th = t * Math.PI * 2; s.pan = Math.sin(th); s.depth = (1 - Math.cos(th)) / 2; s.spread = 1.1; }
      if (id === 'spirale') { const th = t * Math.PI * 4, r = 0.15 + 0.85 * t; s.pan = r * Math.sin(th); s.depth = (1 - r * Math.cos(th)) / 2; s.spread = 1; }
      if (id === 'orbit') { s.pan = 0; s.depth = 0; s.orbit = 0.75; s.orbitRate = +(0.08 + 1.1 * ((i * 7) % L) / L).toFixed(2); s.spread = 1.3; }
      if (id === 'schwarm') { s.pan = +(Math.random() * 2 - 1).toFixed(2); s.depth = +Math.random().toFixed(2); s.panRnd = 0.4; s.orbit = +(Math.random() * 0.35).toFixed(2); s.orbitRate = +(0.05 + Math.random() * 0.4).toFixed(2); s.spread = 1.5; }
    }
    if (!P().layers.pan.on) P().layers.pan.on = true;
    app.commit('stack');
  };
  const btns = h('div', { class: 'sur-btns' }, PRESETS.map(([id, l, help]) => h('button', { class: 'btn', 'data-help': help, onclick: () => apply(id) }, l)),
    h('button', { class: 'ibtn', 'data-help': 'All steps to the centre, no orbit.', onclick: () => { app.snapshot(); P().steps.forEach((s) => { s.pan = 0; s.depth = 0; s.orbit = 0; s.panRnd = 0; s.spread = 1; }); app.commit('stack'); } }, '⟲'));
  const el = h('section', { class: 'mod surround' }, h('header', { class: 'mh' }, h('span', { class: 'mtitle' }, 'SURROUND')), h('div', { class: 'sur' }, cv, btns));
  const trails = []; el.meter = (m) => { if (m.vz) { trails.push({ t: performance.now(), vz: m.vz }); if (trails.length > 16) trails.shift(); } };
  let geo = null, drag = -1;
  const toXY = (pan, dep) => [geo.cx + pan * geo.r, geo.cy + (dep * 2 - 1) * geo.r];
  cv.addEventListener('pointerdown', (e) => {
    if (!geo) return; const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, L = P().transport.length;
    let best = -1, bd = 14; for (let i = 0; i < L; i++) { const s = P().steps[i], [px, py] = toXY(s.pan, s.depth), d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = i; } }
    if (best >= 0) { app.snapshot(); drag = best; cv.setPointerCapture(e.pointerId); }
  });
  cv.addEventListener('pointermove', (e) => {
    if (drag < 0 || !geo) return; const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, s = P().steps[drag];
    s.pan = +Math.max(-1, Math.min(1, (x - geo.cx) / geo.r)).toFixed(3); s.depth = +Math.max(0, Math.min(1, ((y - geo.cy) / geo.r + 1) / 2)).toFixed(3);
    if (!P().layers.pan.on) P().layers.pan.on = true;
    app.commit();
  });
  cv.addEventListener('pointerup', () => { drag = -1; });
  function draw() {
    requestAnimationFrame(draw);
    if (!visible(cv)) return;
    const f = fit(cv); if (!f) return; const { g, W, H } = f;
    const r = Math.min(W, H) * 0.42, cx = W / 2, cy = H / 2; geo = { cx, cy, r };
    const hud = css('--hud'), grid = css('--grid'), dim = css('--dim');
    // Raum
    const rad = g.createRadialGradient(cx, cy, 0, cx, cy, r * 1.15); rad.addColorStop(0, 'rgba(70,240,210,0.07)'); rad.addColorStop(1, 'rgba(70,240,210,0)');
    g.fillStyle = rad; g.fillRect(0, 0, W, H);
    g.strokeStyle = grid; g.lineWidth = 1;
    for (const k of [1, 0.66, 0.33]) { g.beginPath(); g.arc(cx, cy, r * k, 0, Math.PI * 2); g.stroke(); }
    for (let a = 0; a < 12; a++) { const t = (a / 12) * Math.PI * 2; g.beginPath(); g.moveTo(cx + Math.cos(t) * r * 0.33, cy + Math.sin(t) * r * 0.33); g.lineTo(cx + Math.cos(t) * r, cy + Math.sin(t) * r); g.stroke(); }
    // Lautsprecher (5.1-Winkel)
    g.font = '700 8px "JetBrains Mono", monospace'; g.textAlign = 'center';
    for (const [deg, lab] of [[-30, 'L'], [0, 'C'], [30, 'R'], [-110, 'LS'], [110, 'RS']]) {
      const a = (deg * Math.PI) / 180, x = cx + Math.sin(a) * r * 1.08, y = cy - Math.cos(a) * r * 1.08;
      g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = hud; g.globalAlpha = 0.8; g.fillRect(-5, -3, 10, 6); g.restore();
      g.fillStyle = dim; g.fillText(lab, x, y + (y < cy ? -6 : 13));
    }
    // Hörer
    g.fillStyle = css('--text'); g.beginPath(); g.arc(cx, cy, 4, 0, Math.PI * 2); g.fill(); g.beginPath(); g.moveTo(cx - 3, cy - 3); g.lineTo(cx, cy - 9); g.lineTo(cx + 3, cy - 3); g.fill();
    // Steps
    const st = P().steps, L = P().transport.length;
    for (let i = 0; i < L; i++) {
      const s = st[i], [x, y] = toXY(s.pan, s.depth);
      if (s.orbit > 0) { g.strokeStyle = 'rgba(87,199,255,0.25)'; g.setLineDash([2, 3]); g.beginPath(); g.ellipse(x, y, s.orbit * r, s.orbit * r, 0, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); }
      g.fillStyle = s.on ? (i === app.playStep ? css('--ember') : '#57c7ff') : '#1d3a44';
      g.beginPath(); g.arc(x, y, i === drag ? 6 : 4, 0, Math.PI * 2); g.fill();
      if (L <= 16 || i % 2 === 0) { g.fillStyle = s.on ? css('--text') : dim; g.font = '8px "JetBrains Mono", monospace'; g.fillText(String(i + 1), x, y - 6); }
    }
    // klingende Stimmen
    const now = performance.now();
    trails.forEach((tr, k) => {
      const age = (now - tr.t) / 600; if (age > 1) return; const last = k === trails.length - 1;
      for (const v of tr.vz) { const [x, y] = toXY(v.x, v.y), a = Math.min(1, 0.2 + v.e) * (1 - age); g.fillStyle = `rgba(255,59,47,${a * (last ? 0.9 : 0.3)})`; g.beginPath(); g.arc(x, y, last ? 3 + v.e * 9 : 2, 0, Math.PI * 2); g.fill(); }
    });
    g.textAlign = 'left'; g.fillStyle = dim; g.font = '600 8px "Chakra Petch", sans-serif'; g.fillText('FRONT', 4, 10); g.fillText('BACK', 4, H - 4);
  }
  requestAnimationFrame(draw);
  return el;
}

/* ================================================================ GLOBALE HÜLLKURVEN */
export function genvView(app, kind) {
  const E = () => app.project.genv[kind], defs = kind === 'amp' ? GENV_AMP : GENV_FLT;
  const title = kind === 'amp' ? 'AMP-ENV' : 'FILTER-ENV';
  const help = kind === 'amp' ? 'Global amp envelope: acts on every step. “Amount” blends between the step’s own envelope and this one.' : 'Global filter envelope: moves every step’s cutoff by “Amount” octaves. Steps without their own filter get a lowpass.';
  const sw = h('button', { class: 'switch', 'data-help': `${title} on/off.`, onclick: () => { E().on = !E().on; app.commit(); el.refresh(); } });
  const cv = h('canvas', { class: 'env-cv', 'data-help': `${help} The dot shows the position of the most recently triggered voice.` });
  const ks = defs.map((d) => knob(d, () => E()[d.k], (v) => { E()[d.k] = v; if (!E().on) { E().on = true; sw.classList.add('on'); el.classList.remove('off'); } app.commit(); }, { small: true }));
  const el = h('section', { class: `mod genv ${kind}`, 'data-help': help }, h('header', { class: 'mh' }, h('span', { class: 'mtitle' }, title), sw), cv, h('div', { class: 'prow tight' }, ks));
  let live = null; el.meter = (m) => { live = m.ge; };
  el.refresh = () => { sw.classList.toggle('on', E().on); el.classList.toggle('off', !E().on); ks.forEach((k) => k.update()); };
  function draw() {
    requestAnimationFrame(draw);
    if (!visible(cv)) return;
    const f = fit(cv); if (!f) return; const { g, W, H } = f, e = E();
    const col = kind === 'amp' ? css('--accent') : '#b78bff', on = e.on;
    // Zeitachse logarithmisch gestaucht: A | D | Sustain-Plateau | R
    const tw = (ms) => Math.log10(1 + ms / 5), tA = tw(e.atk), tD = tw(e.dec), tR = tw(e.rel), tS = 0.8, tot = tA + tD + tS + tR || 1;
    const sx = (W - 8) / tot, x0 = 4, top = 6, bot = H - 5, hh = bot - top;
    const sus = kind === 'flt' ? e.sus : e.sus, pts = [];
    pts.push([x0, bot]); pts.push([x0 + tA * sx, top]);
    for (let k = 1; k <= 16; k++) { const t = k / 16; pts.push([x0 + (tA + tD * t) * sx, top + (1 - sus) * hh * (1 - Math.exp(-4.6 * t)) / (1 - Math.exp(-4.6))]); }
    pts.push([x0 + (tA + tD + tS) * sx, top + (1 - sus) * hh]);
    for (let k = 1; k <= 16; k++) { const t = k / 16; pts.push([x0 + (tA + tD + tS + tR * t) * sx, top + (1 - sus * Math.exp(-4.6 * t)) * hh]); }
    g.strokeStyle = css('--grid'); for (let x = 0; x < W; x += 20) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke(); }
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.lineTo(pts[pts.length - 1][0], bot); g.closePath();
    g.fillStyle = on ? (kind === 'amp' ? 'rgba(255,59,47,0.16)' : 'rgba(183,139,255,0.16)') : 'rgba(255,255,255,0.03)'; g.fill();
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.strokeStyle = on ? col : css('--dim'); g.lineWidth = 1.6; g.stroke();
    if (kind === 'flt') { g.fillStyle = css('--dim'); g.font = '9px "JetBrains Mono", monospace'; g.textAlign = 'right'; g.fillText(`${e.amt > 0 ? '+' : ''}${e.amt.toFixed(1)} oct`, W - 4, 11); g.textAlign = 'left'; }
    if (on && live && app.playing) {
      const ms = live.t * 1000, gm = live.g * 1000; let x;
      if (live.st >= 2 || ms > gm) { const r = Math.max(0, ms - gm); x = x0 + (tA + tD + tS + Math.min(tR, tw(r) * (tR / Math.max(1e-6, tR)))) * sx; }
      else if (ms < e.atk) x = x0 + tw(ms) * sx;
      else x = x0 + (tA + Math.min(tD + tS * 0.999, tw(ms - e.atk))) * sx;
      const v = kind === 'amp' ? live.e : live.f, y = top + (1 - Math.max(0, Math.min(1, v))) * hh;
      g.fillStyle = '#fff'; g.shadowColor = col; g.shadowBlur = 10; g.beginPath(); g.arc(Math.min(W - 4, x), y, 3.5, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
    }
  }
  requestAnimationFrame(draw);
  return el;
}

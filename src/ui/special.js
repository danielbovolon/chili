/* Chili — Collide (Teilchenbeschleuniger) und Rip (neuronaler Beat-Repeat) */
import { h, paramRow } from './dom.js';
import { COLLIDE_DEFS, RIP_DEFS } from '../state/params.js';

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export function collideView(app) {
  const C = () => app.project.collide;
  const sw = h('button', { class: 'switch', onclick: () => { C().on = !C().on; app.commit('special'); } });
  const canvas = h('canvas', { class: 'ring' });
  const row = paramRow(COLLIDE_DEFS, (k) => C()[k], (k, v) => { C()[k] = v; app.commit(); });
  const stat = h('div', { class: 'stat' });
  const el = h('section', { class: 'card special collide' },
    h('header', { class: 'card-h' }, h('h3', {}, 'Collide'), h('span', { class: 'sub' }, 'Zwei Strahlen umkreisen die Sequenz gegenläufig. Wo sie sich treffen, zerbricht der Klang in Trümmer.'), sw),
    h('div', { class: 'sp-body' }, h('div', { class: 'viz' }, canvas, stat), row));
  const flashes = []; let posA = 0, posB = 0, lastT = 0, sf = 1, live = false;
  el.refresh = () => { sw.classList.toggle('on', C().on); el.classList.toggle('active', C().on); row.refresh(); };
  el.meter = (m) => { posA = m.posA; posB = m.posB; sf = m.sf; live = m.collide && m.playing; lastT = performance.now(); };
  el.collision = (m) => { flashes.push({ step: m.step, t: performance.now(), big: m.big, n: m.count }); stat.textContent = `Kollision bei Step ${m.step + 1} · ${m.count} Trümmer${m.big ? ' · BEAM DUMP' : ''}`; };
  function draw(now) {
    requestAnimationFrame(draw);
    if (!canvas.isConnected) return;
    const dpr = devicePixelRatio || 1, w = canvas.clientWidth, hh = canvas.clientHeight; if (!w) return;
    if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = hh * dpr; }
    const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hh);
    const N = app.project.transport.length, cx = w / 2, cy = hh / 2, r = Math.min(w, hh) * 0.38;
    const ang = (p) => -Math.PI / 2 + (p / N) * Math.PI * 2;
    g.strokeStyle = css('--line'); g.lineWidth = 6; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1; g.strokeStyle = css('--line2'); g.beginPath(); g.arc(cx, cy, r - 12, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i < N; i++) {
      const a = ang(i), s = app.project.steps[i];
      g.fillStyle = s.on ? css('--text') : css('--muted'); g.globalAlpha = s.on ? 0.9 : 0.35;
      g.beginPath(); g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, N > 16 ? 2.5 : 3.5, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    for (let k = flashes.length - 1; k >= 0; k--) {
      const f = flashes[k], age = (now - f.t) / 900; if (age > 1) { flashes.splice(k, 1); continue; }
      const a = ang(f.step + 0.5), x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      g.strokeStyle = css('--ember'); g.globalAlpha = 1 - age; g.lineWidth = 1.5;
      const rr = (f.big ? 60 : 18 + f.n) * age + 4; g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.stroke();
      for (let j = 0; j < Math.min(24, f.n); j++) { const aa = (j / Math.min(24, f.n)) * Math.PI * 2 + f.t; g.fillStyle = css('--ember'); g.fillRect(x + Math.cos(aa) * rr * 1.3, y + Math.sin(aa) * rr * 1.3, 2, 2); }
    }
    g.globalAlpha = 1;
    if (C().on) {
      const dt = live ? (now - lastT) / 1000 : 0, stepSec = app.stepSeconds();
      const pa = posA + (live ? dt / stepSec : 0), pb = posB - (live ? (dt / stepSec) * C().ratio * sf : 0);
      const beam = (p, col, trail) => {
        for (let t = trail; t >= 0; t--) { const a = ang(p + (trail === 0 ? 0 : t * 0.05 * Math.sign(col === 'a' ? -1 : 1))); g.globalAlpha = 1 - t / (trail + 1); g.fillStyle = col === 'a' ? css('--accent') : css('--cool'); g.beginPath(); g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 5 - t * 0.3, 0, Math.PI * 2); g.fill(); }
        g.globalAlpha = 1;
      };
      beam(pa, 'a', 8); beam(pb, 'b', 8);
      g.fillStyle = css('--muted'); g.font = '11px JetBrains Mono, monospace'; g.textAlign = 'center';
      g.fillText(`Strahl B ${(C().ratio * sf).toFixed(2)}×`, cx, cy + 4);
    } else { g.fillStyle = css('--muted'); g.font = '11px JetBrains Mono, monospace'; g.textAlign = 'center'; g.fillText('aus', cx, cy + 4); }
  }
  requestAnimationFrame(draw);
  return el;
}

export function ripView(app) {
  const R = () => app.project.rip;
  const sw = h('button', { class: 'switch', onclick: () => { R().on = !R().on; app.commit('special'); } });
  const freeze = h('button', { class: 'tog', onclick: () => { R().freeze = !R().freeze; app.commit('special'); } }, 'Lernen einfrieren');
  const reset = h('button', { class: 'btn', onclick: () => { R().seed = (Math.random() * 1e9) | 0; R().brain = null; app.engine.resetBrain(R().seed); app.commit('special'); } }, 'Neues Gehirn');
  const canvas = h('canvas', { class: 'brain' });
  const row = paramRow(RIP_DEFS, (k) => R()[k], (k, v) => { R()[k] = v; app.commit(); });
  const stat = h('div', { class: 'stat' });
  const el = h('section', { class: 'card special rip' },
    h('header', { class: 'card-h' }, h('h3', {}, 'Rip'), h('span', { class: 'sub' }, 'Beat-Repeat mit einem rekurrenten neuronalen Netz, das hört, entscheidet und aus jeder Wiederholung lernt.'), sw),
    h('div', { class: 'sp-body' }, h('div', { class: 'viz' }, canvas, stat), h('div', {}, row, h('div', { class: 'prow' }, freeze, reset))));
  let st = null;
  el.refresh = () => { sw.classList.toggle('on', R().on); el.classList.toggle('active', R().on); freeze.classList.toggle('on', R().freeze); row.refresh(); };
  el.meter = (m) => { st = m.rip; if (st) stat.textContent = `Events ${st.events} · Lernschritte ${st.learns} · Belohnung Ø ${st.rBar.toFixed(2)}${st.active ? ' · RIPPING' : ''}`; else stat.textContent = R().on ? 'wartet auf Wiedergabe …' : 'aus'; };
  const pos = Array.from({ length: 24 }, (_, i) => { const a = i * 2.39996; const rr = Math.sqrt((i + 0.5) / 24); return [Math.cos(a) * rr, Math.sin(a) * rr]; });
  const OUT = ['Auslösen', 'Raster', 'Pitch', 'Reverse', 'Zerfall', 'Dauer'];
  function draw() {
    requestAnimationFrame(draw);
    if (!canvas.isConnected) return;
    const dpr = devicePixelRatio || 1, w = canvas.clientWidth, hh = canvas.clientHeight; if (!w) return;
    if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = hh * dpr; }
    const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hh);
    const cx = w * 0.36, cy = hh / 2, r = Math.min(w * 0.3, hh * 0.42);
    const x = st ? st.x : new Array(24).fill(0), y = st ? st.y : new Array(6).fill(0);
    g.strokeStyle = css('--line'); g.lineWidth = 1; g.globalAlpha = 0.5;
    for (let i = 0; i < 24; i++) for (let j = i + 1; j < 24; j += 5) { g.beginPath(); g.moveTo(cx + pos[i][0] * r, cy + pos[i][1] * r); g.lineTo(cx + pos[j][0] * r, cy + pos[j][1] * r); g.stroke(); }
    g.globalAlpha = 1;
    for (let i = 0; i < 24; i++) {
      const v = x[i], a = Math.min(1, Math.abs(v) * 1.4);
      g.fillStyle = v >= 0 ? css('--accent') : css('--cool'); g.globalAlpha = 0.15 + a * 0.85;
      g.beginPath(); g.arc(cx + pos[i][0] * r, cy + pos[i][1] * r, 3 + a * 5, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    const bx = w * 0.7, bw = w * 0.26, bh = Math.max(5, Math.min(8, hh / 30)), gap = bh + 15;
    g.font = '10px JetBrains Mono, monospace'; g.textAlign = 'left';
    for (let o = 0; o < 6; o++) {
      const yy = cy - 3 * gap + 12 + o * gap, v = Math.tanh(y[o]);
      g.fillStyle = css('--line'); g.fillRect(bx, yy, bw, bh);
      g.fillStyle = o === 0 && st && st.active ? css('--ember') : css('--text');
      const mid = bx + bw / 2; g.fillRect(Math.min(mid, mid + v * bw / 2), yy, Math.abs(v * bw / 2), bh);
      g.fillStyle = css('--muted'); g.fillText(OUT[o], bx, yy - 3);
    }
  }
  requestAnimationFrame(draw);
  return el;
}

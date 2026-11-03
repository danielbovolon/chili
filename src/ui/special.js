/* Rip — neuronaler Beat-Repeat */
import { h, paramRow } from './dom.js';
import { RIP_DEFS } from '../state/params.js';

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export function ripView(app) {
  const R = () => app.project.rip;
  const sw = h('button', { class: 'switch', onclick: () => { R().on = !R().on; app.commit('special'); } });
  const freeze = h('button', { class: 'tog', 'data-help': 'Freeze learning: the network keeps its current state.', onclick: () => { R().freeze = !R().freeze; app.commit('special'); } }, 'Freeze');
  const reset = h('button', { class: 'btn', 'data-help': 'New brain: the network restarts with a new seed and forgets what it learned.', onclick: () => { R().seed = (Math.random() * 1e9) | 0; R().brain = null; app.engine.resetBrain(R().seed); app.commit('special'); } }, 'New');
  const canvas = h('canvas', { class: 'brain' });
  const row = paramRow(RIP_DEFS, (k) => R()[k], (k, v) => { R()[k] = v; app.commit(); }, { small: true });
  const stat = h('div', { class: 'stat' });
  const el = h('section', { class: 'mod rip', 'data-help': 'Rip — beat repeat driven by a recurrent neural network: it listens to the sequencer, decides on every step (trigger, grid, pitch, reverse, decay, length) and learns from every repeat.' },
    h('header', { class: 'mh' }, h('span', { class: 'mtitle' }, 'RIP'), h('span', { class: 'grow' }), freeze, reset, sw),
    h('div', { class: 'sp-body' }, h('div', { class: 'viz' }, canvas, stat), row));
  let st = null;
  el.refresh = () => { sw.classList.toggle('on', R().on); el.classList.toggle('active', R().on); freeze.classList.toggle('on', R().freeze); row.refresh(); };
  el.meter = (m) => { st = m.rip; if (st) stat.textContent = `Events ${st.events} · learn steps ${st.learns} · reward Ø ${st.rBar.toFixed(2)}${st.active ? ' · RIPPING' : ''}`; else stat.textContent = R().on ? 'waiting for playback …' : 'off'; };
  const pos = Array.from({ length: 24 }, (_, i) => { const a = i * 2.39996; const rr = Math.sqrt((i + 0.5) / 24); return [Math.cos(a) * rr, Math.sin(a) * rr]; });
  const OUT = ['Trigger', 'Grid', 'Pitch', 'Reverse', 'Decay', 'Length'];
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

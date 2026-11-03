/* Chili — Master: Compressor, Delay, Reverb, Fader (max. 0 dB) und Metering */
import { h, paramRow } from './dom.js';
import { MASTER_GROUPS } from '../state/params.js';

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const posToDb = (p) => (p <= 0 ? -Infinity : 40 * Math.log10(p)); // Gain = pos²
const dbToPos = (d) => Math.pow(10, d / 40);

export function masterView(app) {
  const M = () => app.project.master;
  const rows = [];
  const sections = MASTER_GROUPS.map((g) => {
    const row = paramRow(g.params, (k) => M()[g.id][k], (k, v) => { M()[g.id][k] = v; app.commit(); }, { });
    rows.push(row);
    const extra = g.id === 'comp' ? h('div', { class: 'grbar' }, h('span', {})) : null;
    return h('div', { class: `msec m-${g.id}` }, h('h4', {}, g.title, extra), row);
  });
  const grFill = sections[0].querySelector('.grbar span');
  /* Fader */
  const thumb = h('div', { class: 'f-thumb' }), track = h('div', { class: 'f-track' }, h('div', { class: 'f-fill' }), thumb);
  const scale = h('div', { class: 'f-scale' }, [0, -3, -6, -12, -24, -40, -60].map((d) => h('span', { style: { bottom: `${dbToPos(d) * 100}%` } }, d === 0 ? '0' : String(d))));
  const fval = h('div', { class: 'f-val' });
  const meter = h('canvas', { class: 'meter' });
  const read = { pk: h('b', {}), lufs: h('b', {}), lim: h('b', {}), cpu: h('b', {}) };
  const over = h('span', { class: 'over', title: 'Pre-Limiter über 0 dBFS — Klick zum Zurücksetzen', onclick: () => over.classList.remove('on') }, 'OVER');
  const fader = h('div', { class: 'fader', tabindex: 0, 'data-help': 'Master-Fader — maximal 0 dB, klickfrei geglättet. Doppelklick: 0 dB · Shift: fein.' }, scale, track);
  const el = h('aside', { class: 'panel master' },
    h('header', { class: 'ph' }, h('span', { class: 'ptitle' }, 'Master'), h('span', { class: 'grow' }), over),
    h('div', { class: 'm-fx' }, sections),
    h('div', { class: 'm-out' },
      h('div', { class: 'f-wrap' }, fader, meter),
      fval,
      h('div', { class: 'readouts' },
        h('div', {}, h('span', {}, 'Peak'), read.pk), h('div', {}, h('span', {}, 'LUFS M'), read.lufs),
        h('div', {}, h('span', {}, 'Limiter'), read.lim), h('div', {}, h('span', {}, 'DSP'), read.cpu))));
  const setPos = (p) => { M().fader = Math.min(1, Math.max(0, p)); app.commit(); upd(); };
  const upd = () => {
    const p = M().fader; thumb.style.bottom = `calc(${p * 100}% - 9px)`; track.firstChild.style.height = `${p * 100}%`;
    const d = posToDb(p); fval.textContent = d === -Infinity ? '−∞ dB' : `${d > -0.05 ? '0.0' : d.toFixed(1)} dB`;
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

  /* Meter-Ballistik */
  const lv = [-120, -120], hold = [-120, -120], holdT = [0, 0]; let last = performance.now(), lastMsg = null;
  el.meter = (m) => {
    lastMsg = m;
    const now = performance.now();
    for (let c = 0; c < 2; c++) { const d = 20 * Math.log10(Math.max(1e-7, m.pk[c])); if (d > lv[c]) lv[c] = d; if (d >= hold[c]) { hold[c] = d; holdT[c] = now; } }
    if (m.over) over.classList.add('on');
    grFill.style.width = `${Math.min(100, (-m.gr / 24) * 100)}%`;
    read.lufs.textContent = m.lufs > -70 ? m.lufs.toFixed(1) : '—';
    read.lim.textContent = m.lim < -0.05 ? `${m.lim.toFixed(1)} dB` : '0.0';
    read.cpu.textContent = `${Math.round(m.cpu * 100)}% · ${m.voices}v`;
  };
  function draw(now) {
    requestAnimationFrame(draw);
    if (!meter.isConnected) return;
    const dt = (now - last) / 1000; last = now;
    const holdS = Number(app.settings.peakHold) || 1.5;
    for (let c = 0; c < 2; c++) { lv[c] = Math.max(-120, lv[c] - 24 * dt); if (now - holdT[c] > holdS * 1000) hold[c] = Math.max(-120, hold[c] - 20 * dt); }
    const dpr = devicePixelRatio || 1, w = meter.clientWidth, hh = meter.clientHeight; if (!w) return;
    if (meter.width !== w * dpr) { meter.width = w * dpr; meter.height = hh * dpr; }
    const g = meter.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hh);
    const y = (d) => hh - Math.max(0, Math.min(1, (d + 60) / 60)) * hh, bw = (w - 6) / 2;
    for (let c = 0; c < 2; c++) {
      const x = c * (bw + 6);
      g.fillStyle = css('--line'); g.fillRect(x, 0, bw, hh);
      const grad = g.createLinearGradient(0, hh, 0, 0);
      grad.addColorStop(0, css('--m-low')); grad.addColorStop(0.7, css('--m-low')); grad.addColorStop(0.86, css('--m-mid')); grad.addColorStop(0.97, css('--m-high')); grad.addColorStop(1, css('--m-high'));
      g.fillStyle = grad; const yy = y(lv[c]); g.fillRect(x, yy, bw, hh - yy);
      g.fillStyle = hold[c] > -0.5 ? css('--m-high') : css('--text'); g.fillRect(x, y(hold[c]) - 1, bw, 2);
    }
    read.pk.textContent = Math.max(hold[0], hold[1]) > -100 ? `${Math.max(hold[0], hold[1]).toFixed(1)}` : '—';
  }
  requestAnimationFrame(draw);
  el.refresh = () => { rows.forEach((r) => r.refresh()); upd(); };
  return el;
}

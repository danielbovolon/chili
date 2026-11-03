/* Chili — UI-Bausteine: h(), Knob, Select, Toggle, Parameter-Sektionen */
import { fmt, toNorm, fromNorm } from '../state/params.js';

export function h(tag, props = {}, ...kids) {
  const el = tag === 'svg' || props.svg ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false || k === 'svg') continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const A0 = Math.PI * 0.75, A1 = Math.PI * 2.25;
function arc(r, a, b) {
  if (b - a < 1e-4) return '';
  const x0 = 20 + r * Math.cos(a), y0 = 20 + r * Math.sin(a), x1 = 20 + r * Math.cos(b), y1 = 20 + r * Math.sin(b);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${b - a > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** Knob: vertikal ziehen (Shift = fein), Mausrad, Doppelklick = Default, Pfeiltasten. */
export function knob(def, get, set, opt = {}) {
  const bip = def.min < 0 && def.max > 0;
  const s = svg('svg', { viewBox: '0 0 40 40', class: 'knob-svg' });
  // Ableton-Stil: dünner Bogen, Wertbogen, Zeiger aus der Mitte
  const track = svg('path', { class: 'k-track', d: arc(14, A0, A1) }), val = svg('path', { class: 'k-val' }), dot = svg('line', { class: 'k-needle', x1: 20, y1: 20 });
  s.append(track, val, dot);
  const valEl = h('div', { class: 'k-value' }), lab = h('div', { class: 'k-label' }, def.l);
  const el = h('div', { class: `knob${opt.small ? ' small' : ''}${opt.macro ? ' macro' : ''}`, tabindex: 0, 'data-help': `${def.l} — vertikal ziehen · Shift fein · Mausrad · Doppelklick Standardwert` }, lab, s, valEl);
  const maxFor = () => (def.dyn && opt.dynMax ? opt.dynMax() : def.max);
  const d = () => ({ ...def, max: Math.max(def.min + (def.int ? 1 : 1e-6), maxFor()) });
  const update = () => {
    const v = get(), dd = d(), n = Math.min(1, Math.max(0, toNorm(dd, v))), a = A0 + n * (A1 - A0);
    const c = bip ? A0 + toNorm(dd, 0) * (A1 - A0) : A0;
    val.setAttribute('d', arc(14, Math.min(a, c), Math.max(a, c)));
    dot.setAttribute('x2', (20 + 14 * Math.cos(a)).toFixed(2)); dot.setAttribute('y2', (20 + 14 * Math.sin(a)).toFixed(2));
    valEl.textContent = opt.mixed ? '—' : fmt(def.u, v);
  };
  const setN = (n) => { set(fromNorm(d(), n)); update(); };
  let y0 = 0, n0 = 0;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return; el.setPointerCapture(e.pointerId); y0 = e.clientY; n0 = toNorm(d(), get()); el.classList.add('drag'); e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!el.hasPointerCapture(e.pointerId)) return;
    const range = e.shiftKey ? 900 : 180; let n = n0 + (y0 - e.clientY) / range;
    if (def.int) { const dd = d(); const steps = dd.max - dd.min; n = Math.round(n * steps) / steps; }
    setN(n);
  });
  el.addEventListener('pointerup', (e) => { el.releasePointerCapture(e.pointerId); el.classList.remove('drag'); });
  el.addEventListener('dblclick', () => { set(def.def); update(); });
  el.addEventListener('wheel', (e) => {
    e.preventDefault(); const dd = d(); const stepN = def.int ? 1 / (dd.max - dd.min) : e.shiftKey ? 0.002 : 0.012;
    setN(toNorm(dd, get()) - Math.sign(e.deltaY) * stepN);
  }, { passive: false });
  el.addEventListener('keydown', (e) => {
    const dd = d(), stepN = def.int ? 1 / (dd.max - dd.min) : e.shiftKey ? 0.002 : 0.02;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { setN(toNorm(dd, get()) + stepN); e.preventDefault(); e.stopPropagation(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { setN(toNorm(dd, get()) - stepN); e.preventDefault(); e.stopPropagation(); }
  });
  update(); el.update = update;
  return el;
}

export function select(def, get, set) {
  const sel = h('select', { class: 'sel', onchange: (e) => set(e.target.value) }, def.o.map(([v, l]) => h('option', { value: v }, l)));
  const el = h('label', { class: 'field' }, h('span', { class: 'k-label' }, def.l), sel);
  el.update = () => { sel.value = String(get()); }; el.update();
  return el;
}
export function toggle(def, get, set) {
  const b = h('button', { class: 'tog', type: 'button', onclick: () => { set(!get()); b.update(); } }, def.l);
  b.update = () => b.classList.toggle('on', !!get()); b.update();
  return b;
}
export function control(def, get, set, opt) {
  if (def.t === 'sel') return select(def, get, set);
  if (def.t === 'tog') return toggle(def, get, set);
  return knob(def, get, set, opt);
}
/** Rendert eine Parameterliste; gibt refresh() zurück. */
export function paramRow(defs, get, set, opt = {}) {
  const ctrls = defs.map((d) => control(d, () => get(d.k), (v) => set(d.k, v), { ...opt, mixed: opt.isMixed ? opt.isMixed(d.k) : false }));
  const row = h('div', { class: 'prow' }, ctrls);
  row.refresh = () => ctrls.forEach((c) => c.update && c.update());
  return row;
}

export const CHILI_SVG = `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="cg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff6a3d"/><stop offset=".5" stop-color="#e8141f"/><stop offset="1" stop-color="#8a0710"/></linearGradient></defs><path d="M21.5 19.5c-6.2 1.7-9.4 8.6-8.3 16.7 1.2 9.3 7.8 17.6 18 21.3 6.6 2.4 13.9 2.9 19.5 1.8-7.4-2.7-12.6-7.9-15.6-14.3-3.1-6.5-3.3-13.3-5.4-19.2-1.4-3.9-4.4-7.4-8.2-6.3z" fill="url(#cg)"/><path d="M17.4 25.5c-1.9 3.7-2.1 9-.6 13.6" stroke="#ffc2ad" stroke-width="2.2" fill="none" stroke-linecap="round" opacity=".55"/><path d="M18.5 20.6c2-3.4 6.4-4.6 9.8-2.5-1.3.4-2.4 1.4-3 2.6" fill="#2f9e44"/><path d="M24.6 18.6c.8-4.4 3.8-7.6 8.4-8.6 2.8-.6 4.6-2.4 5.4-5.2" stroke="#2f9e44" stroke-width="3.4" fill="none" stroke-linecap="round"/></svg>`;

/** Würfel mit fünf Augen — Symbol für alle Zufallsfunktionen */
export const DICE = '<svg viewBox="0 0 20 20" class="dice" aria-hidden="true"><rect x="2.5" y="2.5" width="15" height="15" rx="3.2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="6.6" cy="6.6" r="1.35" fill="currentColor"/><circle cx="13.4" cy="6.6" r="1.35" fill="currentColor"/><circle cx="10" cy="10" r="1.35" fill="currentColor"/><circle cx="6.6" cy="13.4" r="1.35" fill="currentColor"/><circle cx="13.4" cy="13.4" r="1.35" fill="currentColor"/></svg>';
/** Würfel-Button: tag „1" (ein Preset für alle Steps) oder „ALL" (jeder Step eigener Zufallswert) */
export function diceBtn(tag, help, fn, cls = '') {
  return h('button', { class: `dbtn ${tag === '1' ? 'one ' : ''}${cls}`, 'data-help': help, onclick: fn }, h('span', { html: DICE }), tag ? h('b', {}, tag) : null);
}

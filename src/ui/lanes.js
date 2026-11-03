/* Chili — Layer-Stack: jeder Parameter ist eine Lane über alle Steps, direkt zeichenbar.
 *
 * Gesten (in jeder Lane):
 *   Ziehen            Werte zeichnen (über mehrere Steps hinweg)
 *   Shift + Ziehen    gerade Linie / Rampe
 *   Alt + Ziehen      fein, relativ (nur der angeklickte Step)
 *   Strg/⌘ + Ziehen   alle Steps gleichzeitig
 *   Rechtsklick       Wert zurücksetzen (auch ziehend)
 *   Doppelklick       Step auf Standardwert
 *   Alt + Mausrad     einzelnen Step fein einstellen
 */
import { h, diceBtn } from './dom.js';
import { STEP_DEF_MAP, fmt, toNorm, fromNorm, noteName } from '../state/params.js';
import { LAYERS, LAYER_MAP, LANE_LABEL, PRESETS, layerActive } from '../state/layers.js';

const GATE_DEF = { k: 'on', l: 'Gate', t: 'tog', def: true };
const defOf = (k) => (k === 'on' ? GATE_DEF : STEP_DEF_MAP[k]);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function kindOf(key) {
  if (key === 'on') return 'gate';
  if (key === 'slice') return 'slice';
  if (key === 'note') return 'note';
  if (key === 'dec') return 'env';
  if (key === 'gain') return 'bar'; // Pegel: von unten, obwohl der Bereich über 0 dB reicht
  const d = STEP_DEF_MAP[key];
  if (d.t === 'tog') return 'tog';
  if (d.t === 'sel') return 'sel';
  if (d.min < 0 && d.max > 0) return d.int ? 'bint' : 'bi';
  return d.int ? 'int' : 'bar';
}
const isDiscrete = (k) => k === 'tog' || k === 'sel' || k === 'gate';
const laneH = (kind, primary) => (kind === 'gate' ? 28 : kind === 'tog' || kind === 'sel' ? 25 : kind === 'slice' ? (primary ? 52 : 42) : primary ? 44 : 34);

/* ---------- Farben */
const hexRgb = (hx) => { const n = parseInt(hx.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgba = (hx, a) => { const [r, g, b] = hexRgb(hx); return `rgba(${r},${g},${b},${a})`; };
let C = null;
function theme() {
  const cs = getComputedStyle(document.documentElement), g = (v) => cs.getPropertyValue(v).trim();
  C = { cell: g('--cell'), beat: g('--cell-beat'), hover: g('--cell-hover'), line: g('--line'), text: g('--text'), muted: g('--muted'), dim: g('--dim'), accent: g('--accent'), ember: g('--ember'), cool: g('--cool'), bg: g('--bg') };
}

/* ---------- Kurzlabels & Icons für Auswahl-Lanes */
const SHORT = {
  source: { sample: 'SMP', synth: 'SYN' },
  fType: { off: '—', lp: 'LP', hp: 'HP', bp: 'BP', notch: 'NT' },
};
const TOG_SHORT = { reverse: 'REV', loop: 'LOOP', fEnvLoop: 'LOOP', delayPP: 'P·P' };
const ICON_PTS = {};
(function buildIcons() {
  let s = 12345; const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const f = {
    decay: (x) => Math.exp(-5 * x), attack: (x) => 1 - Math.exp(-5 * x), ad: (x) => (x < 0.15 ? x / 0.15 : Math.exp(-4 * (x - 0.15))),
    rampUp: (x) => x, rampDown: (x) => 1 - x, triangle: (x) => (x < 0.5 ? 2 * x : 2 - 2 * x), sine: (x) => 0.5 - 0.5 * Math.cos(2 * Math.PI * x), square: (x) => (x < 0.5 ? 1 : 0),
    tri: (x) => (x < 0.5 ? 2 * x : 2 - 2 * x), saw: (x) => x, sh: null, smooth: null,
  };
  const pts = (fn) => Array.from({ length: 25 }, (_, i) => fn(i / 24));
  for (const [k, fn] of Object.entries(f)) if (fn) ICON_PTS[k] = pts(fn);
  ICON_PTS.sine = pts((x) => 0.5 + 0.5 * Math.sin(2 * Math.PI * x));
  const steps8 = Array.from({ length: 8 }, rnd); ICON_PTS.rndSteps = pts((x) => steps8[Math.min(7, (x * 8) | 0)]);
  ICON_PTS.sh = pts((x) => steps8[Math.min(3, (x * 4) | 0)]);
  const sm = Array.from({ length: 5 }, rnd); ICON_PTS.rndSmooth = ICON_PTS.smooth = pts((x) => { const q = x * 4, i = Math.min(3, q | 0), t = q - i; return sm[i] + (sm[i + 1] - sm[i]) * (0.5 - 0.5 * Math.cos(Math.PI * t)); });
  let v = 0.5; ICON_PTS.rndWalk = pts(() => (v = clamp(v + (rnd() - 0.5) * 0.5, 0, 1)));
  let c = 0.3; ICON_PTS.chaos = pts(() => (c = 3.9 * c * (1 - c)));
  ICON_PTS.rndSpikes = pts((x) => Math.max(0, ...[0.1, 0.45, 0.7].map((p, i) => (x >= p ? [0.9, 0.6, 1][i] * Math.exp(-(x - p) * 20) : 0))));
  ICON_PTS.rndRamps = pts((x) => { const q = x * 3, i = Math.min(2, q | 0); return [0.9, 0.6, 1][i] * (1 - (q - i)); });
})();
const WAVE_FN = { sine: (x) => 0.5 + 0.45 * Math.sin(2 * Math.PI * x), tri: (x) => (x < 0.5 ? 0.05 + 1.8 * x : 1.85 - 1.8 * x), saw: (x) => 0.05 + 0.9 * x, square: (x) => (x < 0.5 ? 0.95 : 0.05) };
function drawIcon(ctx, pts, x, y, w, hh, col) {
  ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.beginPath();
  pts.forEach((p, i) => { const px = x + (i / (pts.length - 1)) * w, py = y + hh - p * hh; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
  ctx.stroke();
}
const rr = (ctx, x, y, w, hh, r) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, hh, r); else ctx.rect(x, y, w, hh); };

/* ================================================================ VIEW */
export function stackView(app) {
  const chips = h('div', { class: 'chips' });
  const rows = h('div', { class: 'rows' });
  const el = h('section', { class: 'stack' }, chips, rows);
  let lanes = [], dirty = true, W = 0;
  const P = () => app.project, N = () => P().transport.length;
  const nSl = () => P().slices.length;

  /* ---------- Werte lesen/schreiben */
  const dDef = (key) => {
    const d = defOf(key);
    if (key === 'slice') return { ...d, max: Math.max(1, nSl() - 1) };
    return d;
  };
  const getN = (key, i) => { const d = dDef(key); return clamp(toNorm(d, P().steps[i][key]), 0, 1); };
  const setN = (key, i, n) => {
    const d = dDef(key); let v = fromNorm(d, n);
    if (key === 'slice') v = clamp(Math.round(v), 0, Math.max(0, nSl() - 1));
    P().steps[i][key] = v;
  };
  const setV = (key, i, v) => { P().steps[i][key] = v; };
  const opts = (key) => defOf(key).o.map((o) => o[0]);
  const cycle = (key, v, dir) => { const o = opts(key), j = o.indexOf(v); return o[(j + dir + o.length) % o.length]; };
  const valText = (key, v) => {
    const d = defOf(key);
    if (key === 'on') return v ? 'An' : 'Aus';
    if (d.t === 'tog') return v ? 'An' : 'Aus';
    if (d.t === 'sel') { const o = d.o.find((x) => x[0] === v); return o ? o[1] : String(v); }
    if (key === 'slice') return nSl() ? `Slice ${v + 1}` : 'kein Sample';
    return fmt(d.u, v);
  };

  /* ---------- Operationen auf ganze Lanes / Layer */
  function randValue(key, i) {
    const r = Math.random, d = defOf(key), s = P().steps[i];
    switch (key) {
      case 'on': return r() < 0.62;
      case 'slice': return nSl() ? (r() * nSl()) | 0 : 0;
      case 'note': return 45 + [0, 3, 5, 7, 10, 12, 15, 19][(r() * 8) | 0];
      case 'pitch': return [0, 0, 0, 0, 12, -12, 7, -5, 5][(r() * 9) | 0];
      case 'gain': return Math.round(-14 + r() * 14);
      case 'prob': return r() < 0.7 ? 1 : +(0.35 + r() * 0.5).toFixed(2);
      case 'gate': return [0.25, 0.5, 1, 1, 1, 2][(r() * 6) | 0];
      case 'ratchet': return r() < 0.72 ? 1 : [2, 2, 3, 4, 6][(r() * 5) | 0];
      case 'spread': return +(0.6 + r() * 1.3).toFixed(2);
      case 'source': return s.source;
      case 'cutoff': return Math.round(250 * Math.pow(40, r()));
      case 'fType': return ['lp', 'lp', 'lp', 'bp', 'hp'][(r() * 5) | 0];
    }
    if (d.t === 'tog') return r() < 0.25;
    if (d.t === 'sel') return d.o[(r() * d.o.length) | 0][0];
    if (d.min === 0 && d.def === 0) return r() < 0.5 ? 0 : fromNorm(d, 0.2 + r() * 0.6);
    if (d.min < 0 && d.max > 0) return fromNorm(d, 0.5 + (r() - 0.5) * 0.8);
    return fromNorm(d, 0.15 + r() * 0.75);
  }
  app.laneOp = (key, op) => {
    app.snapshot();
    const st = P().steps, L = N(), d = defOf(key);
    if (op === 'rnd') for (let i = 0; i < L; i++) st[i][key] = randValue(key, i);
    if (op === 'reset') for (let i = 0; i < L; i++) st[i][key] = d.def;
    if (op === 'off') for (let i = 0; i < L; i++) st[i][key] = false;
    if (op === 'left' || op === 'right') {
      const v = st.slice(0, L).map((s) => s[key]);
      if (op === 'left') v.push(v.shift()); else v.unshift(v.pop());
      v.forEach((x, i) => (st[i][key] = x));
    }
    changed();
  };
  /** op: 'one' = ein Zufalls-Preset auf alle Steps · 'rnd' = jeder Step eigener Zufallswert · 'reset' */
  function layerApply(id, op) {
    const l = LAYER_MAP[id], st = P().steps, L = N();
    if (op === 'one') {
      const pre = PRESETS[id], usePre = pre && Math.random() < 0.65;
      const v = usePre ? pre[(Math.random() * pre.length) | 0] : null;
      const vals = {};
      for (const key of l.keys) { if (key === 'source' || key === 'slice' || key === 'note') continue; vals[key] = v ? v.v[key] : randValue(key, 0); }
      for (const [key, val] of Object.entries(vals)) if (val !== undefined) for (let i = 0; i < L; i++) st[i][key] = val;
      if (!P().layers[id].on && l.bypass) P().layers[id].on = true;
      return v ? v.n : 'Zufall';
    }
    for (const key of l.keys) {
      if (key === 'source' && (op !== 'rnd' || !nSl())) continue;
      for (let i = 0; i < L; i++) st[i][key] = op === 'rnd' ? (key === 'source' ? (Math.random() < 0.3 ? 'synth' : 'sample') : randValue(key, i)) : defOf(key).def;
    }
    if (op === 'rnd' && !P().layers[id].on && l.bypass) P().layers[id].on = true;
    return null;
  }
  app.layerOp = (id, op) => { app.snapshot(); const n = layerApply(id, op); changed(); if (n) app.toast(`${LAYER_MAP[id].label}: Preset „${n}" auf allen Steps`); el.refresh(); };
  app.randomAll = (op) => {
    app.snapshot();
    for (const l of LAYERS) if (l.id !== 'rip') layerApply(l.id, op);
    if (op === 'all') for (let i = 0; i < N(); i++) P().steps[i].on = randValue('on', i);
    changed(); el.refresh();
    app.toast(op === 'one' ? 'Jede Reihe: ein zufälliges Preset' : 'Jeder Step jeder Reihe: zufällig');
  };

  function changed() { app.commit(); dirty = true; updateChips(); updateReadouts(); }
  el.markDirty = () => { dirty = true; };

  /* ---------- Chips (Layer ein-/ausblenden) */
  function buildChips() {
    chips.innerHTML = '';
    chips.append(h('span', { class: 'chips-l' }, 'Layer'));
    for (const l of LAYERS) {
      const st = P().layers[l.id];
      const c = h('button', { class: 'chip', 'data-id': l.id, style: { '--lc': l.color }, 'data-help': `${l.label} — ${l.help} Klick blendet den Layer ein/aus.`,
        onclick: () => { st.show = !st.show; app.commit(); el.refresh(); } }, h('i', {}), l.label);
      chips.append(c);
    }
    chips.append(h('span', { class: 'grow' }),
      h('button', { class: 'ibtn', 'data-help': 'Alle sichtbaren Layer aufklappen: jede Lane des Layers wird angezeigt.', onclick: () => { LAYERS.forEach((l) => (P().layers[l.id].open = true)); el.refresh(); } }, '⊞'),
      h('button', { class: 'ibtn', 'data-help': 'Alle Layer zuklappen: nur die gewählte Haupt-Lane pro Layer.', onclick: () => { LAYERS.forEach((l) => (P().layers[l.id].open = false)); el.refresh(); } }, '⊟'));
    updateChips();
  }
  function updateChips() {
    chips.querySelectorAll('.chip').forEach((c) => {
      const l = LAYER_MAP[c.dataset.id], st = P().layers[l.id];
      const on = l.ripPower ? P().rip.on : st.on;
      c.classList.toggle('show', st.show); c.classList.toggle('byp', !on);
      c.classList.toggle('live', on && (l.ripPower ? P().rip.on : layerActive(l, P().steps, N())));
    });
  }

  /* ---------- Aufbau */
  function laneRow(key, layer, primary) {
    const kind = kindOf(key), H = laneH(kind, primary);
    const cv = h('canvas', { class: 'lane-cv' });
    const ro = h('span', { class: 'ro' });
    const ops = h('span', { class: 'ops' });
    const op = (sym, o, help) => (sym === '✦' ? diceBtn('', help, () => app.laneOp(key, o), 'sm') : h('button', { class: 'ibtn', 'data-help': help, onclick: () => app.laneOp(key, o) }, sym));
    if (kind === 'gate') ops.append(op('✦', 'rnd', 'Zufälliges Gate-Muster.'), op('●', 'reset', 'Alle Steps an.'), op('○', 'off', 'Alle Steps aus.'), op('◀', 'left', 'Muster einen Step nach links rotieren.'), op('▶', 'right', 'Muster einen Step nach rechts rotieren.'));
    else ops.append(op('✦', 'rnd', 'Lane würfeln: zufällige, musikalisch begrenzte Werte.'), op('⟲', 'reset', 'Lane auf Standardwerte.'), op('◀', 'left', 'Lane einen Step nach links rotieren.'), op('▶', 'right', 'Lane einen Step nach rechts rotieren.'));
    const name = kind === 'gate' ? 'Gate' : LANE_LABEL[key] || defOf(key).l;
    const lab = h('div', { class: `lane-l${primary ? ' prim' : ''}` }, h('span', { class: 'ln' }, name), ro, ops);
    const help = kind === 'gate' ? 'Gate — Steps an/aus. Klicken und ziehen malt An oder Aus über mehrere Steps.' : `${layer.label} · ${name} — ziehen zeichnet · Shift Linie · Alt fein · Strg/⌘ alle · Rechtsklick/Doppelklick Reset`;
    const row = h('div', { class: `lane k-${kind}`, style: { '--lc': layer ? layer.color : '#ff3b2f', height: `${H}px` }, 'data-help': help }, lab, h('div', { class: 'lane-c' }, cv));
    const lane = { key, kind, layer, cv, ro, H, row };
    attach(lane);
    lanes.push(lane);
    return row;
  }
  function rulerRow() {
    const cv = h('canvas', { class: 'lane-cv' });
    const row = h('div', { class: 'lane k-ruler', style: { height: '18px' }, 'data-help': 'Step-Nummer anklicken: Step vorhören.' }, h('div', { class: 'lane-l' }, h('span', { class: 'ln dim' }, 'Step')), h('div', { class: 'lane-c' }, cv));
    const lane = { key: 'ruler', kind: 'ruler', layer: null, cv, H: 18, row };
    cv.addEventListener('pointerdown', (e) => { const i = stepAt(lane, e); if (i >= 0) app.audition(i); });
    cv.addEventListener('pointermove', (e) => setHover(stepAt(lane, e), null));
    cv.addEventListener('pointerleave', () => setHover(-1, null));
    lanes.push(lane);
    return row;
  }
  function layerBlock(l) {
    const st = P().layers[l.id];
    const isOn = () => (l.ripPower ? P().rip.on : st.on);
    const power = l.bypass || l.ripPower
      ? h('button', { class: `pwr${isOn() ? ' on' : ''}`, 'data-help': l.ripPower ? 'Rip ein/aus.' : 'Layer-Bypass: neutralisiert den Layer im Klang, die gezeichneten Werte bleiben erhalten.',
        onclick: () => { if (l.ripPower) { P().rip.on = !P().rip.on; app.refreshPart('special'); } else st.on = !st.on; app.commit(); el.refresh(); } },
        h('svg', { svg: true, viewBox: '0 0 16 16', html: '<path d="M8 2v6M4.6 4.2a5 5 0 1 0 6.8 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' }))
      : h('span', { class: 'pwr-sp' });
    const tabs = h('div', { class: 'ltabs' }, l.keys.map((k) => {
      const d = defOf(k), used = P().steps.slice(0, N()).some((s) => s[k] !== d.def);
      return h('button', { class: `${st.lane === k ? 'on' : ''}${used ? ' used' : ''}`, 'data-help': `${LANE_LABEL[k] || d.l} als Haupt-Lane zeigen. Punkt = Lane enthält gezeichnete Werte.`, onclick: () => { st.lane = k; el.refresh(); } }, LANE_LABEL[k] || d.l);
    }));
    const head = h('div', { class: 'lhead', 'data-help': l.help },
      h('div', { class: 'lh-l' }, h('i', { class: 'lbar' }), power, h('span', { class: 'lname' }, l.label),
        h('button', { class: `chev${st.open ? ' open' : ''}`, 'data-help': 'Layer auf-/zuklappen: alle Lanes des Layers zeigen.', onclick: () => { st.open = !st.open; el.refresh(); } }, '▸')),
      h('div', { class: 'lh-r' }, st.open ? h('span', { class: 'lh-hint' }, `${l.keys.length} Lanes`) : tabs, h('span', { class: 'grow' }),
        diceBtn('1', `Würfel 1 — ein zufälliges Preset für „${l.label}", gleich auf allen Steps.`, () => app.layerOp(l.id, 'one')),
        diceBtn('ALL', `Würfel ALL — jeder Step bekommt in „${l.label}" eigene Zufallswerte.`, () => app.layerOp(l.id, 'rnd'), 'hot'),
        h('button', { class: 'ibtn', 'data-help': `Ganzen Layer „${l.label}" zurücksetzen.`, onclick: () => app.layerOp(l.id, 'reset') }, '⟲'),
        h('button', { class: 'ibtn', 'data-help': 'Layer ausblenden (bleibt aktiv, wenn nicht gebypasst).', onclick: () => { st.show = false; el.refresh(); } }, '✕')));
    const block = h('div', { class: `layer${isOn() ? '' : ' byp'}`, style: { '--lc': l.color } }, head);
    if (st.open) l.keys.forEach((k, j) => block.append(laneRow(k, l, j === 0)));
    else block.append(laneRow(st.lane, l, true));
    return block;
  }
  el.refresh = () => {
    theme();
    rows.innerHTML = ''; lanes = [];
    rows.append(rulerRow(), laneRow('on', null, true));
    const vis = LAYERS.filter((l) => P().layers[l.id].show);
    for (const l of vis) rows.append(layerBlock(l));
    if (!vis.length) rows.append(h('div', { class: 'empty-l' }, 'Keine Layer sichtbar — oben einen Layer wählen.'));
    buildChips(); resize(); dirty = true;
  };

  /* ---------- Größe */
  function resize() {
    const dpr = devicePixelRatio || 1;
    for (const ln of lanes) {
      const w = ln.cv.clientWidth; if (!w) continue; W = w;
      ln.w = w; ln.cv.width = Math.round(w * dpr); ln.cv.height = Math.round(ln.H * dpr); ln.cv.style.height = `${ln.H}px`;
      ln.ctx = ln.cv.getContext('2d'); ln.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    dirty = true;
  }
  new ResizeObserver(() => resize()).observe(rows);

  /* ---------- Hover / Readouts */
  function setHover(i, key) {
    if (i === app.hoverStep) return;
    app.hoverStep = i; dirty = true; updateReadouts();
    const s = i >= 0 ? P().steps[i] : null;
    const hs = s && s.source !== 'synth' && nSl() ? s.slice : -1;
    if (hs !== app.hoverSlice) { app.hoverSlice = hs; app.views.source.draw && app.views.source.draw(); }
  }
  function updateReadouts() {
    const i = app.hoverStep;
    for (const ln of lanes) if (ln.ro) ln.ro.textContent = i >= 0 && i < N() ? valText(ln.key, P().steps[i][ln.key]) : '';
  }
  const stepAt = (ln, e) => { const r = ln.cv.getBoundingClientRect(), L = N(); const i = Math.floor(((e.clientX - r.left) / r.width) * L); return i >= 0 && i < L ? i : -1; };

  /* ---------- Zeichnen per Maus */
  function attach(ln) {
    const { cv, key, kind } = ln;
    const disc = isDiscrete(kind);
    let drag = null;
    const pos = (e) => {
      const r = cv.getBoundingClientRect(), L = N();
      const i = clamp(Math.floor(((e.clientX - r.left) / r.width) * L), 0, L - 1);
      const n = clamp(1 - (e.clientY - r.top - 4) / (r.height - 8), 0, 1);
      return { i, n };
    };
    const span = (a, b, fn) => { const s = Math.sign(b - a) || 1; for (let j = a; j !== b + s; j += s) fn(j, a === b ? 1 : (j - a) / (b - a)); };
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      const { i, n } = pos(e); e.preventDefault(); cv.setPointerCapture(e.pointerId);
      app.snapshot();
      const L = N(), mod = e.ctrlKey || e.metaKey;
      const mode = e.button === 2 ? 'erase' : mod ? 'all' : !disc && e.shiftKey ? 'line' : !disc && e.altKey ? 'fine' : 'draw';
      drag = { mode, i0: i, n0: n, last: i, lastN: n, orig: P().steps.map((s) => s[key]), y0: e.clientY, nStart: disc ? 0 : getN(key, i) };
      if (disc) {
        const cur = P().steps[i][key], d = defOf(key);
        drag.paint = mode === 'erase' ? (kind === 'gate' ? false : d.def) : kind === 'sel' ? cycle(key, cur, e.shiftKey ? -1 : 1) : !cur;
        if (mode === 'all') for (let j = 0; j < L; j++) setV(key, j, drag.paint); else setV(key, i, drag.paint);
      } else if (mode === 'erase') setV(key, i, defOf(key).def);
      else if (mode === 'all') for (let j = 0; j < L; j++) setN(key, j, n);
      else if (mode !== 'fine') setN(key, i, n);
      changed();
    });
    cv.addEventListener('pointermove', (e) => {
      const { i, n } = pos(e);
      if (!drag) { setHover(i, key); return; }
      const L = N(), D = drag;
      if (disc) {
        if (D.mode === 'all') for (let j = 0; j < L; j++) setV(key, j, D.paint);
        else span(D.last, i, (j) => setV(key, j, D.paint));
      } else if (D.mode === 'draw') span(D.last, i, (j, t) => setN(key, j, D.lastN + (n - D.lastN) * t));
      else if (D.mode === 'erase') span(D.last, i, (j) => setV(key, j, defOf(key).def));
      else if (D.mode === 'all') for (let j = 0; j < L; j++) setN(key, j, n);
      else if (D.mode === 'line') { D.orig.forEach((v, j) => (P().steps[j][key] = v)); span(D.i0, i, (j, t) => setN(key, j, D.n0 + (n - D.n0) * t)); }
      else if (D.mode === 'fine') setN(key, D.i0, clamp(D.nStart + (D.y0 - e.clientY) / (e.shiftKey ? 1600 : 500), 0, 1));
      D.last = i; D.lastN = n;
      setHover(i, key); changed();
    });
    const end = (e) => { if (drag) { drag = null; try { cv.releasePointerCapture(e.pointerId); } catch {} } };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', () => { if (!drag) setHover(-1, null); });
    cv.addEventListener('dblclick', (e) => { if (disc) return; const { i } = pos(e); app.snapshot(); setV(key, i, defOf(key).def); changed(); });
    cv.addEventListener('wheel', (e) => {
      if (!e.altKey) return; e.preventDefault();
      const { i } = pos(e), dir = e.deltaY < 0 ? 1 : -1;
      if (kind === 'sel') setV(key, i, cycle(key, P().steps[i][key], dir));
      else if (disc) setV(key, i, dir > 0);
      else { const d = dDef(key), st = d.int ? 1 / Math.max(1, d.max - d.min) : e.shiftKey ? 0.004 : 0.02; setN(key, i, clamp(getN(key, i) + dir * st, 0, 1)); }
      changed();
    }, { passive: false });
  }

  /* ---------- Rendering */
  function drawLane(ln) {
    const ctx = ln.ctx; if (!ctx) return;
    const Wd = ln.w, H = ln.H, L = N(), cw = Wd / L, st = P().steps, key = ln.key, kind = ln.kind, l = ln.layer;
    const col = l ? l.color : C.accent;
    const byp = l && ((l.bypass && !P().layers[l.id].on) || (l.ripPower && !P().rip.on));
    ctx.clearRect(0, 0, Wd, H);
    const mono = (sz, w = 500) => `${w} ${sz}px "JetBrains Mono", ui-monospace, monospace`;
    for (let i = 0; i < L; i++) {
      const s = st[i], x = i * cw + 1, w = cw - 2, y = 2, hh = H - 4;
      const relevant = !l || !l.forSource || s.source === l.forSource;
      const a = (kind === 'ruler' || kind === 'gate' ? 1 : (s.on ? 1 : 0.32) * (relevant ? 1 : 0.22)) * (byp ? 0.35 : 1);
      if (kind !== 'ruler') {
        ctx.fillStyle = i === app.hoverStep ? C.hover : (i >> 2) % 2 === 0 ? C.beat : C.cell;
        rr(ctx, x, y, w, hh, 4); ctx.fill();
      }
      ctx.globalAlpha = a;
      const v = s[key];
      switch (kind) {
        case 'ruler': {
          const now = app.playStep === i, beat = i % 4 === 0;
          ctx.fillStyle = now ? C.ember : i === app.hoverStep ? C.text : beat ? C.muted : C.dim;
          ctx.font = mono(cw < 22 ? 9 : 10.5, beat || now ? 700 : 500); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(i === app.hoverStep ? '▶' : String(i + 1), x + w / 2, H / 2 + 1);
          if (beat) { ctx.fillStyle = C.line; ctx.fillRect(i * cw, H - 2, 1, 2); }
          break;
        }
        case 'gate': {
          if (v) {
            const g = ctx.createLinearGradient(0, y, 0, y + hh); g.addColorStop(0, '#ff5a3d'); g.addColorStop(1, '#d81e18');
            ctx.fillStyle = g; rr(ctx, x + 1, y + 1, w - 2, hh - 2, 4); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(x + 3, y + 2, w - 6, 1);
            ctx.fillStyle = '#ffe2d6'; ctx.beginPath(); ctx.arc(x + w / 2, y + hh / 2, Math.min(3, w / 6), 0, Math.PI * 2); ctx.fill();
          } else { ctx.strokeStyle = C.line; ctx.lineWidth = 1; rr(ctx, x + 1.5, y + 1.5, w - 3, hh - 3, 4); ctx.stroke(); }
          break;
        }
        case 'bar': case 'int': case 'note': {
          const n = clamp(toNorm(dDef(key), v), 0, 1), bh = Math.max(1.5, n * (hh - 2)), top = y + hh - 1 - bh;
          ctx.fillStyle = rgba(col, 0.5); ctx.fillRect(x + 1, top, w - 2, bh);
          ctx.fillStyle = col; ctx.fillRect(x + 1, top, w - 2, 2);
          if ((kind !== 'bar' || i === app.hoverStep) && cw >= 22) {
            ctx.fillStyle = C.text; ctx.font = mono(9.5, 600); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
            ctx.fillText(kind === 'note' ? noteName(v) : kind === 'int' ? String(v) : fmt(defOf(key).u, v).replace(' ', ''), x + w / 2, Math.max(y + 2, Math.min(top + 4, y + hh - 12)));
          }
          break;
        }
        case 'bi': case 'bint': {
          const n = clamp(toNorm(dDef(key), v), 0, 1), mid = y + 1 + (1 - toNorm(dDef(key), 0)) * (hh - 2), yy = y + 1 + (1 - n) * (hh - 2);
          ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(x, mid, w, 1);
          ctx.fillStyle = rgba(col, 0.5); ctx.fillRect(x + 1, Math.min(mid, yy), w - 2, Math.abs(yy - mid));
          ctx.fillStyle = col; ctx.fillRect(x + 1, yy - 1, w - 2, 2);
          if (cw >= 22 && (kind === 'bint' ? v !== 0 : i === app.hoverStep)) {
            ctx.fillStyle = C.text; ctx.font = mono(9.5, 600); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            const t = kind === 'bint' ? (v > 0 ? `+${v}` : String(v)) : key === 'pan' ? fmt('pan', v) : fmt(defOf(key).u, v).replace(' ', '');
            ctx.fillText(t, x + w / 2, yy < mid ? Math.min(mid + 8, y + hh - 6) : Math.max(mid - 8, y + 6));
          }
          break;
        }
        case 'slice': {
          const sl = P().slices[v], pk = sl && app.peaks.get(sl.sampleId);
          if (!nSl()) { ctx.fillStyle = C.dim; ctx.font = mono(10); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('—', x + w / 2, H / 2); break; }
          if (app.hoverSlice === v && s.source !== 'synth') { ctx.fillStyle = rgba(col, 0.12); rr(ctx, x, y, w, hh, 4); ctx.fill(); }
          if (pk) {
            const mid = y + hh / 2 + 5, amp = (hh - 16) / 2, len = pk.mn.length;
            ctx.fillStyle = rgba(col, 0.85);
            for (let px = 0; px < w - 2; px++) {
              const t0 = sl.a + ((sl.b - sl.a) * px) / (w - 2), t1 = sl.a + ((sl.b - sl.a) * (px + 1)) / (w - 2);
              let mn = 0, mx = 0; for (let k = Math.floor(t0 * len); k <= Math.min(len - 1, Math.floor(t1 * len)); k++) { if (pk.mn[k] < mn) mn = pk.mn[k]; if (pk.mx[k] > mx) mx = pk.mx[k]; }
              const p = s.reverse ? w - 3 - px : px;
              ctx.fillRect(x + 1 + p, mid - mx * amp, 1, Math.max(1, (mx - mn) * amp));
            }
          }
          ctx.fillStyle = C.text; ctx.font = mono(cw < 26 ? 8.5 : 10, 700); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
          ctx.fillText(String(v + 1), x + 3, y + 2);
          const n = clamp(toNorm(dDef(key), v), 0, 1); ctx.fillStyle = col; ctx.fillRect(x + w - 3, y + hh - 2 - n * (hh - 4), 2, 2);
          break;
        }
        case 'env': {
          const at = clamp(toNorm(defOf('atk'), s.atk), 0, 1), dc = clamp(toNorm(defOf('dec'), s.dec), 0, 1), su = clamp(s.sus, 0, 1);
          const x0 = x + 2, ww = w - 4, base = y + hh - 2, top = y + 4, Ht = base - top;
          const aW = at * ww * 0.3, dW = (0.08 + dc * 0.92) * (ww - aW);
          ctx.beginPath(); ctx.moveTo(x0, base); ctx.lineTo(x0 + aW, top);
          for (let k = 1; k <= 12; k++) { const t = k / 12; ctx.lineTo(x0 + aW + dW * t, top + (1 - su) * Ht * (1 - Math.exp(-4 * t)) / (1 - Math.exp(-4))); }
          ctx.lineTo(x0 + ww, top + (1 - su) * Ht); ctx.lineTo(x0 + ww, base); ctx.closePath();
          ctx.fillStyle = rgba(col, 0.32); ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
          break;
        }
        case 'tog': {
          if (v) {
            ctx.fillStyle = rgba(col, 0.85); rr(ctx, x + 2, y + 2, w - 4, hh - 4, 3); ctx.fill();
            if (cw >= 26) { ctx.fillStyle = '#140c08'; ctx.font = mono(8.5, 700); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(TOG_SHORT[key] || 'ON', x + w / 2, H / 2 + 0.5); }
          } else { ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(x + w / 2 - 3, H / 2 - 0.5, 6, 1); }
          break;
        }
        case 'sel': {
          const d = defOf(key), changedV = v !== d.def;
          if (changedV) { ctx.fillStyle = rgba(col, key === 'source' && v === 'synth' ? 0.28 : 0.16); rr(ctx, x + 1, y + 1, w - 2, hh - 2, 3); ctx.fill(); }
          const ipad = Math.max(3, w * 0.16);
          if (ICON_PTS[v] && (key === 'fEnvShape' || key.endsWith('Shape'))) drawIcon(ctx, ICON_PTS[v], x + ipad, y + 6, w - 2 * ipad, hh - 12, changedV ? col : C.muted);
          else if (v === 'random') { ctx.fillStyle = col; ctx.font = mono(13, 700); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('✦', x + w / 2, H / 2 + 1); }
          else if (WAVE_FN[v] && (key === 'osc1' || key === 'osc2')) drawIcon(ctx, Array.from({ length: 25 }, (_, k) => WAVE_FN[v](k / 24)), x + ipad, y + 6, w - 2 * ipad, hh - 12, col);
          else {
            const t = (SHORT[key] && SHORT[key][v]) || v;
            ctx.fillStyle = changedV ? C.text : C.muted; ctx.font = mono(cw < 26 ? 8 : 9.5, 600); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(cw < 20 ? t.slice(0, 2) : t, x + w / 2, H / 2 + 0.5);
          }
          break;
        }
      }
      ctx.globalAlpha = 1;
      if (app.playStep === i && kind !== 'ruler') {
        ctx.fillStyle = 'rgba(255,170,40,0.13)'; rr(ctx, x, y, w, hh, 4); ctx.fill();
        if (kind === 'gate') { ctx.strokeStyle = C.ember; ctx.lineWidth = 1.5; rr(ctx, x + 0.75, y + 0.75, w - 1.5, hh - 1.5, 4); ctx.stroke(); }
      }
    }
    // Kollisionsblitze (Collide)
    const now = performance.now();
    for (const f of app.flashes) {
      const age = (now - f.t) / 650; if (age >= 1 || f.step >= L) continue;
      ctx.fillStyle = `rgba(95,184,255,${0.38 * (1 - age)})`; rr(ctx, f.step * cw + 1, 2, cw - 2, H - 4, 4); ctx.fill();
    }
  }
  function frame() {
    requestAnimationFrame(frame);
    const now = performance.now();
    if (app.flashes.length) { app.flashes = app.flashes.filter((f) => now - f.t < 650); dirty = true; }
    if (!dirty || !el.isConnected || el.offsetParent === null) return;
    dirty = false;
    if (!C) theme();
    for (const ln of lanes) drawLane(ln);
  }
  requestAnimationFrame(frame);
  return el;
}

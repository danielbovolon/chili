/* Chaos — Zufallsmodulator */
import { h, knob, diceBtn } from './dom.js';
import { CHAOS_DEFS } from '../state/params.js';
import { LAYERS } from '../state/layers.js';
import { chaosKeys } from '../state/project.js';

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

/* ================================================================ CHAOS */
export function chaosView(app) {
  const C = () => app.project.chaos;
  const set = (k, v) => { C()[k] = v; app.commit(); };
  const sw = h('button', { class: 'switch', 'data-help': 'Chaos modulator on/off. The “Chaos” macro scales its overall depth.', onclick: () => { C().on = !C().on; app.commit(); el.refresh(); app.refreshPart('bay'); } });
  const cv = h('canvas', { class: 'chaos-cv', 'data-help': 'Live: the modulator’s random channels. Each line is one parameter.' });
  const D = Object.fromEntries(CHAOS_DEFS.map((d) => [d.k, d]));
  const helps = {
    depth: 'Depth — how far the random values move the drawn values.',
    rate: 'Rate — every how many steps a new random value is drawn.',
    prob: 'Chance — probability that a new value is drawn at all on each tick.',
    rand: 'Random — how far the new value jumps from the previous one (0 = stays, 1 = fully free).',
    shape: 'Shape — transition between values: step · linear · smooth · exponential (continuous).',
    lock: 'Lock — probability of repeating a phrase of loop length instead of rolling new values (like a Turing Machine).',
    loop: 'Loop — length of the phrase that Lock repeats.',
  };
  const ks = CHAOS_DEFS.map((d) => { const k = knob(d, () => C()[d.k], (v) => set(d.k, v), { small: true }); k.dataset.help = helps[d.k]; return k; });
  const mode = h('div', { class: 'seg mini', 'data-help': 'Relative: randomness around the drawn values. Absolute: randomness replaces the values (from 50 % depth also choice parameters).' },
    [['rel', 'RELATIVE'], ['abs', 'ABSOLUTE']].map(([v, l]) => h('button', { 'data-v': v, onclick: () => { set('mode', v); el.refresh(); } }, l)));
  const seed = diceBtn('', 'New seed: new random sequence.', () => { C().seed = (Math.random() * 1e9) | 0; app.commit(); });
  const targets = h('div', { class: 'targets' });
  const mini = (t, help, fn, cls = '') => h('button', { class: `tbtn ${cls}`, 'data-help': help, onclick: fn }, t);
  const all = mini('ALL', 'Target all rows.', () => { C().targets = ['gate', ...LAYERS.map((l) => l.id)]; app.commit(); el.refresh(); });
  const none = mini('NONE', 'No targets.', () => { C().targets = []; app.commit(); el.refresh(); });
  const inf = mini('∞', 'Infinite: all rows (except the CPU-hungry per-step delay/reverb — add them one by one), depth 100 %, new value every step: every parameter of every step keeps changing.', () => { Object.assign(C(), { on: true, depth: 1, rate: 1, prob: 1, rand: 1, shape: 0, lock: 0, mode: 'abs', targets: ['gate', ...LAYERS.map((l) => l.id).filter((id) => id !== 'rev' && id !== 'dly')] }); app.commit(); el.refresh(); }, 'hot');
  const el = h('section', { class: 'mod chaos', 'data-help': 'Chaos — random modulator for every parameter of every step, after VCV Random.' },
    h('header', { class: 'mh' }, h('span', { class: 'mtitle' }, 'CHAOS'), mode, seed, inf, sw),
    cv,
    h('div', { class: 'prow tight' }, ks),
    h('div', { class: 'targets' }, all, none, targets));
  el.refresh = () => {
    const c = C();
    sw.classList.toggle('on', c.on); el.classList.toggle('off', !c.on);
    ks.forEach((k) => k.update());
    mode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === c.mode));
    targets.innerHTML = '';
    const all = [{ id: 'gate', label: 'Gates', color: '#ff3b2f' }, ...LAYERS];
    for (const l of all) {
      const on = c.targets.includes(l.id);
      const b = h('button', { class: `chip${on ? ' show live' : ''}`, style: { '--lc': l.color }, 'data-help': `${l.label} as a target of the random modulator.`,
        onclick: () => { c.targets = on ? c.targets.filter((x) => x !== l.id) : [...c.targets, l.id]; app.commit(); el.refresh(); } }, h('i', {}), l.label);
      targets.append(b);
    }
  };
  /* Live-Kanäle */
  const hist = []; let latest = null;
  el.meter = (m) => { latest = m.ch; if (m.ch) { hist.push(m.ch.slice()); if (hist.length > 140) hist.shift(); } };
  const cols = ['#ff3b2f', '#46f0d2', '#ffa21a', '#b78bff', '#57c7ff', '#6ee07a', '#ff7ad9', '#ffd166'];
  function draw() {
    requestAnimationFrame(draw);
    if (!cv.isConnected || cv.offsetParent === null) return;
    const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; if (!W) return;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    g.strokeStyle = css('--grid'); for (let y = 0; y <= 4; y++) { g.beginPath(); g.moveTo(0, (y * H) / 4 + 0.5); g.lineTo(W, (y * H) / 4 + 0.5); g.stroke(); }
    if (!hist.length) { g.fillStyle = css('--dim'); g.font = '600 10px "Chakra Petch", sans-serif'; g.fillText('WAITING FOR PLAYBACK', 8, H / 2 + 4); return; }
    const n = Math.min(8, hist[hist.length - 1].length);
    for (let c = 0; c < n; c++) {
      g.strokeStyle = cols[c]; g.lineWidth = c === 0 ? 1.8 : 1; g.globalAlpha = c === 0 ? 1 : 0.6; g.beginPath();
      hist.forEach((row, i) => { const x = (i / 139) * W, y = H / 2 - row[c] * (H / 2 - 4); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.stroke();
    }
    g.globalAlpha = 1;
    const keys = chaosKeys(C().targets); g.font = '9px "JetBrains Mono", monospace';
    for (let c = 0; c < n; c++) { g.fillStyle = cols[c]; g.fillText(keys[c] ? keys[c].k : '', 6 + c * 54, 11); }
  }
  requestAnimationFrame(draw);
  return el;
}

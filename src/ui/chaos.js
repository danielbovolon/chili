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
  const sw = h('button', { class: 'switch', 'data-help': 'Chaos-Modulator ein/aus. Unabhängig davon steuert das Makro „Chaos" die Gesamttiefe.', onclick: () => { C().on = !C().on; app.commit(); el.refresh(); app.refreshPart('bay'); } });
  const cv = h('canvas', { class: 'chaos-cv', 'data-help': 'Live: die Zufallskanäle des Modulators. Jede Linie ist ein Parameter.' });
  const D = Object.fromEntries(CHAOS_DEFS.map((d) => [d.k, d]));
  const helps = {
    depth: 'Tiefe — wie weit die Zufallswerte die gezeichneten Werte verschieben.',
    rate: 'Rate — alle wie viele Steps ein neuer Zufallswert entsteht.',
    prob: 'Chance — Wahrscheinlichkeit, dass beim Takt überhaupt ein neuer Wert gezogen wird.',
    rand: 'Zufall — wie weit der neue Wert vom vorigen springt (0 = bleibt, 1 = völlig frei).',
    shape: 'Form — Übergang zwischen den Werten: Stufe · Linear · Glatt · Exponentiell (stufenlos).',
    lock: 'Lock — Wahrscheinlichkeit, eine Phrase aus der Loop-Länge zu wiederholen statt neu zu würfeln (wie eine Turing Machine).',
    loop: 'Loop — Länge der Phrase, die Lock wiederholt.',
  };
  const ks = CHAOS_DEFS.map((d) => { const k = knob(d, () => C()[d.k], (v) => set(d.k, v), { small: true }); k.dataset.help = helps[d.k]; return k; });
  const mode = h('div', { class: 'seg mini', 'data-help': 'Relativ: Zufall um die gezeichneten Werte herum. Absolut: Zufall ersetzt die Werte (ab 50 % Tiefe auch Auswahl-Parameter).' },
    [['rel', 'RELATIV'], ['abs', 'ABSOLUT']].map(([v, l]) => h('button', { 'data-v': v, onclick: () => { set('mode', v); el.refresh(); } }, l)));
  const seed = diceBtn('', 'Neuer Seed: neue Zufallsfolge.', () => { C().seed = (Math.random() * 1e9) | 0; app.commit(); });
  const targets = h('div', { class: 'targets' });
  const el = h('section', { class: 'mod chaos', 'data-help': 'Chaos — Zufallsmodulator für jeden Parameter jedes Steps, angelehnt an VCV Random.' },
    h('header', { class: 'mh' }, h('span', { class: 'mtitle' }, 'CHAOS'), mode, seed, sw),
    cv,
    h('div', { class: 'prow tight' }, ks),
    targets,
    h('div', { class: 'rowline' },
      h('button', { class: 'btn', 'data-help': 'Alle Reihen als Ziel.', onclick: () => { C().targets = ['gate', ...LAYERS.map((l) => l.id)]; app.commit(); el.refresh(); } }, 'Alle'),
      h('button', { class: 'btn', 'data-help': 'Keine Ziele.', onclick: () => { C().targets = []; app.commit(); el.refresh(); } }, 'Keine'),
      h('button', { class: 'btn hot', 'data-help': 'Unendlich: alle Reihen (außer den CPU-hungrigen Delay/Reverb pro Step — einzeln zuschaltbar), Tiefe 100 %, neuer Wert auf jedem Step: jeder Parameter jedes Steps ändert sich ständig.', onclick: () => { Object.assign(C(), { on: true, depth: 1, rate: 1, prob: 1, rand: 1, shape: 0, lock: 0, mode: 'abs', targets: ['gate', ...LAYERS.map((l) => l.id).filter((id) => id !== 'rev' && id !== 'dly')] }); app.commit(); el.refresh(); app.refreshPart('bay'); } }, '∞ Unendlich')));
  el.refresh = () => {
    const c = C();
    sw.classList.toggle('on', c.on); el.classList.toggle('off', !c.on && !app.project.macros.chaos);
    ks.forEach((k) => k.update());
    mode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === c.mode));
    targets.innerHTML = '';
    const all = [{ id: 'gate', label: 'Gates', color: '#ff3b2f' }, ...LAYERS];
    for (const l of all) {
      const on = c.targets.includes(l.id);
      const b = h('button', { class: `chip${on ? ' show live' : ''}`, style: { '--lc': l.color }, 'data-help': `${l.label} als Ziel des Zufallsmodulators.`,
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
    if (!hist.length) { g.fillStyle = css('--dim'); g.font = '600 10px "Chakra Petch", sans-serif'; g.fillText('WARTET AUF WIEDERGABE', 8, H / 2 + 4); return; }
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

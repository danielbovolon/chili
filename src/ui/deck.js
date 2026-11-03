/* Chili — Deck: Transport, Laufrichtung, globale Würfel und die acht Makro-Knöpfe */
import { h, knob, diceBtn } from './dom.js';
import { DIVISIONS, LENGTHS, NOTE_NAMES, DIRECTIONS, MACRO_DEFS } from '../state/params.js';
import { noteTempo, tempoBpm } from '../state/project.js';

const PLAY = '<svg viewBox="0 0 20 20"><path d="M6.5 4.2v11.6L16 10z"/></svg>';
const STOP = '<svg viewBox="0 0 20 20"><rect x="5.5" y="5.5" width="9" height="9" rx="1"/></svg>';

export function deckView(app) {
  const t = () => app.project.transport;
  const playBtn = h('button', { class: 'play', 'data-help': 'Play / Stop — Leertaste.', onclick: () => app.togglePlay() });
  const bounce = h('button', { class: 'bounce', 'data-help': 'Bounce: Master-Ausgang als WAV-Datei aufnehmen. Nochmal klicken beendet und speichert.', onclick: () => app.toggleRec() }, h('i', {}), 'BNC');
  const modeSeg = h('div', { class: 'seg mini', 'data-help': 'Tempo in BPM, in Hz oder als Note: die Frequenz einer Note, in Oktaven auf ein spielbares Tempo gefaltet.' },
    ['bpm', 'hz', 'note'].map((m) => h('button', { 'data-m': m, onclick: () => { t().tempoMode = m; app.commit('transport'); } }, m === 'bpm' ? 'BPM' : m === 'hz' ? 'HZ' : 'NOTE')));
  const tempoBox = h('div', { class: 'tempo-in' }), derived = h('div', { class: 'derived' });
  const lcd = h('div', { class: 'lcd' }, h('div', { class: 'lcd-top' }, modeSeg), tempoBox, derived);
  const lenSeg = h('div', { class: 'seg', 'data-help': 'Länge der Sequenz in Steps.' }, LENGTHS.map((n) => h('button', { 'data-n': n, onclick: () => { t().length = n; app.commit('transport', 'stack', 'source'); } }, String(n))));
  const divSel = h('select', { class: 'sel', 'data-help': 'Notenwert eines Steps.', onchange: (e) => { t().division = e.target.value; app.commit('transport'); } }, DIVISIONS.map((d) => h('option', { value: d }, d)));
  const dirSel = h('select', { class: 'sel', 'data-help': 'Laufrichtung: vorwärts, rückwärts, Ping-Pong, Zufall, Brown (meist vorwärts, manchmal zurück) oder Sprung.', onchange: (e) => { t().direction = e.target.value; app.commit(); } }, DIRECTIONS.map(([v, l]) => h('option', { value: v }, l)));
  const swing = knob({ k: 'swing', l: 'Swing', min: 0, max: 0.5, def: 0, u: '%' }, () => t().swing, (v) => { t().swing = v; app.commit(); }, { small: true });
  const tool = (sym, help, fn) => h('button', { class: 'tbtn', 'data-help': help, onclick: fn }, sym);
  const transport = h('div', { class: 'transport' },
    h('div', { class: 'tgroup' }, playBtn, bounce),
    h('div', { class: 'tgroup' }, lcd),
    h('div', { class: 'tgroup col' }, h('span', { class: 'tlabel' }, 'Steps'), lenSeg),
    h('div', { class: 'tgroup col opt' }, h('span', { class: 'tlabel' }, 'Raster · Lauf'), h('div', { class: 'tgroup' }, divSel, dirSel)),
    h('div', { class: 'opt' }, swing),
    h('div', { class: 'grow' }),
    h('div', { class: 'tgroup col' }, h('span', { class: 'tlabel' }, 'Zufall'),
      h('div', { class: 'tgroup' },
        diceBtn('1', 'Würfel 1 — jede Reihe bekommt ein zufälliges Preset, gleich auf allen Steps. Gates bleiben.', () => app.randomAll('one'), 'big'),
        diceBtn('ALL', 'Würfel ALL — jeder Step jeder Reihe bekommt einen eigenen Zufallswert, inklusive Gates.', () => app.randomAll('all'), 'big hot'))),
    h('div', { class: 'tgroup col opt' }, h('span', { class: 'tlabel' }, 'Pattern'),
      h('div', { class: 'tgroup' },
        tool('◀', 'Ganzes Pattern einen Step nach links.', () => app.patternOp('left')),
        tool('▶', 'Ganzes Pattern einen Step nach rechts.', () => app.patternOp('right')),
        tool('×2', 'Pattern verdoppeln.', () => app.patternOp('double')),
        tool('↶', 'Rückgängig — Strg/⌘+Z.', () => app.undo()),
        tool('↷', 'Wiederholen — Strg/⌘+Shift+Z.', () => app.redo()))));
  /* Makros */
  const M = () => app.project.macros;
  const mk = MACRO_DEFS.map((d) => { const k = knob(d, () => M()[d.k], (v) => { M()[d.k] = v; app.commit(); }, { macro: true }); k.dataset.help = `${d.help} Doppelklick: neutral.`; return k; });
  const macroReset = h('button', { class: 'tbtn', 'data-help': 'Alle Makros auf neutral.', onclick: () => { app.snapshot(); MACRO_DEFS.forEach((d) => (M()[d.k] = d.def)); app.commit(); mk.forEach((k) => k.update()); } }, '⟲');
  const macros = h('div', { class: 'macros' }, h('div', { class: 'mac-l' }, h('span', { class: 'tlabel' }, 'Makro'), macroReset), h('div', { class: 'mac-k' }, mk));
  const el = h('section', { class: 'deck' }, transport, macros);
  function buildTempo() {
    tempoBox.innerHTML = ''; const tr = t();
    if (tr.tempoMode === 'bpm') tempoBox.append(numInput(tr.bpm, 20, 400, 0.01, (v) => { tr.bpm = v; app.commit('transportLite'); }));
    else if (tr.tempoMode === 'hz') tempoBox.append(numInput(tr.hz, 0.25, 6.6667, 0.0001, (v) => { tr.hz = v; app.commit('transportLite'); }));
    else tempoBox.append(
      h('select', { class: 'lcd-sel', onchange: (e) => { tr.note = e.target.value; app.commit('transportLite'); } }, NOTE_NAMES.map((n) => h('option', { value: n, selected: n === tr.note }, n))),
      h('select', { class: 'lcd-sel', onchange: (e) => { tr.octave = +e.target.value; app.commit('transportLite'); } }, [0, 1, 2, 3, 4, 5, 6, 7, 8].map((o) => h('option', { value: o, selected: o === tr.octave }, String(o)))));
  }
  el.refresh = (full) => {
    const tr = t();
    playBtn.classList.toggle('on', app.playing); playBtn.innerHTML = app.playing ? STOP : PLAY;
    bounce.classList.toggle('on', app.recording);
    modeSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === tr.tempoMode));
    lenSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.n === tr.length));
    divSel.value = tr.division; dirSel.value = tr.direction || 'fwd'; swing.update(); mk.forEach((k) => k.update());
    if (full !== false) buildTempo();
    const bpm = tempoBpm(tr, app.settings);
    if (tr.tempoMode === 'note') { const r = noteTempo(tr.note, tr.octave, app.settings.refA, app.settings.noteFloor); derived.textContent = `${r.f.toFixed(1)} HZ → ${bpm.toFixed(2)} BPM`; }
    else if (tr.tempoMode === 'hz') derived.textContent = `${bpm.toFixed(2)} BPM`;
    else derived.textContent = `${(bpm / 60).toFixed(3)} HZ`;
  };
  return el;
}
function numInput(val, min, max, step, set) {
  const inp = h('input', { type: 'number', class: 'lcd-num', value: +val.toFixed(4), min, max, step });
  inp.addEventListener('change', () => { const v = Math.min(max, Math.max(min, parseFloat(inp.value) || min)); inp.value = v; set(v); });
  inp.addEventListener('keydown', (e) => e.stopPropagation());
  inp.addEventListener('wheel', (e) => { e.preventDefault(); const v = Math.min(max, Math.max(min, (parseFloat(inp.value) || 0) - Math.sign(e.deltaY) * (e.shiftKey ? 0.1 : 1))); inp.value = +v.toFixed(4); set(v); }, { passive: false });
  return inp;
}

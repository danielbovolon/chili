/* Deck: transport, scale, play direction, TRIP and the eight macro knobs */
import { h, knob } from './dom.js';
import { DIVISIONS, LENGTHS, NOTE_NAMES, DIRECTIONS, MACRO_DEFS, SCALES } from '../state/params.js';
import { noteTempo, tempoBpm } from '../state/project.js';

const PLAY = '<svg viewBox="0 0 20 20"><path d="M6.5 4.2v11.6L16 10z"/></svg>';
const STOP = '<svg viewBox="0 0 20 20"><rect x="5.5" y="5.5" width="9" height="9" rx="1"/></svg>';
const SPIRAL = '<svg viewBox="0 0 20 20"><path d="M10 10m0 0a1.5 1.5 0 0 1 1.5 1.5a3 3 0 0 1-3 3a4.5 4.5 0 0 1-4.5-4.5a6 6 0 0 1 6-6a7.5 7.5 0 0 1 7.5 7.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

export function deckView(app) {
  const t = () => app.project.transport, SC = () => app.project.scale;
  const playBtn = h('button', { class: 'play', 'data-help': 'Play / Stop — Space.', onclick: () => app.togglePlay() });
  const bounce = h('button', { class: 'bounce', 'data-help': 'Bounce: record the master output to a WAV file. Click again to stop and save.', onclick: () => app.toggleRec() }, h('i', {}), 'BNC');
  const modeSeg = h('div', { class: 'seg mini', 'data-help': 'Tempo in BPM, in Hz, or as a note: the frequency of a note, folded by octaves into a playable tempo.' },
    ['bpm', 'hz', 'note'].map((m) => h('button', { 'data-m': m, onclick: () => { t().tempoMode = m; app.commit('transport'); } }, m === 'bpm' ? 'BPM' : m === 'hz' ? 'HZ' : 'NOTE')));
  const tempoBox = h('div', { class: 'tempo-in' }), derived = h('div', { class: 'derived' });
  const lcd = h('div', { class: 'lcd' }, h('div', { class: 'lcd-top' }, modeSeg), tempoBox, derived);
  const lenSeg = h('div', { class: 'seg', 'data-help': 'Sequence length in steps.' }, LENGTHS.map((n) => h('button', { 'data-n': n, onclick: () => { t().length = n; app.commit('transport', 'stack', 'source'); } }, String(n))));
  const divSel = h('select', { class: 'sel', 'data-help': 'Note value of one step.', onchange: (e) => { t().division = e.target.value; app.commit('transport'); } }, DIVISIONS.map((d) => h('option', { value: d }, d)));
  const dirSel = h('select', { class: 'sel', 'data-help': 'Play direction: forward, reverse, ping-pong, random, brown (mostly forward, sometimes back) or skip.', onchange: (e) => { t().direction = e.target.value; app.commit(); } }, DIRECTIONS.map(([v, l]) => h('option', { value: v }, l)));
  const swing = knob({ k: 'swing', l: 'Swing', min: 0, max: 0.5, def: 0, u: '%' }, () => t().swing, (v) => { t().swing = v; app.commit(); }, { small: true });
  swing.dataset.help = 'Swing: delays every second step.';
  /* Scale — like "Use Current Scale" in Ableton's devices: every pitch is snapped at trigger time */
  const rootSel = h('select', { class: 'sel', 'data-help': 'Scale root.', onchange: (e) => { SC().root = +e.target.value; app.commit(); } }, NOTE_NAMES.map((n, i) => h('option', { value: i }, n)));
  const scaleSel = h('select', { class: 'sel scale-sel', 'data-help': 'Scale: every pitch — drawn, rolled, TRIP, chaos, warp — is snapped to it when the step plays. Off = free, Chromatic = semitones, Quarter-tone = 24-TET for experimental tunings.', onchange: (e) => { SC().scale = e.target.value; app.commit(); el.refresh(false); } }, SCALES.map(([v, l]) => h('option', { value: v }, l)));
  const degree = knob({ k: 'shift', l: 'Degree', min: -14, max: 14, def: 0, u: 'int', int: true }, () => SC().shift, (v) => { SC().shift = v; app.commit(); }, { small: true });
  degree.dataset.help = 'Degree: transposes the whole sequence by scale steps, staying in key (like the arpeggiator\'s transpose in key).';
  const transport = h('div', { class: 'transport' },
    h('div', { class: 'tgroup' }, playBtn, bounce),
    h('div', { class: 'tgroup' }, lcd),
    h('div', { class: 'tgroup col' }, h('span', { class: 'tlabel' }, 'Steps'), lenSeg),
    h('div', { class: 'tgroup col opt' }, h('span', { class: 'tlabel' }, 'Grid · Direction'), h('div', { class: 'tgroup' }, divSel, dirSel)),
    h('div', { class: 'opt' }, swing),
    h('div', { class: 'tgroup col scale' }, h('span', { class: 'tlabel' }, 'Scale'), h('div', { class: 'tgroup' }, rootSel, scaleSel)),
    h('div', { class: 'opt' }, degree),
    h('div', { class: 'grow' }),
    h('button', { class: 'trip', 'data-help': 'TRIP — builds a psychedelic sequence: slow phaser/flanger sweeps, tape wobble, shimmer delay, big spaces, orbiting voices, looping filter shapes, granular clouds and a gentle chaos drift. Every roll is different; Ctrl/⌘+Z takes it back.', onclick: () => app.trip() }, h('span', { html: SPIRAL }), 'TRIP'));
  /* Macros */
  const M = () => app.project.macros;
  const mk = MACRO_DEFS.map((d) => { const k = knob(d, () => M()[d.k], (v) => {
    M()[d.k] = v; const P = app.project;
    // "vice versa": a macro that needs a switched-off module switches it on
    if (d.k === 'chaos' && v > 0 && !P.chaos.on) { P.chaos.on = true; app.refreshPart('special'); }
    if (d.k === 'space' && v > 0.5 && (!P.master.delay.on || !P.master.verb.on)) { P.master.delay.on = true; P.master.verb.on = true; app.refreshPart('master'); }
    app.commit(); }, { macro: true }); k.dataset.help = `${d.help} Double-click: neutral.`; return k; });
  const macroReset = h('button', { class: 'tbtn', 'data-help': 'All macros back to neutral.', onclick: () => { app.snapshot(); MACRO_DEFS.forEach((d) => (M()[d.k] = d.def)); app.commit(); mk.forEach((k) => k.update()); } }, '⟲');
  const macros = h('div', { class: 'macros' }, h('div', { class: 'mac-l' }, h('span', { class: 'tlabel' }, 'Macro'), macroReset), h('div', { class: 'mac-k' }, mk));
  transport.insertBefore(macros, transport.querySelector('.grow'));
  const el = h('section', { class: 'deck' }, transport);
  function buildTempo() {
    tempoBox.innerHTML = ''; const tr = t();
    if (tr.tempoMode === 'bpm') tempoBox.append(numInput(tr.bpm, 20, 400, 0.01, (v) => { tr.bpm = v; app.commit('transportLite'); }));
    else if (tr.tempoMode === 'hz') tempoBox.append(numInput(tr.hz, 0.25, 6.6667, 0.0001, (v) => { tr.hz = v; app.commit('transportLite'); }));
    else tempoBox.append(
      h('select', { class: 'lcd-sel', onchange: (e) => { tr.note = e.target.value; app.commit('transportLite'); } }, NOTE_NAMES.map((n) => h('option', { value: n, selected: n === tr.note }, n))),
      h('select', { class: 'lcd-sel', onchange: (e) => { tr.octave = +e.target.value; app.commit('transportLite'); } }, [0, 1, 2, 3, 4, 5, 6, 7, 8].map((o) => h('option', { value: o, selected: o === tr.octave }, String(o)))));
  }
  el.refresh = (full) => {
    const tr = t(), sc = SC();
    playBtn.classList.toggle('on', app.playing); playBtn.innerHTML = app.playing ? STOP : PLAY;
    bounce.classList.toggle('on', app.recording);
    modeSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === tr.tempoMode));
    lenSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.n === tr.length));
    divSel.value = tr.division; dirSel.value = tr.direction || 'fwd'; swing.update(); mk.forEach((k) => k.update());
    rootSel.value = String(sc.root); scaleSel.value = sc.scale; degree.update();
    scaleSel.classList.toggle('on', sc.scale !== 'off'); rootSel.disabled = sc.scale === 'off'; degree.classList.toggle('dis', sc.scale === 'off');
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

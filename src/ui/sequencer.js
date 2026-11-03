/* Chili — Transportleiste und Sample-Leiste */
import { h, knob } from './dom.js';
import { DIVISIONS, LENGTHS, NOTE_NAMES } from '../state/params.js';
import { noteTempo, tempoBpm } from '../state/project.js';

const PLAY = '<svg viewBox="0 0 20 20"><path d="M6.5 4.2v11.6L16 10z"/></svg>';
const STOP = '<svg viewBox="0 0 20 20"><rect x="5.5" y="5.5" width="9" height="9" rx="1.2"/></svg>';

/* ================================================================ TRANSPORT */
export function transportView(app) {
  const t = () => app.project.transport;
  const playBtn = h('button', { class: 'play', 'data-help': 'Play / Stop — Leertaste.', onclick: () => app.togglePlay() });
  const bounce = h('button', { class: 'bounce', 'data-help': 'Bounce: Master-Ausgang als WAV-Datei aufnehmen. Nochmal klicken beendet und speichert.', onclick: () => app.toggleRec() }, h('i', {}), 'Bounce');
  const modeSeg = h('div', { class: 'seg', 'data-help': 'Tempo in BPM, in Hz (Steps pro Sekunde ÷ 4) oder als Note: die Frequenz einer Note, in Oktaven auf ein spielbares Tempo gefaltet.' },
    ['bpm', 'hz', 'note'].map((m) => h('button', { 'data-m': m, onclick: () => { t().tempoMode = m; app.commit('transport'); } }, m === 'bpm' ? 'BPM' : m === 'hz' ? 'Hz' : 'Note')));
  const tempoBox = h('div', { class: 'tempo-in' });
  const derived = h('div', { class: 'derived' });
  const lcd = h('div', { class: 'lcd' }, tempoBox, derived);
  const lenSeg = h('div', { class: 'seg', 'data-help': 'Länge der Sequenz in Steps.' }, LENGTHS.map((n) => h('button', { 'data-n': n, onclick: () => { t().length = n; app.commit('transport', 'stack'); } }, String(n))));
  const divSel = h('select', { class: 'sel', 'data-help': 'Notenwert eines Steps.', onchange: (e) => { t().division = e.target.value; app.commit('transport'); } }, DIVISIONS.map((d) => h('option', { value: d }, d)));
  const swing = knob({ k: 'swing', l: 'Swing', min: 0, max: 0.5, def: 0, u: '%' }, () => t().swing, (v) => { t().swing = v; app.commit(); }, { small: true });
  swing.dataset.help = 'Swing: verzögert jeden zweiten Step.';
  const tool = (sym, help, fn) => h('button', { class: 'tbtn', 'data-help': help, onclick: fn }, sym);
  const el = h('section', { class: 'transport' },
    h('div', { class: 'tgroup' }, playBtn, bounce),
    h('div', { class: 'tsep' }),
    h('div', { class: 'tgroup' }, modeSeg, lcd),
    h('div', { class: 'tsep' }),
    h('div', { class: 'tgroup' }, h('span', { class: 'tlabel' }, 'Steps'), lenSeg),
    h('div', { class: 'tgroup' }, h('span', { class: 'tlabel' }, 'Raster'), divSel, swing),
    h('div', { class: 'grow' }),
    h('div', { class: 'tgroup tools' },
      tool('✦', 'Ganzes Pattern würfeln: Gates, Slices, Pitch, Filter, Pan und etwas Mutate.', () => app.patternOp('rnd')),
      tool('◀', 'Ganzes Pattern (alle Lanes) einen Step nach links.', () => app.patternOp('left')),
      tool('▶', 'Ganzes Pattern (alle Lanes) einen Step nach rechts.', () => app.patternOp('right')),
      tool('×2', 'Pattern verdoppeln: Steps 1…n werden kopiert, Länge ×2.', () => app.patternOp('double')),
      tool('↶', 'Rückgängig — Strg/⌘+Z.', () => app.undo()),
      tool('↷', 'Wiederholen — Strg/⌘+Shift+Z.', () => app.redo())));
  function buildTempo() {
    tempoBox.innerHTML = ''; const tr = t();
    if (tr.tempoMode === 'bpm') tempoBox.append(numInput(tr.bpm, 20, 400, 0.01, (v) => { tr.bpm = v; app.commit('transportLite'); }, 'BPM'));
    else if (tr.tempoMode === 'hz') tempoBox.append(numInput(tr.hz, 0.25, 6.6667, 0.0001, (v) => { tr.hz = v; app.commit('transportLite'); }, 'Hz'));
    else tempoBox.append(
      h('select', { class: 'sel lcd-sel', onchange: (e) => { tr.note = e.target.value; app.commit('transportLite'); } }, NOTE_NAMES.map((n) => h('option', { value: n, selected: n === tr.note }, n))),
      h('select', { class: 'sel lcd-sel', onchange: (e) => { tr.octave = +e.target.value; app.commit('transportLite'); } }, [0, 1, 2, 3, 4, 5, 6, 7, 8].map((o) => h('option', { value: o, selected: o === tr.octave }, String(o)))));
  }
  el.refresh = (full) => {
    const tr = t();
    playBtn.classList.toggle('on', app.playing); playBtn.innerHTML = app.playing ? STOP : PLAY;
    bounce.classList.toggle('on', app.recording);
    modeSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === tr.tempoMode));
    lenSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.n === tr.length));
    divSel.value = tr.division; swing.update();
    if (full !== false) buildTempo();
    const bpm = tempoBpm(tr, app.settings);
    if (tr.tempoMode === 'note') { const r = noteTempo(tr.note, tr.octave, app.settings.refA, app.settings.noteFloor); derived.textContent = `${r.f.toFixed(2)} Hz → ${bpm.toFixed(3)} BPM`; }
    else if (tr.tempoMode === 'hz') derived.textContent = `${bpm.toFixed(2)} BPM`;
    else derived.textContent = `${(bpm / 60).toFixed(4)} Hz`;
  };
  return el;
}
function numInput(val, min, max, step, set, unit) {
  const inp = h('input', { type: 'number', class: 'lcd-num', value: +val.toFixed(4), min, max, step });
  inp.addEventListener('change', () => { const v = Math.min(max, Math.max(min, parseFloat(inp.value) || min)); inp.value = v; set(v); });
  inp.addEventListener('keydown', (e) => e.stopPropagation());
  inp.addEventListener('wheel', (e) => { e.preventDefault(); const v = Math.min(max, Math.max(min, (parseFloat(inp.value) || 0) - Math.sign(e.deltaY) * (e.shiftKey ? 0.1 : 1))); inp.value = +v.toFixed(4); set(v); }, { passive: false });
  return h('div', { class: 'numwrap' }, inp, h('span', { class: 'unit' }, unit));
}

/* ================================================================ SAMPLE-LEISTE */
export function sourceView(app) {
  const fileIn = h('input', { type: 'file', accept: 'audio/*', multiple: true, style: { display: 'none' }, onchange: (e) => { app.importFiles([...e.target.files]); e.target.value = ''; } });
  const sampleSel = h('select', { class: 'sel grow', 'data-help': 'Angezeigtes Sample. Die Slice-Lane kann Slices aus allen Samples des Projekts verwenden.', onchange: (e) => { app.viewSample = e.target.value; el.refresh(); } });
  const modeSel = h('select', { class: 'sel', 'data-help': 'Slicing: gleichmäßig oder an den Transienten.' }, h('option', { value: 'equal' }, 'Gleichmäßig'), h('option', { value: 'trans' }, 'Transienten'));
  const countSel = h('select', { class: 'sel', 'data-help': 'Anzahl Slices.' }, ['steps', 4, 8, 16, 32].map((n) => h('option', { value: n }, n === 'steps' ? '= Steps' : `${n}`)));
  const sens = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: 0.5, class: 'range', 'data-help': 'Empfindlichkeit der Transienten-Erkennung.' });
  const canvas = h('canvas', { class: 'wave' });
  const name = h('span', { class: 'wname' });
  const drop = h('div', { class: 'wave-wrap', 'data-help': 'Audio hierher ziehen (WAV, AIFF, MP3, FLAC, OGG). Ohne Sample spielt die Synth-Engine.' }, canvas, h('div', { class: 'wave-empty' }, '＋'));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); app.importFiles([...e.dataTransfer.files].filter((f) => f.type.startsWith('audio') || /\.(wav|aif|aiff|mp3|flac|ogg|m4a)$/i.test(f.name))); });
  drop.addEventListener('click', () => { if (!app.viewSample) fileIn.click(); });
  const el = h('section', { class: 'panel samplebar' },
    h('div', { class: 'sb-l' },
      h('div', { class: 'ptitle' }, 'Sample'),
      h('div', { class: 'sb-btns' },
        h('button', { class: 'btn accent', 'data-help': 'Audiodateien importieren — werden automatisch auf die Steps gesliced.', onclick: () => fileIn.click() }, 'Import'),
        h('button', { class: 'btn recbtn', 'data-help': 'Aufnahme: Eingang oder Master direkt als neues Sample aufnehmen.', onclick: () => app.toggleRecorder() }, h('i', {}), 'Rec')),
      fileIn),
    h('div', { class: 'sb-c' }, drop),
    h('div', { class: 'sb-r' }, sampleSel, h('div', { class: 'sb-row' }, modeSel, countSel), h('div', { class: 'sb-row' }, sens,
      h('button', { class: 'btn', 'data-help': 'Angezeigtes Sample neu slicen und auf die Steps legen.', onclick: () => app.reslice(app.viewSample, modeSel.value, countSel.value, +sens.value) }, 'Slicen'),
      h('button', { class: 'btn ghost', 'data-help': 'Sample aus dem Projekt entfernen.', onclick: () => app.removeSample(app.viewSample) }, '✕'))));
  function draw() {
    const dpr = devicePixelRatio || 1, w = canvas.clientWidth, hh = canvas.clientHeight;
    if (!w) return;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr); }
    const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, hh);
    const id = app.viewSample, pk = id && app.peaks.get(id);
    drop.classList.toggle('empty', !pk);
    if (!pk) return;
    const css = getComputedStyle(document.documentElement), P = app.project, L = P.transport.length;
    const used = new Set(P.steps.slice(0, L).filter((s) => s.on && s.source !== 'synth').map((s) => s.slice));
    P.slices.forEach((s, i) => {
      if (s.sampleId !== id) return;
      const x0 = s.a * w, x1 = s.b * w;
      if (i === app.hoverSlice) { c.fillStyle = 'rgba(255,179,107,0.22)'; c.fillRect(x0, 0, x1 - x0, hh); }
      else if (used.has(i)) { c.fillStyle = 'rgba(255,179,107,0.07)'; c.fillRect(x0, 0, x1 - x0, hh); }
      c.fillStyle = css.getPropertyValue('--line').trim(); c.fillRect(Math.round(x0), 0, 1, hh);
      c.fillStyle = i === app.hoverSlice ? '#ffb36b' : css.getPropertyValue('--dim').trim(); c.font = '600 9px JetBrains Mono, monospace'; c.fillText(String(i + 1), x0 + 3, 10);
    });
    const n = pk.mn.length, mid = hh / 2 + 4, amp = (hh - 14) / 2;
    c.fillStyle = css.getPropertyValue('--wave').trim();
    for (let x = 0; x < w; x++) {
      const i = Math.floor((x / w) * n), y0 = mid - pk.mx[i] * amp, y1 = mid - pk.mn[i] * amp;
      c.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
  }
  el.draw = draw;
  el.refresh = () => {
    const ss = app.project.samples;
    if (!ss.find((s) => s.id === app.viewSample)) app.viewSample = ss[0] ? ss[0].id : null;
    sampleSel.innerHTML = '';
    if (!ss.length) sampleSel.append(h('option', {}, 'kein Sample'));
    ss.forEach((s) => sampleSel.append(h('option', { value: s.id, selected: s.id === app.viewSample }, s.name)));
    sampleSel.disabled = !ss.length; name.textContent = '';
    draw();
  };
  new ResizeObserver(() => draw()).observe(canvas);
  return el;
}

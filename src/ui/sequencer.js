/* Chili — Sequencer-Ansicht: Transport, Quelle/Wellenform, Step-Grid, Step-Editor */
import { h, paramRow, knob, select } from './dom.js';
import { STEP_GROUPS, DIVISIONS, LENGTHS, NOTE_NAMES, noteName, fmt } from '../state/params.js';
import { noteTempo, tempoBpm, randomizeStep, resetStep } from '../state/project.js';

/* ================================================================ TRANSPORT */
export function transportView(app) {
  const t = () => app.project.transport;
  const playBtn = h('button', { class: 'play', title: 'Play/Stop (Leertaste)', onclick: () => app.togglePlay() });
  const recBtn = h('button', { class: 'rec', title: 'Master-Ausgang aufnehmen (WAV)', onclick: () => app.toggleRec() }, h('span', { class: 'rec-dot' }), 'Bounce');
  const modeSeg = h('div', { class: 'seg' }, ['bpm', 'hz', 'note'].map((m) => h('button', { 'data-m': m, onclick: () => { t().tempoMode = m; app.commit('transport'); } }, m === 'bpm' ? 'BPM' : m === 'hz' ? 'Hz' : 'Note')));
  const tempoBox = h('div', { class: 'tempo-box' });
  const derived = h('div', { class: 'derived' });
  const lenSeg = h('div', { class: 'seg' }, LENGTHS.map((n) => h('button', { 'data-n': n, onclick: () => { t().length = n; app.commit('transport', 'grid'); } }, String(n))));
  const divSel = h('select', { class: 'sel', onchange: (e) => { t().division = e.target.value; app.commit('transport'); } }, DIVISIONS.map((d) => h('option', { value: d }, d)));
  const swing = knob({ k: 'swing', l: 'Swing', min: 0, max: 0.5, def: 0, u: '%' }, () => t().swing, (v) => { t().swing = v; app.commit(); }, { small: true });
  const el = h('section', { class: 'transport' },
    h('div', { class: 'tgroup' }, playBtn, recBtn),
    h('div', { class: 'tgroup' }, h('span', { class: 'tlabel' }, 'Tempo'), modeSeg, tempoBox, derived),
    h('div', { class: 'tgroup' }, h('span', { class: 'tlabel' }, 'Steps'), lenSeg),
    h('div', { class: 'tgroup' }, h('span', { class: 'tlabel' }, 'Raster'), divSel, swing),
  );
  function buildTempo() {
    tempoBox.innerHTML = ''; const tr = t();
    if (tr.tempoMode === 'bpm') {
      tempoBox.append(numInput(tr.bpm, 20, 400, 0.01, (v) => { tr.bpm = v; app.commit('transportLite'); }, 'BPM'));
    } else if (tr.tempoMode === 'hz') {
      tempoBox.append(numInput(tr.hz, 0.25, 6.6667, 0.0001, (v) => { tr.hz = v; app.commit('transportLite'); }, 'Hz'));
    } else {
      tempoBox.append(
        h('select', { class: 'sel', onchange: (e) => { tr.note = e.target.value; app.commit('transportLite'); } }, NOTE_NAMES.map((n) => h('option', { value: n, selected: n === tr.note }, n))),
        h('select', { class: 'sel', onchange: (e) => { tr.octave = +e.target.value; app.commit('transportLite'); } }, [0, 1, 2, 3, 4, 5, 6, 7, 8].map((o) => h('option', { value: o, selected: o === tr.octave }, String(o)))),
      );
    }
  }
  el.refresh = (full) => {
    const tr = t();
    playBtn.classList.toggle('on', app.playing); playBtn.innerHTML = app.playing ? '<svg viewBox="0 0 20 20"><rect x="5" y="5" width="10" height="10" rx="1.5"/></svg>' : '<svg viewBox="0 0 20 20"><path d="M6 4l10 6-10 6z"/></svg>';
    recBtn.classList.toggle('on', app.recording);
    modeSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === tr.tempoMode));
    lenSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.n === tr.length));
    divSel.value = tr.division; swing.update();
    if (full !== false) buildTempo();
    const bpm = tempoBpm(tr, app.settings);
    if (tr.tempoMode === 'note') { const r = noteTempo(tr.note, tr.octave, app.settings.refA, app.settings.noteFloor); derived.textContent = `${tr.note}${tr.octave} = ${r.f.toFixed(2)} Hz → ÷2^${r.k} → ${bpm.toFixed(3)} BPM`; }
    else if (tr.tempoMode === 'hz') derived.textContent = `= ${bpm.toFixed(2)} BPM`;
    else derived.textContent = `= ${(bpm / 60).toFixed(4)} Hz`;
  };
  return el;
}
function numInput(val, min, max, step, set, unit) {
  const inp = h('input', { type: 'number', class: 'num', value: +val.toFixed(4), min, max, step });
  inp.addEventListener('change', () => { const v = Math.min(max, Math.max(min, parseFloat(inp.value) || min)); inp.value = v; set(v); });
  inp.addEventListener('keydown', (e) => e.stopPropagation());
  inp.addEventListener('wheel', (e) => { e.preventDefault(); const v = Math.min(max, Math.max(min, (parseFloat(inp.value) || 0) - Math.sign(e.deltaY) * (e.shiftKey ? 0.1 : 1))); inp.value = +v.toFixed(4); set(v); }, { passive: false });
  return h('div', { class: 'numwrap' }, inp, h('span', { class: 'unit' }, unit));
}

/* ================================================================ QUELLE / WELLENFORM */
export function sourceView(app) {
  const fileIn = h('input', { type: 'file', accept: 'audio/*', multiple: true, style: { display: 'none' }, onchange: (e) => { app.importFiles([...e.target.files]); e.target.value = ''; } });
  const sampleSel = h('select', { class: 'sel grow', onchange: (e) => { app.viewSample = e.target.value; el.refresh(); } });
  const modeSel = h('select', { class: 'sel' }, h('option', { value: 'equal' }, 'Gleichmäßig'), h('option', { value: 'trans' }, 'Transienten'));
  const countSel = h('select', { class: 'sel' }, ['steps', 4, 8, 16, 32].map((n) => h('option', { value: n }, n === 'steps' ? '= Steps' : `${n}`)));
  const sens = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: 0.5, class: 'range', title: 'Empfindlichkeit (Transienten)' });
  const canvas = h('canvas', { class: 'wave' });
  const drop = h('div', { class: 'wave-wrap' }, canvas, h('div', { class: 'wave-empty' }, h('strong', {}, 'Audio hierher ziehen'), h('span', {}, 'oder „Import" — WAV, AIFF, MP3, FLAC, OGG. Ohne Sample spielt die Synth-Engine.')));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); app.importFiles([...e.dataTransfer.files].filter((f) => f.type.startsWith('audio') || /\.(wav|aif|aiff|mp3|flac|ogg|m4a)$/i.test(f.name))); });
  canvas.addEventListener('click', (e) => {
    const id = app.viewSample; if (!id) return;
    const r = canvas.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
    const idx = app.project.slices.findIndex((s) => s.sampleId === id && x >= s.a && x < s.b);
    if (idx >= 0) { app.forSel((s) => { s.slice = idx; s.source = 'sample'; }); app.commit('grid', 'editor'); app.auditionSel(); }
  });
  const el = h('section', { class: 'card source' },
    h('header', { class: 'card-h' }, h('h3', {}, 'Quelle'),
      h('div', { class: 'tools' },
        h('button', { class: 'btn accent', onclick: () => fileIn.click() }, '＋ Import'), sampleSel, modeSel, countSel, sens,
        h('button', { class: 'btn', title: 'Aktuelles Sample neu slicen und Steps zuweisen', onclick: () => app.reslice(app.viewSample, modeSel.value, countSel.value, +sens.value) }, 'Slicen'),
        h('button', { class: 'btn ghost', title: 'Sample aus Projekt entfernen', onclick: () => app.removeSample(app.viewSample) }, '✕')),
      fileIn),
    drop);
  function draw() {
    const dpr = devicePixelRatio || 1, w = canvas.clientWidth, hh = canvas.clientHeight;
    if (!w) return;
    canvas.width = w * dpr; canvas.height = hh * dpr;
    const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, hh);
    const id = app.viewSample, pk = id && app.peaks.get(id);
    drop.classList.toggle('empty', !pk);
    if (!pk) return;
    const css = getComputedStyle(document.documentElement);
    const focusStep = app.project.steps[app.focus], fSlice = focusStep && focusStep.source !== 'synth' ? focusStep.slice : -1;
    app.project.slices.forEach((s, i) => {
      if (s.sampleId !== id) return;
      const x0 = s.a * w, x1 = s.b * w;
      if (i === fSlice) { c.fillStyle = css.getPropertyValue('--sel-fill'); c.fillRect(x0, 0, x1 - x0, hh); }
      c.fillStyle = css.getPropertyValue('--line'); c.fillRect(Math.round(x0), 0, 1, hh);
      c.fillStyle = css.getPropertyValue('--muted'); c.font = '10px JetBrains Mono, monospace'; c.fillText(String(i + 1), x0 + 4, 12);
    });
    const n = pk.mn.length, mid = hh / 2;
    c.fillStyle = css.getPropertyValue('--wave');
    for (let x = 0; x < w; x++) {
      const i = Math.floor((x / w) * n), y0 = mid - pk.mx[i] * mid * 0.92, y1 = mid - pk.mn[i] * mid * 0.92;
      c.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
  }
  el.refresh = () => {
    const ss = app.project.samples;
    if (!ss.find((s) => s.id === app.viewSample)) app.viewSample = ss[0] ? ss[0].id : null;
    sampleSel.innerHTML = ''; ss.forEach((s) => sampleSel.append(h('option', { value: s.id, selected: s.id === app.viewSample }, s.name)));
    sampleSel.disabled = !ss.length;
    draw();
  };
  new ResizeObserver(() => draw()).observe(canvas);
  return el;
}

/* ================================================================ STEP-GRID */
export function gridView(app) {
  const grid = h('div', { class: 'grid' });
  const info = h('div', { class: 'grid-info' });
  const el = h('section', { class: 'card gridcard' },
    h('header', { class: 'card-h' }, h('h3', {}, 'Steps'), info,
      h('div', { class: 'tools' },
        h('button', { class: 'btn', title: 'Alle Steps an/aus', onclick: () => { const L = app.project.transport.length, any = app.project.steps.slice(0, L).some((s) => s.on); app.project.steps.slice(0, L).forEach((s) => (s.on = !any)); app.commit('grid'); } }, 'Alle an/aus'),
        h('button', { class: 'btn', title: 'Auswahl: zufällige, musikalische Variation', onclick: () => { app.forSel((s) => randomizeStep(s, app.project.slices.length)); app.commit('grid', 'editor'); } }, '✦ Würfeln'),
        h('button', { class: 'btn', title: 'Steps 1…n in die zweite Hälfte kopieren', onclick: () => app.doubleLength() }, '×2'))),
    grid);
  let pads = [];
  el.refresh = () => {
    const p = app.project, L = p.transport.length;
    grid.className = `grid len${L}`; grid.innerHTML = ''; pads = [];
    for (let i = 0; i < L; i++) {
      const s = p.steps[i];
      const led = h('span', { class: 'led', title: 'An/Aus', onpointerdown: (e) => { e.stopPropagation(); s.on = !s.on; app.commit('grid'); } });
      const badges = h('span', { class: 'badges' });
      if (s.mutate > 0) badges.append(h('i', { class: 'b-mut', title: 'Mutate' }, 'M'));
      if (s.fType !== 'off') badges.append(h('i', { class: 'b-flt', title: 'Filter' }, s.fEnvShape === 'random' || String(s.fEnvShape).startsWith('rnd') || s.fEnvShape === 'chaos' ? '~' : 'F'));
      if (s.phaserMix + s.flangerMix + s.chorusMix + s.delayMix + s.verbMix + s.tremDepth + s.pmDepth > 0) badges.append(h('i', { class: 'b-fx', title: 'Effekte' }, 'FX'));
      if (s.panRnd > 0 || s.panModDepth > 0 || s.autopan > 0) badges.append(h('i', { class: 'b-pan', title: 'Pan-Modulation' }, '↔'));
      const label = s.source === 'synth' ? noteName(s.note + s.pitch) : p.slices.length ? `S${(s.slice | 0) + 1}${s.pitch ? (s.pitch > 0 ? '+' : '') + s.pitch : ''}` : '—';
      const panBar = h('span', { class: 'panbar' }, h('span', { style: { left: `${50 + s.pan * 45}%` } }));
      const pad = h('div', { class: `pad${s.on ? ' on' : ''}${app.sel.has(i) ? ' sel' : ''}${i === app.focus ? ' focus' : ''}${s.source === 'synth' ? ' synth' : ''}`, 'data-i': i,
        onpointerdown: (e) => app.selectStep(i, e) },
        h('div', { class: 'pad-top' }, led, h('span', { class: 'num' }, String(i + 1)), badges),
        h('div', { class: 'pad-label' }, label), panBar,
        h('div', { class: 'gain', style: { height: `${Math.max(0, Math.min(1, (s.gain + 48) / 54)) * 100}%` } }));
      if (i % 4 === 0) pad.classList.add('beat');
      grid.append(pad); pads.push(pad);
    }
    info.textContent = app.sel.size > 1 ? `${app.sel.size} ausgewählt · Shift/Strg-Klick für Mehrfachauswahl` : 'Klick: wählen · Alt-Klick: vorhören · Shift/Strg: Mehrfachauswahl';
  };
  el.setPlayhead = (i) => { pads.forEach((pd, j) => pd.classList.toggle('now', j === i)); };
  el.flash = (i, cls) => { const pd = pads[i]; if (!pd) return; pd.classList.remove(cls); void pd.offsetWidth; pd.classList.add(cls); };
  return el;
}

/* ================================================================ STEP-EDITOR */
export function editorView(app) {
  let tab = 'src';
  const tabs = h('nav', { class: 'tabs' }), body = h('div', { class: 'ed-body' }), title = h('h3', {});
  const el = h('section', { class: 'card editor' },
    h('header', { class: 'card-h' }, title,
      h('div', { class: 'tools' },
        h('button', { class: 'btn accent', onclick: () => app.auditionSel() }, '▶ Vorhören'),
        h('button', { class: 'btn', title: 'Strg+C', onclick: () => app.copyStep() }, 'Kopieren'),
        h('button', { class: 'btn', title: 'Strg+V', onclick: () => app.pasteStep() }, 'Einfügen'),
        h('button', { class: 'btn', onclick: () => { app.forSel((s) => randomizeStep(s, app.project.slices.length)); app.commit('grid', 'editor'); } }, '✦ Würfeln'),
        h('button', { class: 'btn', onclick: () => { app.forSel((s) => resetStep(s)); app.commit('grid', 'editor'); } }, 'Reset'),
        h('button', { class: 'btn', title: 'Aktuellen Tab des fokussierten Steps auf alle Steps übertragen', onclick: () => app.applyTabToAll(STEP_GROUPS.find((g) => g.id === tab)) }, 'Tab → alle'))),
    tabs, body);
  let rows = [];
  el.refresh = () => {
    const p = app.project, f = p.steps[app.focus];
    title.textContent = app.sel.size > 1 ? `${app.sel.size} Steps` : `Step ${app.focus + 1}`;
    tabs.innerHTML = '';
    STEP_GROUPS.forEach((g) => tabs.append(h('button', { class: g.id === tab ? 'on' : '', onclick: () => { tab = g.id; el.refresh(); } }, g.label)));
    body.innerHTML = ''; rows = [];
    const g = STEP_GROUPS.find((x) => x.id === tab);
    const isMixed = (k) => { if (app.sel.size < 2) return false; const v = f[k]; for (const i of app.sel) if (p.steps[i][k] !== v) return true; return false; };
    for (const sec of g.sections) {
      if (sec.when && !sec.when(f)) continue;
      const row = paramRow(sec.params, (k) => f[k], (k, v) => {
        app.forSel((s) => { s[k] = v; });
        app.commit(k === 'source' ? 'editor' : null, 'grid');
        if (k === 'slice') app.refreshPart('source');
        if (k === 'source') app.refreshPart('source');
      }, { dynMax: () => Math.max(0, p.slices.length - 1), isMixed });
      rows.push(row);
      body.append(h('div', { class: 'ed-sec' }, h('h4', {}, sec.title), row));
    }
    if (tab === 'flt') body.append(shapePreview(f));
  };
  el.soft = () => rows.forEach((r) => r.refresh());
  return el;
}

/** Kleine Vorschau der Filter-Hüllkurvenform */
function shapePreview(s) {
  const c = h('canvas', { class: 'shape-prev', width: 240, height: 60 });
  requestAnimationFrame(() => {
    const g = c.getContext('2d'), w = 240, hh = 60; g.clearRect(0, 0, w, hh);
    const css = getComputedStyle(document.documentElement);
    g.strokeStyle = css.getPropertyValue('--accent'); g.lineWidth = 2; g.beginPath();
    const rnd = s.fEnvShape === 'random' || s.fEnvShape.startsWith('rnd') || s.fEnvShape === 'chaos';
    const pts = Array.from({ length: 16 }, () => Math.random());
    for (let x = 0; x <= w; x++) {
      const t = x / w; let v;
      switch (s.fEnvShape) {
        case 'decay': v = Math.exp(-5 * t); break; case 'attack': v = 1 - Math.exp(-5 * t); break;
        case 'ad': v = t < 0.12 ? t / 0.12 : Math.exp((-4.5 * (t - 0.12)) / 0.88); break;
        case 'rampUp': v = t; break; case 'rampDown': v = 1 - t; break; case 'triangle': v = t < 0.5 ? 2 * t : 2 - 2 * t; break;
        case 'sine': v = 0.5 - 0.5 * Math.cos(2 * Math.PI * t); break; case 'square': v = t < 0.5 ? 1 : 0; break;
        default: { const q = t * 15, i = Math.min(15, q | 0); v = pts[i] + (pts[Math.min(15, i + 1)] - pts[i]) * (q - i); }
      }
      const y = hh - 6 - v * (hh - 12); x ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    if (rnd) { g.fillStyle = css.getPropertyValue('--muted'); g.font = '10px JetBrains Mono, monospace'; g.fillText('jede Auslösung neu', 6, 12); }
  });
  return h('div', { class: 'ed-sec' }, h('h4', {}, 'Form-Vorschau'), c);
}
export { fmt };

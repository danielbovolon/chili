/* Chili — App-Controller */
import { Engine } from './audio/engine.js';
import { equalSlices, transientSlices, beatSlices, autoSlices, mapSlices, peaks } from './audio/slicer.js';
import { encodeWav } from './audio/wav.js';
import { recorderView } from './ui/recorder.js';
import * as storage from './state/storage.js';
import { newProject, normalizeProject, engineState, uid, tempoBpm, randomizeStep } from './state/project.js';
import { h, CHILI_SVG, DICE } from './ui/dom.js';
import { deckView } from './ui/deck.js';
import { viewportView } from './ui/viewport.js';
import { stackView } from './ui/lanes.js';
import { bayView, chaosView } from './ui/bay.js';
import { collideView, ripView } from './ui/special.js';
import { masterFxView, filterView, outView } from './ui/master.js';
import { projectsView, settingsView } from './ui/pages.js';

const VERSION = '0.3.0';
const SETTINGS_KEY = 'chili.settings', LAST_KEY = 'chili.lastProject';
const defaultSettings = () => ({ sampleRate: 'auto', latency: 'interactive', outputDevice: '', quality: '16', maxVoices: 16, limiter: true, ceiling: -0.3, panLaw: 'm3', refA: 440, noteFloor: 70, peakHold: 1.5, exportBits: '24', dither: true, inputDevice: '', inputCh: 'stereo', recAutoComp: true, recOffset: 0, autosave: 30 });
const RESTART_KEYS = ['sampleRate', 'latency', 'outputDevice', 'quality', 'maxVoices'];
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

const app = {
  engine: new Engine(), storage,
  settings: { ...defaultSettings(), ...JSON.parse(lsGet(SETTINGS_KEY) || '{}') },
  project: newProject('Erstes Feuer'),
  hoverStep: -1, hoverSlice: -1, playStep: -1, flashes: [], undoStack: [], redoStack: [],
  buffers: new Map(), bytes: new Map(), peaks: new Map(), viewSample: null,
  page: 'seq', playing: false, recording: false, dirty: false, views: {},
  defaultSettings,
};

/* ------------------------------------------------------------------ Zustand → Engine & UI */
app.pushState = () => { if (app.engine.running) app.engine.setState(engineState(app.project, app.settings)); };
app.commit = (...parts) => {
  app.dirty = true; app.pushState(); setStatus(); if (app.views.stack) app.views.stack.markDirty();
  for (const p of parts) if (p) app.refreshPart(p);
};
app.refreshPart = (p) => {
  const v = app.views; if (!v.deck) return;
  if (p === 'transport') v.deck.refresh(true);
  if (p === 'transportLite') v.deck.refresh(false);
  if (p === 'stack' || p === 'grid' || p === 'editor') v.stack.refresh();
  if (p === 'source') v.viewport.refresh();
  if (p === 'special') { v.collide.refresh(); v.rip.refresh(); v.bay.refresh(); }
  if (p === 'master') { v.fx.refresh(); v.filter.refresh(); v.out.refresh(); }
  if (p === 'recorder') v.recorder.refresh();
  if (p === 'bay') v.bay.refresh();
  if (p === 'header') renderHeader();
};
app.refreshAll = () => ['transport', 'stack', 'source', 'recorder', 'special', 'master', 'chaos', 'header'].forEach((p) => (p === 'chaos' ? app.views.chaos && app.views.chaos.refresh() : app.refreshPart(p)));
app.stepSeconds = () => {
  const d = { '1/8': 1 / 8, '1/8T': 1 / 12, '1/16': 1 / 16, '1/16T': 1 / 24, '1/32': 1 / 32 }[app.project.transport.division];
  return (240 / tempoBpm(app.project.transport, app.settings)) * d;
};

/* ------------------------------------------------------------------ Steps, Pattern, Undo */
app.audition = (i) => { ensureAudio().then(() => { app.engine.setStateNow(engineState(app.project, app.settings)); app.engine.audition(i); }); };
const snap = () => JSON.stringify({ steps: app.project.steps, layers: app.project.layers, length: app.project.transport.length, rip: app.project.rip.on });
app.snapshot = () => { app.undoStack.push(snap()); if (app.undoStack.length > 150) app.undoStack.shift(); app.redoStack.length = 0; };
function restore(j) { const o = JSON.parse(j); app.project.steps = o.steps; app.project.layers = o.layers; app.project.transport.length = o.length; app.project.rip.on = o.rip; app.commit('transport', 'stack', 'special'); }
app.undo = () => { if (!app.undoStack.length) return; app.redoStack.push(snap()); restore(app.undoStack.pop()); };
app.redo = () => { if (!app.redoStack.length) return; app.undoStack.push(snap()); restore(app.redoStack.pop()); };
app.patternOp = (op) => {
  const p = app.project, t = p.transport, L = t.length;
  app.snapshot();
  if (op === 'rnd') p.steps.slice(0, L).forEach((s) => { randomizeStep(s, p.slices.length); s.on = Math.random() < 0.62; });
  if (op === 'left' || op === 'right') { const a = p.steps.slice(0, L); if (op === 'left') a.push(a.shift()); else a.unshift(a.pop()); a.forEach((s, i) => (p.steps[i] = s)); }
  if (op === 'double') { if (L >= 32) return; for (let i = 0; i < L; i++) p.steps[i + L] = JSON.parse(JSON.stringify(p.steps[i])); t.length = L * 2; }
  app.commit('transport', 'stack', 'source');
};

/* ------------------------------------------------------------------ Audio */
let audioStarting = null;
function ensureAudio() {
  if (app.engine.running) { if (app.engine.ctx.state !== 'running') app.engine.ctx.resume(); return Promise.resolve(); }
  if (!audioStarting) audioStarting = startAudio().finally(() => { audioStarting = null; });
  return audioStarting;
}
async function startAudio() {
  try {
    await app.engine.start(app.settings);
    for (const s of app.project.samples) await decodeSample(s.id);
    app.engine.setStateNow(engineState(app.project, app.settings));
    if (app.project.rip.brain) app.engine.setBrain(app.project.rip.brain);
    if (app.rec && app.rec.info) await app.enableInput();
    document.body.classList.add('audio-on'); setStatus(); app.refreshPart('source');
  } catch (err) { console.error(err); toast(`Audio konnte nicht starten: ${err.message}`, true); throw err; }
}
async function decodeSample(id) {
  let bytes = app.bytes.get(id);
  if (!bytes) { const rec = await storage.getSample(id); if (!rec) { toast('Sample fehlt in der Datenbank', true); return; } bytes = rec.bytes; app.bytes.set(id, bytes); }
  if (!app.engine.running) return;
  const buf = await app.engine.decode(bytes);
  app.buffers.set(id, buf); app.peaks.set(id, peaks(buf)); app.engine.sendSample(id, buf);
}
app.importFiles = async (files, opt = {}) => {
  if (!files.length) return;
  await ensureAudio();
  let first = null;
  for (const f of files) {
    try {
      const bytes = await f.arrayBuffer(), id = uid();
      await storage.putSample({ id, name: f.name, type: f.type, bytes: bytes.slice(0) });
      app.bytes.set(id, bytes);
      app.project.samples.push({ id, name: f.name.replace(/\.[^.]+$/, '') });
      await decodeSample(id);
      first ||= id;
      if (app.buffers.get(id)) app.reslice(id, opt.mode || app.slicing.mode, opt.count || app.slicing.count, app.slicing.sens, files.length === 1 || first === id, true);
    } catch (err) { console.error(err); toast(`„${f.name}" konnte nicht dekodiert werden`, true); }
  }
  if (first) { app.viewSample = first; app.commit('source', 'stack'); if (!opt.quiet) toast(`${files.length} Datei(en) importiert und gesliced`); }
};
/** Slicing wie Simpler/Sampler: mode = auto | trans | beat | region | manual; map = Zuordnung Slice → Step */
app.slicing = { mode: 'auto', count: 'steps', grid: '1/16', sens: 0.5, map: 'seq' };
app.reslice = (id, mode, count, sens, assign = true, quiet = false, map) => {
  const buf = app.buffers.get(id); if (!buf) return;
  if (!quiet) app.snapshot();
  const p = app.project, L = p.transport.length, n = count === 'steps' || count == null ? L : Number(count), S = app.slicing;
  const bpm = tempoBpm(p.transport, app.settings);
  let parts;
  if (mode === 'manual') parts = p.slices.filter((s) => s.sampleId === id).map((s) => [s.a, s.b]);
  if (!parts || !parts.length) parts = mode === 'trans' ? transientSlices(buf, sens ?? S.sens, n) : mode === 'beat' ? beatSlices(buf, bpm, S.grid, 32) : mode === 'region' || mode === 'equal' ? equalSlices(n) : autoSlices(buf, bpm, n);
  const oldIdx = new Set(p.slices.map((s, i) => (s.sampleId === id ? i : -1)).filter((i) => i >= 0));
  const keep = p.slices.filter((s) => s.sampleId !== id), remap = new Map();
  p.slices.forEach((s, i) => { if (s.sampleId !== id) remap.set(i, keep.indexOf(s)); });
  const base = keep.length;
  p.slices = keep.concat(parts.map(([a, b]) => ({ sampleId: id, a, b })));
  const order = mapSlices(parts.length, L, map || S.map);
  p.steps.forEach((s, i) => {
    if (assign && i < L) { s.slice = base + order[i]; s.source = 'sample'; } // neues Material auf die aktiven Steps legen
    else if (remap.has(s.slice)) s.slice = remap.get(s.slice);                // andere Samples: Index nachführen
    else if (oldIdx.has(s.slice)) s.slice = base + ((s.slice - Math.min(...oldIdx)) % parts.length);
  });
  if (assign) p.steps.slice(0, L).forEach((s) => { s.on = true; });
  if (!quiet) { app.commit('source', 'stack'); toast(`${parts.length} Slices`); }
};
/** Manuelles Bearbeiten der Slice-Grenzen im Viewport */
app.editMarkers = (id, bounds) => {
  const p = app.project, idx = []; p.slices.forEach((s, i) => { if (s.sampleId === id) idx.push(i); });
  const b = [...bounds].sort((x, y) => x - y);
  if (b.length - 1 === idx.length) { idx.forEach((si, k) => { p.slices[si].a = b[k]; p.slices[si].b = b[k + 1]; }); app.commit('source'); return; }
  // Anzahl geändert: Slices dieses Samples neu aufbauen, Steps behalten ihre Position (gekürzt auf neue Anzahl)
  const parts = []; for (let k = 0; k < b.length - 1; k++) parts.push({ sampleId: id, a: b[k], b: b[k + 1] });
  const keep = p.slices.filter((s) => s.sampleId !== id), remap = new Map(); p.slices.forEach((s, i) => { if (s.sampleId !== id) remap.set(i, keep.indexOf(s)); });
  const base = keep.length, first = idx.length ? idx[0] : 0;
  p.slices = keep.concat(parts);
  p.steps.forEach((s) => { if (remap.has(s.slice)) s.slice = remap.get(s.slice); else if (idx.includes(s.slice)) s.slice = base + Math.min(parts.length - 1, s.slice - first); });
  app.commit('source', 'stack');
};

app.removeSample = (id) => {
  if (!id || !confirm('Sample aus diesem Projekt entfernen?')) return;
  const p = app.project, keep = p.slices.filter((s) => s.sampleId !== id), remap = new Map();
  p.slices.forEach((s, i) => remap.set(i, s.sampleId === id ? -1 : keep.indexOf(s)));
  p.slices = keep; p.samples = p.samples.filter((s) => s.id !== id);
  p.steps.forEach((s) => { const r = remap.get(s.slice); if (r === -1 || r === undefined) { s.slice = 0; if (!keep.length) s.source = 'synth'; } else s.slice = r; });
  app.engine.removeSample(id); app.buffers.delete(id); app.peaks.delete(id);
  app.commit('source', 'stack');
};

/* ------------------------------------------------------------------ Transport */
app.togglePlay = async () => {
  await ensureAudio();
  app.playing = !app.playing; app.engine.setStateNow(engineState(app.project, app.settings)); app.engine.play(app.playing);
  if (!app.playing) { app.playStep = -1; app.views.stack.markDirty(); }
  app.refreshPart('transportLite');
};
app.toggleRec = async () => {
  await ensureAudio();
  if (!app.recording) {
    app.recording = true; app.refreshPart('transportLite');
    const blob = await app.engine.startRec(Number(app.settings.exportBits), app.settings.dither);
    download(blob, `${safeName(app.project.name)}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.wav`);
    toast('Bounce gespeichert');
  } else { app.recording = false; app.engine.stopRec(); app.refreshPart('transportLite'); }
};

/* ------------------------------------------------------------------ Aufnahme in den Sequencer */
app.rec = { open: true, src: 'input', mode: 'sync', passes: 1, countIn: true, monitor: false, state: 'idle', count: 0, info: null };
app.toggleRecorder = () => { app.views.bay.show(app.bayTab === 'rec' ? 'master' : 'rec'); setMobile('bay'); };
app.enableInput = async () => {
  await ensureAudio();
  try {
    app.rec.info = await app.engine.enableInput(app.settings.inputDevice);
    app.engine.setInput(app.settings.inputCh, app.rec.monitor);
    toast(`Eingang: ${app.rec.info.label || 'Standard'} · ${app.rec.info.channels} Kanal/Kanäle`);
  } catch (err) { console.error(err); app.rec.info = null; toast(err.name === 'NotAllowedError' ? 'Mikrofonzugriff wurde verweigert' : `Eingang nicht verfügbar: ${err.message}`, true); }
  app.refreshPart('recorder');
};
app.disableInput = () => { app.engine.disableInput(); app.rec.info = null; app.rec.monitor = false; app.engine.setInput(app.settings.inputCh, false); app.refreshPart('recorder'); };
app.setInputOpt = (k, v) => {
  if (k === 'inputDevice' || k === 'inputCh') { app.settings[k] = v; lsSet(SETTINGS_KEY, JSON.stringify(app.settings)); }
  else app.rec[k] = v;
  if (k === 'inputDevice' && app.engine.inputOn) app.enableInput();
  app.engine.setInput(app.settings.inputCh, app.rec.monitor);
  app.refreshPart('recorder');
};
/** Latenzausgleich für Eingangsaufnahmen im Sync-Modus: Wandler-Roundtrip (Ausgang + Eingang) + manueller Versatz */
app.recCompMs = () => {
  const e = app.engine, auto = app.settings.recAutoComp ? ((e.ctx.baseLatency || 0) + (e.ctx.outputLatency || 0) + ((e.inInfo && e.inInfo.latency) || 0)) * 1000 : 0;
  return Math.max(0, auto + Number(app.settings.recOffset || 0));
};
app.startCapture = async () => {
  await ensureAudio();
  const r = app.rec;
  if (r.state !== 'idle') { app.engine.stopCapture(); return; }
  if (r.src === 'input' && !app.engine.inputOn) { await app.enableInput(); if (!app.engine.inputOn) return; }
  const sr = app.engine.sampleRate, compN = r.src === 'input' && r.mode === 'sync' ? Math.round((app.recCompMs() / 1000) * sr) : 0;
  const done = app.engine.capture({ mode: r.mode, src: r.src, passes: r.passes, countIn: r.mode === 'sync' && r.countIn ? 1 : 0, compN });
  r.state = r.mode === 'sync' ? 'armed' : 'recording'; app.refreshPart('recorder');
  if (r.mode === 'sync' && !app.playing) await app.togglePlay();
  const res = await done;
  r.state = 'idle'; app.refreshPart('recorder');
  if (!res) { toast('Aufnahme abgebrochen'); return; }
  r.count++;
  const name = `${r.src === 'master' ? 'Resample' : 'Aufnahme'} ${r.count} · ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
  const blob = encodeWav(res.L, res.R, sr, 32, false); // verlustfrei: 32 Bit Float, kein Dither
  const L = app.project.transport.length;
  const opt = r.mode === 'sync' ? { mode: 'equal', count: String(Math.min(32, L * r.passes)), quiet: true } : { mode: 'trans', count: String(L), quiet: true };
  await app.importFiles([new File([blob], `${name}.wav`, { type: 'audio/wav' })], opt);
  const secs = res.L.reduce((a, c) => a + c.length, 0) / sr;
  toast(`${name} — ${secs.toFixed(2)} s, ${r.mode === 'sync' ? 'auf die Steps gesliced' : 'nach Transienten gesliced'}`);
};
app.engine.on('capState', (m) => {
  if (m.state === 'idle') return;
  app.rec.state = m.state; app.rec.countLeft = m.countIn; app.refreshPart('recorder');
});

/* ------------------------------------------------------------------ Projekte */
app.save = async () => {
  try {
    const brain = await app.engine.getBrain(); if (brain) app.project.rip.brain = brain;
    app.project.updated = Date.now();
    await storage.putProject(JSON.parse(JSON.stringify(app.project)));
    lsSet(LAST_KEY, app.project.id); app.dirty = false; setStatus(); toast('Gespeichert');
    if (app.page === 'projects') app.views.projects.refresh();
  } catch (err) { console.error(err); toast(`Speichern fehlgeschlagen: ${err.message}`, true); }
};
async function loadProject(p) {
  if (app.playing) await app.togglePlay();
  app.engine.panic();
  for (const s of app.project.samples) app.engine.removeSample(s.id);
  app.project = normalizeProject(p); app.undoStack = []; app.redoStack = []; app.hoverStep = -1; app.hoverSlice = -1;
  app.buffers.clear(); app.peaks.clear(); app.viewSample = null;
  if (app.engine.running) {
    for (const s of app.project.samples) await decodeSample(s.id);
    app.engine.resetBrain(app.project.rip.seed);
    app.engine.setStateNow(engineState(app.project, app.settings));
    if (app.project.rip.brain) app.engine.setBrain(app.project.rip.brain);
  }
  lsSet(LAST_KEY, app.project.id); app.dirty = false; app.refreshAll(); setStatus();
}
app.openProject = async (id) => {
  if (app.dirty && !confirm('Ungespeicherte Änderungen verwerfen?')) return;
  const p = await storage.getProject(id); if (!p) return;
  await loadProject(p); go('seq'); toast(`„${p.name}" geladen`);
};
app.newProject = async () => {
  if (app.dirty && !confirm('Ungespeicherte Änderungen verwerfen?')) return;
  await loadProject(newProject(`Projekt ${new Date().toLocaleDateString('de-DE')}`)); app.dirty = true; go('seq');
};
app.duplicateProject = async (p) => { const c = { ...JSON.parse(JSON.stringify(p)), id: uid(), name: `${p.name} (Kopie)`, created: Date.now(), updated: Date.now() }; await storage.putProject(c); app.views.projects.refresh(); };
app.exportProject = async (p) => { if (p.id === app.project.id && app.dirty) await app.save(); download(await storage.exportProject(p.id === app.project.id ? app.project : p), `${safeName(p.name)}.chili`); };
app.importProject = async (file) => { try { const p = await storage.importProjectFile(file, uid()); toast(`„${p.name}" importiert`); app.views.projects.refresh(); } catch (err) { toast(err.message, true); } };

/* ------------------------------------------------------------------ Einstellungen */
app.applySettings = async (draft) => {
  const restart = RESTART_KEYS.some((k) => String(draft[k]) !== String(app.settings[k]));
  app.settings = { ...draft }; lsSet(SETTINGS_KEY, JSON.stringify(app.settings));
  if (restart && app.engine.running) {
    const brain = await app.engine.getBrain(); if (brain) app.project.rip.brain = brain;
    const was = app.playing; if (was) await app.togglePlay();
    await startAudio(); if (was) await app.togglePlay();
    toast('Engine neu gestartet');
  } else { app.engine.settings(app.settings); app.pushState(); toast('Einstellungen übernommen'); }
  app.refreshPart('transport'); app.views.settings.refresh(); setupAutosave();
};

/* ------------------------------------------------------------------ Engine-Events */
app.engine.on('tick', (m) => {
  const delay = Math.max(0, (m.t - app.engine.ctx.currentTime + app.engine.latency) * 1000);
  setTimeout(() => { if (app.playing) { app.playStep = m.step; app.views.stack.markDirty(); } }, delay);
});
app.engine.on('meter', (m) => { const v = app.views; v.out.meter(m); v.fx.meter(m); v.filter.meter(m); v.viewport.meter(m); v.recorder.meter(m); v.collide.meter(m); v.rip.meter(m); v.chaos.meter(m); });
app.engine.on('collision', (m) => { app.views.collide.collision(m); app.flashes.push({ step: m.step, t: performance.now() }); });
app.engine.on('dump', () => toast('Beam Dump — Strahl B zurückgesetzt'));

/* ------------------------------------------------------------------ Layout: ein Gerät, das in jeden Bildschirm passt */
const root = document.getElementById('app');
const header = h('header', { class: 'topbar' });
const status = h('span', { class: 'status' });
function renderHeader() {
  header.innerHTML = '';
  const name = h('input', { class: 'pname', value: app.project.name, spellcheck: false, 'data-help': 'Projektname.', onchange: (e) => { app.project.name = e.target.value || 'Ohne Titel'; app.commit(); }, onkeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); } });
  header.append(
    h('div', { class: 'brand' }, h('span', { class: 'logo', html: CHILI_SVG }), h('span', { class: 'word' }, 'CHILI'), h('span', { class: 'ver' }, VERSION)),
    h('nav', { class: 'nav' }, [['seq', 'SEQ'], ['projects', 'PROJEKTE'], ['settings', 'SETUP']].map(([id, l]) => h('button', { class: app.page === id ? 'on' : '', onclick: () => go(id) }, l))),
    h('div', { class: 'hcenter' }, name),
    h('div', { class: 'hright' }, status, h('button', { class: 'btn accent', 'data-help': 'Projekt speichern — Strg/⌘+S.', onclick: () => app.save() }, 'SAVE')));
  setStatus();
}
function setStatus() {
  const e = app.engine;
  status.innerHTML = '';
  status.append(h('i', { class: app.dirty ? 'dot dirty' : 'dot' }), e.running ? `${(e.sampleRate / 1000).toFixed(1)}K · ${(e.latency * 1000).toFixed(0)}MS` : 'OFFLINE');
  status.title = app.dirty ? 'Ungespeicherte Änderungen' : 'Gespeichert';
}
function go(page) {
  app.page = page; renderHeader();
  device.dataset.page = page;
  for (const [k, el] of Object.entries(pages)) el.style.display = k === page ? '' : 'none';
  if (page === 'projects') app.views.projects.refresh();
  if (page === 'settings') app.views.settings.refresh();
  if (page === 'seq') app.views.stack.markDirty();
}

const V = app.views;
V.deck = deckView(app); V.viewport = viewportView(app); V.source = V.viewport; V.stack = stackView(app);
V.recorder = recorderView(app); V.collide = collideView(app); V.rip = ripView(app);
V.fx = masterFxView(app); V.filter = filterView(app); V.out = outView(app); V.chaos = chaosView(app);
V.bay = bayView(app, [
  { id: 'master', label: 'MASTER', el: V.fx, help: 'Master: Compressor, Delay, Reverb.' },
  { id: 'filter', label: 'FILTER', el: V.filter, help: 'Master-Filter: 10 Typen, bis 48 dB/Okt, Drive, Hüllkurvenfolger, LFO, Stereo.', lit: () => app.project.master.filter.on },
  { id: 'chaos', label: 'CHAOS', el: V.chaos, help: 'Chaos: Zufallsmodulator für jeden Parameter jedes Steps.', lit: () => app.project.chaos.on || app.project.macros.chaos > 0 },
  { id: 'collide', label: 'COLLIDE', el: V.collide, help: 'Collide: der Sequencer als Teilchenbeschleuniger.', lit: () => app.project.collide.on },
  { id: 'rip', label: 'RIP', el: V.rip, help: 'Rip: neuronaler Beat-Repeat.', lit: () => app.project.rip.on },
  { id: 'rec', label: 'REC', el: V.recorder, help: 'Aufnahme: Eingang oder Master direkt als Sample.', lit: () => app.rec.state !== 'idle' },
]);
const bayShow = V.bay.show; V.bay.show = (id) => { app.bayTab = id; bayShow(id); };
app.bayTab = 'master';
V.projects = projectsView(app); V.settings = settingsView(app);
app.toast = (m, e) => toast(m, e);

const helpText = h('span', {});
const DEFAULT_HELP = 'LEERTASTE Play · in jede Lane direkt zeichnen · SHIFT Linie · ALT fein · STRG/⌘ alle Steps · RECHTSKLICK Reset · STRG/⌘+Z zurück';
helpText.textContent = DEFAULT_HELP;
const helpbar = h('footer', { class: 'helpbar' }, h('b', {}, '?'), helpText);
document.addEventListener('mouseover', (e) => { const t = e.target.closest && e.target.closest('[data-help]'); helpText.textContent = t ? t.dataset.help : DEFAULT_HELP; });

const seqPage = h('div', { class: 'body' },
  h('div', { class: 'main' }, V.viewport, V.stack),
  V.bay, V.out);
const pages = { seq: seqPage, projects: h('div', { class: 'body page-wrap' }, V.projects), settings: h('div', { class: 'body page-wrap' }, V.settings) };
const mtabs = h('nav', { class: 'mtabs' }, [['seq', 'SEQ'], ['macro', 'MAKRO'], ['bay', 'MODULE'], ['out', 'OUT']].map(([id, l]) => h('button', { 'data-m': id, onclick: () => setMobile(id) }, l)));
function setMobile(id) { device.dataset.m = id; mtabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === id)); if (id === 'seq') V.stack.markDirty(); }
const device = h('div', { class: 'device', 'data-m': 'seq' }, header, V.deck, pages.seq, pages.projects, pages.settings, helpbar, mtabs);

/* Startfenster: Zündung */
const ign = h('button', { class: 'ignite', 'aria-label': 'Audio starten' },
  h('span', { class: 'igr r1' }), h('span', { class: 'igr r2' }), h('span', { class: 'igr r3' }),
  h('span', { class: 'core', html: '<svg viewBox="0 0 24 24"><path d="M12 3v8M6.3 6.6a8 8 0 1 0 11.4 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>' }));
const gate = h('div', { class: 'gate' },
  h('div', { class: 'gate-in' }, h('span', { class: 'logo big', html: CHILI_SVG }), h('h1', {}, 'CHILI'), ign, h('div', { class: 'ign-l' }, 'AUDIO STARTEN')));
const ignite = () => { gate.classList.add('lit'); ensureAudio().then(() => { setTimeout(() => gate.classList.add('out'), 260); setTimeout(() => gate.remove(), 900); }).catch(() => gate.classList.remove('lit')); };
ign.addEventListener('click', ignite);
root.append(device, gate, h('div', { class: 'toasts' }));
setMobile('seq'); go('seq');

/* ------------------------------------------------------------------ Tastatur, Autosave, Hilfen */
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && k === 's') { e.preventDefault(); app.save(); return; }
  if (app.page !== 'seq') return;
  if (e.code === 'Space') { e.preventDefault(); app.togglePlay(); }
  else if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) app.redo(); else app.undo(); }
  else if (mod && k === 'y') { e.preventDefault(); app.redo(); }
});
let autoTimer = null;
function setupAutosave() {
  clearInterval(autoTimer); const s = Number(app.settings.autosave);
  if (s > 0) autoTimer = setInterval(() => { if (app.dirty) app.save(); }, s * 1000);
}
window.addEventListener('beforeunload', (e) => { if (app.dirty) { e.preventDefault(); e.returnValue = ''; } });
function toast(msg, err) {
  const t = h('div', { class: `toast${err ? ' err' : ''}` }, msg); document.querySelector('.toasts').append(t);
  setTimeout(() => t.classList.add('out'), 2400); setTimeout(() => t.remove(), 2900);
}
const safeName = (s) => s.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60);
function download(blob, name) { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }

/* ------------------------------------------------------------------ Start */
(async () => {
  try {
    const last = lsGet(LAST_KEY), p = last && (await storage.getProject(last));
    if (p) await loadProject(p); else app.refreshAll();
  } catch (err) { console.warn('Kein gespeichertes Projekt geladen', err); app.refreshAll(); }
  setupAutosave();
})();
window.chili = app; // Debug-Zugriff in der Konsole

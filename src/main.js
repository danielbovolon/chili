/* Chili v0.1 — App-Controller */
import { Engine } from './audio/engine.js';
import { equalSlices, transientSlices, peaks } from './audio/slicer.js';
import * as storage from './state/storage.js';
import { newProject, normalizeProject, engineState, uid, tempoBpm } from './state/project.js';
import { h, CHILI_SVG } from './ui/dom.js';
import { transportView, sourceView, gridView, editorView } from './ui/sequencer.js';
import { collideView, ripView } from './ui/special.js';
import { masterView } from './ui/master.js';
import { projectsView, settingsView } from './ui/pages.js';

const VERSION = '0.1.0';
const SETTINGS_KEY = 'chili.settings', LAST_KEY = 'chili.lastProject';
const defaultSettings = () => ({ sampleRate: 'auto', latency: 'interactive', outputDevice: '', quality: '16', maxVoices: 16, limiter: true, ceiling: -0.3, panLaw: 'm3', refA: 440, noteFloor: 70, peakHold: 1.5, exportBits: '24', dither: true, autosave: 30, auditionOnSelect: true });
const RESTART_KEYS = ['sampleRate', 'latency', 'outputDevice', 'quality', 'maxVoices'];
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

const app = {
  engine: new Engine(), storage,
  settings: { ...defaultSettings(), ...JSON.parse(lsGet(SETTINGS_KEY) || '{}') },
  project: newProject('Erstes Feuer'),
  sel: new Set([0]), focus: 0, clipboard: null,
  buffers: new Map(), bytes: new Map(), peaks: new Map(), viewSample: null,
  page: 'seq', playing: false, recording: false, dirty: false, views: {},
  defaultSettings,
};

/* ------------------------------------------------------------------ Zustand → Engine & UI */
app.pushState = () => { if (app.engine.running) app.engine.setState(engineState(app.project, app.settings)); };
app.commit = (...parts) => {
  app.dirty = true; app.pushState(); setStatus();
  for (const p of parts) if (p) app.refreshPart(p);
};
app.refreshPart = (p) => {
  const v = app.views;
  if (p === 'transport') v.transport.refresh(true);
  if (p === 'transportLite') { v.transport.refresh(false); }
  if (p === 'grid') v.grid.refresh();
  if (p === 'editor') v.editor.refresh();
  if (p === 'source') v.source.refresh();
  if (p === 'special') { v.collide.refresh(); v.rip.refresh(); }
  if (p === 'master') v.master.refresh();
  if (p === 'header') renderHeader();
};
app.refreshAll = () => ['transport', 'grid', 'editor', 'source', 'special', 'master', 'header'].forEach(app.refreshPart);
app.stepSeconds = () => {
  const d = { '1/8': 1 / 8, '1/8T': 1 / 12, '1/16': 1 / 16, '1/16T': 1 / 24, '1/32': 1 / 32 }[app.project.transport.division];
  return (240 / tempoBpm(app.project.transport, app.settings)) * d;
};

/* ------------------------------------------------------------------ Auswahl & Steps */
app.forSel = (fn) => { for (const i of app.sel) fn(app.project.steps[i], i); };
app.selectStep = (i, e) => {
  if (e.altKey) { app.audition(i); return; }
  if (e.shiftKey && app.sel.size) { const a = Math.min(app.focus, i), b = Math.max(app.focus, i); for (let k = a; k <= b; k++) app.sel.add(k); }
  else if (e.ctrlKey || e.metaKey) { if (app.sel.has(i) && app.sel.size > 1) app.sel.delete(i); else app.sel.add(i); }
  else app.sel = new Set([i]);
  app.focus = i;
  if (app.settings.auditionOnSelect && !app.playing && !e.shiftKey && !e.ctrlKey && !e.metaKey) app.audition(i);
  app.refreshPart('grid'); app.refreshPart('editor'); app.refreshPart('source');
};
app.audition = (i) => { ensureAudio().then(() => { app.engine.setStateNow(engineState(app.project, app.settings)); app.engine.audition(i); }); };
app.auditionSel = () => app.audition(app.focus);
app.copyStep = () => { app.clipboard = JSON.parse(JSON.stringify(app.project.steps[app.focus])); toast('Step kopiert'); };
app.pasteStep = () => { if (!app.clipboard) return; app.forSel((s, i) => { app.project.steps[i] = { ...JSON.parse(JSON.stringify(app.clipboard)) }; }); app.commit('grid', 'editor'); toast(`Auf ${app.sel.size} Step(s) eingefügt`); };
app.applyTabToAll = (group) => {
  const f = app.project.steps[app.focus], keys = group.sections.flatMap((s) => s.params.map((d) => d.k));
  app.project.steps.forEach((s, i) => { if (i !== app.focus) for (const k of keys) if (k !== 'slice' && k !== 'note') s[k] = f[k]; });
  app.commit('grid', 'editor'); toast(`„${group.label}" auf alle Steps übertragen`);
};
app.doubleLength = () => {
  const t = app.project.transport; if (t.length >= 32) return;
  for (let i = 0; i < t.length; i++) app.project.steps[i + t.length] = JSON.parse(JSON.stringify(app.project.steps[i]));
  t.length *= 2; app.commit('transport', 'grid');
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
app.importFiles = async (files) => {
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
      if (app.buffers.get(id)) app.reslice(id, 'equal', 'steps', 0.5, files.length === 1 || first === id, true);
    } catch (err) { console.error(err); toast(`„${f.name}" konnte nicht dekodiert werden`, true); }
  }
  if (first) { app.viewSample = first; app.commit('source', 'grid', 'editor'); toast(`${files.length} Datei(en) importiert und gesliced`); }
};
app.reslice = (id, mode, count, sens, assign = true, quiet = false) => {
  const buf = app.buffers.get(id); if (!buf) return;
  const p = app.project, L = p.transport.length, n = count === 'steps' ? L : Number(count);
  const parts = mode === 'trans' ? transientSlices(buf, sens, n) : equalSlices(n);
  const oldIdx = new Set(p.slices.map((s, i) => (s.sampleId === id ? i : -1)).filter((i) => i >= 0));
  const keep = p.slices.filter((s) => s.sampleId !== id), remap = new Map();
  p.slices.forEach((s, i) => { if (s.sampleId !== id) remap.set(i, keep.indexOf(s)); });
  const base = keep.length;
  p.slices = keep.concat(parts.map(([a, b]) => ({ sampleId: id, a, b })));
  p.steps.forEach((s, i) => {
    if (remap.has(s.slice)) s.slice = remap.get(s.slice);
    else if (oldIdx.has(s.slice) || assign) { if (assign && i < L) { s.slice = base + (i % parts.length); s.source = 'sample'; } else s.slice = base + (s.slice % parts.length); }
  });
  if (assign) p.steps.slice(0, L).forEach((s, i) => { if (i < L) s.on = true; });
  if (!quiet) { app.commit('source', 'grid', 'editor'); toast(`${parts.length} Slices`); }
};
app.removeSample = (id) => {
  if (!id || !confirm('Sample aus diesem Projekt entfernen?')) return;
  const p = app.project, keep = p.slices.filter((s) => s.sampleId !== id), remap = new Map();
  p.slices.forEach((s, i) => remap.set(i, s.sampleId === id ? -1 : keep.indexOf(s)));
  p.slices = keep; p.samples = p.samples.filter((s) => s.id !== id);
  p.steps.forEach((s) => { const r = remap.get(s.slice); if (r === -1 || r === undefined) { s.slice = 0; if (!keep.length) s.source = 'synth'; } else s.slice = r; });
  app.engine.removeSample(id); app.buffers.delete(id); app.peaks.delete(id);
  app.commit('source', 'grid', 'editor');
};

/* ------------------------------------------------------------------ Transport */
app.togglePlay = async () => {
  await ensureAudio();
  app.playing = !app.playing; app.engine.setStateNow(engineState(app.project, app.settings)); app.engine.play(app.playing);
  if (!app.playing) app.views.grid.setPlayhead(-1);
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
  app.project = normalizeProject(p); app.sel = new Set([0]); app.focus = 0;
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
  setTimeout(() => { if (app.playing) app.views.grid.setPlayhead(m.step); }, delay);
});
app.engine.on('meter', (m) => { app.views.master.meter(m); app.views.collide.meter(m); app.views.rip.meter(m); });
app.engine.on('collision', (m) => { app.views.collide.collision(m); app.views.grid.flash(m.step, 'hit'); });
app.engine.on('dump', () => toast('Beam Dump — Strahl B zurückgesetzt'));

/* ------------------------------------------------------------------ Layout */
const root = document.getElementById('app');
const header = h('header', { class: 'app-h' });
const status = h('span', { class: 'status' });
function renderHeader() {
  header.innerHTML = '';
  const name = h('input', { class: 'pname', value: app.project.name, spellcheck: false, onchange: (e) => { app.project.name = e.target.value || 'Ohne Titel'; app.commit(); }, onkeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); } });
  header.append(
    h('div', { class: 'brand' }, h('span', { class: 'logo', html: CHILI_SVG }), h('span', { class: 'word' }, 'Chili'), h('span', { class: 'ver' }, `v${VERSION}`)),
    h('nav', { class: 'nav' }, [['seq', 'Sequencer'], ['projects', 'Projekte'], ['settings', 'Einstellungen']].map(([id, l]) => h('button', { class: app.page === id ? 'on' : '', onclick: () => go(id) }, l))),
    h('div', { class: 'hright' }, name, h('button', { class: 'btn accent', title: 'Strg/⌘+S', onclick: () => app.save() }, 'Speichern'), status));
  setStatus();
}
function setStatus() {
  const e = app.engine;
  status.textContent = `${app.dirty ? '● ungespeichert' : '✓ gespeichert'} · ${e.running ? `${(e.sampleRate / 1000).toFixed(1)} kHz · ${(e.latency * 1000).toFixed(1)} ms` : 'Audio aus'}`;
  status.classList.toggle('dirty', app.dirty);
}
function go(page) {
  app.page = page; renderHeader();
  for (const [k, el] of Object.entries(pages)) el.style.display = k === page ? '' : 'none';
  if (page === 'projects') app.views.projects.refresh();
  if (page === 'settings') app.views.settings.refresh();
}

const V = app.views;
V.transport = transportView(app); V.source = sourceView(app); V.grid = gridView(app); V.editor = editorView(app);
V.collide = collideView(app); V.rip = ripView(app); V.master = masterView(app);
V.projects = projectsView(app); V.settings = settingsView(app);
const pages = {
  seq: h('main', { class: 'seq' }, V.transport, h('div', { class: 'cols' }, h('div', { class: 'left' }, V.source, V.grid, V.editor, h('div', { class: 'specials' }, V.collide, V.rip)), V.master)),
  projects: V.projects, settings: V.settings,
};
const gate = h('div', { class: 'gate', onclick: () => ensureAudio().then(() => gate.remove()).catch(() => {}) },
  h('div', { class: 'gate-in' }, h('span', { class: 'logo big', html: CHILI_SVG }), h('h1', {}, 'Chili'), h('p', {}, 'Deep Step Sequencer · Mutate · Collide · Rip'), h('button', { class: 'btn accent big' }, 'Audio starten'), h('small', {}, 'Browser erlauben Audio erst nach einem Klick.')));
root.append(header, pages.seq, pages.projects, pages.settings, gate, h('div', { class: 'toasts' }));
go('seq');

/* ------------------------------------------------------------------ Tastatur, Autosave, Hilfen */
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); app.save(); return; }
  if (app.page !== 'seq') return;
  if (e.code === 'Space') { e.preventDefault(); app.togglePlay(); }
  else if (mod && e.key.toLowerCase() === 'c') app.copyStep();
  else if (mod && e.key.toLowerCase() === 'v') app.pasteStep();
  else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const L = app.project.transport.length, i = (app.focus + (e.key === 'ArrowRight' ? 1 : L - 1)) % L;
    app.selectStep(i, { shiftKey: e.shiftKey, altKey: false, ctrlKey: false, metaKey: false }); e.preventDefault();
  } else if (e.key === 'Enter') { app.forSel((s) => (s.on = !s.on)); app.commit('grid'); }
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

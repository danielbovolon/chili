/* Chili — Projektmodell */
import { makeStep, masterDefaults, collideDefaults, ripDefaults, macroDefaults, chaosDefaults, mfDefaults, NOTE_NAMES, STEP_DEFS, STEP_DEF_MAP } from './params.js';
import { LAYERS, LAYER_MAP, layerDefaults } from './layers.js';

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

/** Demo-Pattern: läuft sofort mit dem Synth, ohne dass ein Sample geladen sein muss. */
export function newProject(name = 'Neues Projekt', demo = true) {
  const steps = [];
  const notes = [45, 48, 52, 55, 57, 52, 60, 55, 45, 48, 55, 57, 64, 60, 57, 52];
  for (let i = 0; i < 32; i++) {
    const s = makeStep({ source: 'synth', note: notes[i % 16], slice: i, osc1: 'saw', osc2: 'square', fType: 'lp', cutoff: 600, res: 0.35, fEnvAmt: 3.5, fEnvTime: 0.75, sus: 0.0, dec: 260, rel: 120, gate: 0.9, gain: -6 });
    if (demo) {
      s.on = [0, 2, 3, 6, 8, 10, 11, 14].includes(i % 16);
      if (i % 16 === 3) { s.fEnvShape = 'random'; s.pan = -0.4; }
      if (i % 16 === 6) { s.mutate = 0.55; s.gate = 2; s.verbMix = 0.25; }
      if (i % 16 === 10) { s.delayMix = 0.35; s.pan = 0.45; }
      if (i % 16 === 14) { s.fEnvShape = 'rndSpikes'; s.fEnvLoop = true; s.fEnvTime = 0.5; s.gate = 2; s.phaserMix = 0.6; }
    } else s.on = false;
    steps.push(s);
  }
  return {
    version: 1, id: uid(), name, created: Date.now(), updated: Date.now(),
    transport: { tempoMode: 'bpm', bpm: 120, hz: 2, note: 'A', octave: 4, length: 16, division: '1/16', swing: 0, direction: 'fwd' },
    steps, slices: [], samples: [],
    collide: collideDefaults(), rip: ripDefaults(), master: masterDefaults(), layers: layerDefaults(), macros: macroDefaults(), chaos: chaosDefaults(),
  };
}

/** Ältere/fremde Projektdaten auf aktuelles Schema bringen (fehlende Felder → Defaults). */
export function normalizeProject(p) {
  const base = newProject(p.name || 'Projekt', false);
  const out = { ...base, ...p };
  out.transport = { ...base.transport, ...(p.transport || {}) };
  out.steps = Array.from({ length: 32 }, (_, i) => ({ ...makeStep(), ...((p.steps || [])[i] || { on: false }) }));
  out.collide = { ...base.collide, ...(p.collide || {}) };
  out.rip = { ...base.rip, ...(p.rip || {}) };
  const m = p.master || {};
  out.master = { comp: { ...base.master.comp, ...(m.comp || {}) }, delay: { ...base.master.delay, ...(m.delay || {}) }, verb: { ...base.master.verb, ...(m.verb || {}) }, filter: { ...mfDefaults(), ...(m.filter || {}) }, fader: m.fader ?? base.master.fader };
  out.macros = { ...macroDefaults(), ...(p.macros || {}) };
  out.chaos = { ...chaosDefaults(), ...(p.chaos || {}) };
  out.slices = p.slices || []; out.samples = p.samples || [];
  const ld = layerDefaults(), pl = p.layers || {};
  out.layers = Object.fromEntries(Object.entries(ld).map(([k, v]) => [k, { ...v, ...(pl[k] || {}) }]));
  return out;
}

export function noteTempo(note, octave, refA = 440, floor = 70) {
  const midi = (octave + 1) * 12 + NOTE_NAMES.indexOf(note), f = refA * Math.pow(2, (midi - 69) / 12);
  let bpm = f * 60, k = 0;
  while (bpm >= floor * 2) { bpm /= 2; k++; }
  while (bpm < floor) { bpm *= 2; k--; }
  return { bpm, f, k };
}
export function tempoBpm(t, settings) {
  if (t.tempoMode === 'hz') return t.hz * 60;
  if (t.tempoMode === 'note') return noteTempo(t.note, t.octave, settings.refA, settings.noteFloor).bpm;
  return t.bpm;
}

export function engineState(p, settings) {
  const t = p.transport;
  const { brain, ...rip } = p.rip;
  // Bypass: Layer-Parameter in der Engine neutralisieren, gezeichnete Werte bleiben im Projekt
  let over = null;
  for (const l of LAYERS) if (l.bypass && p.layers && p.layers[l.id] && !p.layers[l.id].on) over = { ...(over || {}), ...l.bypass };
  const steps = over ? p.steps.map((s) => ({ ...s, ...over })) : p.steps;
  return { bpm: tempoBpm(t, settings), division: t.division, swing: t.swing, len: t.length, direction: t.direction || 'fwd', steps, slices: p.slices, collide: p.collide, rip, master: p.master,
    macros: p.macros, chaos: { ...p.chaos, keys: chaosKeys(p.chaos.targets) } };
}

export function randomizeStep(s, nSlices) {
  const r = Math.random, pick = (a) => a[(r() * a.length) | 0];
  if (nSlices > 0 && s.source !== 'synth') s.slice = (r() * nSlices) | 0;
  if (s.source === 'synth') s.note = pick([45, 48, 50, 52, 55, 57, 60, 62, 64, 67]);
  s.pitch = r() < 0.7 ? 0 : pick([-12, -5, -7, 5, 7, 12]);
  s.pan = +(r() * 1.4 - 0.7).toFixed(2);
  s.gate = pick([0.25, 0.5, 1, 1, 2]);
  if (r() < 0.6) { s.fType = pick(['lp', 'lp', 'bp', 'hp']); s.cutoff = Math.round(200 * Math.pow(40, r())); s.res = +(r() * 0.7).toFixed(2); s.fEnvAmt = +(r() * 6 - 1).toFixed(1); s.fEnvShape = pick(['decay', 'ad', 'random', 'rndSmooth', 'rndSteps', 'chaos', 'rndSpikes']); }
  s.mutate = r() < 0.35 ? +(r() * 0.7).toFixed(2) : 0;
  s.delayMix = r() < 0.2 ? 0.3 : 0; s.verbMix = r() < 0.2 ? 0.25 : 0; s.phaserMix = r() < 0.15 ? 0.6 : 0;
  return s;
}
export function resetStep(s) { const d = makeStep(); for (const def of STEP_DEFS) s[def.k] = d[def.k]; return s; }

/** Parameter-Beschreibungen für den Chaos-Modulator in der Engine */
const ckCache = new Map();
export function chaosKeys(targets = []) {
  const sig = targets.join(','); if (ckCache.has(sig)) return ckCache.get(sig);
  const keys = [];
  if (targets.includes('gate')) keys.push({ k: 'on', t: 'tog' });
  for (const id of targets) {
    const l = LAYER_MAP[id]; if (!l) continue;
    for (const k of l.keys) {
      if (k === 'source' || k === 'ripWeight') continue;
      const d = STEP_DEF_MAP[k];
      keys.push(d.t === 'knob' ? { k, t: 'n', min: d.min, max: d.max, c: d.c, int: !!d.int } : d.t === 'sel' ? { k, t: 'sel', o: d.o.map((x) => x[0]) } : { k, t: 'tog' });
    }
  }
  ckCache.set(sig, keys); return keys;
}

/* Chili — Parameter-Definitionen (eine Quelle der Wahrheit für UI, Defaults und Speicherformat) */

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (m) => NOTE_NAMES[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);
export const SYNC_OPTS = ['1/64', '1/32', '1/16T', '1/16', '1/16D', '1/8T', '1/8', '1/8D', '1/4T', '1/4', '1/4D', '1/2', '1/1'].map((v) => [v, v]);
export const DIVISIONS = ['1/8', '1/8T', '1/16', '1/16T', '1/32'];
export const LENGTHS = [4, 8, 16, 32];

export const SHAPES = [
  ['decay', 'Decay'], ['attack', 'Attack'], ['ad', 'Attack-Decay'], ['rampUp', 'Rampe ↑'], ['rampDown', 'Rampe ↓'],
  ['triangle', 'Dreieck'], ['sine', 'Sinus'], ['square', 'Rechteck'],
  ['random', '✦ Zufall: Form wechselt'], ['rndSteps', 'Zufall · Stufen'], ['rndSmooth', 'Zufall · Glatt'], ['rndWalk', 'Zufall · Walk'],
  ['rndSpikes', 'Zufall · Spikes'], ['chaos', 'Chaos (Logistic Map)'], ['rndRamps', 'Zufall · Rampen'],
];
export const LFO_SHAPES = [['sine', 'Sinus'], ['tri', 'Dreieck'], ['square', 'Rechteck'], ['saw', 'Sägezahn'], ['sh', 'S&H'], ['smooth', 'Zufall glatt']];
export const WAVES = [['sine', 'Sinus'], ['tri', 'Dreieck'], ['saw', 'Sägezahn'], ['square', 'Rechteck']];
export const FILTERS = [['off', 'Aus'], ['lp', 'Lowpass'], ['hp', 'Highpass'], ['bp', 'Bandpass'], ['notch', 'Notch']];

/* ---- Formatierung */
export function fmt(u, v) {
  switch (u) {
    case 'db': return v <= -60 ? '−∞' : `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;
    case 'hz': return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${v.toFixed(v < 10 ? 2 : 0)} Hz`;
    case 'ms': return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v.toFixed(v < 10 ? 1 : 0)} ms`;
    case 's': return `${v.toFixed(v < 10 ? 2 : 1)} s`;
    case '%': return `${Math.round(v * 100)}%`;
    case 'st': return `${v > 0 ? '+' : ''}${Number.isInteger(v) ? v : v.toFixed(2)} st`;
    case 'ct': return `${v > 0 ? '+' : ''}${Math.round(v)} ct`;
    case 'oct': return `${v > 0 ? '+' : ''}${v.toFixed(1)} oct`;
    case 'pan': return Math.abs(v) < 0.005 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`;
    case 'steps': return `${v < 1 ? v.toFixed(3) : v.toFixed(2)} St`;
    case 'note': return noteName(v);
    case 'x': return `${v.toFixed(2)}×`;
    case 'ratio': return `${v.toFixed(1)}:1`;
    case 'slice': return `#${Math.round(v) + 1}`;
    case 'int': return String(Math.round(v));
    case 'grid': return gridLabel(v);
    case 'shape': return ['Stufe', 'Linear', 'Glatt', 'Exp'][Math.min(3, Math.round(v))] + (Math.abs(v - Math.round(v)) > 0.05 ? '~' : '');
    case 'vowel': return ['A', 'E', 'I', 'O', 'U'][Math.min(4, Math.round(v))] + (Math.abs(v - Math.round(v)) > 0.05 ? '~' : '');
    default: return v.toFixed(2);
  }
}
export function gridLabel(e) { const r = Math.pow(2, Math.round(e)); return r >= 1 ? `${r} St` : `1/${Math.round(1 / r)} St`; }

/* ---- Kurven: normiert 0..1 ↔ Wert */
export function toNorm(d, v) {
  const { min, max } = d;
  if (d.c === 'log') return Math.log(v / min) / Math.log(max / min);
  if (d.c === 'cub') return Math.cbrt((v - min) / (max - min));
  return (v - min) / (max - min);
}
export function fromNorm(d, n) {
  n = Math.min(1, Math.max(0, n));
  let v;
  if (d.c === 'log') v = d.min * Math.pow(d.max / d.min, n);
  else if (d.c === 'cub') v = d.min + (d.max - d.min) * n * n * n;
  else v = d.min + (d.max - d.min) * n;
  if (d.int) v = Math.round(v);
  return v;
}

/* ---- Step-Parameter (Gruppen = Tabs im Editor) */
const K = (k, l, min, max, def, u, extra = {}) => ({ k, l, t: 'knob', min, max, def, u, ...extra });
const S = (k, l, o, def) => ({ k, l, t: 'sel', o, def });
const T = (k, l, def = false) => ({ k, l, t: 'tog', def });

export const STEP_GROUPS = [
  { id: 'src', label: 'Quelle', sections: [
    { title: 'Step', params: [S('source', 'Quelle', [['sample', 'Sample'], ['synth', 'Synth']], 'sample'), K('gain', 'Gain', -48, 6, 0, 'db'), K('prob', 'Chance', 0, 1, 1, '%'), K('gate', 'Länge', 0.05, 8, 1, 'steps', { c: 'log' }), K('pitch', 'Pitch', -24, 24, 0, 'st', { int: true }), K('fine', 'Fein', -100, 100, 0, 'ct'), K('ratchet', 'Ratchet', 1, 8, 1, 'int', { int: true }), K('ratchVel', 'Ratchet-Dyn.', -1, 1, 0, '%')] },
    { title: 'Sample', when: (s) => s.source !== 'synth', params: [K('slice', 'Slice', 0, 31, 0, 'slice', { int: true, dyn: 'slices' }), K('start', 'Start', 0, 0.95, 0, '%'), T('reverse', 'Reverse'), T('loop', 'Loop')] },
    { title: 'Granular', params: [T('grMode', 'Granular'), K('grSize', 'Korngröße', 5, 500, 80, 'ms', { c: 'log' }), K('grDensity', 'Kornrate', 1, 200, 30, 'hz', { c: 'log' }), K('grPos', 'Position', 0, 1, 0, '%'), K('grSpray', 'Streuung', 0, 1, 0.1, '%'), K('grScan', 'Scan', -2, 2, 1, 'x'), K('grPitch', 'Pitch-Streu', 0, 24, 0, 'st'), K('grWidth', 'Breite', 0, 1, 0.5, '%')] },
    { title: 'Synth', when: (s) => s.source === 'synth', params: [K('note', 'Note', 24, 96, 48, 'note', { int: true }), S('osc1', 'Osc 1', WAVES, 'saw'), S('osc2', 'Osc 2', WAVES, 'square'), K('osc2Semi', 'Osc 2 Semi', -24, 24, 0, 'st', { int: true }), K('osc2Fine', 'Osc 2 Fein', -50, 50, 7, 'ct'), K('oscMix', 'Mix 1↔2', 0, 1, 0.5, '%'), K('sub', 'Sub', 0, 1, 0, '%'), K('noise', 'Noise', 0, 1, 0, '%')] },
  ] },
  { id: 'env', label: 'Hüllkurve', sections: [
    { title: 'Amp-Hüllkurve', params: [K('atk', 'Attack', 0, 2000, 1, 'ms', { c: 'cub' }), K('dec', 'Decay', 1, 5000, 300, 'ms', { c: 'log' }), K('sus', 'Sustain', 0, 1, 1, '%'), K('rel', 'Release', 1, 5000, 80, 'ms', { c: 'log' })] },
  ] },
  { id: 'flt', label: 'Filter', sections: [
    { title: 'Filter', params: [S('fType', 'Typ', FILTERS, 'off'), K('cutoff', 'Cutoff', 20, 20000, 2000, 'hz', { c: 'log' }), K('res', 'Resonanz', 0, 1, 0.2, '%')] },
    { title: 'Filter-Hüllkurve', params: [S('fEnvShape', 'Form', SHAPES, 'decay'), K('fEnvAmt', 'Menge', -8, 8, 0, 'oct'), K('fEnvTime', 'Dauer', 0.0625, 16, 1, 'steps', { c: 'log' }), T('fEnvLoop', 'Loop')] },
  ] },
  { id: 'pan', label: 'Panorama', sections: [
    { title: 'Panorama', params: [K('pan', 'Pan', -1, 1, 0, 'pan'), K('panRnd', 'Zufall', 0, 1, 0, '%')] },
    { title: 'Pan-Modulation', params: [K('panModDepth', 'Tiefe', 0, 1, 0, '%'), K('panModRate', 'Rate', 0.05, 40, 2, 'hz', { c: 'log' }), S('panModShape', 'Form', LFO_SHAPES, 'sine')] },
    { title: 'Autopan (sync)', params: [K('autopan', 'Tiefe', 0, 1, 0, '%'), S('autopanSync', 'Rate', SYNC_OPTS, '1/4')] },
    { title: 'Surround', params: [K('depth', 'Tiefe', 0, 1, 0, '%'), K('orbit', 'Orbit', 0, 1, 0, '%'), K('orbitRate', 'Orbit-Rate', 0.02, 10, 0.25, 'hz', { c: 'log' }), K('spread', 'Spread', 0, 2, 1, '%')] },
  ] },
  { id: 'fx', label: 'Effekte', sections: [
    { title: 'Tremolo', params: [K('tremDepth', 'Tiefe', 0, 1, 0, '%'), K('tremRate', 'Rate', 0.1, 40, 6, 'hz', { c: 'log' }), S('tremShape', 'Form', LFO_SHAPES, 'sine')] },
    { title: 'Pitch-Mod', params: [K('pmDepth', 'Tiefe', 0, 12, 0, 'st', { c: 'cub' }), K('pmRate', 'Rate', 0.05, 40, 5, 'hz', { c: 'log' }), S('pmShape', 'Form', LFO_SHAPES, 'sine')] },
    { title: 'Phaser', params: [K('phaserMix', 'Mix', 0, 1, 0, '%'), K('phaserRate', 'Rate', 0.02, 10, 0.5, 'hz', { c: 'log' }), K('phaserDepth', 'Tiefe', 0, 1, 0.7, '%'), K('phaserFb', 'Feedback', -0.9, 0.9, 0.5, '%')] },
    { title: 'Flanger', params: [K('flangerMix', 'Mix', 0, 1, 0, '%'), K('flangerRate', 'Rate', 0.02, 10, 0.25, 'hz', { c: 'log' }), K('flangerDepth', 'Tiefe', 0, 1, 0.7, '%'), K('flangerFb', 'Feedback', -0.9, 0.9, 0.5, '%')] },
    { title: 'Chorus', params: [K('chorusMix', 'Mix', 0, 1, 0, '%'), K('chorusRate', 'Rate', 0.05, 8, 0.8, 'hz', { c: 'log' }), K('chorusDepth', 'Tiefe', 0, 1, 0.5, '%')] },
    { title: 'Delay', params: [K('delayMix', 'Pegel', 0, 1, 0, '%'), S('delaySync', 'Zeit', SYNC_OPTS, '1/8D'), K('delayFb', 'Feedback', 0, 0.95, 0.4, '%'), K('delayTone', 'Ton', 0, 1, 0.6, '%'), T('delayPP', 'Ping-Pong', true)] },
    { title: 'Reverb', params: [K('verbMix', 'Pegel', 0, 1, 0, '%'), K('verbSize', 'Größe', 0, 1, 0.6, '%'), K('verbDecay', 'Decay', 0.1, 12, 2, 's', { c: 'log' }), K('verbDamp', 'Dämpfung', 0, 1, 0.5, '%')] },
  ] },
  { id: 'mut', label: 'Mutate', sections: [
    { title: 'Mutate — nach dem Ansatz jedes Mal anders', params: [K('mutate', 'Menge', 0, 1, 0, '%'), K('mutRate', 'Tempo', 0.05, 20, 1.5, 'hz', { c: 'log' }), K('mutHold', 'Schutz', 0, 200, 15, 'ms')] },
    { title: 'Dimensionen', params: [K('mutPitch', 'Pitch', 0, 1, 0.3, '%'), K('mutFilter', 'Filter', 0, 1, 0.6, '%'), K('mutPan', 'Raum', 0, 1, 0.4, '%'), K('mutWarp', 'Warp', 0, 1, 0.3, '%'), K('mutLevel', 'Pegel', 0, 1, 0.3, '%')] },
    { title: 'Rip', params: [K('ripWeight', 'Rip-Gewicht', 0, 1, 0.5, '%')] },
  ] },
];

export const STEP_DEFS = STEP_GROUPS.flatMap((g) => g.sections.flatMap((s) => s.params));
export const STEP_DEF_MAP = Object.fromEntries(STEP_DEFS.map((d) => [d.k, d]));
export function makeStep(over = {}) {
  const s = { on: true };
  for (const d of STEP_DEFS) s[d.k] = d.def;
  return Object.assign(s, over);
}

/* ---- Master / Collide / Rip */
export const MASTER_GROUPS = [
  { id: 'comp', title: 'Compressor', params: [K('thr', 'Thresh', -60, 0, -18, 'db'), K('ratio', 'Ratio', 1, 20, 3, 'ratio', { c: 'log' }), K('atk', 'Attack', 0.1, 100, 10, 'ms', { c: 'log' }), K('rel', 'Release', 10, 2000, 120, 'ms', { c: 'log' }), K('knee', 'Knee', 0, 18, 6, 'db'), K('makeup', 'Gain', 0, 24, 0, 'db'), K('mix', 'Mix', 0, 1, 0, '%')] },
  { id: 'delay', title: 'Delay', params: [S('sync', 'Zeit', SYNC_OPTS, '1/8D'), K('fb', 'FB', 0, 0.95, 0.35, '%'), K('tone', 'Ton', 0, 1, 0.6, '%'), T('pp', 'P·P', true), K('mix', 'Mix', 0, 1, 0, '%')] },
  { id: 'verb', title: 'Reverb', params: [K('size', 'Größe', 0, 1, 0.7, '%'), K('decay', 'Decay', 0.2, 20, 2.4, 's', { c: 'log' }), K('damp', 'Damp', 0, 1, 0.4, '%'), K('pre', 'Pre', 0, 250, 20, 'ms'), K('mix', 'Mix', 0, 1, 0, '%')] },
];
export const RIP_DEFS = [
  K('mix', 'Mix', 0, 1, 1, '%'), K('chance', 'Erreg.', 0, 1, 0.35, '%'), K('plast', 'Plast.', 0, 1, 0.3, '%'), K('temp', 'Temp', 0, 1, 0.3, '%'),
  K('gridMin', 'Min', -4, 2, -2, 'grid', { int: true }), K('gridMax', 'Max', -4, 2, 0, 'grid', { int: true }), K('maxLen', 'Dauer', 1, 16, 4, 'steps', { int: true }),
  K('pitch', 'Drift', 0, 12, 0, 'st'), K('decay', 'Zerf.', 0, 1, 0.2, '%'),
];
const defaults = (defs) => Object.fromEntries(defs.map((d) => [d.k, d.def]));
export const masterDefaults = () => ({ comp: defaults(MASTER_GROUPS[0].params), delay: defaults(MASTER_GROUPS[1].params), verb: defaults(MASTER_GROUPS[2].params), fader: 0.8, filter: mfDefaults() });
export const ripDefaults = () => ({ on: false, freeze: false, seed: 1, ...defaults(RIP_DEFS) });

/* ---- Laufrichtung */
export const DIRECTIONS = [['fwd', '→ Vorwärts'], ['rev', '← Rückwärts'], ['pp', '↔ Ping-Pong'], ['rnd', '⁂ Zufall'], ['brown', '≈ Brown'], ['skip', '⇥ Sprung']];

/* ---- Makros: verändern Klang und Struktur der ganzen Sequenz (neutral = keine Wirkung) */
export const MACRO_DEFS = [
  K('heat', 'Heat', 0, 1, 0, '%', { help: 'Heat — Sättigung (aliasfrei, ADAA), mehr Resonanz und Filter-Hub. Von warm bis brennend.' }),
  K('density', 'Dichte', 0, 1, 0.5, '%', { help: 'Dichte — links dünnt das Pattern aus, rechts füllt es leere Steps mit Ghost-Notes und streut Ratchets ein. Mitte = neutral.' }),
  K('warp', 'Warp', 0, 1, 0, '%', { help: 'Warp — Mikro-Timing, Pitch-Drift, Startpunkt-Jitter und Längen-Variation pro Auslösung.' }),
  K('tone', 'Ton', -1, 1, 0, '%', { help: 'Ton — verschiebt alle Filter-Cutoffs um bis zu ±3 Oktaven.' }),
  K('pitch', 'Pitch', -24, 24, 0, 'st', { int: true, help: 'Pitch — transponiert die ganze Sequenz in Halbtönen.' }),
  K('length', 'Länge', 0.1, 4, 1, 'x', { c: 'log', help: 'Länge — skaliert alle Notenlängen: Staccato bis Drone.' }),
  K('space', 'Raum', 0, 1, 0.5, '%', { help: 'Raum — links trocken, rechts mehr Delay/Hall, Spread und Surround-Orbit. Mitte = neutral.' }),
  K('chaos', 'Chaos', 0, 1, 0, '%', { help: 'Chaos — Gesamttiefe des Zufallsmodulators. Ganz rechts: jeder Parameter jedes Steps ändert sich bei jeder Auslösung.' }),
];
export const macroDefaults = () => defaults(MACRO_DEFS);

/* ---- Chaos-Zufallsmodulator (angelehnt an VCV Random) */
export const CHAOS_DEFS = [
  K('depth', 'Tiefe', 0, 1, 0.5, '%'), K('rate', 'Rate', 1, 16, 1, 'steps', { int: true }), K('prob', 'Chance', 0, 1, 1, '%'),
  K('rand', 'Zufall', 0, 1, 1, '%'), K('shape', 'Form', 0, 3, 0, 'shape'), K('lock', 'Lock', 0, 1, 0, '%'), K('loop', 'Loop', 2, 32, 8, 'steps', { int: true }),
];
export const chaosDefaults = () => ({ on: false, mode: 'rel', seed: 1, targets: ['flt', 'pan', 'mut'], ...defaults(CHAOS_DEFS) });

/* ---- Master-Filter */
export const MF_TYPES = [['lp', 'LP'], ['bp', 'BP'], ['hp', 'HP'], ['notch', 'Notch'], ['peak', 'Peak'], ['lshelf', 'Low-Shelf'], ['hshelf', 'High-Shelf'], ['comb', 'Comb +'], ['combn', 'Comb −'], ['formant', 'Formant']];
export const MF_DEFS = [
  K('cutoff', 'Cutoff', 20, 20000, 1200, 'hz', { c: 'log' }), K('res', 'Reso', 0, 1, 0.3, '%'), K('drive', 'Drive', 0, 36, 0, 'db'),
  K('gain', 'Gain', -18, 18, 6, 'db'), K('vowel', 'Vokal', 0, 4, 0, 'vowel'),
  K('envAmt', 'Env', -4, 4, 0, 'oct'), K('envAtk', 'Atk', 0.5, 200, 5, 'ms', { c: 'log' }), K('envRel', 'Rel', 10, 2000, 150, 'ms', { c: 'log' }),
  K('lfoDepth', 'LFO', 0, 4, 0, 'oct', { c: 'cub' }), K('lfoRate', 'Rate', 0.01, 20, 0.5, 'hz', { c: 'log' }), S('lfoSync', 'LFO-Sync', [['off', 'frei'], ...SYNC_OPTS], 'off'), S('lfoShape', 'LFO-Form', LFO_SHAPES, 'sine'),
  K('stereo', 'Phase', 0, 1, 0, '%'), K('spreadOct', 'L/R', -1, 1, 0, 'oct'),
  K('mix', 'Mix', 0, 1, 1, '%'), K('out', 'Out', -18, 12, 0, 'db'),
];
export const mfDefaults = () => ({ on: false, type: 'lp', slope: 2, ...defaults(MF_DEFS) });

/* ---- Globale Hüllkurven: wirken auf jeden Step */
export const GENV_AMP = [K('atk', 'Atk', 0, 2000, 2, 'ms', { c: 'cub' }), K('dec', 'Dec', 1, 5000, 300, 'ms', { c: 'log' }), K('sus', 'Sus', 0, 1, 0.6, '%'), K('rel', 'Rel', 1, 5000, 200, 'ms', { c: 'log' }), K('amt', 'Menge', 0, 1, 1, '%')];
export const GENV_FLT = [K('atk', 'Atk', 0, 2000, 2, 'ms', { c: 'cub' }), K('dec', 'Dec', 1, 5000, 250, 'ms', { c: 'log' }), K('sus', 'Sus', 0, 1, 0.2, '%'), K('rel', 'Rel', 1, 5000, 200, 'ms', { c: 'log' }), K('amt', 'Menge', -8, 8, 3, 'oct')];
export const genvDefaults = () => ({ amp: { on: false, ...defaults(GENV_AMP) }, flt: { on: false, ...defaults(GENV_FLT) } });

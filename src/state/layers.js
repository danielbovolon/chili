/* Chili — Layer-System
 * Jeder Layer bündelt die Parameter eines Klangbereichs. Jeder Parameter ist eine Lane über alle Steps,
 * in die direkt gezeichnet wird. Layer lassen sich ein-/ausblenden und (wo sinnvoll) bypassen —
 * Bypass setzt die Parameter des Layers in der Engine auf neutral, die gezeichneten Werte bleiben erhalten. */
import { makeStep } from './params.js';

const D = makeStep();
const neutral = (...keys) => Object.fromEntries(keys.map((k) => [k, D[k]]));

export const LAYERS = [
  { id: 'seq', label: 'Sequenz', short: 'SEQ', color: '#f3e9e4', keys: ['gain', 'prob', 'gate', 'source'], primary: 'gain', show: true,
    help: 'Pegel, Wahrscheinlichkeit und Länge jedes Steps. „Quelle" schaltet pro Step zwischen Sample und Synth.' },
  { id: 'src', label: 'Sample', short: 'SMP', color: '#ffb36b', keys: ['slice', 'pitch', 'fine', 'start', 'reverse', 'loop'], primary: 'slice', show: true, forSource: 'sample',
    help: 'Welcher Slice auf welchem Step spielt — hoch/runter ziehen wählt den Slice. Dazu Pitch, Startpunkt, Reverse und Loop.' },
  { id: 'syn', label: 'Synth', short: 'SYN', color: '#ffd166', keys: ['note', 'osc1', 'osc2', 'osc2Semi', 'osc2Fine', 'oscMix', 'sub', 'noise'], primary: 'note', show: true, forSource: 'synth',
    help: 'Note und Klang der Synth-Engine für alle Steps mit Quelle „Synth".' },
  { id: 'env', label: 'Hüllkurve', short: 'ENV', color: '#ff7a45', keys: ['dec', 'atk', 'sus', 'rel'], primary: 'dec', bypass: neutral('atk', 'dec', 'sus', 'rel'), show: true,
    help: 'Amp-Hüllkurve pro Step. Die Lane zeigt die Form; gezogen wird der Decay.' },
  { id: 'flt', label: 'Filter', short: 'FLT', color: '#b78bff', keys: ['cutoff', 'res', 'fEnvAmt', 'fEnvShape', 'fEnvTime', 'fType', 'fEnvLoop'], primary: 'cutoff', bypass: { fType: 'off' }, show: true,
    help: 'Filter pro Step mit eigener Filter-Hüllkurve. Formen inkl. Zufall — „✦ Zufall" wählt bei jeder Auslösung eine neue Form.' },
  { id: 'pan', label: 'Panorama', short: 'PAN', color: '#57c7ff', keys: ['pan', 'panRnd', 'panModDepth', 'panModRate', 'panModShape', 'autopan', 'autopanSync'], primary: 'pan', bypass: neutral('pan', 'panRnd', 'panModDepth', 'autopan'), show: true,
    help: 'Position im Stereobild, Zufalls-Pan pro Auslösung, Pan-Modulation und tempo-synchrones Autopan.' },
  { id: 'trm', label: 'Tremolo', short: 'TRM', color: '#ffe14d', keys: ['tremDepth', 'tremRate', 'tremShape'], primary: 'tremDepth', bypass: { tremDepth: 0 },
    help: 'Amplitudenmodulation pro Step.' },
  { id: 'pmd', label: 'Pitch-Mod', short: 'PMD', color: '#ff7ad9', keys: ['pmDepth', 'pmRate', 'pmShape'], primary: 'pmDepth', bypass: { pmDepth: 0 },
    help: 'Vibrato bis Sirene: Tonhöhenmodulation pro Step.' },
  { id: 'phs', label: 'Phaser', short: 'PHS', color: '#3fe0c5', keys: ['phaserMix', 'phaserRate', 'phaserDepth', 'phaserFb'], primary: 'phaserMix', bypass: { phaserMix: 0 },
    help: '6-stufiger Phaser mit Feedback, pro Step.' },
  { id: 'flg', label: 'Flanger', short: 'FLG', color: '#5f8dff', keys: ['flangerMix', 'flangerRate', 'flangerDepth', 'flangerFb'], primary: 'flangerMix', bypass: { flangerMix: 0 },
    help: 'Flanger mit positivem/negativem Feedback, pro Step.' },
  { id: 'cho', label: 'Chorus', short: 'CHO', color: '#8fd3ff', keys: ['chorusMix', 'chorusRate', 'chorusDepth'], primary: 'chorusMix', bypass: { chorusMix: 0 },
    help: 'Stereo-Chorus pro Step.' },
  { id: 'dly', label: 'Delay', short: 'DLY', color: '#6ee07a', keys: ['delayMix', 'delaySync', 'delayFb', 'delayTone', 'delayPP'], primary: 'delayMix', bypass: { delayMix: 0 }, show: true,
    help: 'Tempo-synchrones Delay pro Step — der Ausklang läuft über den Step hinaus.' },
  { id: 'rev', label: 'Reverb', short: 'REV', color: '#9b8cff', keys: ['verbMix', 'verbSize', 'verbDecay', 'verbDamp'], primary: 'verbMix', bypass: { verbMix: 0 }, show: true,
    help: 'Eigener Hall pro Step (8×8-FDN).' },
  { id: 'mut', label: 'Mutate', short: 'MUT', color: '#ff9f1c', keys: ['mutate', 'mutRate', 'mutHold', 'mutPitch', 'mutFilter', 'mutPan', 'mutWarp', 'mutLevel'], primary: 'mutate', bypass: { mutate: 0 }, show: true,
    help: 'Nach dem Ansatz jedes Mal anders: der Attack bleibt identisch, danach moduliert Mutate Pitch, Filter, Raum, Warp und Pegel bei jeder Auslösung neu.' },
  { id: 'rip', label: 'Rip', short: 'RIP', color: '#ff3b2f', keys: ['ripWeight'], primary: 'ripWeight', ripPower: true,
    help: 'Wie stark das neuronale Netz von Rip auf diesem Step zum Wiederholen neigt. Power schaltet Rip ein.' },
];
export const LAYER_MAP = Object.fromEntries(LAYERS.map((l) => [l.id, l]));

/** Kurznamen für Lanes (wo der Param-Label allein mehrdeutig wäre) */
export const LANE_LABEL = {
  gain: 'Pegel', prob: 'Chance', gate: 'Länge', source: 'Quelle', slice: 'Slice', pitch: 'Pitch', fine: 'Fein', start: 'Start', reverse: 'Reverse', loop: 'Loop',
  note: 'Note', osc1: 'Osc 1', osc2: 'Osc 2', osc2Semi: 'Osc 2 Semi', osc2Fine: 'Osc 2 Fein', oscMix: 'Mix 1↔2', sub: 'Sub', noise: 'Noise',
  atk: 'Attack', dec: 'Decay', sus: 'Sustain', rel: 'Release',
  cutoff: 'Cutoff', res: 'Resonanz', fEnvAmt: 'Env-Menge', fEnvShape: 'Env-Form', fEnvTime: 'Env-Dauer', fType: 'Typ', fEnvLoop: 'Env-Loop',
  pan: 'Pan', panRnd: 'Zufall', panModDepth: 'Mod-Tiefe', panModRate: 'Mod-Rate', panModShape: 'Mod-Form', autopan: 'Autopan', autopanSync: 'Autopan-Rate',
  tremDepth: 'Tiefe', tremRate: 'Rate', tremShape: 'Form', pmDepth: 'Tiefe', pmRate: 'Rate', pmShape: 'Form',
  phaserMix: 'Mix', phaserRate: 'Rate', phaserDepth: 'Tiefe', phaserFb: 'Feedback', flangerMix: 'Mix', flangerRate: 'Rate', flangerDepth: 'Tiefe', flangerFb: 'Feedback',
  chorusMix: 'Mix', chorusRate: 'Rate', chorusDepth: 'Tiefe', delayMix: 'Send', delaySync: 'Zeit', delayFb: 'Feedback', delayTone: 'Ton', delayPP: 'Ping-Pong',
  verbMix: 'Send', verbSize: 'Größe', verbDecay: 'Decay', verbDamp: 'Dämpfung',
  mutate: 'Menge', mutRate: 'Tempo', mutHold: 'Schutz', mutPitch: 'Pitch', mutFilter: 'Filter', mutPan: 'Raum', mutWarp: 'Warp', mutLevel: 'Pegel', ripWeight: 'Gewicht',
};

export function layerDefaults() {
  return Object.fromEntries(LAYERS.map((l) => [l.id, { on: true, show: !!l.show, open: false, lane: l.primary }]));
}

/** Prüft, ob ein Layer überhaupt etwas tut (für die Chip-Anzeige) */
export function layerActive(layer, steps, len) {
  if (!layer.bypass) return true;
  const ks = Object.keys(layer.bypass);
  for (let i = 0; i < len; i++) for (const k of ks) if (steps[i][k] !== layer.bypass[k]) return true;
  return false;
}

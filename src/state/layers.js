/* Chili — Layer-System
 * Jeder Layer bündelt die Parameter eines Klangbereichs. Jeder Parameter ist eine Lane über alle Steps,
 * in die direkt gezeichnet wird. Layer lassen sich ein-/ausblenden und (wo sinnvoll) bypassen —
 * Bypass setzt die Parameter des Layers in der Engine auf neutral, die gezeichneten Werte bleiben erhalten. */
import { makeStep } from './params.js';

const D = makeStep();
const neutral = (...keys) => Object.fromEntries(keys.map((k) => [k, D[k]]));

export const LAYERS = [
  { id: 'seq', label: 'Sequenz', short: 'SEQ', color: '#f3e9e4', keys: ['gain', 'prob', 'gate', 'ratchet', 'ratchVel', 'source', 'ripWeight'], primary: 'gain', show: true,
    help: 'Pegel, Wahrscheinlichkeit, Länge und Ratchets (Wiederholungen im Step) jedes Steps. „Quelle" schaltet pro Step zwischen Sample und Synth.' },
  { id: 'src', label: 'Sample', short: 'SMP', color: '#ffb36b', keys: ['slice', 'pitch', 'fine', 'start', 'reverse', 'loop'], primary: 'slice', show: true, forSource: 'sample',
    help: 'Welcher Slice auf welchem Step spielt — hoch/runter ziehen wählt den Slice. Dazu Pitch, Startpunkt, Reverse und Loop.' },
  { id: 'syn', label: 'Synth', short: 'SYN', color: '#ffd166', keys: ['note', 'osc1', 'osc2', 'osc2Semi', 'osc2Fine', 'oscMix', 'sub', 'noise'], primary: 'note', forSource: 'synth',
    help: 'Note und Klang der Synth-Engine für alle Steps mit Quelle „Synth".' },
  { id: 'env', label: 'Hüllkurve', short: 'ENV', color: '#ff7a45', keys: ['dec', 'atk', 'sus', 'rel'], primary: 'dec', bypass: neutral('atk', 'dec', 'sus', 'rel'), show: true,
    help: 'Amp-Hüllkurve pro Step. Die Lane zeigt die Form; gezogen wird der Decay.' },
  { id: 'flt', label: 'Filter', short: 'FLT', color: '#b78bff', keys: ['cutoff', 'res', 'fEnvAmt', 'fEnvShape', 'fEnvTime', 'fType', 'fEnvLoop'], primary: 'cutoff', bypass: { fType: 'off' }, show: true,
    help: 'Filter pro Step mit eigener Filter-Hüllkurve. Formen inkl. Zufall — „✦ Zufall" wählt bei jeder Auslösung eine neue Form.' },
  { id: 'pan', label: 'Raum', short: 'PAN', color: '#57c7ff', keys: ['pan', 'depth', 'spread', 'orbit', 'orbitRate', 'panRnd', 'panModDepth', 'panModRate', 'panModShape', 'autopan', 'autopanSync'], primary: 'pan', bypass: neutral('pan', 'depth', 'spread', 'orbit', 'panRnd', 'panModDepth', 'autopan'), show: true,
    help: 'Surround-Panner: Links/Rechts (Pan), Vorne/Hinten (Tiefe), Orbit um den Hörer, Spread (Stereobreite), Zufalls-Pan, Pan-Modulation und Autopan.' },
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
  { id: 'dly', label: 'Delay', short: 'DLY', color: '#6ee07a', keys: ['delayMix', 'delaySync', 'delayFb', 'delayTone', 'delayPP'], primary: 'delayMix', bypass: { delayMix: 0 },
    help: 'Tempo-synchrones Delay pro Step — der Ausklang läuft über den Step hinaus.' },
  { id: 'rev', label: 'Reverb', short: 'REV', color: '#9b8cff', keys: ['verbMix', 'verbSize', 'verbDecay', 'verbDamp'], primary: 'verbMix', bypass: { verbMix: 0 },
    help: 'Eigener Hall pro Step (8×8-FDN).' },
  { id: 'mut', label: 'Mutate', short: 'MUT', color: '#ff9f1c', keys: ['mutate', 'mutRate', 'mutHold', 'mutPitch', 'mutFilter', 'mutPan', 'mutWarp', 'mutLevel'], primary: 'mutate', bypass: { mutate: 0 }, show: true,
    help: 'Nach dem Ansatz jedes Mal anders: der Attack bleibt identisch, danach moduliert Mutate Pitch, Filter, Raum, Warp und Pegel bei jeder Auslösung neu.' },
];
export const LAYER_MAP = Object.fromEntries(LAYERS.map((l) => [l.id, l]));

/** Kurznamen für Lanes (wo der Param-Label allein mehrdeutig wäre) */
export const LANE_LABEL = {
  gain: 'Pegel', prob: 'Chance', gate: 'Länge', source: 'Quelle', slice: 'Slice', pitch: 'Pitch', fine: 'Fein', start: 'Start', reverse: 'Reverse', loop: 'Loop',
  note: 'Note', osc1: 'Osc 1', osc2: 'Osc 2', osc2Semi: 'Osc 2 Semi', osc2Fine: 'Osc 2 Fein', oscMix: 'Mix 1↔2', sub: 'Sub', noise: 'Noise',
  atk: 'Attack', dec: 'Decay', sus: 'Sustain', rel: 'Release',
  cutoff: 'Cutoff', res: 'Resonanz', fEnvAmt: 'Env-Menge', fEnvShape: 'Env-Form', fEnvTime: 'Env-Dauer', fType: 'Typ', fEnvLoop: 'Env-Loop',
  ratchet: 'Ratchet', ratchVel: 'Ratch-Dyn', depth: 'Tiefe', spread: 'Spread', orbit: 'Orbit', orbitRate: 'Orbit-Rate',
  pan: 'Pan', panRnd: 'Zufall', panModDepth: 'Mod-Tiefe', panModRate: 'Mod-Rate', panModShape: 'Mod-Form', autopan: 'Autopan', autopanSync: 'Autopan-Rate',
  tremDepth: 'Tiefe', tremRate: 'Rate', tremShape: 'Form', pmDepth: 'Tiefe', pmRate: 'Rate', pmShape: 'Form',
  phaserMix: 'Mix', phaserRate: 'Rate', phaserDepth: 'Tiefe', phaserFb: 'Feedback', flangerMix: 'Mix', flangerRate: 'Rate', flangerDepth: 'Tiefe', flangerFb: 'Feedback',
  chorusMix: 'Mix', chorusRate: 'Rate', chorusDepth: 'Tiefe', delayMix: 'Send', delaySync: 'Zeit', delayFb: 'Feedback', delayTone: 'Ton', delayPP: 'Ping-Pong',
  verbMix: 'Send', verbSize: 'Größe', verbDecay: 'Decay', verbDamp: 'Dämpfung',
  mutate: 'Menge', mutRate: 'Tempo', mutHold: 'Schutz', mutPitch: 'Pitch', mutFilter: 'Filter', mutPan: 'Raum', mutWarp: 'Warp', mutLevel: 'Pegel', ripWeight: 'Rip-Gew.',
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

/* ---- Presets pro Layer (für „Würfel 1": ein Preset für alle Steps) */
export const PRESETS = {
  seq: [{ n: 'Gerade', v: { gain: -6, prob: 1, gate: 1, ratchet: 1 } }, { n: 'Staccato', v: { gain: -4, prob: 1, gate: 0.3, ratchet: 1 } }, { n: 'Roll', v: { gain: -8, prob: 0.9, gate: 0.5, ratchet: 3, ratchVel: 0.6 } }, { n: 'Nebel', v: { gain: -10, prob: 0.55, gate: 2, ratchet: 1 } }],
  src: [{ n: 'Original', v: { pitch: 0, fine: 0, start: 0, reverse: false, loop: false } }, { n: 'Rückwärts', v: { reverse: true, pitch: 0 } }, { n: 'Oktave tief', v: { pitch: -12, reverse: false } }, { n: 'Chipmunk', v: { pitch: 12, fine: 0 } }, { n: 'Mitten-Start', v: { start: 0.4, loop: true } }],
  syn: [{ n: 'Acid', v: { osc1: 'saw', osc2: 'saw', osc2Semi: 0, osc2Fine: 9, oscMix: 0.3, sub: 0.2, noise: 0 } }, { n: 'Hohl', v: { osc1: 'square', osc2: 'tri', osc2Semi: 12, osc2Fine: 3, oscMix: 0.5, sub: 0, noise: 0 } }, { n: 'Glas', v: { osc1: 'sine', osc2: 'tri', osc2Semi: 19, osc2Fine: 0, oscMix: 0.35, sub: 0, noise: 0.03 } }, { n: 'Tief & Rau', v: { osc1: 'saw', osc2: 'square', osc2Semi: -12, osc2Fine: 12, oscMix: 0.5, sub: 0.6, noise: 0.12 } }],
  env: [{ n: 'Pluck', v: { atk: 1, dec: 140, sus: 0, rel: 60 } }, { n: 'Pad', v: { atk: 400, dec: 1200, sus: 0.7, rel: 900 } }, { n: 'Perkussiv', v: { atk: 0, dec: 70, sus: 0, rel: 30 } }, { n: 'Swell', v: { atk: 900, dec: 400, sus: 1, rel: 300 } }],
  flt: [{ n: 'Acid', v: { fType: 'lp', cutoff: 350, res: 0.8, fEnvAmt: 5, fEnvShape: 'decay', fEnvTime: 0.6, fEnvLoop: false } }, { n: 'Dunkel', v: { fType: 'lp', cutoff: 500, res: 0.15, fEnvAmt: 1, fEnvShape: 'ad', fEnvTime: 1 } }, { n: 'Chaos-Sweep', v: { fType: 'bp', cutoff: 900, res: 0.6, fEnvAmt: 4, fEnvShape: 'chaos', fEnvTime: 0.5, fEnvLoop: true } }, { n: 'Spikes', v: { fType: 'hp', cutoff: 1500, res: 0.5, fEnvAmt: -3, fEnvShape: 'rndSpikes', fEnvTime: 1, fEnvLoop: true } }, { n: 'Zufallsform', v: { fType: 'lp', cutoff: 700, res: 0.55, fEnvAmt: 4, fEnvShape: 'random', fEnvTime: 0.75 } }],
  pan: [{ n: 'Mitte', v: { pan: 0, depth: 0, spread: 1, orbit: 0, panRnd: 0 } }, { n: 'Breit', v: { pan: 0, spread: 1.8, depth: 0.1, panRnd: 0.3 } }, { n: 'Orbit', v: { orbit: 0.8, orbitRate: 0.3, depth: 0, spread: 1.3 } }, { n: 'Hinter dir', v: { depth: 0.9, pan: 0, spread: 1.4 } }, { n: 'Streuung', v: { panRnd: 0.9, depth: 0.3, spread: 1.2 } }],
  trm: [{ n: 'Puls', v: { tremDepth: 0.8, tremRate: 12, tremShape: 'square' } }, { n: 'Wabern', v: { tremDepth: 0.5, tremRate: 3, tremShape: 'sine' } }, { n: 'Zerhackt', v: { tremDepth: 1, tremRate: 24, tremShape: 'sh' } }],
  pmd: [{ n: 'Vibrato', v: { pmDepth: 0.4, pmRate: 5.5, pmShape: 'sine' } }, { n: 'Sirene', v: { pmDepth: 7, pmRate: 0.4, pmShape: 'tri' } }, { n: 'Glitch', v: { pmDepth: 5, pmRate: 14, pmShape: 'sh' } }],
  phs: [{ n: 'Langsam', v: { phaserMix: 0.7, phaserRate: 0.2, phaserDepth: 0.8, phaserFb: 0.6 } }, { n: 'Jet', v: { phaserMix: 1, phaserRate: 2, phaserDepth: 1, phaserFb: 0.85 } }],
  flg: [{ n: 'Metall', v: { flangerMix: 0.8, flangerRate: 0.15, flangerDepth: 0.8, flangerFb: 0.8 } }, { n: 'Negativ', v: { flangerMix: 0.8, flangerRate: 0.5, flangerDepth: 0.6, flangerFb: -0.75 } }],
  cho: [{ n: 'Breit', v: { chorusMix: 0.6, chorusRate: 0.6, chorusDepth: 0.6 } }, { n: 'Leiern', v: { chorusMix: 0.9, chorusRate: 2.5, chorusDepth: 1 } }],
  dly: [{ n: 'Punktiert', v: { delayMix: 0.35, delaySync: '1/8D', delayFb: 0.45, delayTone: 0.6, delayPP: true } }, { n: 'Dub', v: { delayMix: 0.5, delaySync: '1/4', delayFb: 0.75, delayTone: 0.3, delayPP: true } }, { n: 'Slap', v: { delayMix: 0.4, delaySync: '1/32', delayFb: 0.2, delayTone: 0.8, delayPP: false } }],
  rev: [{ n: 'Raum', v: { verbMix: 0.25, verbSize: 0.4, verbDecay: 1, verbDamp: 0.5 } }, { n: 'Kathedrale', v: { verbMix: 0.5, verbSize: 1, verbDecay: 9, verbDamp: 0.3 } }, { n: 'Blech', v: { verbMix: 0.35, verbSize: 0.2, verbDecay: 2.5, verbDamp: 0 } }],
  mut: [{ n: 'Leicht', v: { mutate: 0.3, mutRate: 1, mutPitch: 0.1, mutFilter: 0.6, mutPan: 0.4, mutWarp: 0.1, mutLevel: 0.2 } }, { n: 'Wild', v: { mutate: 0.85, mutRate: 6, mutPitch: 0.6, mutFilter: 1, mutPan: 0.8, mutWarp: 0.6, mutLevel: 0.5 } }, { n: 'Tape', v: { mutate: 0.6, mutRate: 0.6, mutPitch: 0.2, mutFilter: 0.2, mutPan: 0.1, mutWarp: 0.9, mutLevel: 0.3 } }],
};

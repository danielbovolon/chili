/* Layer system
 * Each layer groups the parameters of one sound area. Every parameter is a lane across all steps that you draw into.
 * Layers can be shown/hidden and (where it makes sense) bypassed — bypass neutralises the layer in the engine, drawn values are kept. */
import { makeStep } from './params.js';

const D = makeStep();
const neutral = (...keys) => Object.fromEntries(keys.map((k) => [k, D[k]]));

export const LAYERS = [
  { id: 'seq', label: 'Sequence', short: 'SEQ', color: '#f3e9e4', keys: ['gain', 'prob', 'gate', 'ratchet', 'ratchVel', 'source', 'ripWeight'], primary: 'gain', show: true,
    help: 'Level, probability, length and ratchets (repeats within the step) of every step. “Source” switches each step between sample and synth.' },
  { id: 'src', label: 'Sample', short: 'SMP', color: '#ffb36b', keys: ['slice', 'pitch', 'fine', 'start', 'reverse', 'loop'], primary: 'slice', show: true, forSource: 'sample',
    help: 'Which slice plays on which step — drag up/down to choose the slice. Plus pitch, start point, reverse and loop.' },
  { id: 'grn', label: 'Granular', short: 'GRN', color: '#ff8fb1', keys: ['grMode', 'grSize', 'grDensity', 'grPos', 'grSpray', 'grScan', 'grPitch', 'grWidth'], primary: 'grMode', bypass: { grMode: false }, forSource: 'sample',
    help: 'Granular: the sampler breaks the slice into grains. Grain size, grain rate, position, spray, scan (read speed, 0 = freeze), pitch spread and stereo width per step.' },
  { id: 'syn', label: 'Synth', short: 'SYN', color: '#ffd166', keys: ['note', 'osc1', 'osc2', 'osc2Semi', 'osc2Fine', 'oscMix', 'sub', 'noise'], primary: 'note', forSource: 'synth',
    help: 'Note and tone of the synth engine for all steps with source “Synth”.' },
  { id: 'env', label: 'Envelope', short: 'ENV', color: '#ff7a45', keys: ['dec', 'atk', 'sus', 'rel'], primary: 'dec', bypass: neutral('atk', 'dec', 'sus', 'rel'), show: true,
    help: 'Amp envelope per step. The lane shows the shape; dragging sets the decay.' },
  { id: 'flt', label: 'Filter', short: 'FLT', color: '#b78bff', keys: ['cutoff', 'res', 'fEnvAmt', 'fEnvShape', 'fEnvTime', 'fType', 'fEnvLoop'], primary: 'cutoff', bypass: { fType: 'off' }, show: true,
    help: 'Filter per step with its own filter envelope. Shapes include random ones — “✦ Random” picks a new shape on every trigger.' },
  { id: 'pan', label: 'Space', short: 'PAN', color: '#57c7ff', keys: ['pan', 'depth', 'spread', 'orbit', 'orbitRate', 'panRnd', 'panModDepth', 'panModRate', 'panModShape', 'autopan', 'autopanSync'], primary: 'pan', bypass: neutral('pan', 'depth', 'spread', 'orbit', 'panRnd', 'panModDepth', 'autopan'), show: true,
    help: 'Surround panner: left/right (pan), front/back (depth), orbit around the listener, spread (stereo width), random pan, pan modulation and autopan.' },
  { id: 'trm', label: 'Tremolo', short: 'TRM', color: '#ffe14d', keys: ['tremDepth', 'tremRate', 'tremShape'], primary: 'tremDepth', bypass: { tremDepth: 0 },
    help: 'Amplitude modulation per step.' },
  { id: 'pmd', label: 'Pitch-Mod', short: 'PMD', color: '#ff7ad9', keys: ['pmDepth', 'pmRate', 'pmShape'], primary: 'pmDepth', bypass: { pmDepth: 0 },
    help: 'From vibrato to siren: pitch modulation per step.' },
  { id: 'phs', label: 'Phaser', short: 'PHS', color: '#3fe0c5', keys: ['phaserMix', 'phaserRate', 'phaserDepth', 'phaserFb'], primary: 'phaserMix', bypass: { phaserMix: 0 },
    help: '6-stage phaser with feedback, per step.' },
  { id: 'flg', label: 'Flanger', short: 'FLG', color: '#5f8dff', keys: ['flangerMix', 'flangerRate', 'flangerDepth', 'flangerFb'], primary: 'flangerMix', bypass: { flangerMix: 0 },
    help: 'Flanger with positive/negative feedback, per step.' },
  { id: 'cho', label: 'Chorus', short: 'CHO', color: '#8fd3ff', keys: ['chorusMix', 'chorusRate', 'chorusDepth'], primary: 'chorusMix', bypass: { chorusMix: 0 },
    help: 'Stereo chorus per step.' },
  { id: 'dly', label: 'Delay', short: 'DLY', color: '#6ee07a', keys: ['delayMix', 'delaySync', 'delayFb', 'delayTone', 'delayPP'], primary: 'delayMix', bypass: { delayMix: 0 },
    help: 'Tempo-synced delay per step — the tail rings on past the step.' },
  { id: 'rev', label: 'Reverb', short: 'REV', color: '#9b8cff', keys: ['verbMix', 'verbSize', 'verbDecay', 'verbDamp'], primary: 'verbMix', bypass: { verbMix: 0 },
    help: 'Its own reverb per step (8×8 FDN).' },
  { id: 'mut', label: 'Mutate', short: 'MUT', color: '#ff9f1c', keys: ['mutate', 'mutRate', 'mutHold', 'mutPitch', 'mutFilter', 'mutPan', 'mutWarp', 'mutLevel'], primary: 'mutate', bypass: { mutate: 0 }, show: true,
    help: 'Different every time after the attack: the attack stays identical, then Mutate re-modulates pitch, filter, space, warp and level on every trigger.' },
];
export const LAYER_MAP = Object.fromEntries(LAYERS.map((l) => [l.id, l]));

/** Short lane names */
export const LANE_LABEL = {
  gain: 'Level', prob: 'Chance', gate: 'Length', source: 'Source', slice: 'Slice', pitch: 'Pitch', fine: 'Fine', start: 'Start', reverse: 'Reverse', loop: 'Loop',
  note: 'Note', osc1: 'Osc 1', osc2: 'Osc 2', osc2Semi: 'Osc 2 Semi', osc2Fine: 'Osc 2 Fine', oscMix: 'Mix 1↔2', sub: 'Sub', noise: 'Noise',
  atk: 'Attack', dec: 'Decay', sus: 'Sustain', rel: 'Release',
  cutoff: 'Cutoff', res: 'Resonance', fEnvAmt: 'Env Amount', fEnvShape: 'Env Shape', fEnvTime: 'Env Time', fType: 'Type', fEnvLoop: 'Env Loop',
  grMode: 'Granular', grSize: 'Grain Size', grDensity: 'Grain Rate', grPos: 'Position', grSpray: 'Spray', grScan: 'Scan', grPitch: 'Pitch Spread', grWidth: 'Width',
  ratchet: 'Ratchet', ratchVel: 'Ratchet Dyn', depth: 'Depth', spread: 'Spread', orbit: 'Orbit', orbitRate: 'Orbit Rate',
  pan: 'Pan', panRnd: 'Random', panModDepth: 'Mod Depth', panModRate: 'Mod Rate', panModShape: 'Mod Shape', autopan: 'Autopan', autopanSync: 'Autopan Rate',
  tremDepth: 'Depth', tremRate: 'Rate', tremShape: 'Shape', pmDepth: 'Depth', pmRate: 'Rate', pmShape: 'Shape',
  phaserMix: 'Mix', phaserRate: 'Rate', phaserDepth: 'Depth', phaserFb: 'Feedback', flangerMix: 'Mix', flangerRate: 'Rate', flangerDepth: 'Depth', flangerFb: 'Feedback',
  chorusMix: 'Mix', chorusRate: 'Rate', chorusDepth: 'Depth', delayMix: 'Send', delaySync: 'Time', delayFb: 'Feedback', delayTone: 'Tone', delayPP: 'Ping-Pong',
  verbMix: 'Send', verbSize: 'Size', verbDecay: 'Decay', verbDamp: 'Damping',
  mutate: 'Amount', mutRate: 'Speed', mutHold: 'Hold', mutPitch: 'Pitch', mutFilter: 'Filter', mutPan: 'Space', mutWarp: 'Warp', mutLevel: 'Level', ripWeight: 'Rip Weight',
};

export function layerDefaults() {
  return Object.fromEntries(LAYERS.map((l) => [l.id, { on: true, show: !!l.show, open: false, lane: l.primary }]));
}

/** Does the layer do anything at all (for the chip LED) */
export function layerActive(layer, steps, len) {
  if (!layer.bypass) return true;
  const ks = Object.keys(layer.bypass);
  for (let i = 0; i < len; i++) for (const k of ks) if (steps[i][k] !== layer.bypass[k]) return true;
  return false;
}

/* ---- Presets per layer (for “Roll 1”: one preset on all steps) */
export const PRESETS = {
  seq: [{ n: 'Straight', v: { gain: -6, prob: 1, gate: 1, ratchet: 1 } }, { n: 'Staccato', v: { gain: -4, prob: 1, gate: 0.3, ratchet: 1 } }, { n: 'Roll', v: { gain: -8, prob: 0.9, gate: 0.5, ratchet: 3, ratchVel: 0.6 } }, { n: 'Haze', v: { gain: -10, prob: 0.55, gate: 2, ratchet: 1 } }],
  src: [{ n: 'Original', v: { pitch: 0, fine: 0, start: 0, reverse: false, loop: false } }, { n: 'Reversed', v: { reverse: true, pitch: 0 } }, { n: 'Octave Down', v: { pitch: -12, reverse: false } }, { n: 'Chipmunk', v: { pitch: 12, fine: 0 } }, { n: 'Mid Start', v: { start: 0.4, loop: true } }],
  grn: [{ n: 'Cloud', v: { grMode: true, grSize: 120, grDensity: 40, grSpray: 0.5, grScan: 0.3, grPitch: 0.3, grWidth: 0.9 } }, { n: 'Freeze', v: { grMode: true, grSize: 200, grDensity: 25, grSpray: 0.05, grScan: 0, grPitch: 0, grWidth: 0.6 } }, { n: 'Stutter', v: { grMode: true, grSize: 25, grDensity: 60, grSpray: 0.02, grScan: 1, grPitch: 0, grWidth: 0.2 } }, { n: 'Shimmer', v: { grMode: true, grSize: 90, grDensity: 50, grSpray: 0.3, grScan: 0.5, grPitch: 12, grWidth: 1 } }, { n: 'Reverse Haze', v: { grMode: true, grSize: 160, grDensity: 30, grSpray: 0.4, grScan: -0.5, grPitch: 0.5, grWidth: 0.8 } }],
  syn: [{ n: 'Acid', v: { osc1: 'saw', osc2: 'saw', osc2Semi: 0, osc2Fine: 9, oscMix: 0.3, sub: 0.2, noise: 0 } }, { n: 'Hollow', v: { osc1: 'square', osc2: 'tri', osc2Semi: 12, osc2Fine: 3, oscMix: 0.5, sub: 0, noise: 0 } }, { n: 'Glass', v: { osc1: 'sine', osc2: 'tri', osc2Semi: 19, osc2Fine: 0, oscMix: 0.35, sub: 0, noise: 0.03 } }, { n: 'Low & Rough', v: { osc1: 'saw', osc2: 'square', osc2Semi: -12, osc2Fine: 12, oscMix: 0.5, sub: 0.6, noise: 0.12 } }],
  env: [{ n: 'Pluck', v: { atk: 1, dec: 140, sus: 0, rel: 60 } }, { n: 'Pad', v: { atk: 400, dec: 1200, sus: 0.7, rel: 900 } }, { n: 'Percussive', v: { atk: 0, dec: 70, sus: 0, rel: 30 } }, { n: 'Swell', v: { atk: 900, dec: 400, sus: 1, rel: 300 } }],
  flt: [{ n: 'Acid', v: { fType: 'lp', cutoff: 350, res: 0.8, fEnvAmt: 5, fEnvShape: 'decay', fEnvTime: 0.6, fEnvLoop: false } }, { n: 'Dark', v: { fType: 'lp', cutoff: 500, res: 0.15, fEnvAmt: 1, fEnvShape: 'ad', fEnvTime: 1 } }, { n: 'Chaos-Sweep', v: { fType: 'bp', cutoff: 900, res: 0.6, fEnvAmt: 4, fEnvShape: 'chaos', fEnvTime: 0.5, fEnvLoop: true } }, { n: 'Spikes', v: { fType: 'hp', cutoff: 1500, res: 0.5, fEnvAmt: -3, fEnvShape: 'rndSpikes', fEnvTime: 1, fEnvLoop: true } }, { n: 'Random Shape', v: { fType: 'lp', cutoff: 700, res: 0.55, fEnvAmt: 4, fEnvShape: 'random', fEnvTime: 0.75 } }],
  pan: [{ n: 'Center', v: { pan: 0, depth: 0, spread: 1, orbit: 0, panRnd: 0 } }, { n: 'Wide', v: { pan: 0, spread: 1.8, depth: 0.1, panRnd: 0.3 } }, { n: 'Orbit', v: { orbit: 0.8, orbitRate: 0.3, depth: 0, spread: 1.3 } }, { n: 'Behind You', v: { depth: 0.9, pan: 0, spread: 1.4 } }, { n: 'Scatter', v: { panRnd: 0.9, depth: 0.3, spread: 1.2 } }],
  trm: [{ n: 'Pulse', v: { tremDepth: 0.8, tremRate: 12, tremShape: 'square' } }, { n: 'Wobble', v: { tremDepth: 0.5, tremRate: 3, tremShape: 'sine' } }, { n: 'Chopped', v: { tremDepth: 1, tremRate: 24, tremShape: 'sh' } }],
  pmd: [{ n: 'Vibrato', v: { pmDepth: 0.4, pmRate: 5.5, pmShape: 'sine' } }, { n: 'Siren', v: { pmDepth: 7, pmRate: 0.4, pmShape: 'tri' } }, { n: 'Glitch', v: { pmDepth: 5, pmRate: 14, pmShape: 'sh' } }],
  phs: [{ n: 'Slow', v: { phaserMix: 0.7, phaserRate: 0.2, phaserDepth: 0.8, phaserFb: 0.6 } }, { n: 'Jet', v: { phaserMix: 1, phaserRate: 2, phaserDepth: 1, phaserFb: 0.85 } }],
  flg: [{ n: 'Metal', v: { flangerMix: 0.8, flangerRate: 0.15, flangerDepth: 0.8, flangerFb: 0.8 } }, { n: 'Negative', v: { flangerMix: 0.8, flangerRate: 0.5, flangerDepth: 0.6, flangerFb: -0.75 } }],
  cho: [{ n: 'Wide', v: { chorusMix: 0.6, chorusRate: 0.6, chorusDepth: 0.6 } }, { n: 'Warble', v: { chorusMix: 0.9, chorusRate: 2.5, chorusDepth: 1 } }],
  dly: [{ n: 'Dotted', v: { delayMix: 0.35, delaySync: '1/8D', delayFb: 0.45, delayTone: 0.6, delayPP: true } }, { n: 'Dub', v: { delayMix: 0.5, delaySync: '1/4', delayFb: 0.75, delayTone: 0.3, delayPP: true } }, { n: 'Slap', v: { delayMix: 0.4, delaySync: '1/32', delayFb: 0.2, delayTone: 0.8, delayPP: false } }],
  rev: [{ n: 'Room', v: { verbMix: 0.25, verbSize: 0.4, verbDecay: 1, verbDamp: 0.5 } }, { n: 'Cathedral', v: { verbMix: 0.5, verbSize: 1, verbDecay: 9, verbDamp: 0.3 } }, { n: 'Plate', v: { verbMix: 0.35, verbSize: 0.2, verbDecay: 2.5, verbDamp: 0 } }],
  mut: [{ n: 'Light', v: { mutate: 0.3, mutRate: 1, mutPitch: 0.1, mutFilter: 0.6, mutPan: 0.4, mutWarp: 0.1, mutLevel: 0.2 } }, { n: 'Wild', v: { mutate: 0.85, mutRate: 6, mutPitch: 0.6, mutFilter: 1, mutPan: 0.8, mutWarp: 0.6, mutLevel: 0.5 } }, { n: 'Tape', v: { mutate: 0.6, mutRate: 0.6, mutPitch: 0.2, mutFilter: 0.2, mutPan: 0.1, mutWarp: 0.9, mutLevel: 0.3 } }],
};

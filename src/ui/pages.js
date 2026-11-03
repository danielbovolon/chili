/* Chili — Seiten: Projekte und Einstellungen */
import { h } from './dom.js';

export function projectsView(app) {
  const list = h('div', { class: 'plist' });
  const fileIn = h('input', { type: 'file', accept: '.chili,application/json', style: { display: 'none' }, onchange: (e) => { if (e.target.files[0]) app.importProject(e.target.files[0]); e.target.value = ''; } });
  const el = h('main', { class: 'page projects' },
    h('header', { class: 'page-h' }, h('div', {}, h('h2', {}, 'Projects'), h('p', {}, 'Stored locally in the browser (IndexedDB) — including the original audio files, step settings, master and the learned Rip brain.')),
      h('div', { class: 'tools' }, h('button', { class: 'btn accent', onclick: () => app.newProject() }, '＋ New Project'), h('button', { class: 'btn', onclick: () => fileIn.click() }, '.chili importieren'), fileIn)),
    list);
  el.refresh = async () => {
    const ps = await app.storage.listProjects();
    list.innerHTML = '';
    if (!ps.length) { list.append(h('div', { class: 'empty' }, 'No saved projects yet. Ctrl/⌘+S saves the current one.')); return; }
    for (const p of ps) {
      const cur = p.id === app.project.id;
      const t = p.transport || {};
      const nOn = (p.steps || []).slice(0, t.length || 16).filter((s) => s.on).length;
      list.append(h('article', { class: `pcard${cur ? ' cur' : ''}` },
        h('div', { class: 'pc-mini' }, (p.steps || []).slice(0, t.length || 16).map((s) => h('i', { class: s.on ? 'on' : '' }))),
        h('div', { class: 'pc-main' },
          h('h3', {}, p.name, cur ? h('span', { class: 'badge' }, 'open') : null),
          h('p', {}, `${t.length || 16} Steps · ${nOn} active · ${(p.samples || []).length} Sample(s) · ${new Date(p.updated).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}`)),
        h('div', { class: 'tools' },
          h('button', { class: 'btn accent', onclick: () => app.openProject(p.id) }, 'Open'),
          h('button', { class: 'btn', onclick: async () => { const n = prompt('New name', p.name); if (n) { p.name = n; await app.storage.putProject(p); if (cur) { app.project.name = n; app.refreshPart('header'); } el.refresh(); } } }, 'Rename'),
          h('button', { class: 'btn', onclick: () => app.duplicateProject(p) }, 'Duplicate'),
          h('button', { class: 'btn', onclick: () => app.exportProject(p) }, 'Export'),
          h('button', { class: 'btn ghost danger', onclick: async () => { if (confirm(`Delete “${p.name}” for good?`)) { await app.storage.deleteProject(p.id); el.refresh(); } } }, 'Delete'))));
    }
  };
  return el;
}

export function settingsView(app) {
  const S = app.settings, draft = { ...S };
  const body = h('div', { class: 'sgrid' });
  const row = (label, hint, ctrl) => h('div', { class: 'srow' }, h('div', {}, h('strong', {}, label), hint ? h('p', {}, hint) : null), ctrl);
  const sel = (k, opts) => { const s = h('select', { class: 'sel', onchange: (e) => { draft[k] = e.target.value; } }, opts.map(([v, l]) => h('option', { value: v, selected: String(draft[k]) === String(v) }, l))); return s; };
  const num = (k, min, max, step) => h('input', { type: 'number', class: 'num', value: draft[k], min, max, step, onchange: (e) => { draft[k] = Number(e.target.value); }, onkeydown: (e) => e.stopPropagation() });
  const chk = (k) => h('input', { type: 'checkbox', class: 'chk', checked: !!draft[k], onchange: (e) => { draft[k] = e.target.checked; } });
  const devSel = sel('outputDevice', [['', 'System default']]);
  const info = h('div', { class: 'ainfo' });
  const grp = (t, ...rows) => h('section', { class: 'panel sgroup' }, h('h3', {}, t), ...rows);
  const el = h('main', { class: 'page settings' },
    h('header', { class: 'page-h' }, h('div', {}, h('h2', {}, 'Settings'), h('p', {}, 'Changing audio device, sample rate, quality or voices restarts the engine (playback stops briefly).')),
      h('div', { class: 'tools' }, h('button', { class: 'btn', onclick: () => { Object.assign(draft, app.defaultSettings()); el.build(); } }, 'Defaults'), h('button', { class: 'btn accent', onclick: () => app.applySettings(draft) }, 'Apply'))),
    body);
  el.build = () => {
    body.innerHTML = '';
    body.append(
      grp('Audio engine',
        row('Sample rate', 'Internal processing and output. “Auto” = device default, avoids resampling in the OS.', sel('sampleRate', [['auto', 'Auto (device)'], ['44100', '44.1 kHz'], ['48000', '48 kHz'], ['88200', '88.2 kHz'], ['96000', '96 kHz']])),
        row('Latency', 'Interactive = smallest buffer. If you hear crackles choose “Balanced” or “Playback”.', sel('latency', [['interactive', 'Interactive (low)'], ['balanced', 'Balanced'], ['playback', 'Playback (stable)']])),
        row('Output device', 'Needs browser support for AudioContext.setSinkId (Chrome/Edge).', devSel),
        info),
      grp('Sound quality',
        row('Resampling quality', 'Windowed sinc for sample pitch. Measured alias rejection: Eco ≈ −61 dB, High ≈ −115 dB (default), Ultra ≈ −117 dB.', sel('quality', [['12', 'Eco · 24 taps'], ['16', 'High · 32 taps'], ['24', 'Ultra · 48 taps']])),
        row('Max. Voices', 'Simultaneous voices incl. delay/reverb tails. Extra voices fade out in 4 ms (no click).', num('maxVoices', 4, 48, 1)),
        row('Pan law', 'How panning distributes level.', sel('panLaw', [['m3', '−3 dB centre (equal power)'], ['eq0', '0 dB centre (equal power, +3 dB at the sides)'], ['m45', '−4.5 dB centre'], ['lin', '−6 dB centre (linear)'], ['bal', 'Balance (stereo, 0 dB centre)']]))),
      grp('Master safety & metering',
        row('Safety limiter', 'Lookahead 1.5 ms, bit-transparent below the ceiling. Off = overs go unprotected to the converter.', chk('limiter')),
        row('Ceiling', 'dBFS (sample peak)', num('ceiling', -6, 0, 0.1)),
        row('Peak hold', 'seconds', num('peakHold', 0, 10, 0.5))),
      grp('Tempo & tuning',
        row('Reference A4', 'For synth notes and tempo in “Note” mode.', num('refA', 400, 480, 0.1)),
        row('Note tempo from', 'Lower bound of the octave folding range (BPM). Range = [x, 2x).', num('noteFloor', 40, 160, 1))),
      grp('Recording',
        row('Automatic latency compensation', 'Synced input recordings are shifted by the round-trip latency the browser reports (output + input) so they sit on the steps.', chk('recAutoComp')),
        row('Extra offset', 'ms, added on top. Positive = recording earlier. Calibrate with a click loopback.', num('recOffset', -200, 500, 0.5))),
      grp('Bounce / Export',
        row('Bit depth', null, sel('exportBits', [['16', '16-bit PCM'], ['24', '24-bit PCM'], ['32', '32-bit float']])),
        row('TPDF dither', '16/24 bit only.', chk('dither'))),
      grp('Projects & handling',
        row('Autosave', 'seconds, 0 = off', num('autosave', 0, 600, 5))),
    );
    info.textContent = app.engine.running ? `Running: ${app.engine.sampleRate} Hz · output latency ≈ ${(app.engine.latency * 1000).toFixed(1)} ms` : 'Engine not started.';
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then((ds) => ds.filter((d) => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'default').forEach((d) => devSel.append(h('option', { value: d.deviceId, selected: d.deviceId === draft.outputDevice }, d.label || 'Output')))).catch(() => {});
    }
  };
  el.refresh = () => { Object.assign(draft, app.settings); el.build(); };
  return el;
}

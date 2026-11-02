/* Chili — Seiten: Projekte und Einstellungen */
import { h } from './dom.js';

export function projectsView(app) {
  const list = h('div', { class: 'plist' });
  const fileIn = h('input', { type: 'file', accept: '.chili,application/json', style: { display: 'none' }, onchange: (e) => { if (e.target.files[0]) app.importProject(e.target.files[0]); e.target.value = ''; } });
  const el = h('main', { class: 'page projects' },
    h('header', { class: 'page-h' }, h('div', {}, h('h2', {}, 'Projekte'), h('p', {}, 'Lokal im Browser gespeichert (IndexedDB) — inklusive Original-Audiodateien, Step-Einstellungen, Master und dem gelernten Rip-Gehirn.')),
      h('div', { class: 'tools' }, h('button', { class: 'btn accent', onclick: () => app.newProject() }, '＋ Neues Projekt'), h('button', { class: 'btn', onclick: () => fileIn.click() }, '.chili importieren'), fileIn)),
    list);
  el.refresh = async () => {
    const ps = await app.storage.listProjects();
    list.innerHTML = '';
    if (!ps.length) { list.append(h('div', { class: 'empty' }, 'Noch keine gespeicherten Projekte. Strg/⌘+S speichert das aktuelle.')); return; }
    for (const p of ps) {
      const cur = p.id === app.project.id;
      const t = p.transport || {};
      const nOn = (p.steps || []).slice(0, t.length || 16).filter((s) => s.on).length;
      list.append(h('article', { class: `pcard${cur ? ' cur' : ''}` },
        h('div', { class: 'pc-mini' }, (p.steps || []).slice(0, t.length || 16).map((s) => h('i', { class: s.on ? 'on' : '' }))),
        h('div', { class: 'pc-main' },
          h('h3', {}, p.name, cur ? h('span', { class: 'chip' }, 'geöffnet') : null),
          h('p', {}, `${t.length || 16} Steps · ${nOn} aktiv · ${(p.samples || []).length} Sample(s) · ${new Date(p.updated).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}`)),
        h('div', { class: 'tools' },
          h('button', { class: 'btn accent', onclick: () => app.openProject(p.id) }, 'Öffnen'),
          h('button', { class: 'btn', onclick: async () => { const n = prompt('Neuer Name', p.name); if (n) { p.name = n; await app.storage.putProject(p); if (cur) { app.project.name = n; app.refreshPart('header'); } el.refresh(); } } }, 'Umbenennen'),
          h('button', { class: 'btn', onclick: () => app.duplicateProject(p) }, 'Duplizieren'),
          h('button', { class: 'btn', onclick: () => app.exportProject(p) }, 'Export'),
          h('button', { class: 'btn ghost danger', onclick: async () => { if (confirm(`„${p.name}" endgültig löschen?`)) { await app.storage.deleteProject(p.id); el.refresh(); } } }, 'Löschen'))));
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
  const devSel = sel('outputDevice', [['', 'System-Standard']]);
  const info = h('div', { class: 'ainfo' });
  const grp = (t, ...rows) => h('section', { class: 'card sgroup' }, h('h3', {}, t), ...rows);
  const el = h('main', { class: 'page settings' },
    h('header', { class: 'page-h' }, h('div', {}, h('h2', {}, 'Einstellungen'), h('p', {}, 'Änderungen an Audio-Gerät, Samplerate, Qualität oder Voices starten die Engine neu (Wiedergabe stoppt kurz).')),
      h('div', { class: 'tools' }, h('button', { class: 'btn', onclick: () => { Object.assign(draft, app.defaultSettings()); el.build(); } }, 'Standardwerte'), h('button', { class: 'btn accent', onclick: () => app.applySettings(draft) }, 'Übernehmen'))),
    body);
  el.build = () => {
    body.innerHTML = '';
    body.append(
      grp('Audio-Engine',
        row('Samplerate', 'Interne Verarbeitung und Ausgabe. „Auto" = Gerätestandard, vermeidet Resampling im System.', sel('sampleRate', [['auto', 'Auto (Gerät)'], ['44100', '44.1 kHz'], ['48000', '48 kHz'], ['88200', '88.2 kHz'], ['96000', '96 kHz']])),
        row('Latenz', 'Interaktiv = kleinster Puffer. Bei Knacksern „Ausgewogen" oder „Wiedergabe" wählen.', sel('latency', [['interactive', 'Interaktiv (niedrig)'], ['balanced', 'Ausgewogen'], ['playback', 'Wiedergabe (stabil)']])),
        row('Ausgabegerät', 'Benötigt Browser-Unterstützung für AudioContext.setSinkId (Chrome/Edge).', devSel),
        info),
      grp('Klangqualität',
        row('Resampling-Qualität', 'Windowed-Sinc für Sample-Pitch. Gemessene Alias-Unterdrückung: Eco ≈ −61 dB, Hoch ≈ −115 dB (Standard), Ultra ≈ −117 dB.', sel('quality', [['12', 'Eco · 24 Taps'], ['16', 'Hoch · 32 Taps'], ['24', 'Ultra · 48 Taps']])),
        row('Max. Voices', 'Gleichzeitige Stimmen inkl. Delay/Reverb-Ausklang. Überzählige werden in 4 ms ausgeblendet (kein Klick).', num('maxVoices', 4, 48, 1)),
        row('Pan-Law', 'Wie Panning Pegel verteilt.', sel('panLaw', [['m3', '−3 dB Mitte (Equal Power)'], ['eq0', '0 dB Mitte (Equal Power, +3 dB außen)'], ['m45', '−4.5 dB Mitte'], ['lin', '−6 dB Mitte (linear)'], ['bal', 'Balance (Stereo, 0 dB Mitte)']]))),
      grp('Master-Sicherheit & Metering',
        row('Safety-Limiter', 'Lookahead 1.5 ms, unterhalb der Ceiling bit-transparent. Aus = Overs gehen ungeschützt zum Wandler.', chk('limiter')),
        row('Ceiling', 'dBFS (Sample-Peak)', num('ceiling', -6, 0, 0.1)),
        row('Peak-Hold', 'Sekunden', num('peakHold', 0, 10, 0.5))),
      grp('Tempo & Stimmung',
        row('Kammerton A4', 'Für Synth-Noten und Tempo im Modus „Note".', num('refA', 400, 480, 0.1)),
        row('Note-Tempo ab', 'Untergrenze des Oktav-Faltbereichs (BPM). Bereich = [x, 2x).', num('noteFloor', 40, 160, 1))),
      grp('Bounce / Export',
        row('Bit-Tiefe', null, sel('exportBits', [['16', '16 Bit PCM'], ['24', '24 Bit PCM'], ['32', '32 Bit Float']])),
        row('TPDF-Dither', 'Nur für 16/24 Bit.', chk('dither'))),
      grp('Projekte & Bedienung',
        row('Autosave', 'Sekunden, 0 = aus', num('autosave', 0, 600, 5)),
        row('Vorhören bei Auswahl', 'Step beim Anklicken abspielen, wenn gestoppt.', chk('auditionOnSelect'))),
    );
    info.textContent = app.engine.running ? `Läuft: ${app.engine.sampleRate} Hz · Ausgabelatenz ≈ ${(app.engine.latency * 1000).toFixed(1)} ms` : 'Engine nicht gestartet.';
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then((ds) => ds.filter((d) => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'default').forEach((d) => devSel.append(h('option', { value: d.deviceId, selected: d.deviceId === draft.outputDevice }, d.label || 'Ausgang')))).catch(() => {});
    }
  };
  el.refresh = () => { Object.assign(draft, app.settings); el.build(); };
  return el;
}

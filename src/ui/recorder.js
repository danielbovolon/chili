/* Chili — Aufnahme in den Sequencer: Eingang (Mikro/Interface) oder Master-Resampling → neues Sample */
import { h } from './dom.js';

const STATE_TXT = { idle: 'Bereit', armed: 'Wartet auf Step 1 …', countin: 'Count-in …', recording: 'Aufnahme' };

export function recorderView(app) {
  const R = () => app.rec, S = () => app.settings;
  const seg = (key, opts, get, set) => {
    const el = h('div', { class: 'seg' }, opts.map(([v, l]) => h('button', { 'data-v': v, onclick: () => set(v) }, l)));
    el.update = () => el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(get())));
    return el;
  };
  const srcSeg = seg('src', [['input', 'Eingang'], ['master', 'Resample Master']], () => R().src, (v) => app.setInputOpt('src', v));
  const modeSeg = seg('mode', [['sync', 'Sync'], ['free', 'Frei']], () => R().mode, (v) => app.setInputOpt('mode', v));
  const passSeg = seg('passes', [['1', '1×'], ['2', '2×'], ['4', '4×'], ['8', '8×']], () => R().passes, (v) => app.setInputOpt('passes', Number(v)));
  const chSeg = seg('ch', [['stereo', 'Stereo'], ['L', 'Mono L'], ['R', 'Mono R']], () => S().inputCh, (v) => app.setInputOpt('inputCh', v));
  const devSel = h('select', { class: 'sel grow', onchange: (e) => app.setInputOpt('inputDevice', e.target.value) });
  const inBtn = h('button', { class: 'btn', onclick: () => (app.engine.inputOn ? app.disableInput() : app.enableInput()) });
  const monBtn = h('button', { class: 'tog', title: 'Eingang über den Master abhören — Kopfhörer verwenden (Rückkopplung!)', onclick: () => app.setInputOpt('monitor', !R().monitor) }, 'Monitor');
  const ciBtn = h('button', { class: 'tog', title: 'Einen Pattern-Durchlauf vorzählen', onclick: () => app.setInputOpt('countIn', !R().countIn) }, 'Count-in');
  const big = h('button', { class: 'capbtn', onclick: () => app.startCapture() }, h('span', { class: 'rec-dot' }), h('span', { class: 'cap-txt' }));
  const status = h('div', { class: 'cap-status' });
  const meterBars = [h('span', {}), h('span', {})], clip = h('i', { class: 'clip', title: 'Eingang hat 0 dBFS erreicht' }, 'CLIP');
  const meter = h('div', { class: 'inmeter', title: 'Eingangspegel (Peak)' }, h('div', { class: 'bars' }, meterBars), clip);
  const inRow = h('div', { class: 'rec-row in-only' }, h('span', { class: 'tlabel' }, 'Eingang'), inBtn, devSel, chSeg, monBtn, meter);
  const el = h('section', { class: 'panel recorder', 'data-help': 'Aufnahme direkt als neues Sample. Sync startet sample-genau auf Step 1, stoppt nach der gewählten Länge und schneidet exakt auf die Steps.' },
    h('header', { class: 'ph' }, h('span', { class: 'ptitle' }, 'Aufnahme'), h('span', { class: 'grow' }), h('button', { class: 'ibtn', onclick: () => app.toggleRecorder() }, '✕')),
    h('div', { class: 'rec-body' },
      h('div', { class: 'rec-ctrl' },
        h('div', { class: 'rec-row' }, h('span', { class: 'tlabel' }, 'Quelle'), srcSeg, h('span', { class: 'tlabel' }, 'Modus'), modeSeg),
        h('div', { class: 'rec-row sync-only' }, h('span', { class: 'tlabel' }, 'Länge'), passSeg, h('span', { class: 'hint' }, 'Pattern-Durchläufe'), ciBtn),
        inRow),
      h('div', { class: 'rec-go' }, big, status)));
  let dbDev = false;
  async function loadDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    const ds = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    devSel.innerHTML = ''; devSel.append(h('option', { value: '' }, 'Standard-Eingang'));
    ds.filter((d) => d.deviceId && d.deviceId !== 'default').forEach((d, i) => devSel.append(h('option', { value: d.deviceId, selected: d.deviceId === S().inputDevice }, d.label || `Eingang ${i + 1}`)));
    devSel.value = S().inputDevice || '';
  }
  el.refresh = () => {
    const r = R();
    el.style.display = r.open ? '' : 'none';
    if (!r.open) return;
    if (!dbDev || app.engine.inputOn) { dbDev = true; loadDevices().catch(() => {}); }
    [srcSeg, modeSeg, passSeg, chSeg].forEach((x) => x.update());
    el.classList.toggle('src-master', r.src === 'master'); el.classList.toggle('mode-free', r.mode === 'free');
    inBtn.textContent = app.engine.inputOn ? 'Eingang aus' : 'Eingang aktivieren';
    monBtn.classList.toggle('on', r.monitor); ciBtn.classList.toggle('on', r.countIn);
    const busy = r.state !== 'idle';
    big.classList.toggle('on', busy); big.classList.toggle('wait', r.state === 'armed' || r.state === 'countin');
    big.querySelector('.cap-txt').textContent = busy ? (r.state === 'recording' ? 'Stopp' : 'Abbrechen') : 'Aufnehmen';
    const comp = r.src === 'input' && r.mode === 'sync' && app.engine.running ? ` · Latenzausgleich ${app.recCompMs().toFixed(1)} ms` : '';
    const info = r.info ? `${r.info.label || 'Eingang'} · ${r.info.channels} ch` : r.src === 'input' ? 'Eingang nicht aktiv' : 'Master-Ausgang (post Fader/Limiter)';
    status.textContent = `${STATE_TXT[r.state] || r.state}${r.state === 'countin' && r.countLeft >= 0 ? ` (${r.countLeft + 1})` : ''} · ${info}${comp}`;
  };
  el.meter = (m) => {
    const r = R();
    if (!r.open) return;
    if (m.inPk) for (let c = 0; c < 2; c++) { const d = 20 * Math.log10(Math.max(1e-6, m.inPk[c])); meterBars[c].style.width = `${Math.max(0, Math.min(1, (d + 60) / 60)) * 100}%`; meterBars[c].classList.toggle('hot', d > -6); }
    if (m.inOver) { clip.classList.add('on'); clearTimeout(clip.t); clip.t = setTimeout(() => clip.classList.remove('on'), 2000); }
    if (m.capN >= 0 && r.state === 'recording') {
      const s = m.capN / app.engine.sampleRate;
      big.querySelector('.cap-txt').textContent = `Stopp · ${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
    }
  };
  return el;
}

/* Chili — Brücke Main-Thread ↔ AudioWorklet */
import { encodeWav } from './wav.js';

export class Engine {
  constructor() { this.ctx = null; this.node = null; this.ls = {}; this.brainReq = new Map(); this.reqId = 0; this.rec = null; this.statePending = null; }
  on(type, fn) { (this.ls[type] ||= []).push(fn); }
  emit(type, d) { for (const f of this.ls[type] || []) f(d); }
  get running() { return !!this.node; }
  get sampleRate() { return this.ctx ? this.ctx.sampleRate : 0; }
  get latency() { return this.ctx ? (this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0) : 0; }

  async start(settings) {
    await this.close();
    const opts = { latencyHint: settings.latency || 'interactive' };
    if (settings.sampleRate && settings.sampleRate !== 'auto') opts.sampleRate = Number(settings.sampleRate);
    const ctx = new AudioContext(opts); this.ctx = ctx;
    await ctx.audioWorklet.addModule(new URL('./chili-processor.js', import.meta.url));
    const node = new AudioWorkletNode(ctx, 'chili-engine', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'discrete',
      processorOptions: { lobes: Number(settings.quality) || 16, maxVoices: Number(settings.maxVoices) || 16 },
    });
    node.port.onmessage = (e) => this.onMsg(e.data);
    node.connect(ctx.destination); this.node = node;
    if (settings.outputDevice && ctx.setSinkId) { try { await ctx.setSinkId(settings.outputDevice); } catch (err) { console.warn('Ausgabegerät nicht verfügbar', err); } }
    if (ctx.state !== 'running') await ctx.resume();
    this.settings(settings);
  }
  /* ---- Audio-Eingang: ohne Echo-Unterdrückung, Rauschfilter oder AGC — das Signal soll unverändert ankommen */
  async enableInput(deviceId) {
    this.disableInput();
    const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 }, sampleRate: { ideal: this.ctx.sampleRate } };
    if (deviceId) audio.deviceId = { exact: deviceId };
    const stream = await navigator.mediaDevices.getUserMedia({ audio });
    this.inStream = stream; this.inSrc = this.ctx.createMediaStreamSource(stream); this.inSrc.connect(this.node);
    const st = stream.getAudioTracks()[0].getSettings();
    this.inInfo = { label: stream.getAudioTracks()[0].label, channels: st.channelCount || 1, latency: st.latency || 0, sr: st.sampleRate || this.ctx.sampleRate };
    return this.inInfo;
  }
  disableInput() {
    if (this.inSrc) { try { this.inSrc.disconnect(); } catch {} this.inSrc = null; }
    if (this.inStream) { this.inStream.getTracks().forEach((t) => t.stop()); this.inStream = null; }
    this.inInfo = null;
  }
  get inputOn() { return !!this.inSrc; }
  setInput(ch, monitor) { this.post({ type: 'input', ch, monitor }); }
  /** Aufnahme in ein neues Sample. Promise liefert {L:[], R:[]} oder null (abgebrochen/leer). */
  capture(opts) {
    return new Promise((done) => { this.cap = { L: [], R: [], done }; this.post({ type: 'capArm', ...opts }); });
  }
  stopCapture() { this.post({ type: 'capStop' }); }

  async close() {
    this.disableInput();
    if (this.node) { try { this.node.disconnect(); } catch {} this.node = null; }
    if (this.ctx) { try { await this.ctx.close(); } catch {} this.ctx = null; }
  }
  post(m, tr) { if (this.node) this.node.port.postMessage(m, tr || []); }

  onMsg(m) {
    if (m.type === 'brain') { const r = this.brainReq.get(m.id); if (r) { this.brainReq.delete(m.id); r(m.brain); } return; }
    if (m.type === 'cap' && this.cap) { this.cap.L.push(m.L); this.cap.R.push(m.R); return; }
    if (m.type === 'capEnd' && this.cap) { const c = this.cap; this.cap = null; c.done(m.empty || !c.L.length ? null : { L: c.L, R: c.R }); this.emit('capState', { state: 'idle' }); return; }
    if (m.type === 'rec' && this.rec) { this.rec.L.push(m.L); this.rec.R.push(m.R); return; }
    if (m.type === 'recEnd' && this.rec) { const r = this.rec; this.rec = null; r.done(encodeWav(r.L, r.R, this.sampleRate, r.bits, r.dither)); return; }
    this.emit(m.type, m);
  }

  settings(s) { this.post({ type: 'settings', panLaw: s.panLaw, limiter: s.limiter, ceiling: Number(s.ceiling), refA: Number(s.refA) }); }
  /** State gebündelt pro Animation-Frame senden */
  setState(st) {
    const first = !this.statePending; this.statePending = st;
    if (first) requestAnimationFrame(() => { const s = this.statePending; this.statePending = null; this.post({ type: 'state', state: s }); });
  }
  setStateNow(st) { this.statePending = null; this.post({ type: 'state', state: st }); }
  play(on) { this.post({ type: 'play', on }); }
  audition(step) { this.post({ type: 'audition', step }); }
  panic() { this.post({ type: 'panic' }); }

  async decode(bytes) { return this.ctx.decodeAudioData(bytes.slice(0)); }
  sendSample(id, buf) {
    const L = new Float32Array(buf.getChannelData(0)), R = buf.numberOfChannels > 1 ? new Float32Array(buf.getChannelData(1)) : new Float32Array(L);
    this.post({ type: 'sample', id, L, R }, [L.buffer, R.buffer]);
  }
  removeSample(id) { this.post({ type: 'removeSample', id }); }

  getBrain() {
    if (!this.node) return Promise.resolve(null);
    const id = ++this.reqId;
    return new Promise((res) => { this.brainReq.set(id, res); this.post({ type: 'getBrain', id }); setTimeout(() => { if (this.brainReq.has(id)) { this.brainReq.delete(id); res(null); } }, 500); });
  }
  setBrain(b) { if (b) this.post({ type: 'setBrain', brain: b }); }
  resetBrain(seed) { this.post({ type: 'ripReset', seed }); }

  startRec(bits, dither) { return new Promise((done) => { this.rec = { L: [], R: [], bits, dither, done }; this.post({ type: 'rec', on: true }); }); }
  stopRec() { this.post({ type: 'rec', on: false }); }
}

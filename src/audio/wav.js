/* Chili — WAV-Encoder: 16/24 Bit PCM (optional TPDF-Dither) oder 32 Bit Float (IEEE, mit fact-Chunk) */
export function encodeWav(chunksL, chunksR, sr, bits = 24, dither = true) {
  const n = chunksL.reduce((s, c) => s + c.length, 0), ch = 2, float = bits === 32, bps = bits / 8;
  const dataLen = n * ch * bps, hdr = float ? 58 : 44, buf = new ArrayBuffer(hdr + dataLen), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, hdr - 8 + dataLen, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, float ? 18 : 16, true); v.setUint16(20, float ? 3 : 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * ch * bps, true); v.setUint16(32, ch * bps, true); v.setUint16(34, bits, true);
  let o = 36;
  if (float) { v.setUint16(36, 0, true); str(38, 'fact'); v.setUint32(42, 4, true); v.setUint32(46, n, true); o = 50; }
  str(o, 'data'); v.setUint32(o + 4, dataLen, true); o += 8;
  const max = Math.pow(2, bits - 1) - 1, lsb = 1 / max;
  const q = (x) => { if (dither) x += (Math.random() - Math.random()) * lsb; const s = Math.round(Math.max(-1, Math.min(1, x)) * max); return Math.max(-max - 1, Math.min(max, s)); };
  for (let c = 0; c < chunksL.length; c++) {
    const L = chunksL[c], R = chunksR[c];
    for (let i = 0; i < L.length; i++) {
      for (const x of [L[i], R[i]]) {
        if (float) { v.setFloat32(o, x, true); o += 4; }
        else if (bits === 16) { v.setInt16(o, q(x), true); o += 2; }
        else { const s = q(x); v.setUint8(o, s & 255); v.setUint8(o + 1, (s >> 8) & 255); v.setUint8(o + 2, (s >> 16) & 255); o += 3; }
      }
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}

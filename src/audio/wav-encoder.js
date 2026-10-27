/** 16-bit PCM WAV encoding for captured audio. */

export function concatChunks(chunks, length) {
  const out = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.length, length - offset);
    out.set(take === chunk.length ? chunk : chunk.subarray(0, take), offset);
    offset += take;
    if (offset >= length) break;
  }
  return out;
}

export function encodeWav(channels, sampleRate) {
  if (!Array.isArray(channels) || channels.length < 1 || channels.length > 2) {
    throw new RangeError('encodeWav expects 1 or 2 channels');
  }
  if (!channels.every((c) => c instanceof Float32Array)) throw new TypeError('Channels must be Float32Array');
  const frames = channels[0].length;
  if (!channels.every((c) => c.length === frames)) throw new RangeError('All channels must have the same length');
  if (!Number.isInteger(sampleRate) || sampleRate < 3000 || sampleRate > 384000) throw new RangeError('Invalid sample rate');

  const numChannels = channels.length;
  const bytesPerSample = 2;
  const dataSize = frames * numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeAscii = (offset, text) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return buffer;
}

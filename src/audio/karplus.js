import { clamp, createRandom } from '../core/note-utils.js';

/**
 * Karplus–Strong plucked string, rendered offline into a sample buffer.
 * (A DelayNode feedback loop cannot be shorter than one 128-frame render quantum,
 * so high notes must be rendered in JavaScript.)
 *
 * Returns the samples plus the playback rate that corrects the integer-period tuning error.
 */
export function renderPluckedString({ sampleRate, frequency, t60 = 2, brightness = 0.6, seed = 1 }) {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000) throw new RangeError('sampleRate must be >= 8000');
  if (!Number.isFinite(frequency) || frequency <= 0 || frequency >= sampleRate / 4) {
    throw new RangeError('frequency must be positive and below a quarter of the sample rate');
  }
  const decaySeconds = clamp(t60, 0.1, 12);
  const period = Math.max(2, Math.floor(sampleRate / frequency - 0.5));
  const actualFrequency = sampleRate / (period + 0.5);
  const length = Math.floor(sampleRate * (decaySeconds + 0.1));
  const out = new Float32Array(length);
  const line = new Float32Array(period);

  // Excitation: low-passed noise; brighter = more high harmonics.
  const random = createRandom(seed);
  const a = clamp(brightness, 0.05, 1);
  let lp = 0;
  let mean = 0;
  for (let i = 0; i < period; i++) {
    lp += a * (random() * 2 - 1 - lp);
    line[i] = lp;
    mean += lp;
  }
  mean /= period;
  for (let i = 0; i < period; i++) line[i] -= mean;

  // Loop gain chosen so the string loses 60 dB in roughly `t60` seconds.
  const loopGain = Math.min(0.99995, Math.pow(10, -3 / (decaySeconds * actualFrequency)));
  let index = 0;
  let peak = 0;
  for (let i = 0; i < length; i++) {
    const current = line[index];
    const next = line[(index + 1) % period];
    out[i] = current;
    line[index] = loopGain * 0.5 * (current + next);
    index = (index + 1) % period;
    const mag = Math.abs(current);
    if (mag > peak) peak = mag;
  }

  const scale = peak > 0 ? 0.9 / peak : 0;
  const fade = Math.min(length, Math.floor(sampleRate * 0.02));
  for (let i = 0; i < length; i++) {
    const tail = i >= length - fade ? (length - i) / fade : 1;
    out[i] *= scale * tail;
  }

  return { data: out, sampleRate, playbackRate: frequency / actualFrequency };
}

/** Note, pitch and numeric helpers shared by the audio engine and the UI. */

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);
const NATURAL_OFFSETS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Pitch class (0-11) of any integer, including negatives. */
export function mod12(n) {
  return ((n % 12) + 12) % 12;
}

export function isValidMidiNote(n) {
  return Number.isInteger(n) && n >= 0 && n <= 127;
}

/** Equal-temperament frequency of a MIDI note. */
export function midiToFrequency(midi, a4 = 440) {
  if (typeof midi !== 'number' || !Number.isFinite(midi)) {
    throw new TypeError('MIDI note must be a finite number');
  }
  if (typeof a4 !== 'number' || !Number.isFinite(a4) || a4 <= 0) {
    throw new RangeError('A4 reference frequency must be a positive number');
  }
  return a4 * Math.pow(2, (midi - 69) / 12);
}

export function midiToNoteName(midi) {
  if (!Number.isInteger(midi)) throw new TypeError('MIDI note must be an integer');
  return `${NOTE_NAMES[mod12(midi)]}${Math.floor(midi / 12) - 1}`;
}

/** Parse names such as "C4", "F#3", "Bb2" or "C-1" into MIDI note numbers. */
export function noteNameToMidi(name) {
  const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(String(name).trim());
  if (!match) throw new RangeError(`Invalid note name: ${name}`);
  const base = NATURAL_OFFSETS[match[1].toUpperCase()];
  const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  const midi = (Number(match[3]) + 1) * 12 + base + accidental;
  if (!isValidMidiNote(midi)) throw new RangeError(`Note out of MIDI range: ${name}`);
  return midi;
}

export function isBlackKey(midi) {
  return BLACK_PITCH_CLASSES.has(mod12(midi));
}

/** Seeded pseudo-random generator (mulberry32) for deterministic synthesis. */
export function createRandom(seed = 1) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

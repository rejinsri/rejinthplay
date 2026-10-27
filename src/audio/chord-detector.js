/**
 * Chord recognition for the auto-accompaniment.
 *
 * - Fingered: full chord shapes in any inversion (bass note breaks ties, so
 *   C-E-G-A over C is C6 while the same notes over A are Am7).
 * - Casio-style single finger: the highest key is the root; adding 1/2/3 lower keys
 *   gives minor / seventh / minor seventh.
 * - Manual: chosen from the UI.
 */

import { NOTE_NAMES, isValidMidiNote, mod12 } from '../core/note-utils.js';

export const CHORD_TYPES = Object.freeze([
  { id: 'maj', symbol: '', name: 'Major', intervals: [0, 4, 7] },
  { id: 'min', symbol: 'm', name: 'Minor', intervals: [0, 3, 7] },
  { id: '7', symbol: '7', name: 'Dominant 7th', intervals: [0, 4, 7, 10] },
  { id: 'maj7', symbol: 'maj7', name: 'Major 7th', intervals: [0, 4, 7, 11] },
  { id: 'm7', symbol: 'm7', name: 'Minor 7th', intervals: [0, 3, 7, 10] },
  { id: 'sus4', symbol: 'sus4', name: 'Suspended 4th', intervals: [0, 5, 7] },
  { id: 'sus2', symbol: 'sus2', name: 'Suspended 2nd', intervals: [0, 2, 7] },
  { id: 'dim', symbol: 'dim', name: 'Diminished', intervals: [0, 3, 6] },
  { id: 'aug', symbol: 'aug', name: 'Augmented', intervals: [0, 4, 8] },
  { id: '6', symbol: '6', name: 'Major 6th', intervals: [0, 4, 7, 9] },
  { id: 'm6', symbol: 'm6', name: 'Minor 6th', intervals: [0, 3, 7, 9] },
  { id: 'm7b5', symbol: 'm7♭5', name: 'Half-diminished', intervals: [0, 3, 6, 10] },
  { id: 'dim7', symbol: 'dim7', name: 'Diminished 7th', intervals: [0, 3, 6, 9] },
  { id: '7sus4', symbol: '7sus4', name: '7th suspended 4th', intervals: [0, 5, 7, 10] },
  { id: 'mMaj7', symbol: 'm(maj7)', name: 'Minor-major 7th', intervals: [0, 3, 7, 11] },
  { id: 'add9', symbol: 'add9', name: 'Added 9th', intervals: [0, 2, 4, 7] },
  { id: '9', symbol: '9', name: 'Dominant 9th', intervals: [0, 2, 4, 7, 10] },
  { id: '5', symbol: '5', name: 'Power chord', intervals: [0, 7] },
]);

export const CHORD_TYPE_MAP = new Map(CHORD_TYPES.map((t) => [t.id, t]));

// Interval-set signature -> candidate types (rank: lower = preferred when ambiguous).
const SIGNATURES = new Map();
function addSignature(intervals, id, rank) {
  const key = [...intervals].sort((a, b) => a - b).join(',');
  if (!SIGNATURES.has(key)) SIGNATURES.set(key, []);
  SIGNATURES.get(key).push({ id, rank });
}
CHORD_TYPES.forEach((type, index) => addSignature(type.intervals, type.id, index));
// Common voicings with the fifth omitted.
addSignature([0, 4, 10], '7', 30);
addSignature([0, 4, 11], 'maj7', 31);
addSignature([0, 3, 10], 'm7', 32);
addSignature([0, 2, 4, 10], '9', 33);

export function chordPitchClasses(root, typeId) {
  const type = CHORD_TYPE_MAP.get(typeId);
  if (!type) throw new RangeError(`Unknown chord type: ${typeId}`);
  return type.intervals.map((i) => mod12(root + i));
}

export function chordName(root, typeId, bass = root) {
  const type = CHORD_TYPE_MAP.get(typeId);
  if (!type) return '';
  const slash = bass !== undefined && bass !== root ? `/${NOTE_NAMES[mod12(bass)]}` : '';
  return `${NOTE_NAMES[mod12(root)]}${type.symbol}${slash}`;
}

export function makeChord(root, typeId, bass = root) {
  const type = CHORD_TYPE_MAP.get(typeId);
  if (!type || !Number.isInteger(root)) return null;
  const r = mod12(root);
  const b = mod12(bass);
  return {
    root: r,
    type: typeId,
    bass: b,
    symbol: type.symbol,
    name: chordName(r, typeId, b),
    intervals: [...type.intervals],
    pitchClasses: chordPitchClasses(r, typeId),
  };
}

function validNotes(notes) {
  if (!Array.isArray(notes) && !(notes instanceof Set)) return [];
  return [...notes].filter(isValidMidiNote);
}

/** Detect a chord from held MIDI notes; returns null when no chord shape matches. */
export function detectChord(notes, { minNotes = 3 } = {}) {
  const valid = validNotes(notes);
  if (valid.length === 0) return null;
  const pitchClasses = [...new Set(valid.map(mod12))].sort((a, b) => a - b);
  if (pitchClasses.length < minNotes) return null;
  const bass = mod12(Math.min(...valid));

  let best = null;
  for (const root of pitchClasses) {
    const key = pitchClasses.map((pc) => mod12(pc - root)).sort((a, b) => a - b).join(',');
    for (const match of SIGNATURES.get(key) ?? []) {
      const score = match.rank + (root === bass ? 0 : 100);
      if (!best || score < best.score) best = { root, type: match.id, score };
    }
  }
  return best ? makeChord(best.root, best.type, bass) : null;
}

/** Casio-style single-finger chords. */
export function detectCasioChord(notes) {
  const valid = [...new Set(validNotes(notes))].sort((a, b) => a - b);
  if (valid.length === 0) return null;
  const root = mod12(valid[valid.length - 1]);
  const type = ['maj', 'min', '7', 'm7'][Math.min(valid.length - 1, 3)];
  return makeChord(root, type, root);
}

export function manualChord(root, typeId) {
  if (!Number.isInteger(root) || root < 0 || root > 11) return null;
  return makeChord(root, typeId, root);
}

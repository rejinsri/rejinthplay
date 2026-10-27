/**
 * Arranger-style accompaniment. Each rhythm pattern can carry a style with bass,
 * chord and arpeggio parts (see rhythm-patterns.js). The sequencer calls
 * `handleStep` for every step, so the accompaniment is locked to the drums.
 */

import { CHORD_TYPE_MAP, chordPitchClasses } from './chord-detector.js';
import { mod12 } from '../core/note-utils.js';

const BASS_LOWEST = 33; // A1: bass roots fall in A1..G#2
const VOICING_LOW = 55; // chord tones fall in G3..F#4
const VOICING_CENTER = 61;
const MAX_CHORD_TONES = 4;

function chordInterval(intervals, wanted, fallback) {
  for (const interval of wanted) if (intervals.includes(interval)) return interval;
  return fallback;
}

/** MIDI note for a bass degree character (R 3 5 6 7 8). */
export function bassNoteFor(degree, chord) {
  const intervals = CHORD_TYPE_MAP.get(chord.type)?.intervals ?? [0, 4, 7];
  const third = chordInterval(intervals, [3, 4, 5, 2], 4);
  const fifth = chordInterval(intervals, [7, 6, 8], 7);
  const seventh = chordInterval(intervals, [10, 11, 9], third === 3 ? 10 : 9);
  const offsets = { R: 0, 3: third, 5: fifth, 6: 9, 7: seventh, 8: 12 };
  const base = BASS_LOWEST + mod12(chord.root - (BASS_LOWEST % 12));
  return base + (offsets[degree] ?? 0);
}

/** Chord voicing in a fixed register, voice-led from the previous voicing when given. */
export function voiceChord(chord, previous = null) {
  let pcs = chordPitchClasses(chord.root, chord.type);
  if (pcs.length > MAX_CHORD_TONES) {
    const fifth = mod12(chord.root + 7);
    pcs = pcs.filter((pc) => pc !== fifth).slice(0, MAX_CHORD_TONES);
  }
  const candidates = pcs.map((_, rotation) => {
    const order = pcs.slice(rotation).concat(pcs.slice(0, rotation));
    const notes = [];
    let note = VOICING_LOW + mod12(order[0] - VOICING_LOW);
    for (const pc of order) {
      if (notes.length) note = notes[notes.length - 1] + 1 + mod12(pc - notes[notes.length - 1] - 1);
      notes.push(note);
    }
    return notes;
  });
  const cost = (notes) => {
    if (previous && previous.length === notes.length) return notes.reduce((sum, n, i) => sum + Math.abs(n - previous[i]), 0);
    const mean = notes.reduce((a, b) => a + b, 0) / notes.length;
    return Math.abs(mean - VOICING_CENTER);
  };
  return candidates.reduce((best, notes) => (cost(notes) < cost(best) ? notes : best));
}

function holdLength(pattern, index) {
  let length = 1;
  for (let i = index + 1; i < pattern.length && pattern[i] === '-'; i++) length += 1;
  return length;
}

/**
 * Notes to play at `stepIndex` for `style` over `chord`.
 * Returns [{ part: 'bass'|'chord'|'arp', notes, durationSteps, velocity }].
 */
export function buildStepEvents(style, chord, stepIndex, voicing) {
  if (!style || !chord) return [];
  const events = [];
  const chordNotes = voicing ?? voiceChord(chord);

  for (const part of ['bass', 'chord', 'arp']) {
    const pattern = style[part];
    if (!pattern) continue;
    const index = stepIndex % pattern.length;
    const ch = pattern[index];
    if (ch === '.' || ch === '-') continue;
    const durationSteps = holdLength(pattern, index);
    const accent = index === 0 ? 1.1 : 1;
    if (part === 'bass') {
      events.push({ part, notes: [bassNoteFor(ch, chord)], durationSteps, velocity: Math.round(100 * accent) });
    } else if (part === 'chord') {
      events.push({ part, notes: [...chordNotes], durationSteps, velocity: Math.round(78 * accent) });
    } else {
      const i = Number(ch) - 1;
      const note = chordNotes[i % chordNotes.length] + 12 * (1 + Math.floor(i / chordNotes.length));
      events.push({ part, notes: [note], durationSteps, velocity: Math.round(82 * accent) });
    }
  }
  return events;
}

export class AccompanimentEngine {
  /** @param {{scheduleNote: (note: {part: string, instrumentId: string, midi: number, velocity: number, time: number, duration: number}) => void}} options */
  constructor({ scheduleNote }) {
    if (typeof scheduleNote !== 'function') throw new TypeError('AccompanimentEngine requires scheduleNote()');
    this.scheduleNote = scheduleNote;
    this.enabled = false;
    this.chord = null;
    this.voicing = null;
  }

  setEnabled(on) {
    this.enabled = Boolean(on);
  }

  /** Chords take effect from the next scheduled step. Returns true when the chord changed. */
  setChord(chord) {
    if (!chord) return false;
    if (this.chord && this.chord.name === chord.name) return false;
    this.chord = chord;
    this.voicing = voiceChord(chord, this.voicing);
    return true;
  }

  clearChord() {
    this.chord = null;
    this.voicing = null;
  }

  handleStep({ style, step, time, stepDuration }) {
    if (!this.enabled || !style || !this.chord) return [];
    const events = buildStepEvents(style, this.chord, step, this.voicing);
    for (const event of events) {
      const instrumentId = event.part === 'bass' ? style.bassPatch : event.part === 'arp' ? style.arpPatch : style.chordPatch;
      const part = event.part === 'bass' ? 'bass' : 'chord';
      const duration = Math.max(0.03, event.durationSteps * stepDuration * 0.92);
      for (const midi of event.notes) {
        this.scheduleNote({ part, instrumentId, midi, velocity: event.velocity, time, duration });
      }
    }
    return events;
  }
}

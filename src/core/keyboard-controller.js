import { DEFAULT_BASE_NOTE, HELD_CONTROLS, REPEATABLE_CONTROLS } from './key-mapping.js';
import { clamp, isValidMidiNote } from './note-utils.js';

export const MIN_OCTAVE = -3;
export const MAX_OCTAVE = 3;

/**
 * Turns raw key events into note/control actions.
 *
 * - Auto-repeat and duplicate key-downs never retrigger a note.
 * - The note chosen at key-down is remembered, so changing octave while a key is
 *   held still releases the right note (no stuck notes).
 * - `releaseAll()` is used on window blur so nothing hangs when focus is lost.
 */
export class KeyboardController {
  constructor({ mapper, baseNote = DEFAULT_BASE_NOTE, octave = 0 } = {}) {
    if (!mapper) throw new Error('KeyboardController requires a KeyMapper');
    this.mapper = mapper;
    this.baseNote = baseNote;
    this.octave = clamp(Math.trunc(octave) || 0, MIN_OCTAVE, MAX_OCTAVE);
    this.pressedNotes = new Map();
    this.heldControls = new Map();
  }

  get rootNote() {
    return this.baseNote + this.octave * 12;
  }

  setOctave(octave) {
    if (!Number.isFinite(octave)) return this.octave;
    this.octave = clamp(Math.trunc(octave), MIN_OCTAVE, MAX_OCTAVE);
    return this.octave;
  }

  shiftOctave(delta) {
    return this.setOctave(this.octave + delta);
  }

  noteForOffset(offset) {
    return this.rootNote + offset;
  }

  keyDown({ code, repeat = false } = {}) {
    if (typeof code !== 'string' || code === '') return { type: 'ignored', reason: 'invalid' };
    const resolved = this.mapper.resolve(code);
    if (!resolved) return { type: 'ignored', reason: 'unmapped' };

    if (resolved.kind === 'note') {
      if (repeat || this.pressedNotes.has(code)) return { type: 'ignored', reason: 'repeat' };
      const note = this.noteForOffset(resolved.offset);
      if (!isValidMidiNote(note)) return { type: 'ignored', reason: 'out-of-range' };
      this.pressedNotes.set(code, note);
      return { type: 'noteOn', code, note };
    }

    const { action } = resolved;
    if (HELD_CONTROLS.has(action)) {
      if (repeat || this.heldControls.has(code)) return { type: 'ignored', reason: 'repeat' };
      this.heldControls.set(code, action);
      return { type: 'control', code, action, pressed: true };
    }
    if (repeat && !REPEATABLE_CONTROLS.has(action)) return { type: 'ignored', reason: 'repeat' };
    return { type: 'control', code, action, pressed: true, repeat };
  }

  keyUp({ code } = {}) {
    if (this.pressedNotes.has(code)) {
      const note = this.pressedNotes.get(code);
      this.pressedNotes.delete(code);
      return { type: 'noteOff', code, note };
    }
    if (this.heldControls.has(code)) {
      const action = this.heldControls.get(code);
      this.heldControls.delete(code);
      return { type: 'control', code, action, pressed: false };
    }
    return { type: 'ignored', reason: 'not-pressed' };
  }

  /** Release every held note and held control (focus loss, panic). */
  releaseAll() {
    const actions = [];
    for (const [code, note] of this.pressedNotes) actions.push({ type: 'noteOff', code, note });
    for (const [code, action] of this.heldControls) actions.push({ type: 'control', code, action, pressed: false });
    this.pressedNotes.clear();
    this.heldControls.clear();
    return actions;
  }

  isPressed(code) {
    return this.pressedNotes.has(code) || this.heldControls.has(code);
  }

  isControlHeld(action) {
    for (const held of this.heldControls.values()) if (held === action) return true;
    return false;
  }
}

/**
 * Laptop keyboard → musical note mapping.
 *
 * Keys are identified by `KeyboardEvent.code` (physical position), so the mapping
 * works the same on QWERTY, AZERTY, etc. and is not affected by Shift or Caps Lock.
 * Offsets are semitones above the current octave root (C4 at octave 0).
 */

export const DEFAULT_BASE_NOTE = 60;
export const NOTE_OFFSET_MIN = -12;
export const NOTE_OFFSET_MAX = 36;

export const DEFAULT_NOTE_MAP = Object.freeze({
  KeyA: 0, // C
  KeyW: 1, // C#
  KeyS: 2, // D
  KeyE: 3, // D#
  KeyD: 4, // E
  KeyF: 5, // F
  KeyT: 6, // F#
  KeyG: 7, // G
  KeyY: 8, // G#
  KeyH: 9, // A
  KeyU: 10, // A#
  KeyJ: 11, // B
  KeyK: 12, // C
  KeyO: 13, // C#
  KeyL: 14, // D
  KeyP: 15, // D#
  Semicolon: 16, // E
  Quote: 17, // F
});

export const CONTROL_KEY_MAP = Object.freeze({
  KeyZ: 'octaveDown',
  KeyX: 'octaveUp',
  KeyC: 'velocityDown',
  KeyV: 'velocityUp',
  ArrowLeft: 'transposeDown',
  ArrowRight: 'transposeUp',
  ArrowUp: 'bendUp',
  ArrowDown: 'bendDown',
  Space: 'sustain',
  Enter: 'rhythmToggle',
  NumpadEnter: 'rhythmToggle',
  Minus: 'tempoDown',
  Equal: 'tempoUp',
  BracketLeft: 'volumeDown',
  BracketRight: 'volumeUp',
  Digit1: 'instrument:1',
  Digit2: 'instrument:2',
  Digit3: 'instrument:3',
  Digit4: 'instrument:4',
  Digit5: 'instrument:5',
  Digit6: 'instrument:6',
  Digit7: 'instrument:7',
  Digit8: 'instrument:8',
  Digit9: 'instrument:9',
  Digit0: 'instrument:10',
  F1: 'help',
  F2: 'accompToggle',
  F3: 'recordToggle',
  F4: 'playToggle',
  F5: 'syncStart',
  F6: 'metronomeToggle',
  F7: 'intro',
  F8: 'variationA',
  F9: 'variationB',
  F10: 'fillIn',
  F11: 'ending',
  Escape: 'panic',
});

/** Controls that keep acting while the key auto-repeats. */
export const REPEATABLE_CONTROLS = new Set(['tempoDown', 'tempoUp', 'volumeDown', 'volumeUp', 'velocityDown', 'velocityUp']);

/** Controls that are "held" and need a release event (like a pedal). */
export const HELD_CONTROLS = new Set(['sustain', 'bendUp', 'bendDown']);

export const CONTROL_DESCRIPTIONS = Object.freeze({
  octaveDown: 'Octave down',
  octaveUp: 'Octave up',
  velocityDown: 'Velocity −8',
  velocityUp: 'Velocity +8',
  transposeDown: 'Transpose −1 semitone',
  transposeUp: 'Transpose +1 semitone',
  bendUp: 'Pitch bend up (hold)',
  bendDown: 'Pitch bend down (hold)',
  sustain: 'Sustain pedal',
  rhythmToggle: 'Rhythm start / stop',
  tempoDown: 'Tempo −1 BPM',
  tempoUp: 'Tempo +1 BPM',
  volumeDown: 'Master volume down',
  volumeUp: 'Master volume up',
  help: 'Show this help',
  accompToggle: 'Accompaniment on / off',
  recordToggle: 'Record performance on / off',
  playToggle: 'Play / stop recording',
  metronomeToggle: 'Metronome on / off',
  syncStart: 'Sync start (rhythm starts with your first chord)',
  intro: 'Intro',
  variationA: 'Variation A (fill-in while playing)',
  variationB: 'Variation B (fill-in while playing)',
  fillIn: 'Fill-in',
  ending: 'Ending (then stop)',
  panic: 'All notes off (panic) / close dialog',
});

const VALID_NOTE_CODE =
  /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|Semicolon|Quote|Comma|Period|Slash|Backslash|BracketLeft|BracketRight|Minus|Equal|Backquote|IntlBackslash)$/;

const CODE_LABELS = {
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  IntlBackslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Num Enter',
  Escape: 'Esc',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
};

export function codeToLabel(code) {
  if (CODE_LABELS[code]) return CODE_LABELS[code];
  let match = /^Key([A-Z])$/.exec(code);
  if (match) return match[1];
  match = /^Digit([0-9])$/.exec(code);
  if (match) return match[1];
  match = /^Numpad([0-9])$/.exec(code);
  if (match) return `Num${match[1]}`;
  return String(code);
}

export function isValidNoteKeyCode(code) {
  return typeof code === 'string' && VALID_NOTE_CODE.test(code);
}

/**
 * Validate a user supplied note map. Invalid entries are reported and dropped;
 * mapping a note onto a shortcut key is allowed but reported as a warning.
 */
export function validateNoteMap(map) {
  const errors = [];
  const warnings = [];
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    return { valid: false, errors: ['Key map must be an object of { keyCode: semitoneOffset }'], warnings, map: {} };
  }
  const clean = {};
  for (const [code, offset] of Object.entries(map)) {
    if (!isValidNoteKeyCode(code)) {
      errors.push(`"${code}" is not a supported note key`);
      continue;
    }
    if (!Number.isInteger(offset) || offset < NOTE_OFFSET_MIN || offset > NOTE_OFFSET_MAX) {
      errors.push(`${codeToLabel(code)}: offset must be an integer from ${NOTE_OFFSET_MIN} to ${NOTE_OFFSET_MAX}`);
      continue;
    }
    clean[code] = offset;
    if (CONTROL_KEY_MAP[code]) {
      warnings.push(`${codeToLabel(code)} replaces the "${CONTROL_DESCRIPTIONS[CONTROL_KEY_MAP[code]] ?? CONTROL_KEY_MAP[code]}" shortcut`);
    }
  }
  if (Object.keys(clean).length === 0) errors.push('Key map must contain at least one note key');
  return { valid: errors.length === 0, errors, warnings, map: clean };
}

export class KeyMapper {
  constructor(noteMap = DEFAULT_NOTE_MAP) {
    this.noteMap = {};
    this.setNoteMap(noteMap);
  }

  /** Replace the note map. Throws on invalid input; returns validation warnings. */
  setNoteMap(map) {
    const result = validateNoteMap(map);
    if (!result.valid) throw new Error(result.errors.join('; '));
    this.noteMap = result.map;
    return result;
  }

  /** Note mappings take precedence over shortcut keys. */
  resolve(code) {
    if (Object.prototype.hasOwnProperty.call(this.noteMap, code)) return { kind: 'note', offset: this.noteMap[code] };
    const action = CONTROL_KEY_MAP[code];
    if (action) return { kind: 'control', action };
    return null;
  }

  keysForOffset(offset) {
    return Object.keys(this.noteMap).filter((code) => this.noteMap[code] === offset);
  }

  entries() {
    return Object.entries(this.noteMap).sort((a, b) => a[1] - b[1]);
  }

  get range() {
    const offsets = Object.values(this.noteMap);
    return { min: Math.min(...offsets), max: Math.max(...offsets) };
  }
}

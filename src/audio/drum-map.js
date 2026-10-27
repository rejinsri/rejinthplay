/**
 * Drum sounds for the playable Drum Kit instrument, ordered from LOW to HIGH pitch.
 *
 * Two banks of 18 sounds — one sound per laptop note key (A W S E D F T G Y H U J K O L P ; '):
 *   - Kit bank (octave 0 and below): kicks, toms, snares, hats, cymbals
 *   - Percussion bank (octave +1 and above, press X): latin and hand percussion
 *
 * On the virtual keyboard the sounds run upwards from C2 (note 36) in the same order,
 * so the leftmost key is the lowest drum. `gm` is the General MIDI percussion note
 * used for MIDI export (channel 10).
 */

export const DRUM_BASE_NOTE = 36;
export const DRUM_BANK_SIZE = 18;

export const DRUM_BANKS = Object.freeze([
  { id: 'kit', name: 'Kit' },
  { id: 'percussion', name: 'Percussion' },
]);

export const DRUM_SOUNDS = Object.freeze([
  // Kit bank — low to high
  { voice: 'boom808', name: '808 Boom', gm: 35 },
  { voice: 'kick', name: 'Kick', gm: 36 },
  { voice: 'kickPunch', name: 'Punch Kick', gm: 35 },
  { voice: 'tomFloor', name: 'Floor Tom', gm: 41 },
  { voice: 'tomLow', name: 'Low Tom', gm: 45 },
  { voice: 'tomMid', name: 'Mid Tom', gm: 47 },
  { voice: 'tomHigh', name: 'High Tom', gm: 50 },
  { voice: 'snare', name: 'Snare', gm: 38 },
  { voice: 'snareTight', name: 'Tight Snare', gm: 40 },
  { voice: 'clap', name: 'Clap', gm: 39 },
  { voice: 'rim', name: 'Side Stick', gm: 37 },
  { voice: 'cowbell', name: 'Cowbell', gm: 56 },
  { voice: 'chh', name: 'Closed Hi-hat', gm: 42 },
  { voice: 'pedalHat', name: 'Pedal Hi-hat', gm: 44 },
  { voice: 'ohh', name: 'Open Hi-hat', gm: 46 },
  { voice: 'ride', name: 'Ride', gm: 51 },
  { voice: 'crash', name: 'Crash', gm: 49 },
  { voice: 'splash', name: 'Splash', gm: 55 },
  // Percussion bank — low to high
  { voice: 'surdo', name: 'Surdo', gm: 43 },
  { voice: 'congaLow', name: 'Low Conga', gm: 64 },
  { voice: 'conga', name: 'High Conga', gm: 63 },
  { voice: 'bongoLow', name: 'Low Bongo', gm: 61 },
  { voice: 'bongoHigh', name: 'High Bongo', gm: 60 },
  { voice: 'timbaleLow', name: 'Low Timbale', gm: 66 },
  { voice: 'timbaleHigh', name: 'High Timbale', gm: 65 },
  { voice: 'agogoLow', name: 'Low Agogo', gm: 68 },
  { voice: 'agogoHigh', name: 'High Agogo', gm: 67 },
  { voice: 'woodLow', name: 'Low Wood Block', gm: 77 },
  { voice: 'woodHigh', name: 'High Wood Block', gm: 76 },
  { voice: 'clave', name: 'Claves', gm: 75 },
  { voice: 'snap', name: 'Finger Snap', gm: 39 },
  { voice: 'tambourine', name: 'Tambourine', gm: 54 },
  { voice: 'shaker', name: 'Shaker', gm: 70 },
  { voice: 'guiro', name: 'Guiro', gm: 73 },
  { voice: 'rideBell', name: 'Ride Bell', gm: 53 },
  { voice: 'triangle', name: 'Triangle', gm: 81 },
]);

/** The drum sound for a note (virtual keyboard / recording), or null. */
export function drumSoundForNote(note) {
  return DRUM_SOUNDS[note - DRUM_BASE_NOTE] ?? null;
}

export function drumVoiceForNote(note) {
  return drumSoundForNote(note)?.voice ?? null;
}

/** General MIDI percussion note for MIDI export. */
export function drumGmNote(note) {
  return drumSoundForNote(note)?.gm ?? note;
}

export function drumBankForOctave(octave) {
  return octave >= 1 ? 1 : 0;
}

/** Note for a laptop key: offset 0..17 within the bank chosen by the octave. */
export function drumNoteForKey(offset, octave = 0) {
  if (!Number.isInteger(offset) || offset < 0 || offset >= DRUM_BANK_SIZE) return null;
  return DRUM_BASE_NOTE + drumBankForOctave(octave) * DRUM_BANK_SIZE + offset;
}

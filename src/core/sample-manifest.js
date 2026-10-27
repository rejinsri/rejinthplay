/**
 * Sampled-instrument manifest validation.
 *
 * Format (instrument.json, stored next to its audio files):
 * {
 *   "format": "lk61-sample-instrument",
 *   "version": 1,
 *   "name": "My Piano",
 *   "license": "CC0-1.0",                       // optional, shown in the UI
 *   "envelope": { "attack": 0.002, "decay": 0.1, "sustain": 1, "release": 0.35 },  // optional
 *   "zones": [ { "note": "C4", "file": "C4.wav", "loopStart": 0.5, "loopEnd": 1.2, "gain": 1 } ]
 * }
 * Each zone is a multi-sample root key, like a SoundFont sample zone. Notes between
 * zones are pitch-shifted from the nearest root.
 */

import { clamp, isValidMidiNote, noteNameToMidi } from './note-utils.js';

export const SAMPLE_MANIFEST_FORMAT = 'lk61-sample-instrument';
export const SAMPLE_MANIFEST_VERSION = 1;
const FILE_NAME = /^[\w\- .()]+\.(wav|mp3|ogg|flac)$/i;

export function validateSampleManifest(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['Manifest must be a JSON object'] };
  }
  if (input.format !== SAMPLE_MANIFEST_FORMAT) errors.push(`"format" must be "${SAMPLE_MANIFEST_FORMAT}"`);
  if (!Number.isInteger(input.version) || input.version < 1 || input.version > SAMPLE_MANIFEST_VERSION) {
    errors.push(`Unsupported manifest version (this app reads version ${SAMPLE_MANIFEST_VERSION})`);
  }
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 48) : '';
  if (!name) errors.push('"name" is required');
  if (!Array.isArray(input.zones) || input.zones.length === 0) errors.push('"zones" must be a non-empty array');
  else if (input.zones.length > 128) errors.push('At most 128 zones are supported');

  const zones = [];
  const usedNotes = new Set();
  (Array.isArray(input.zones) ? input.zones.slice(0, 128) : []).forEach((zone, index) => {
    const where = `zones[${index}]`;
    if (!zone || typeof zone !== 'object') {
      errors.push(`${where} must be an object`);
      return;
    }
    let midi = null;
    try {
      midi = typeof zone.note === 'number' ? zone.note : noteNameToMidi(zone.note);
    } catch {
      midi = null;
    }
    if (!isValidMidiNote(midi)) {
      errors.push(`${where}.note must be a note name like "C4" or a MIDI number`);
      return;
    }
    if (usedNotes.has(midi)) {
      errors.push(`${where}.note duplicates another zone`);
      return;
    }
    if (typeof zone.file !== 'string' || !FILE_NAME.test(zone.file)) {
      errors.push(`${where}.file must be a .wav, .mp3, .ogg or .flac file name in the same folder`);
      return;
    }
    const clean = { midi, file: zone.file, gain: finiteOr(zone.gain, 1, 0, 4) };
    if (zone.loopStart !== undefined || zone.loopEnd !== undefined) {
      const start = Number(zone.loopStart);
      const end = Number(zone.loopEnd);
      if (!(Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start)) {
        errors.push(`${where} loopStart/loopEnd must be seconds with loopEnd > loopStart`);
        return;
      }
      clean.loopStart = start;
      clean.loopEnd = end;
    }
    usedNotes.add(midi);
    zones.push(clean);
  });

  const env = input.envelope && typeof input.envelope === 'object' ? input.envelope : {};
  const envelope = {
    attack: finiteOr(env.attack, 0.002, 0, 5),
    decay: finiteOr(env.decay, 0.1, 0, 10),
    sustain: finiteOr(env.sustain, 1, 0, 1),
    release: finiteOr(env.release, 0.35, 0.01, 10),
  };

  if (errors.length) return { ok: false, errors };
  zones.sort((a, b) => a.midi - b.midi);
  return {
    ok: true,
    errors: [],
    manifest: {
      name,
      license: typeof input.license === 'string' ? input.license.slice(0, 120) : '',
      envelope,
      zones,
    },
  };
}

function finiteOr(value, fallback, min, max) {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

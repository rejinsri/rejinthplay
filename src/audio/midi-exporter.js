/**
 * Standard MIDI File (format 0) export of a recorded performance.
 */

import { clamp } from '../core/note-utils.js';
import { drumGmNote } from './drum-map.js';
import { validatePerformance } from './recording-engine.js';

/** General MIDI program numbers for the built-in instruments. */
export const GM_PROGRAMS = Object.freeze({
  piano: 0,
  epiano: 4,
  organ: 16,
  synth: 81,
  strings: 48,
  flute: 73,
  guitar: 25,
  bass: 33,
  vibes: 11,
  brass: 61,
  harpsichord: 6,
  choir: 52,
});

/** Instruments recorded on the General MIDI percussion channel (channel 10). */
const DRUM_INSTRUMENTS = new Set(['drums']);
const GM_DRUM_CHANNEL = 9;

export function encodeVariableLength(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0x0fffffff) {
    throw new RangeError('Variable-length quantity must be an integer from 0 to 0x0FFFFFFF');
  }
  const bytes = [value & 0x7f];
  let rest = value >>> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  return bytes;
}

const u32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u16 = (n) => [(n >>> 8) & 0xff, n & 0xff];
const ascii = (text) => [...String(text)].map((c) => c.charCodeAt(0) & 0x7f);

function metaEvent(type, data) {
  return [0xff, type, ...encodeVariableLength(data.length), ...data];
}

const ORDER = { program: 0, sustain: 1, noteOff: 2, noteOn: 3 };

export function performanceToMidi(performance, { ppq = 480, channel = 0, trackName = 'LK-61 Performance', programs = GM_PROGRAMS } = {}) {
  const checked = validatePerformance(performance);
  if (!checked.ok) throw new Error(`Invalid performance: ${checked.errors.join('; ')}`);
  const perf = checked.performance;
  const ch = clamp(Math.trunc(channel), 0, 15);
  const tempo = clamp(perf.tempo, 20, 400);
  const ticksPerSecond = (ppq * tempo) / 60;

  // Events are time-sorted, so the instrument in effect is tracked while mapping.
  let drums = DRUM_INSTRUMENTS.has(perf.instrument);
  const timed = [];
  perf.events.forEach((event, index) => {
    const tick = Math.round(event.t * ticksPerSecond);
    const noteChannel = drums ? GM_DRUM_CHANNEL : ch;
    // Drum notes are stored in the app's low-to-high order; MIDI wants GM percussion numbers.
    const note = drums && event.note !== undefined ? drumGmNote(event.note) : event.note;
    let bytes = null;
    switch (event.type) {
      case 'noteOn':
        bytes = [0x90 | noteChannel, note, event.velocity];
        break;
      case 'noteOff':
        bytes = [0x80 | noteChannel, note, 0x40];
        break;
      case 'sustain':
        bytes = [0xb0 | ch, 64, event.value ? 127 : 0];
        break;
      case 'program':
        drums = DRUM_INSTRUMENTS.has(event.instrument);
        if (!drums) bytes = [0xc0 | ch, clamp(programs[event.instrument] ?? 0, 0, 127)];
        break;
    }
    if (bytes) timed.push({ tick, order: ORDER[event.type], index, bytes });
  });
  timed.sort((a, b) => a.tick - b.tick || a.order - b.order || a.index - b.index);

  const microsPerQuarter = Math.round(60000000 / tempo);
  const track = [
    0, ...metaEvent(0x03, ascii(trackName)),
    0, ...metaEvent(0x51, [(microsPerQuarter >> 16) & 0xff, (microsPerQuarter >> 8) & 0xff, microsPerQuarter & 0xff]),
    0, ...metaEvent(0x58, [4, 2, 24, 8]),
  ];
  let lastTick = 0;
  for (const event of timed) {
    track.push(...encodeVariableLength(event.tick - lastTick), ...event.bytes);
    lastTick = event.tick;
  }
  track.push(0, ...metaEvent(0x2f, []));

  const header = [...ascii('MThd'), ...u32(6), ...u16(0), ...u16(1), ...u16(ppq)];
  const chunk = [...ascii('MTrk'), ...u32(track.length)];
  const out = new Uint8Array(header.length + chunk.length + track.length);
  out.set(header, 0);
  out.set(chunk, header.length);
  out.set(track, header.length + chunk.length);
  return out;
}

/**
 * Performance (event) recording and playback.
 *
 * This records what was played — note-on/off, sustain and instrument changes with
 * audio-clock timestamps — not the rendered sound. Rendered audio capture lives in
 * audio-capture.js and is a separate feature.
 *
 * File format (JSON), version 1:
 * {
 *   "format": "lk61-performance",
 *   "version": 1,
 *   "createdAt": "2026-10-20T10:00:00.000Z",
 *   "tempo": 112,                 // BPM at record time (used for MIDI export)
 *   "instrument": "piano",        // instrument at the start
 *   "duration": 12.5,             // seconds
 *   "events": [
 *     { "t": 0.000, "type": "program", "instrument": "piano" },
 *     { "t": 0.512, "type": "noteOn", "note": 60, "velocity": 96 },
 *     { "t": 0.734, "type": "sustain", "value": true },
 *     { "t": 0.901, "type": "noteOff", "note": 60 }
 *   ]
 * }
 * `t` is seconds from the start of the recording.
 */

import { isValidMidiNote } from '../core/note-utils.js';

export const PERFORMANCE_FORMAT = 'lk61-performance';
export const PERFORMANCE_VERSION = 1;
export const MAX_EVENTS = 500000;

const round = (n) => Math.round(n * 1e6) / 1e6;

export class PerformanceRecorder {
  constructor({ now }) {
    if (typeof now !== 'function') throw new TypeError('PerformanceRecorder requires now()');
    this.now = now;
    this.recording = false;
    this.events = [];
    this.held = new Set();
    this.sustainOn = false;
    this.startTime = 0;
    this.meta = { tempo: 120, instrument: 'piano' };
    this.currentInstrument = 'piano';
  }

  get eventCount() {
    return this.events.length;
  }

  get elapsed() {
    return this.recording ? Math.max(0, this.now() - this.startTime) : 0;
  }

  start({ tempo = 120, instrument = 'piano' } = {}) {
    this.events = [];
    this.held.clear();
    this.sustainOn = false;
    this.startTime = this.now();
    this.meta = { tempo, instrument };
    this.currentInstrument = instrument;
    this.recording = true;
    this.events.push({ t: 0, type: 'program', instrument });
  }

  #t() {
    return round(Math.max(0, this.now() - this.startTime));
  }

  #push(event) {
    if (this.events.length >= MAX_EVENTS) return false;
    this.events.push(event);
    return true;
  }

  noteOn(note, velocity, instrument) {
    if (!this.recording || !isValidMidiNote(note)) return;
    const t = this.#t();
    if (instrument && instrument !== this.currentInstrument) {
      this.currentInstrument = instrument;
      this.#push({ t, type: 'program', instrument });
    }
    if (this.held.has(note)) this.#push({ t, type: 'noteOff', note });
    this.held.add(note);
    this.#push({ t, type: 'noteOn', note, velocity: Math.min(127, Math.max(1, Math.round(velocity))) });
  }

  noteOff(note) {
    if (!this.recording || !this.held.has(note)) return;
    this.held.delete(note);
    this.#push({ t: this.#t(), type: 'noteOff', note });
  }

  sustain(on) {
    if (!this.recording || Boolean(on) === this.sustainOn) return;
    this.sustainOn = Boolean(on);
    this.#push({ t: this.#t(), type: 'sustain', value: this.sustainOn });
  }

  /** Stop recording; closes any held notes/sustain so playback never hangs. */
  stop() {
    if (!this.recording) return null;
    const t = this.#t();
    for (const note of this.held) this.#push({ t, type: 'noteOff', note });
    this.held.clear();
    if (this.sustainOn) this.#push({ t, type: 'sustain', value: false });
    this.sustainOn = false;
    this.recording = false;
    this.duration = t;
    return this.toPerformance();
  }

  toPerformance() {
    return {
      format: PERFORMANCE_FORMAT,
      version: PERFORMANCE_VERSION,
      createdAt: new Date().toISOString(),
      tempo: this.meta.tempo,
      instrument: this.meta.instrument,
      duration: this.duration ?? this.#t(),
      events: this.events.map((e) => ({ ...e })),
    };
  }
}

/** Validate untrusted performance data. Returns a normalized copy with events sorted by time. */
export function validatePerformance(input) {
  const errors = [];
  const fail = () => ({ ok: false, errors: errors.slice(0, 10) });
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    errors.push('Performance must be a JSON object');
    return fail();
  }
  if (input.format !== PERFORMANCE_FORMAT) errors.push(`Not an LK-61 performance file (format must be "${PERFORMANCE_FORMAT}")`);
  if (!Number.isInteger(input.version) || input.version < 1) errors.push('Missing or invalid "version"');
  else if (input.version > PERFORMANCE_VERSION) errors.push(`File version ${input.version} is newer than this app supports (${PERFORMANCE_VERSION})`);
  if (!Array.isArray(input.events)) errors.push('"events" must be an array');
  else if (input.events.length > MAX_EVENTS) errors.push(`Too many events (max ${MAX_EVENTS})`);
  if (errors.length) return fail();

  const events = [];
  input.events.forEach((e, i) => {
    if (errors.length >= 10) return;
    const where = `events[${i}]`;
    if (!e || typeof e !== 'object') return errors.push(`${where} must be an object`);
    if (typeof e.t !== 'number' || !Number.isFinite(e.t) || e.t < 0) return errors.push(`${where}.t must be a time >= 0`);
    switch (e.type) {
      case 'noteOn':
        if (!isValidMidiNote(e.note)) return errors.push(`${where}.note must be 0-127`);
        if (!Number.isInteger(e.velocity) || e.velocity < 1 || e.velocity > 127) return errors.push(`${where}.velocity must be 1-127`);
        return events.push({ t: e.t, type: 'noteOn', note: e.note, velocity: e.velocity });
      case 'noteOff':
        if (!isValidMidiNote(e.note)) return errors.push(`${where}.note must be 0-127`);
        return events.push({ t: e.t, type: 'noteOff', note: e.note });
      case 'sustain':
        if (typeof e.value !== 'boolean') return errors.push(`${where}.value must be true or false`);
        return events.push({ t: e.t, type: 'sustain', value: e.value });
      case 'program':
        if (typeof e.instrument !== 'string' || e.instrument.length > 64) return errors.push(`${where}.instrument must be a string`);
        return events.push({ t: e.t, type: 'program', instrument: e.instrument });
      default:
        return errors.push(`${where}.type "${String(e.type).slice(0, 20)}" is not supported`);
    }
  });
  if (errors.length) return fail();

  events.sort((a, b) => a.t - b.t);
  const lastT = events.length ? events[events.length - 1].t : 0;
  const tempo = typeof input.tempo === 'number' && input.tempo >= 20 && input.tempo <= 400 ? input.tempo : 120;
  return {
    ok: true,
    errors: [],
    performance: {
      format: PERFORMANCE_FORMAT,
      version: PERFORMANCE_VERSION,
      createdAt: typeof input.createdAt === 'string' ? input.createdAt : new Date().toISOString(),
      tempo,
      instrument: typeof input.instrument === 'string' ? input.instrument : 'piano',
      duration: Math.max(lastT, typeof input.duration === 'number' && Number.isFinite(input.duration) ? input.duration : 0),
      events,
    },
  };
}

export function serializePerformance(performance) {
  return JSON.stringify(performance, null, 1);
}

export function parsePerformance(text) {
  if (typeof text !== 'string') return { ok: false, errors: ['No file contents'] };
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['File is not valid JSON'] };
  }
  return validatePerformance(data);
}

/**
 * Plays a performance against the audio clock with lookahead scheduling.
 * `onEvent(event, audioTime)` is called slightly ahead of time with the exact play time.
 */
export class PerformancePlayer {
  constructor({
    getTime,
    onEvent,
    onEnd = () => {},
    lookahead = 0.025,
    scheduleAhead = 0.15,
    setTimer = (fn, ms) => setInterval(fn, ms),
    clearTimer = (id) => clearInterval(id),
  }) {
    this.getTime = getTime;
    this.onEvent = onEvent;
    this.onEnd = onEnd;
    this.lookahead = lookahead;
    this.scheduleAhead = scheduleAhead;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.performance = null;
    this.state = 'stopped';
    this.index = 0;
    this.offset = 0;
    this.startAt = 0;
    this.timer = null;
  }

  load(performance) {
    this.stop();
    this.performance = performance;
  }

  get duration() {
    return this.performance?.duration ?? 0;
  }

  get position() {
    if (this.state === 'playing') return Math.min(this.duration, Math.max(0, this.getTime() - this.startAt));
    return this.offset;
  }

  play() {
    if (!this.performance || this.state === 'playing') return false;
    if (this.state === 'stopped') {
      this.offset = 0;
      this.index = 0;
    }
    this.startAt = this.getTime() + 0.05 - this.offset;
    this.state = 'playing';
    this.timer = this.setTimer(() => this.tick(), this.lookahead * 1000);
    this.tick();
    return true;
  }

  /** Pause; events after the pause point are re-scheduled on resume. */
  pause() {
    if (this.state !== 'playing') return false;
    this.offset = this.position;
    this.#clear();
    this.state = 'paused';
    const events = this.performance.events;
    this.index = events.findIndex((e) => e.t >= this.offset);
    if (this.index === -1) this.index = events.length;
    return true;
  }

  resume() {
    return this.state === 'paused' ? this.play() : false;
  }

  stop() {
    this.#clear();
    this.state = 'stopped';
    this.offset = 0;
    this.index = 0;
  }

  tick() {
    if (this.state !== 'playing') return;
    const now = this.getTime();
    const horizon = now + this.scheduleAhead;
    const events = this.performance.events;
    while (this.index < events.length && this.startAt + events[this.index].t < horizon) {
      const event = events[this.index++];
      try {
        this.onEvent(event, Math.max(this.startAt + event.t, now));
      } catch (err) {
        console.error('[player] event handler failed', err);
      }
    }
    if (this.index >= events.length && now >= this.startAt + this.duration + 0.05) {
      this.stop();
      this.onEnd();
    }
  }

  #clear() {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }
}

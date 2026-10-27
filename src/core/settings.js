/**
 * Settings persistence. Every value is sanitized against a schema on load and on
 * write, so corrupted or hand-edited storage can never put the app in a bad state.
 */

import { validateNoteMap } from './key-mapping.js';
import { clamp } from './note-utils.js';

export const SETTINGS_VERSION = 1;
export const SETTINGS_STORAGE_KEY = 'lk61.settings.v1';

export const DEFAULT_SETTINGS = deepFreeze({
  version: SETTINGS_VERSION,
  masterVolume: 0.8,
  instrumentId: 'piano',
  octave: 0,
  transpose: 0,
  velocity: 96,
  accentOnShift: true,
  humanize: false,
  sustainMode: 'hold',
  tuningA4: 440,
  maxPolyphony: 48,
  latencyHint: 'interactive',
  showKeyLabels: true,
  keyMap: null,
  partVolumes: { keyboard: 0.9, drums: 0.9, bass: 0.8, chord: 0.6, metronome: 0.6 },
  rhythm: { patternId: '8beat', tempo: 112, swing: 0, metronome: false, drumKit: 'standard', variation: 'A' },
  accomp: { chordMode: 'fingered', splitPoint: 60, manualRoot: 0, manualType: 'maj' },
  effects: {
    highpass: { enabled: false, frequency: 80, q: 0.7 },
    lowpass: { enabled: false, frequency: 9000, q: 0.7 },
    distortion: { enabled: false, amount: 0.35, mix: 0.6 },
    chorus: { enabled: false, mix: 0.45, rate: 0.8, depth: 0.5 },
    delay: { enabled: false, time: 0.32, feedback: 0.35, mix: 0.25 },
    reverb: { enabled: true, mix: 0.22, decay: 2.2 },
  },
});

const num = (min, max) => (value, fallback) =>
  typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback;
const int = (min, max) => (value, fallback) =>
  typeof value === 'number' && Number.isFinite(value) ? clamp(Math.round(value), min, max) : fallback;
const bool = () => (value, fallback) => (typeof value === 'boolean' ? value : fallback);
const oneOf = (...values) => (value, fallback) => (values.includes(value) ? value : fallback);
const id = () => (value, fallback) =>
  typeof value === 'string' && /^[\w.:-]{1,64}$/.test(value) ? value : fallback;
const constant = (v) => () => v;
const noteMap = () => (value) => {
  if (value === null || value === undefined) return null;
  const result = validateNoteMap(value);
  return result.valid ? { ...result.map } : null;
};
const enabled = bool();

const RULES = {
  version: constant(SETTINGS_VERSION),
  masterVolume: num(0, 1),
  instrumentId: id(),
  octave: int(-3, 3),
  transpose: int(-12, 12),
  velocity: int(1, 127),
  accentOnShift: bool(),
  humanize: bool(),
  sustainMode: oneOf('hold', 'toggle'),
  tuningA4: num(415, 466),
  maxPolyphony: int(8, 128),
  latencyHint: oneOf('interactive', 'balanced', 'playback'),
  showKeyLabels: bool(),
  keyMap: noteMap(),
  partVolumes: { keyboard: num(0, 1), drums: num(0, 1), bass: num(0, 1), chord: num(0, 1), metronome: num(0, 1) },
  rhythm: {
    patternId: id(),
    tempo: int(30, 300),
    swing: num(0, 0.5),
    metronome: bool(),
    drumKit: oneOf('standard', 'rock', 'electronic', 'dance', 'jazz'),
    variation: oneOf('A', 'B'),
  },
  accomp: {
    chordMode: oneOf('fingered', 'casio', 'manual'),
    splitPoint: int(36, 96),
    manualRoot: int(0, 11),
    manualType: id(),
  },
  effects: {
    highpass: { enabled, frequency: num(20, 5000), q: num(0.1, 20) },
    lowpass: { enabled, frequency: num(200, 20000), q: num(0.1, 20) },
    distortion: { enabled, amount: num(0, 1), mix: num(0, 1) },
    chorus: { enabled, mix: num(0, 1), rate: num(0.05, 8), depth: num(0, 1) },
    delay: { enabled, time: num(0.02, 1.5), feedback: num(0, 0.9), mix: num(0, 1) },
    reverb: { enabled, mix: num(0, 1), decay: num(0.3, 8) },
  },
};

function deepFreeze(obj) {
  for (const value of Object.values(obj)) if (value && typeof value === 'object') deepFreeze(value);
  return Object.freeze(obj);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeNode(defaults, rules, value) {
  const source = isPlainObject(value) ? value : {};
  const out = {};
  for (const key of Object.keys(defaults)) {
    const rule = rules[key];
    out[key] = typeof rule === 'function' ? rule(source[key], defaults[key]) : sanitizeNode(defaults[key], rule, source[key]);
  }
  return out;
}

/** Return a complete, valid settings object built from arbitrary input. */
export function sanitizeSettings(raw) {
  return sanitizeNode(DEFAULT_SETTINGS, RULES, raw);
}

export function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

function browserStorage() {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    const probe = '__lk61_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

function getPath(obj, path) {
  return path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), obj);
}

export class SettingsStore {
  constructor({ storage, key = SETTINGS_STORAGE_KEY } = {}) {
    this.storage = storage ?? browserStorage() ?? createMemoryStorage();
    this.key = key;
    this.listeners = new Set();
    this.loadError = null;
    this.data = this.load();
  }

  load() {
    let parsed = {};
    try {
      const raw = this.storage.getItem(this.key);
      if (raw) parsed = JSON.parse(raw);
    } catch (err) {
      this.loadError = `Stored settings were unreadable and have been reset (${err.message})`;
    }
    this.data = sanitizeSettings(parsed);
    return this.data;
  }

  get(path) {
    const value = path ? getPath(this.data, path) : this.data;
    return value && typeof value === 'object' ? structuredClone(value) : value;
  }

  /** Set a value by dotted path; returns the stored (sanitized) value. */
  set(path, value) {
    const keys = path.split('.');
    const next = structuredClone(this.data);
    let node = next;
    for (const key of keys.slice(0, -1)) {
      if (!isPlainObject(node[key])) node[key] = {};
      node = node[key];
    }
    node[keys[keys.length - 1]] = value;
    return this.#commit(next, path);
  }

  reset() {
    return this.#commit({}, null);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  save() {
    try {
      this.storage.setItem(this.key, JSON.stringify(this.data));
      return true;
    } catch (err) {
      console.warn('[settings] could not save settings', err);
      return false;
    }
  }

  #commit(next, path) {
    const before = JSON.stringify(this.data);
    this.data = sanitizeSettings(next);
    if (JSON.stringify(this.data) !== before) {
      this.save();
      for (const listener of this.listeners) listener(this.data, path);
    }
    return path ? this.get(path) : this.get();
  }
}

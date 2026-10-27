/**
 * Synthesized drum kits. Every hit builds a short-lived node graph that disconnects
 * itself once finished. Velocity is 0..1.5 (1 = normal accent).
 *
 * Kits share the same voices but use different synthesis parameters, so switching
 * kit changes the character of both the rhythm and the playable Drum Kit instrument.
 */

import { clamp } from '../core/note-utils.js';
import { getNoiseBuffer } from './instrument-engine.js';

const METAL_RATIOS = [2, 3, 4.16, 5.43, 6.79, 8.21];
const metalCache = new WeakMap();

export const DRUM_KITS = Object.freeze({
  standard: {
    name: 'Standard',
    kick: { from: 150, to: 45, sweep: 0.12, decay: 0.42, level: 1.1, click: 0.25 },
    snare: { tone: 190, toneTo: 150, toneDecay: 0.11, toneLevel: 0.45, noiseHp: 1400, noiseDecay: 0.2, noiseLevel: 0.55, attack: 0.001 },
    hat: { band: 10000, hp: 7000, closed: 0.05, open: 0.45, level: 0.35 },
    tom: { low: 125, high: 200, decay: 0.4, level: 0.8 },
    crash: { hp: 4500, decay: 1.6, level: 0.35 },
    ride: { band: 5200, decay: 0.8, level: 0.22 },
    clap: { band: 1150, decay: 0.16, level: 0.5 },
  },
  rock: {
    name: 'Rock',
    kick: { from: 180, to: 50, sweep: 0.09, decay: 0.36, level: 1.3, click: 0.45 },
    snare: { tone: 215, toneTo: 165, toneDecay: 0.13, toneLevel: 0.55, noiseHp: 1200, noiseDecay: 0.27, noiseLevel: 0.75, attack: 0.001 },
    hat: { band: 9500, hp: 6500, closed: 0.06, open: 0.55, level: 0.4 },
    tom: { low: 105, high: 175, decay: 0.55, level: 0.95 },
    crash: { hp: 3800, decay: 2.3, level: 0.45 },
    ride: { band: 4800, decay: 1.1, level: 0.26 },
    clap: { band: 1100, decay: 0.18, level: 0.55 },
  },
  electronic: {
    name: 'Electronic 808',
    kick: { from: 120, to: 42, sweep: 0.08, decay: 1.1, level: 1.25, click: 0.05 },
    snare: { tone: 245, toneTo: 225, toneDecay: 0.09, toneLevel: 0.5, noiseHp: 2600, noiseDecay: 0.15, noiseLevel: 0.5, attack: 0.001 },
    hat: { band: 9000, hp: 6200, closed: 0.035, open: 0.32, level: 0.38 },
    tom: { low: 140, high: 225, decay: 0.65, level: 0.85 },
    crash: { hp: 5500, decay: 1.4, level: 0.3 },
    ride: { band: 6000, decay: 0.7, level: 0.2 },
    clap: { band: 1250, decay: 0.24, level: 0.6 },
  },
  dance: {
    name: 'Dance 909',
    kick: { from: 175, to: 50, sweep: 0.055, decay: 0.32, level: 1.3, click: 0.55 },
    snare: { tone: 230, toneTo: 190, toneDecay: 0.08, toneLevel: 0.4, noiseHp: 2000, noiseDecay: 0.18, noiseLevel: 0.72, attack: 0.001 },
    hat: { band: 10500, hp: 7500, closed: 0.04, open: 0.36, level: 0.42 },
    tom: { low: 130, high: 210, decay: 0.35, level: 0.8 },
    crash: { hp: 5000, decay: 1.5, level: 0.36 },
    ride: { band: 5600, decay: 0.75, level: 0.24 },
    clap: { band: 1200, decay: 0.2, level: 0.62 },
  },
  jazz: {
    name: 'Jazz Brushes',
    kick: { from: 110, to: 55, sweep: 0.1, decay: 0.3, level: 0.7, click: 0.05 },
    snare: { tone: 200, toneTo: 180, toneDecay: 0.05, toneLevel: 0.1, noiseHp: 2400, noiseDecay: 0.3, noiseLevel: 0.42, attack: 0.025 },
    hat: { band: 8500, hp: 6000, closed: 0.06, open: 0.4, level: 0.24 },
    tom: { low: 115, high: 180, decay: 0.45, level: 0.6 },
    crash: { hp: 3500, decay: 2.2, level: 0.28 },
    ride: { band: 4500, decay: 1.4, level: 0.26 },
    clap: { band: 1000, decay: 0.14, level: 0.35 },
  },
});

export const DRUM_KIT_IDS = Object.freeze(Object.keys(DRUM_KITS));

/** Output boost so drums sit at the same loudness as sustained instruments. */
export const RHYTHM_DRUM_LEVEL = 1.6;
export const KEYBOARD_DRUM_LEVEL = 2;

export function hasDrumVoice(voice) {
  return Object.prototype.hasOwnProperty.call(VOICES, voice);
}

/** Inharmonic square-wave cluster (classic analog hi-hat source), rendered once per context. */
function getMetalBuffer(ctx) {
  if (!metalCache.has(ctx)) {
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * 1.5);
    const buffer = ctx.createBuffer(1, length, rate);
    const data = buffer.getChannelData(0);
    const base = 40;
    for (let i = 0; i < length; i++) {
      let sum = 0;
      for (const ratio of METAL_RATIOS) sum += ((i * base * ratio) / rate) % 1 < 0.5 ? 1 : -1;
      data[i] = sum / METAL_RATIOS.length;
    }
    metalCache.set(ctx, buffer);
  }
  return metalCache.get(ctx);
}

export class DrumKit {
  /** `level` is the kit's output gain (drums need headroom-friendly boost next to sustained instruments). */
  constructor(ctx, destination, kitId = 'standard', { level = 1 } = {}) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.output.gain.value = level;
    this.output.connect(destination);
    this.destination = this.output;
    this.openHat = null;
    this.setKit(kitId);
  }

  setLevel(level) {
    this.output.gain.setTargetAtTime(level, this.ctx.currentTime, 0.02);
  }

  setKit(kitId) {
    this.kitId = DRUM_KITS[kitId] ? kitId : 'standard';
    this.params = DRUM_KITS[this.kitId];
  }

  play(voice, time, velocity = 1) {
    const fn = VOICES[voice];
    if (!fn) return false;
    fn(this, Math.max(time, this.ctx.currentTime), clamp(velocity, 0, 1.5), this.params);
    return true;
  }

  /** Metronome click; `accent` marks the first beat of the bar. */
  click(time, accent) {
    const hit = this.hit(Math.max(time, this.ctx.currentTime), 0.06);
    hit.osc('sine', accent ? 1760 : 1175).connect(hit.env(accent ? 0.9 : 0.55, 0.001, 0.045));
    hit.finish();
  }

  hit(time, duration) {
    return new Hit(this, time, duration);
  }
}

/** One drum hit: collects nodes, starts sources, cleans up afterwards. */
class Hit {
  constructor(kit, time, duration) {
    this.kit = kit;
    this.ctx = kit.ctx;
    this.t = time;
    this.duration = duration;
    this.nodes = [];
    this.sources = [];
    this.out = this.#node(this.ctx.createGain());
    this.out.connect(kit.destination);
  }

  #node(node) {
    this.nodes.push(node);
    return node;
  }

  osc(type, frequency) {
    const osc = this.#node(this.ctx.createOscillator());
    osc.type = type;
    osc.frequency.value = frequency;
    this.sources.push(osc);
    return osc;
  }

  noise() {
    const src = this.#node(this.ctx.createBufferSource());
    src.buffer = getNoiseBuffer(this.ctx);
    src.loop = true;
    this.sources.push(src);
    return src;
  }

  metal() {
    const src = this.#node(this.ctx.createBufferSource());
    src.buffer = getMetalBuffer(this.ctx);
    this.sources.push(src);
    return src;
  }

  filter(type, frequency, q = 0.7) {
    const f = this.#node(this.ctx.createBiquadFilter());
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    return f;
  }

  /** Gain node with an attack/exponential-decay envelope, connected to the hit output. */
  env(peak, attack, decay, { at = 0 } = {}) {
    const g = this.#node(this.ctx.createGain());
    const t = this.t + at;
    g.gain.setValueAtTime(0.0001, this.t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.out);
    return g;
  }

  sweep(param, from, to, seconds) {
    param.setValueAtTime(from, this.t);
    param.exponentialRampToValueAtTime(to, this.t + seconds);
  }

  finish() {
    const end = this.t + this.duration;
    for (const src of this.sources) src.start(this.t);
    for (const src of this.sources) src.stop(end);
    const nodes = this.nodes.concat(this.out);
    const cleanup = () => {
      for (const node of nodes) {
        try {
          node.disconnect();
        } catch {
          /* already disconnected */
        }
      }
    };
    if (this.sources[0]) this.sources[0].onended = cleanup;
    return this;
  }
}

const VOICES = {
  kick(kit, t, v, { kick: p }) {
    const h = kit.hit(t, p.decay + 0.1);
    const body = h.osc('sine', p.from);
    h.sweep(body.frequency, p.from, p.to, p.sweep);
    body.connect(h.env(p.level * v, 0.002, p.decay));
    h.noise().connect(h.filter('lowpass', 3000)).connect(h.env(p.click * v, 0.001, 0.008));
    h.finish();
  },

  snare(kit, t, v, { snare: p }) {
    const h = kit.hit(t, Math.max(p.noiseDecay, p.toneDecay) + p.attack + 0.1);
    const tone = h.osc('triangle', p.tone);
    h.sweep(tone.frequency, p.tone, p.toneTo, 0.08);
    tone.connect(h.env(p.toneLevel * v, 0.001, p.toneDecay));
    h.noise().connect(h.filter('highpass', p.noiseHp)).connect(h.env(p.noiseLevel * v, p.attack, p.noiseDecay));
    h.finish();
  },

  rim(kit, t, v) {
    const h = kit.hit(t, 0.08);
    h.osc('triangle', 1700).connect(h.filter('bandpass', 1700, 4)).connect(h.env(0.9 * v, 0.001, 0.03));
    h.noise().connect(h.filter('highpass', 3000)).connect(h.env(0.3 * v, 0.001, 0.015));
    h.finish();
  },

  clap(kit, t, v, { clap: p }) {
    const h = kit.hit(t, p.decay + 0.15);
    const band = h.filter('bandpass', p.band, 0.9);
    h.noise().connect(band);
    for (const at of [0, 0.011, 0.022]) band.connect(h.env(p.level * v, 0.001, 0.012, { at }));
    band.connect(h.env(p.level * 0.9 * v, 0.001, p.decay, { at: 0.03 }));
    h.finish();
  },

  chh(kit, t, v, { hat: p }) {
    if (kit.openHat) {
      const g = kit.openHat.gain;
      if (typeof g.cancelAndHoldAtTime === 'function') g.cancelAndHoldAtTime(t);
      g.setTargetAtTime(0.0001, t, 0.01);
      kit.openHat = null;
    }
    const h = kit.hit(t, p.closed + 0.08);
    h.metal().connect(h.filter('bandpass', p.band, 1)).connect(h.filter('highpass', p.hp)).connect(h.env(p.level * 2.6 * v, 0.001, p.closed));
    h.finish();
  },

  ohh(kit, t, v, { hat: p }) {
    const h = kit.hit(t, p.open + 0.15);
    const choke = h.env(1, 0.001, p.open);
    h.metal().connect(h.filter('bandpass', p.band, 1)).connect(h.filter('highpass', p.hp)).connect(choke);
    choke.gain.cancelScheduledValues(t);
    choke.gain.setValueAtTime(0.0001, t);
    choke.gain.linearRampToValueAtTime(p.level * 1.4 * v, t + 0.002);
    choke.gain.exponentialRampToValueAtTime(0.0001, t + p.open);
    kit.openHat = choke;
    h.finish();
  },

  crash(kit, t, v, { crash: p }) {
    const h = kit.hit(t, p.decay + 0.2);
    h.noise().connect(h.filter('highpass', p.hp)).connect(h.env(p.level * v, 0.002, p.decay));
    h.metal().connect(h.filter('highpass', p.hp + 1500)).connect(h.env(p.level * 0.6 * v, 0.002, p.decay * 0.75));
    h.finish();
  },

  ride(kit, t, v, { ride: p }) {
    const h = kit.hit(t, p.decay + 0.2);
    h.metal().connect(h.filter('bandpass', p.band, 1.5)).connect(h.env(p.level * 1.7 * v, 0.001, p.decay));
    h.osc('sine', 3150).connect(h.env(p.level * 0.45 * v, 0.001, p.decay / 2));
    h.finish();
  },

  tomFloor: (kit, t, v, params) => tom(kit, t, v, params.tom, params.tom.low * 0.72, 1.15),
  tomLow: (kit, t, v, params) => tom(kit, t, v, params.tom, params.tom.low, 1),
  tomMid: (kit, t, v, params) => tom(kit, t, v, params.tom, (params.tom.low + params.tom.high) / 2, 0.9),
  tomHigh: (kit, t, v, params) => tom(kit, t, v, params.tom, params.tom.high, 0.8),

  conga: (kit, t, v) => handDrum(kit, t, v, 340, 300, 0.2, 0.85),

  cowbell(kit, t, v) {
    const h = kit.hit(t, 0.35);
    const band = h.filter('bandpass', 800, 2.5);
    h.osc('square', 545).connect(band);
    h.osc('square', 815).connect(band);
    band.connect(h.env(0.55 * v, 0.001, 0.25));
    h.finish();
  },

  shaker(kit, t, v) {
    const h = kit.hit(t, 0.12);
    h.noise().connect(h.filter('highpass', 6000)).connect(h.env(0.55 * v, 0.012, 0.06));
    h.finish();
  },

  clave(kit, t, v) {
    const h = kit.hit(t, 0.08);
    h.osc('sine', 2500).connect(h.env(0.75 * v, 0.001, 0.04));
    h.finish();
  },

  // --- extra kit voices -----------------------------------------------------

  boom808(kit, t, v) {
    const h = kit.hit(t, 1.6);
    const body = h.osc('sine', 62);
    h.sweep(body.frequency, 62, 38, 0.5);
    body.connect(h.env(1.25 * v, 0.004, 1.4));
    h.osc('sine', 124).connect(h.env(0.35 * v, 0.002, 0.08));
    h.finish();
  },

  kickPunch(kit, t, v) {
    const h = kit.hit(t, 0.35);
    const body = h.osc('sine', 230);
    h.sweep(body.frequency, 230, 55, 0.05);
    body.connect(h.env(1.25 * v, 0.001, 0.24));
    h.noise().connect(h.filter('bandpass', 3500, 1)).connect(h.env(0.55 * v, 0.001, 0.006));
    h.finish();
  },

  snareTight(kit, t, v, { snare: p }) {
    const h = kit.hit(t, 0.25);
    const tone = h.osc('triangle', p.tone * 1.35);
    h.sweep(tone.frequency, p.tone * 1.35, p.tone * 1.15, 0.05);
    tone.connect(h.env(p.toneLevel * 0.9 * v, 0.001, 0.06));
    h.noise().connect(h.filter('highpass', p.noiseHp * 1.8)).connect(h.env(p.noiseLevel * 1.1 * v, p.attack, p.noiseDecay * 0.6));
    h.finish();
  },

  pedalHat(kit, t, v, { hat: p }) {
    const h = kit.hit(t, 0.1);
    h.metal().connect(h.filter('bandpass', p.band * 0.8, 1.2)).connect(h.filter('highpass', p.hp * 0.9)).connect(h.env(p.level * 3 * v, 0.004, 0.045));
    h.finish();
  },

  splash(kit, t, v, { crash: p }) {
    const h = kit.hit(t, 0.9);
    h.noise().connect(h.filter('highpass', p.hp + 2500)).connect(h.env(p.level * 1.3 * v, 0.001, 0.6));
    h.metal().connect(h.filter('highpass', p.hp + 3500)).connect(h.env(p.level * 0.9 * v, 0.001, 0.45));
    h.finish();
  },

  // --- percussion bank --------------------------------------------------------

  surdo(kit, t, v) {
    const h = kit.hit(t, 0.9);
    const body = h.osc('sine', 78);
    h.sweep(body.frequency, 78, 62, 0.3);
    body.connect(h.env(1.1 * v, 0.003, 0.75));
    h.noise().connect(h.filter('lowpass', 900)).connect(h.env(0.3 * v, 0.001, 0.03));
    h.finish();
  },

  congaLow: (kit, t, v) => handDrum(kit, t, v, 230, 205, 0.28, 0.9),
  bongoLow: (kit, t, v) => handDrum(kit, t, v, 410, 380, 0.12, 0.75),
  bongoHigh: (kit, t, v) => handDrum(kit, t, v, 540, 505, 0.1, 0.7),

  timbaleLow: (kit, t, v) => timbale(kit, t, v, 390),
  timbaleHigh: (kit, t, v) => timbale(kit, t, v, 560),

  agogoLow: (kit, t, v) => bell(kit, t, v, 820, 0.35),
  agogoHigh: (kit, t, v) => bell(kit, t, v, 1180, 0.3),

  woodLow: (kit, t, v) => woodBlock(kit, t, v, 900),
  woodHigh: (kit, t, v) => woodBlock(kit, t, v, 1350),

  snap(kit, t, v) {
    const h = kit.hit(t, 0.1);
    h.noise().connect(h.filter('bandpass', 2300, 2.5)).connect(h.env(0.9 * v, 0.001, 0.035));
    h.osc('sine', 1900).connect(h.env(0.25 * v, 0.001, 0.015));
    h.finish();
  },

  tambourine(kit, t, v) {
    const h = kit.hit(t, 0.35);
    h.metal().connect(h.filter('bandpass', 9000, 1.5)).connect(h.env(0.7 * v, 0.002, 0.22));
    h.noise().connect(h.filter('highpass', 7000)).connect(h.env(0.35 * v, 0.004, 0.12));
    h.finish();
  },

  guiro(kit, t, v) {
    const h = kit.hit(t, 0.3);
    const band = h.filter('bandpass', 3200, 3);
    h.noise().connect(band);
    for (let i = 0; i < 9; i++) band.connect(h.env(1.4 * v, 0.002, 0.016, { at: i * 0.02 }));
    h.finish();
  },

  rideBell(kit, t, v) {
    const h = kit.hit(t, 1.4);
    h.osc('sine', 2650).connect(h.env(0.4 * v, 0.001, 1.1));
    h.osc('sine', 3970).connect(h.env(0.18 * v, 0.001, 0.7));
    h.metal().connect(h.filter('bandpass', 3200, 2)).connect(h.env(0.3 * v, 0.001, 0.5));
    h.finish();
  },

  triangle(kit, t, v) {
    const h = kit.hit(t, 1.8);
    h.osc('sine', 4600).connect(h.env(0.35 * v, 0.001, 1.6));
    h.osc('sine', 7400).connect(h.env(0.15 * v, 0.001, 1.1));
    h.osc('sine', 10500).connect(h.env(0.08 * v, 0.001, 0.7));
    h.finish();
  },
};

function tom(kit, t, v, p, frequency, decayScale) {
  const decay = p.decay * decayScale;
  const h = kit.hit(t, decay + 0.1);
  const osc = h.osc('sine', frequency);
  h.sweep(osc.frequency, frequency, frequency * 0.66, decay * 0.7);
  osc.connect(h.env(p.level * 1.15 * v, 0.002, decay));
  h.noise().connect(h.filter('bandpass', frequency * 4, 1.5)).connect(h.env(0.12 * v, 0.001, 0.01));
  h.finish();
}

function handDrum(kit, t, v, from, to, decay, level) {
  const h = kit.hit(t, decay + 0.1);
  const osc = h.osc('sine', from);
  h.sweep(osc.frequency, from, to, decay * 0.5);
  osc.connect(h.env(level * v, 0.001, decay));
  h.noise().connect(h.filter('bandpass', from * 3.5, 2)).connect(h.env(0.15 * v, 0.001, 0.01));
  h.finish();
}

function timbale(kit, t, v, frequency) {
  const h = kit.hit(t, 0.5);
  h.osc('triangle', frequency).connect(h.env(0.6 * v, 0.001, 0.35));
  h.osc('sine', frequency * 2.3).connect(h.env(0.2 * v, 0.001, 0.2));
  h.noise().connect(h.filter('highpass', 2500)).connect(h.env(0.3 * v, 0.001, 0.05));
  h.finish();
}

function bell(kit, t, v, frequency, decay) {
  const h = kit.hit(t, decay + 0.1);
  h.osc('sine', frequency).connect(h.env(0.6 * v, 0.001, decay));
  h.osc('sine', frequency * 1.5).connect(h.env(0.3 * v, 0.001, decay * 0.7));
  h.osc('sine', frequency * 2.76).connect(h.env(0.12 * v, 0.001, decay * 0.4));
  h.finish();
}

function woodBlock(kit, t, v, frequency) {
  const h = kit.hit(t, 0.1);
  h.osc('triangle', frequency).connect(h.filter('bandpass', frequency, 5)).connect(h.env(1.2 * v, 0.001, 0.06));
  h.finish();
}

/**
 * Modular instrument engine.
 *
 * Built-in instruments are synthesized in real time (labelled SYNTH in the UI): they
 * are original approximations, not reproductions of any manufacturer's samples.
 * Sampled instruments (labelled SAMPLED) are loaded from user-supplied, appropriately
 * licensed audio files described by an instrument manifest (see core/sample-manifest.js).
 */

import { clamp, midiToFrequency } from '../core/note-utils.js';
import { validateSampleManifest } from '../core/sample-manifest.js';
import { renderPluckedString } from './karplus.js';

export const SYNTH_INSTRUMENTS = Object.freeze([
  { id: 'piano', name: 'Grand Piano', category: 'Piano', kind: 'synth', gm: 0 },
  { id: 'epiano', name: 'Electric Piano', category: 'Piano', kind: 'synth', gm: 4 },
  { id: 'organ', name: 'Drawbar Organ', category: 'Organ', kind: 'synth', gm: 16 },
  { id: 'synth', name: 'Saw Lead', category: 'Synth', kind: 'synth', gm: 81 },
  { id: 'strings', name: 'String Ensemble', category: 'Strings', kind: 'synth', gm: 48 },
  { id: 'flute', name: 'Flute', category: 'Wind', kind: 'synth', gm: 73 },
  { id: 'guitar', name: 'Plucked Guitar', category: 'Guitar', kind: 'synth', gm: 25 },
  { id: 'bass', name: 'Electric Bass', category: 'Bass', kind: 'synth', gm: 33 },
  { id: 'drums', name: 'Drum Kit', category: 'Drums', kind: 'drums', gm: 0 },
  { id: 'vibes', name: 'Vibraphone', category: 'Mallet', kind: 'synth', gm: 11 },
  { id: 'brass', name: 'Brass Section', category: 'Brass', kind: 'synth', gm: 61 },
  { id: 'harpsichord', name: 'Harpsichord', category: 'Keys', kind: 'synth', gm: 6 },
  { id: 'choir', name: 'Choir Aahs', category: 'Voice', kind: 'synth', gm: 52 },
]);

const SYNTH_IDS = new Set(SYNTH_INSTRUMENTS.map((i) => i.id));

const PLUCK_VARIANTS = {
  guitar: (midi) => ({ t60: clamp(4 * Math.pow(2, -(midi - 40) / 24), 0.8, 4.5), brightness: 0.55 }),
  harpsichord: (midi) => ({ t60: clamp(2.6 * Math.pow(2, -(midi - 50) / 24), 0.5, 3.2), brightness: 1 }),
};

// ---------------------------------------------------------------------------
// Shared per-context resources

const contextCache = new WeakMap();

function resources(ctx) {
  let res = contextCache.get(ctx);
  if (!res) {
    res = { waves: new Map(), noise: null, plucks: new Map() };
    contextCache.set(ctx, res);
  }
  return res;
}

const WAVE_SPECS = {
  // index = harmonic number (0 = DC)
  piano: [0, 1, 0.52, 0.34, 0.2, 0.13, 0.09, 0.055, 0.035, 0.02, 0.012],
  pianoBody: [0, 1, 0.3, 0.08],
  organ: [0, 1, 0.8, 0.6, 0.5, 0, 0.32, 0, 0.25],
  flute: [0, 1, 0.24, 0.07, 0.03],
};

function getWave(ctx, name) {
  const res = resources(ctx);
  if (!res.waves.has(name)) {
    const spec = WAVE_SPECS[name];
    res.waves.set(name, ctx.createPeriodicWave(new Float32Array(spec.length), Float32Array.from(spec)));
  }
  return res.waves.get(name);
}

export function getNoiseBuffer(ctx) {
  const res = resources(ctx);
  if (!res.noise) {
    const length = Math.floor(ctx.sampleRate * 2);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    res.noise = buffer;
  }
  return res.noise;
}

function holdAt(param, time) {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(time);
  } else {
    param.cancelScheduledValues(time);
    param.setValueAtTime(param.value, time);
  }
}

const velocityCurve = (v) => 0.12 + 0.88 * Math.pow(v, 1.6);

// ---------------------------------------------------------------------------
// Voice

export class SynthVoice {
  constructor(ctx, { env, nodes, pitched, aux, startTime, release, stopTime }) {
    this.ctx = ctx;
    this.env = env;
    this.nodes = nodes;
    this.pitched = pitched;
    this.sources = [...pitched, ...aux];
    this.startTime = startTime;
    this.releaseTime = release;
    this.released = false;
    this.disposed = false;
    this.endTime = Infinity;
    this.callbacks = [];
    this.disposeTimer = null;

    for (const source of this.sources) source.start(startTime);
    if (this.sources[0]) this.sources[0].onended = () => this.#dispose();
    if (Number.isFinite(stopTime)) this.#scheduleStop(stopTime);
  }

  onEnded(callback) {
    if (this.disposed) callback();
    else this.callbacks.push(callback);
  }

  release(time = this.ctx.currentTime) {
    if (this.released) return this.endTime;
    this.released = true;
    const t = Math.max(time, this.startTime, this.ctx.currentTime);
    const gain = this.env.gain;
    holdAt(gain, t);
    gain.exponentialRampToValueAtTime(0.0001, t + this.releaseTime);
    gain.setValueAtTime(0, t + this.releaseTime + 0.005);
    const stopAt = Math.min(this.endTime, t + this.releaseTime + 0.05);
    this.#scheduleStop(stopAt);
    return stopAt;
  }

  /** Fast fade-out used for voice stealing and panic; avoids clicks. */
  stop(time = this.ctx.currentTime) {
    const t = Math.max(time, this.ctx.currentTime);
    this.released = true;
    const gain = this.env.gain;
    holdAt(gain, t);
    gain.linearRampToValueAtTime(0, t + 0.012);
    this.#scheduleStop(Math.min(this.endTime, t + 0.02));
  }

  setDetune(cents, time = this.ctx.currentTime) {
    for (const source of this.pitched) {
      source.detune.setTargetAtTime((source.baseDetune || 0) + cents, time, 0.015);
    }
  }

  #scheduleStop(time) {
    this.endTime = time;
    for (const source of this.sources) {
      try {
        source.stop(time);
      } catch {
        /* source already stopped */
      }
    }
    clearTimeout(this.disposeTimer);
    const delayMs = Math.max(0, (time - this.ctx.currentTime + 0.3) * 1000);
    this.disposeTimer = setTimeout(() => this.#dispose(), delayMs);
  }

  #dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.disposeTimer);
    for (const node of this.nodes) {
      try {
        node.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    this.nodes = [];
    const callbacks = this.callbacks;
    this.callbacks = [];
    for (const callback of callbacks) callback();
  }
}

/** Small helper that collects nodes for one voice so they can be started/stopped/cleaned together. */
class VoiceBuilder {
  constructor(ctx, destination, time, pan) {
    this.ctx = ctx;
    this.t = time;
    this.nodes = [];
    this.pitched = [];
    this.aux = [];
    this.env = this.#track(ctx.createGain());
    this.env.gain.value = 0;
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = this.#track(ctx.createStereoPanner());
      panner.pan.value = pan;
      this.env.connect(panner);
      panner.connect(destination);
    } else {
      this.env.connect(destination);
    }
  }

  #track(node) {
    this.nodes.push(node);
    return node;
  }

  osc(type, frequency, { detune = 0, wave = null } = {}) {
    const osc = this.#track(this.ctx.createOscillator());
    if (wave) osc.setPeriodicWave(wave);
    else osc.type = type;
    osc.frequency.value = frequency;
    osc.detune.value = detune;
    osc.baseDetune = detune;
    this.pitched.push(osc);
    return osc;
  }

  lfo(rate) {
    const osc = this.#track(this.ctx.createOscillator());
    osc.frequency.value = rate;
    this.aux.push(osc);
    return osc;
  }

  gain(value = 1) {
    const gain = this.#track(this.ctx.createGain());
    gain.gain.value = value;
    return gain;
  }

  filter(type, frequency, q = 0.7) {
    const filter = this.#track(this.ctx.createBiquadFilter());
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    return filter;
  }

  noise() {
    const src = this.#track(this.ctx.createBufferSource());
    src.buffer = getNoiseBuffer(this.ctx);
    src.loop = true;
    this.aux.push(src);
    return src;
  }

  buffer(audioBuffer, { playbackRate = 1, loopStart, loopEnd } = {}) {
    const src = this.#track(this.ctx.createBufferSource());
    src.buffer = audioBuffer;
    src.playbackRate.value = playbackRate;
    if (loopEnd !== undefined) {
      src.loop = true;
      src.loopStart = loopStart;
      src.loopEnd = Math.min(loopEnd, audioBuffer.duration);
    }
    src.baseDetune = 0;
    this.pitched.push(src);
    return src;
  }

  /** Burst envelope for transients (hammer noise, key click, tine). */
  burst(gainNode, peak, attack, decay) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, this.t);
    g.linearRampToValueAtTime(Math.max(peak, 0.0002), this.t + attack);
    g.exponentialRampToValueAtTime(0.0001, this.t + attack + decay);
  }

  build({ level, attack, decay, sustain, release, maxDuration = Infinity }) {
    const g = this.env.gain;
    const t = this.t;
    const a = Math.max(attack, 0.001);
    const peak = Math.max(level, 0.0001);
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(peak, t + a);
    if (sustain < 0.999) g.setTargetAtTime(peak * sustain, t + a, Math.max(decay, 0.005) / 3);
    let life = maxDuration;
    if (sustain <= 0.001) life = Math.min(life, a + decay * 2.5);
    return new SynthVoice(this.ctx, {
      env: this.env,
      nodes: this.nodes,
      pitched: this.pitched,
      aux: this.aux,
      startTime: t,
      release,
      stopTime: Number.isFinite(life) ? t + life : Infinity,
    });
  }
}

// ---------------------------------------------------------------------------
// Synthesized patches

const PATCHES = {
  piano(b, { freq, midi, vel }) {
    const { ctx, t } = b;
    const register = clamp((midi - 21) / 87, 0, 1); // 0 = lowest key, 1 = highest

    // Two layers: a bright "prompt sound" from 2-3 detuned strings that fades quickly,
    // and a mellow "aftersound" body that rings on — the way real piano tone evolves.
    const bright = b.gain(0);
    const unison = midi < 40 ? [-1.8, 1.8] : [-2.6, 0.4, 2.9];
    for (const detune of unison) b.osc('custom', freq, { wave: getWave(ctx, 'piano'), detune }).connect(bright);
    bright.gain.setValueAtTime(0.75 / unison.length * 2, t);
    bright.gain.setTargetAtTime(0.18, t + 0.01, 0.1 + 0.6 * (1 - register));

    const body = b.gain(0.5);
    b.osc('custom', freq, { wave: getWave(ctx, 'pianoBody'), detune: -1 }).connect(body);

    const lp = b.filter('lowpass', 20000, 0.5);
    bright.connect(lp);
    body.connect(lp);
    lp.connect(b.env);
    lp.frequency.setValueAtTime(Math.min(16000, freq * (3 + 12 * vel) + 600), t);
    lp.frequency.setTargetAtTime(Math.min(9000, freq * 2.5 + 400), t + 0.005, 0.3 + 0.4 * vel);

    const hammer = b.gain(0);
    b.noise().connect(b.filter('bandpass', Math.min(freq * 3, 7000), 1.2)).connect(hammer).connect(b.env);
    b.burst(hammer, (0.08 + 0.2 * vel) * (1 - 0.5 * register), 0.002, 0.03);

    const decay = clamp(6 * Math.pow(2, -(midi - 40) / 18), 0.6, 9);
    return b.build({ level: 0.42 * velocityCurve(vel), attack: 0.002, decay, sustain: 0, release: 0.32 - 0.17 * register });
  },

  epiano(b, { freq, midi, vel }) {
    const { t } = b;
    const tremolo = b.gain(0.88);
    const depth = b.gain(0.12);
    b.lfo(4.6).connect(depth).connect(tremolo.gain);

    const index = b.gain(0);
    b.osc('sine', freq).connect(index);
    for (const detune of [0, 4]) {
      const carrier = b.osc('sine', freq, { detune });
      index.connect(carrier.frequency);
      carrier.connect(b.gain(0.6)).connect(tremolo);
    }
    // Harder playing drives the FM index up for the characteristic "bark".
    index.gain.setValueAtTime(freq * (0.4 + 3 * vel * vel), t);
    index.gain.setTargetAtTime(freq * 0.15, t, 0.25);
    tremolo.connect(b.env);

    if (freq * 14 < 14000) {
      const tineGain = b.gain(0);
      b.osc('sine', freq * 14).connect(tineGain).connect(b.env);
      b.burst(tineGain, 0.1 * vel, 0.001, 0.07);
    }
    const decay = clamp(4.5 * Math.pow(2, -(midi - 60) / 24), 1.2, 7);
    return b.build({ level: 0.4 * velocityCurve(vel), attack: 0.002, decay, sustain: 0, release: 0.35 });
  },

  organ(b, { freq, vel }) {
    const tone = b.osc('custom', freq, { wave: getWave(b.ctx, 'organ') });
    const sub = b.osc('sine', freq / 2);
    tone.connect(b.env);
    sub.connect(b.gain(0.3)).connect(b.env);

    const depth = b.gain(6);
    b.lfo(6.4).connect(depth);
    depth.connect(tone.detune);
    depth.connect(sub.detune);

    // Percussion: a decaying 3rd harmonic on the attack, like a tonewheel organ.
    const percussion = b.gain(0);
    const third = b.osc('sine', freq * 3);
    depth.connect(third.detune);
    third.connect(percussion).connect(b.env);
    b.burst(percussion, 0.35, 0.002, 0.28);

    const click = b.gain(0);
    b.noise().connect(b.filter('highpass', 2500, 0.7)).connect(click).connect(b.env);
    b.burst(click, 0.06, 0.001, 0.012);
    return b.build({ level: 0.19 * (0.7 + 0.3 * vel), attack: 0.006, decay: 0.05, sustain: 1, release: 0.07 });
  },

  synth(b, { freq, vel }) {
    const { t } = b;
    const mix = b.gain(0.5);
    b.osc('sawtooth', freq, { detune: -9 }).connect(mix);
    b.osc('sawtooth', freq, { detune: 9 }).connect(mix);
    b.osc('square', freq / 2).connect(b.gain(0.3)).connect(mix);
    const lp = b.filter('lowpass', freq, 6);
    mix.connect(lp).connect(b.env);
    lp.frequency.setValueAtTime(Math.min(freq * 1.5, 12000), t);
    lp.frequency.linearRampToValueAtTime(Math.min(15000, freq * (2 + 14 * vel)), t + 0.012);
    lp.frequency.setTargetAtTime(Math.min(9000, freq * 3 + 400), t + 0.012, 0.18);
    return b.build({ level: 0.16 * velocityCurve(vel), attack: 0.006, decay: 0.45, sustain: 0.7, release: 0.28 });
  },

  strings(b, { freq, vel }) {
    const { t } = b;
    // Five slightly detuned "players" give the ensemble width; a body resonance adds warmth.
    const mix = b.gain(0.28);
    const oscs = [-16, -7, 0, 7, 15].map((detune) => b.osc('sawtooth', freq, { detune }));
    for (const osc of oscs) osc.connect(mix);
    const body = b.filter('peaking', 1100, 1.2);
    body.gain.value = 3;
    mix
      .connect(b.filter('lowpass', Math.min(9000, 1400 + freq * 2.5 + 2000 * vel), 0.6))
      .connect(b.filter('highpass', 120, 0.5))
      .connect(body)
      .connect(b.env);

    const depth = b.gain(0);
    b.lfo(5.3).connect(depth);
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(7, t + 0.9);
    for (const osc of oscs) depth.connect(osc.detune);
    return b.build({ level: 0.13 * velocityCurve(vel), attack: 0.3 - 0.16 * vel, decay: 0.6, sustain: 0.85, release: 0.8 });
  },

  flute(b, { freq, vel }) {
    const { t } = b;
    const tone = b.osc('custom', freq, { wave: getWave(b.ctx, 'flute') });
    tone.frequency.setValueAtTime(freq * 0.985, t);
    tone.frequency.exponentialRampToValueAtTime(freq, t + 0.06);
    tone.connect(b.env);

    const breath = b.gain(0);
    b.noise().connect(b.filter('bandpass', Math.min(freq * 2, 9000), 0.7)).connect(breath).connect(b.env);
    breath.gain.setValueAtTime(0, t);
    breath.gain.linearRampToValueAtTime(0.25 * vel, t + 0.03);
    breath.gain.setTargetAtTime(0.06, t + 0.03, 0.12);

    const depth = b.gain(0);
    b.lfo(5.1).connect(depth).connect(tone.detune);
    depth.gain.setValueAtTime(0, t + 0.3);
    depth.gain.linearRampToValueAtTime(11, t + 0.9);
    return b.build({ level: 0.3 * velocityCurve(vel), attack: 0.06, decay: 0.2, sustain: 0.85, release: 0.14 });
  },

  guitar(b, { freq, midi, vel, engine }) {
    const pluck = engine.getPluck(b.ctx, midi, freq, 'guitar');
    if (!pluck) {
      b.osc('triangle', freq).connect(b.env);
      return b.build({ level: 0.4 * velocityCurve(vel), attack: 0.002, decay: 0.8, sustain: 0, release: 0.12 });
    }
    const src = b.buffer(pluck.buffer, { playbackRate: pluck.playbackRate });
    // Two body resonances (air + top plate) make the string sound like it sits in a guitar.
    const air = b.filter('peaking', 105, 1.4);
    air.gain.value = 5;
    const top = b.filter('peaking', 220, 1.1);
    top.gain.value = 3.5;
    src.connect(b.filter('lowpass', Math.min(16000, freq * (3 + 12 * vel) + 500), 0.5)).connect(air).connect(top).connect(b.env);

    const pick = b.gain(0);
    b.noise().connect(b.filter('highpass', 2200, 0.7)).connect(pick).connect(b.env);
    b.burst(pick, 0.12 * vel, 0.001, 0.008);
    return b.build({
      level: 0.55 * velocityCurve(vel),
      attack: 0.001,
      decay: 0,
      sustain: 1,
      release: 0.12,
      maxDuration: pluck.buffer.duration / pluck.playbackRate,
    });
  },

  bass(b, { freq, vel }) {
    const { t } = b;
    const lp = b.filter('lowpass', 1000, 2.5);
    b.osc('sawtooth', freq).connect(lp).connect(b.env);
    b.osc('sine', freq).connect(b.gain(0.7)).connect(b.env);
    lp.frequency.setValueAtTime(Math.min(freq * (5 + 6 * vel), 5000), t);
    lp.frequency.setTargetAtTime(Math.min(freq * 2, 2000), t + 0.005, 0.12);

    const finger = b.gain(0);
    b.noise().connect(b.filter('lowpass', 1500, 0.7)).connect(finger).connect(b.env);
    b.burst(finger, 0.15 * vel, 0.001, 0.015);
    return b.build({ level: 0.42 * velocityCurve(vel), attack: 0.004, decay: 2.2, sustain: 0.25, release: 0.09 });
  },

  vibes(b, { freq, midi, vel }) {
    const { t } = b;
    // Vibraphone bars ring at 1 : 4 : 10; upper partials die away quickly.
    const motor = b.gain(0.7);
    const depth = b.gain(0.3);
    b.lfo(5.5).connect(depth).connect(motor.gain);
    b.osc('sine', freq).connect(motor);
    const p4 = b.gain(0);
    b.osc('sine', freq * 4).connect(p4).connect(motor);
    p4.gain.setValueAtTime(0.35 * vel, t);
    p4.gain.setTargetAtTime(0.02, t, 0.25);
    if (freq * 10 < 16000) {
      const p10 = b.gain(0);
      b.osc('sine', freq * 10).connect(p10).connect(motor);
      b.burst(p10, 0.12 * vel, 0.001, 0.08);
    }
    motor.connect(b.env);

    const mallet = b.gain(0);
    b.noise().connect(b.filter('bandpass', Math.min(freq * 2, 8000), 2)).connect(mallet).connect(b.env);
    b.burst(mallet, 0.08 * vel, 0.001, 0.01);
    const decay = clamp(5 * Math.pow(2, -(midi - 60) / 30), 1.5, 6);
    return b.build({ level: 0.36 * velocityCurve(vel), attack: 0.002, decay, sustain: 0, release: 0.3 });
  },

  brass(b, { freq, vel }) {
    const { t } = b;
    const mix = b.gain(0.5);
    const oscs = [-5, 5].map((detune) => b.osc('sawtooth', freq, { detune }));
    for (const osc of oscs) {
      osc.frequency.setValueAtTime(freq * 0.98, t);
      osc.frequency.exponentialRampToValueAtTime(freq, t + 0.05);
      osc.connect(mix);
    }
    // The filter "swell" is what makes a saw sound blown rather than buzzed.
    const lp = b.filter('lowpass', freq, 1.5);
    mix.connect(lp).connect(b.env);
    const swell = 0.04 + 0.05 * (1 - vel);
    lp.frequency.setValueAtTime(freq, t);
    lp.frequency.linearRampToValueAtTime(Math.min(12000, freq * (3 + 6 * vel)), t + swell);
    lp.frequency.setTargetAtTime(Math.min(8000, freq * (2.2 + 2 * vel)), t + swell, 0.2);
    return b.build({ level: 0.17 * velocityCurve(vel), attack: swell, decay: 0.3, sustain: 0.85, release: 0.18 });
  },

  harpsichord(b, { freq, midi, vel, engine }) {
    const main = engine.getPluck(b.ctx, midi, freq, 'harpsichord');
    if (!main) {
      b.osc('sawtooth', freq).connect(b.env);
      return b.build({ level: 0.2, attack: 0.001, decay: 1, sustain: 0, release: 0.1 });
    }
    const hp = b.filter('highpass', 180, 0.7);
    b.buffer(main.buffer, { playbackRate: main.playbackRate }).connect(hp);
    // 4' register: a second set of strings an octave higher.
    const octave = engine.getPluck(b.ctx, midi + 12, freq * 2, 'harpsichord');
    if (octave) b.buffer(octave.buffer, { playbackRate: octave.playbackRate }).connect(b.gain(0.35)).connect(hp);
    hp.connect(b.env);
    return b.build({
      level: 0.42 * (0.75 + 0.25 * vel), // harpsichords are barely touch-sensitive
      attack: 0.001,
      decay: 0,
      sustain: 1,
      release: 0.1,
      maxDuration: main.buffer.duration / main.playbackRate,
    });
  },

  choir(b, { freq, vel }) {
    const { t } = b;
    const mix = b.gain(0.4);
    const oscs = [-9, 0, 8].map((detune) => b.osc('sawtooth', freq, { detune }));
    for (const osc of oscs) osc.connect(mix);
    // Parallel formant filters shape the buzz into an "aah" vowel.
    for (const [frequency, q, gain] of [[750, 7, 1], [1180, 8, 0.55], [2600, 10, 0.25]]) {
      mix.connect(b.filter('bandpass', frequency, q)).connect(b.gain(gain * 2.2)).connect(b.env);
    }
    const depth = b.gain(0);
    b.lfo(5).connect(depth);
    depth.gain.setValueAtTime(0, t + 0.2);
    depth.gain.linearRampToValueAtTime(6, t + 0.9);
    for (const osc of oscs) depth.connect(osc.detune);
    return b.build({ level: 0.32 * velocityCurve(vel), attack: 0.25, decay: 0.4, sustain: 0.9, release: 0.6 });
  },
};

function buildSampledVoice(b, instrument, midi, vel) {
  let zone = instrument.zones[0];
  for (const candidate of instrument.zones) {
    if (Math.abs(candidate.midi - midi) < Math.abs(zone.midi - midi)) zone = candidate;
  }
  const rate = Math.pow(2, (midi - zone.midi) / 12);
  const src = b.buffer(zone.buffer, { playbackRate: rate, loopStart: zone.loopStart, loopEnd: zone.loopEnd });
  src.connect(b.env);
  const { attack, decay, sustain, release } = instrument.envelope;
  const looped = zone.loopEnd !== undefined;
  return b.build({
    level: 0.6 * zone.gain * velocityCurve(vel),
    attack,
    decay,
    sustain,
    release,
    maxDuration: looped ? Infinity : zone.buffer.duration / rate,
  });
}

// ---------------------------------------------------------------------------

export class InstrumentEngine {
  constructor({ tuning = 440 } = {}) {
    this.tuning = tuning;
    this.sampled = new Map();
  }

  list() {
    const sampled = [...this.sampled.values()].map(({ id, name, category, kind, gm, license }) => ({ id, name, category, kind, gm, license }));
    return [...SYNTH_INSTRUMENTS, ...sampled].map((inst, index) => ({ ...inst, number: index + 1 }));
  }

  has(id) {
    return SYNTH_IDS.has(id) || this.sampled.has(id);
  }

  get(id) {
    return this.list().find((inst) => inst.id === id) ?? null;
  }

  setTuning(a4) {
    if (Number.isFinite(a4) && a4 > 0) this.tuning = a4;
  }

  createVoice(ctx, destination, instrumentId, midi, velocity, time) {
    const vel = clamp(velocity, 1, 127) / 127;
    const freq = midiToFrequency(midi, this.tuning);
    const pan = clamp((midi - 60) / 48, -1, 1) * 0.3;
    const builder = new VoiceBuilder(ctx, destination, time, pan);
    const sampled = this.sampled.get(instrumentId);
    if (sampled) return buildSampledVoice(builder, sampled, midi, vel);
    if (instrumentId === 'drums') return null; // drums are one-shot hits, played by the audio engine's DrumKit
    const patch = PATCHES[instrumentId] ?? PATCHES.piano;
    return patch(builder, { freq, midi, vel, engine: this });
  }

  /** Cached Karplus–Strong buffer for one plucked note ('guitar' or 'harpsichord'). */
  getPluck(ctx, midi, freq, variant = 'guitar') {
    if (freq >= ctx.sampleRate / 4) return null;
    const cache = resources(ctx).plucks;
    const key = `${variant}:${midi}@${this.tuning}`;
    if (!cache.has(key)) {
      const { t60, brightness } = (PLUCK_VARIANTS[variant] ?? PLUCK_VARIANTS.guitar)(midi);
      const render = renderPluckedString({ sampleRate: ctx.sampleRate, frequency: freq, t60, brightness, seed: midi + 7 });
      const buffer = ctx.createBuffer(1, render.data.length, ctx.sampleRate);
      buffer.copyToChannel(render.data, 0);
      cache.set(key, { buffer, playbackRate: render.playbackRate });
    }
    return cache.get(key);
  }

  /** Pre-render anything an instrument needs, yielding so the UI never blocks. */
  async prepare(ctx, instrumentId, { from = 28, to = 100 } = {}) {
    if (!PLUCK_VARIANTS[instrumentId]) return;
    for (let midi = from; midi <= to; midi++) {
      this.getPluck(ctx, midi, midiToFrequency(midi, this.tuning), instrumentId);
      if (midi % 6 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  /** Decode a user sample set (manifest + file bytes) into a playable instrument. */
  async loadSampledInstrument(ctx, manifest, files) {
    const result = validateSampleManifest(manifest);
    if (!result.ok) throw new Error(result.errors.slice(0, 5).join('\n'));
    const bytes = new Map((files || []).map((f) => [f.file, f.data]));
    const zones = await Promise.all(
      result.manifest.zones.map(async (zone) => {
        const data = bytes.get(zone.file);
        if (!data) throw new Error(`Missing sample file: ${zone.file}`);
        const copy = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        try {
          return { ...zone, buffer: await ctx.decodeAudioData(copy) };
        } catch {
          throw new Error(`Could not decode ${zone.file}`);
        }
      }),
    );
    const slug = result.manifest.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sample';
    let id = `sample:${slug}`;
    for (let n = 2; this.sampled.has(id); n++) id = `sample:${slug}-${n}`;
    const instrument = {
      id,
      name: result.manifest.name,
      category: 'Sampled',
      kind: 'sampled',
      gm: 0,
      license: result.manifest.license,
      envelope: result.manifest.envelope,
      zones,
    };
    this.sampled.set(id, instrument);
    return this.get(id);
  }
}

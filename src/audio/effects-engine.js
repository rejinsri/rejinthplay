/**
 * Modular effects chain:
 *   input → high-pass → low-pass → distortion → chorus → delay → reverb → output
 *
 * Each module has its own bypass. Enabling/disabling crossfades dry/wet gains over a
 * few milliseconds, so toggling never clicks.
 */

import { clamp, createRandom } from '../core/note-utils.js';

export const EFFECT_ORDER = ['highpass', 'lowpass', 'distortion', 'chorus', 'delay', 'reverb'];
const FADE = 0.015;

/** Stereo exponentially-decaying noise impulse response for the convolution reverb. */
export function generateImpulseResponse(sampleRate, decaySeconds, { preDelay = 0.012, seed = 7 } = {}) {
  const duration = clamp(decaySeconds, 0.2, 10);
  const length = Math.floor(sampleRate * (duration + preDelay));
  const offset = Math.floor(sampleRate * preDelay);
  const channels = [new Float32Array(length), new Float32Array(length)];
  const random = createRandom(seed);
  for (const data of channels) {
    for (let i = offset; i < length; i++) {
      const t = (i - offset) / sampleRate;
      data[i] = (random() * 2 - 1) * Math.pow(10, (-3 * t) / duration); // -60 dB at `duration`
    }
  }
  return channels;
}

export function makeDistortionCurve(amount, samples = 2048) {
  const k = clamp(amount, 0, 1) * 60 + 1;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / (samples - 1) - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

class EffectModule {
  constructor(ctx, { parallel }) {
    this.ctx = ctx;
    this.parallel = parallel; // parallel = dry always passes, wet is added
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.input.connect(this.dry).connect(this.output);
    this.wet.connect(this.output);
    this.enabled = false;
    this.mix = 1;
    this.dry.gain.value = 1;
    this.wet.gain.value = 0;
  }

  setEnabled(on) {
    this.enabled = Boolean(on);
    this.#applyMix();
  }

  setMix(mix) {
    this.mix = clamp(mix, 0, 1);
    this.#applyMix();
  }

  #applyMix() {
    const now = this.ctx.currentTime;
    const wet = this.enabled ? this.mix : 0;
    const dry = this.parallel || !this.enabled ? 1 : 1 - this.mix;
    this.wet.gain.setTargetAtTime(wet, now, FADE);
    this.dry.gain.setTargetAtTime(dry, now, FADE);
  }

  setParam() {}
}

class FilterEffect extends EffectModule {
  constructor(ctx, type) {
    super(ctx, { parallel: false });
    this.filter = ctx.createBiquadFilter();
    this.filter.type = type;
    this.input.connect(this.filter).connect(this.wet);
  }

  setParam(name, value) {
    const now = this.ctx.currentTime;
    if (name === 'frequency') this.filter.frequency.setTargetAtTime(value, now, 0.02);
    if (name === 'q') this.filter.Q.setTargetAtTime(value, now, 0.02);
  }
}

class DistortionEffect extends EffectModule {
  constructor(ctx) {
    super(ctx, { parallel: false });
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = '4x';
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 6000;
    this.makeup = ctx.createGain();
    this.input.connect(this.shaper).connect(this.tone).connect(this.makeup).connect(this.wet);
    this.setParam('amount', 0.35);
  }

  setParam(name, value) {
    if (name === 'amount') {
      this.shaper.curve = makeDistortionCurve(value);
      this.makeup.gain.value = 1 / (1 + value * 1.2);
    }
    if (name === 'mix') this.setMix(value);
  }
}

class ChorusEffect extends EffectModule {
  constructor(ctx) {
    super(ctx, { parallel: true });
    this.merger = ctx.createChannelMerger(2);
    this.lfos = [];
    this.depths = [];
    [0, 1].forEach((channel) => {
      const delay = ctx.createDelay(0.1);
      delay.delayTime.value = channel ? 0.021 : 0.016;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.8 * (channel ? 1.17 : 1);
      const depth = ctx.createGain();
      lfo.connect(depth).connect(delay.delayTime);
      lfo.start();
      this.input.connect(delay);
      delay.connect(this.merger, 0, channel);
      this.lfos.push(lfo);
      this.depths.push(depth);
    });
    this.merger.connect(this.wet);
    this.setParam('depth', 0.5);
  }

  setParam(name, value) {
    const now = this.ctx.currentTime;
    if (name === 'rate') this.lfos.forEach((lfo, i) => lfo.frequency.setTargetAtTime(value * (i ? 1.17 : 1), now, 0.05));
    if (name === 'depth') this.depths.forEach((d) => d.gain.setTargetAtTime(0.0005 + value * 0.004, now, 0.05));
    if (name === 'mix') this.setMix(value);
  }
}

class DelayEffect extends EffectModule {
  constructor(ctx) {
    super(ctx, { parallel: true });
    this.delay = ctx.createDelay(2);
    this.feedback = ctx.createGain();
    this.damp = ctx.createBiquadFilter();
    this.damp.type = 'lowpass';
    this.damp.frequency.value = 4500;
    this.input.connect(this.delay);
    this.delay.connect(this.damp).connect(this.feedback).connect(this.delay);
    this.delay.connect(this.wet);
  }

  setParam(name, value) {
    const now = this.ctx.currentTime;
    if (name === 'time') this.delay.delayTime.setTargetAtTime(value, now, 0.03);
    if (name === 'feedback') this.feedback.gain.setTargetAtTime(clamp(value, 0, 0.9), now, 0.03);
    if (name === 'mix') this.setMix(value);
  }
}

class ReverbEffect extends EffectModule {
  constructor(ctx) {
    super(ctx, { parallel: true });
    this.convolver = ctx.createConvolver();
    this.input.connect(this.convolver).connect(this.wet);
    this.decay = 0;
    this.decayTimer = null;
    this.#build(2.2);
  }

  #build(decay) {
    if (Math.abs(decay - this.decay) < 0.01) return;
    this.decay = decay;
    const [left, right] = generateImpulseResponse(this.ctx.sampleRate, decay);
    const buffer = this.ctx.createBuffer(2, left.length, this.ctx.sampleRate);
    buffer.copyToChannel(left, 0);
    buffer.copyToChannel(right, 1);
    this.convolver.buffer = buffer;
  }

  setParam(name, value) {
    if (name === 'mix') this.setMix(value);
    if (name === 'decay') {
      // Rebuilding the impulse response is relatively expensive; debounce slider drags.
      clearTimeout(this.decayTimer);
      this.decayTimer = setTimeout(() => this.#build(value), 120);
    }
  }
}

export class EffectsEngine {
  constructor(ctx) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.modules = {
      highpass: new FilterEffect(ctx, 'highpass'),
      lowpass: new FilterEffect(ctx, 'lowpass'),
      distortion: new DistortionEffect(ctx),
      chorus: new ChorusEffect(ctx),
      delay: new DelayEffect(ctx),
      reverb: new ReverbEffect(ctx),
    };
    let node = this.input;
    for (const name of EFFECT_ORDER) {
      node.connect(this.modules[name].input);
      node = this.modules[name].output;
    }
    node.connect(this.output);
  }

  setEnabled(name, on) {
    this.modules[name]?.setEnabled(on);
  }

  setParam(name, param, value) {
    if (param === 'enabled') return this.setEnabled(name, value);
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    this.modules[name]?.setParam(param, value);
  }

  /** Apply a full effects settings object ({ reverb: { enabled, mix, decay }, ... }). */
  apply(state) {
    for (const name of EFFECT_ORDER) {
      const params = state?.[name];
      if (!params) continue;
      for (const [param, value] of Object.entries(params)) {
        if (param !== 'enabled') this.setParam(name, param, value);
      }
      this.setEnabled(name, params.enabled);
    }
  }
}

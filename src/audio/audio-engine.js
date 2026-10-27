/**
 * Owns the AudioContext and the signal graph:
 *
 *   keyboard ┐
 *   drums    ├─ part gains → effects chain → master → limiter → analyser → speakers
 *   bass     │                                  ↑
 *   chord    ┘          metronome ──────────────┘ (dry, bypasses effects)
 *
 * Voices are tracked by three independent voice managers so live playing, recorded
 * playback and the accompaniment never steal each other's sustain or voices.
 */

import { clamp } from '../core/note-utils.js';
import { DrumKit, KEYBOARD_DRUM_LEVEL, RHYTHM_DRUM_LEVEL } from './drum-kit.js';
import { drumVoiceForNote } from './drum-map.js';
import { EffectsEngine } from './effects-engine.js';
import { VoiceManager } from './voice-manager.js';

export const PARTS = ['keyboard', 'drums', 'bass', 'chord', 'metronome'];
const CHANNELS = ['live', 'playback', 'accomp'];

export class AudioEngine {
  constructor({ bus, instruments }) {
    this.bus = bus;
    this.instruments = instruments;
    this.ctx = null;
    this.state = 'idle';
    this.message = 'Audio not started';
    this.parts = {};
    this.voices = {};
    this.bend = 0;
    this.maxPolyphony = 48;
    this.drumKitId = 'standard';
    this.scheduledId = 0;
    this.sweepTimer = null;
    this.levelBuffer = null;
  }

  get time() {
    return this.ctx ? this.ctx.currentTime : performance.now() / 1000;
  }

  get isReady() {
    return Boolean(this.ctx) && this.state === 'running';
  }

  get latency() {
    if (!this.ctx) return null;
    return {
      sampleRate: this.ctx.sampleRate,
      base: this.ctx.baseLatency ?? 0,
      output: this.ctx.outputLatency ?? 0,
    };
  }

  async init({ latencyHint = 'interactive', maxPolyphony = 48 } = {}) {
    if (this.ctx) return this.isReady;
    this.maxPolyphony = maxPolyphony;
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) {
      this.#setState('unavailable', 'Web Audio is not available on this system.');
      return false;
    }
    this.#setState('starting', 'Opening audio device…');
    try {
      this.ctx = new Ctor({ latencyHint });
    } catch (err) {
      this.ctx = null;
      this.#setState('unavailable', `No usable audio output device (${err.message}).`);
      return false;
    }
    try {
      this.#buildGraph();
    } catch (err) {
      this.#setState('error', `Audio graph could not be created: ${err.message}`);
      return false;
    }
    this.ctx.addEventListener('statechange', () => this.#syncState());
    await this.resume();
    this.#syncState();
    this.sweepTimer = setInterval(() => {
      for (const vm of Object.values(this.voices)) vm.sweep(this.ctx.currentTime);
    }, 2000);
    return this.isReady;
  }

  /** Resume a suspended context (browsers require a user gesture before audio can start). */
  async resume() {
    if (!this.ctx || this.ctx.state === 'running' || this.ctx.state === 'closed') return;
    try {
      await Promise.race([this.ctx.resume(), new Promise((resolve) => setTimeout(resolve, 1500))]);
    } catch (err) {
      console.warn('[audio] resume failed', err);
    }
    this.#syncState();
  }

  #buildGraph() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.15;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.levelBuffer = new Float32Array(this.analyser.fftSize);
    this.effects = new EffectsEngine(ctx);

    for (const part of PARTS) {
      const gain = ctx.createGain();
      gain.connect(part === 'metronome' ? this.master : this.effects.input);
      this.parts[part] = gain;
    }
    this.effects.output.connect(this.master);
    this.master.connect(this.limiter).connect(this.analyser).connect(ctx.destination);

    const now = () => ctx.currentTime;
    for (const channel of CHANNELS) {
      this.voices[channel] = new VoiceManager({ maxVoices: channel === 'accomp' ? 32 : this.maxPolyphony, now });
    }
    this.drums = new DrumKit(ctx, this.parts.drums, this.drumKitId, { level: RHYTHM_DRUM_LEVEL });
    this.keyDrums = new DrumKit(ctx, this.parts.keyboard, this.drumKitId, { level: KEYBOARD_DRUM_LEVEL });
    this.clickKit = new DrumKit(ctx, this.parts.metronome);
  }

  /** Drum kit used by both the rhythm and the playable Drum Kit instrument. */
  setDrumKit(kitId) {
    this.drumKitId = kitId;
    this.drums?.setKit(kitId);
    this.keyDrums?.setKit(kitId);
  }

  /** The node to tap for rendered-audio capture (post-limiter master). */
  get outputNode() {
    return this.analyser ?? null;
  }

  #syncState() {
    if (!this.ctx) return;
    const state = this.ctx.state;
    if (state === 'running') this.#setState('running', `Audio ready · ${this.ctx.sampleRate} Hz`);
    else if (state === 'suspended') this.#setState('suspended', 'Audio is paused — click or press a key to enable sound.');
    else if (state === 'closed') this.#setState('error', 'Audio device closed.');
    else if (state === 'interrupted') this.#setState('suspended', 'Audio interrupted by the system.');
  }

  #setState(state, message) {
    if (this.state === state && this.message === message) return;
    this.state = state;
    this.message = message;
    this.bus?.emit('audio:status', { state, message });
  }

  setMaxPolyphony(n) {
    this.maxPolyphony = n;
    this.voices.live?.setMaxVoices(n);
    this.voices.playback?.setMaxVoices(n);
  }

  noteOn(key, midi, velocity, { channel = 'live', instrumentId = 'piano', time } = {}) {
    if (!this.isReady) return null;
    const vm = this.voices[channel];
    const t = Math.max(time ?? this.ctx.currentTime, this.ctx.currentTime);
    if (instrumentId === 'drums') {
      // Drum hits are one-shots: no voice to hold or release.
      const voice = drumVoiceForNote(midi);
      if (voice) this.keyDrums.play(voice, t, (velocity / 127) * 1.25);
      return null;
    }
    try {
      return vm.noteOn(
        key,
        () => {
          const voice = this.instruments.createVoice(this.ctx, this.parts.keyboard, instrumentId, midi, velocity, t);
          if (channel === 'live' && this.bend !== 0) voice.setDetune(this.bend * 100, t);
          return voice;
        },
        t,
      );
    } catch (err) {
      console.error('[audio] noteOn failed', err);
      return null;
    }
  }

  noteOff(key, { channel = 'live', time } = {}) {
    if (!this.ctx) return;
    this.voices[channel]?.noteOff(key, Math.max(time ?? this.ctx.currentTime, this.ctx.currentTime));
  }

  setSustain(on, { channel = 'live', time } = {}) {
    if (!this.ctx) return;
    this.voices[channel]?.setSustain(on, Math.max(time ?? this.ctx.currentTime, this.ctx.currentTime));
  }

  /** Pitch bend in semitones for live voices (smoothly applied). */
  setPitchBend(semitones) {
    this.bend = clamp(semitones, -12, 12);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.voices.live.forEachActive((entry) => entry.voice.setDetune?.(this.bend * 100, t));
  }

  /** Schedule a fixed-length note (used by the accompaniment). */
  scheduleNote({ part, instrumentId, midi, velocity, time, duration }) {
    if (!this.isReady) return;
    const key = `acc:${++this.scheduledId}`;
    const t = Math.max(time, this.ctx.currentTime);
    const destination = this.parts[part] ?? this.parts.chord;
    try {
      this.voices.accomp.noteOn(key, () => this.instruments.createVoice(this.ctx, destination, instrumentId, midi, velocity, t), t);
      this.voices.accomp.noteOff(key, t + duration);
    } catch (err) {
      console.error('[audio] scheduleNote failed', err);
    }
  }

  playDrum(voice, time, velocity) {
    if (this.isReady) this.drums.play(voice, time, velocity);
  }

  playClick(time, accent) {
    if (this.isReady) this.clickKit.click(time, accent);
  }

  releaseChannel(channel, prefix = '') {
    if (this.ctx) this.voices[channel]?.releaseAll(this.ctx.currentTime, prefix);
  }

  stopChannel(channel) {
    if (this.ctx) this.voices[channel]?.killAll(this.ctx.currentTime);
  }

  /** All notes off, immediately. */
  panic() {
    if (!this.ctx) return;
    for (const vm of Object.values(this.voices)) vm.killAll(this.ctx.currentTime);
    this.setPitchBend(0);
  }

  get activeVoiceCount() {
    return Object.values(this.voices).reduce((sum, vm) => sum + vm.activeCount, 0);
  }

  setMasterVolume(value) {
    if (this.master) this.master.gain.setTargetAtTime(Math.pow(clamp(value, 0, 1), 2), this.ctx.currentTime, 0.02);
  }

  setPartVolume(part, value) {
    const gain = this.parts[part];
    if (gain) gain.gain.setTargetAtTime(Math.pow(clamp(value, 0, 1), 2) * 1.2, this.ctx.currentTime, 0.02);
  }

  /** Output level in dBFS (RMS), for the level meter. */
  getLevel() {
    if (!this.analyser) return -Infinity;
    this.analyser.getFloatTimeDomainData(this.levelBuffer);
    let sum = 0;
    for (const s of this.levelBuffer) sum += s * s;
    const rms = Math.sqrt(sum / this.levelBuffer.length);
    return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
  }
}

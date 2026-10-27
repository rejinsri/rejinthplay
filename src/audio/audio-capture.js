/**
 * Rendered-audio capture of the master output (everything you hear: keyboard,
 * rhythm, accompaniment, effects). Uses an AudioWorklet; falls back to a
 * ScriptProcessorNode where worklets are unavailable.
 */

import { concatChunks, encodeWav } from './wav-encoder.js';

const WORKLET_URL = new URL('./worklets/capture-processor.js', import.meta.url).href;
const loadedContexts = new WeakSet();

export class AudioCapture {
  constructor(ctx, source, { maxSeconds = 600 } = {}) {
    this.ctx = ctx;
    this.source = source;
    this.maxFrames = Math.floor(maxSeconds * ctx.sampleRate);
    this.recording = false;
    this.node = null;
    this.sink = null;
    this.left = [];
    this.right = [];
    this.frames = 0;
    this.onLimit = null;
  }

  get seconds() {
    return this.frames / this.ctx.sampleRate;
  }

  async start() {
    if (this.recording) return;
    this.left = [];
    this.right = [];
    this.frames = 0;
    this.sink = this.ctx.createGain();
    this.sink.gain.value = 0;
    this.sink.connect(this.ctx.destination);
    this.node = (await this.#createWorkletNode()) ?? this.#createScriptNode();
    this.source.connect(this.node);
    this.node.connect(this.sink);
    this.recording = true;
  }

  async #createWorkletNode() {
    if (!this.ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') return null;
    try {
      if (!loadedContexts.has(this.ctx)) {
        await this.ctx.audioWorklet.addModule(WORKLET_URL);
        loadedContexts.add(this.ctx);
      }
      const node = new AudioWorkletNode(this.ctx, 'lk61-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
      });
      node.port.onmessage = (event) => {
        if (event.data?.type === 'data') this.#push(event.data.left, event.data.right);
        else if (event.data?.type === 'flushed') this.flushResolve?.();
      };
      return node;
    } catch (err) {
      console.warn('[capture] AudioWorklet unavailable, using ScriptProcessor fallback', err);
      return null;
    }
  }

  #createScriptNode() {
    const node = this.ctx.createScriptProcessor(4096, 2, 2);
    node.onaudioprocess = (event) => {
      const input = event.inputBuffer;
      const left = new Float32Array(input.getChannelData(0));
      const right = new Float32Array(input.numberOfChannels > 1 ? input.getChannelData(1) : input.getChannelData(0));
      this.#push(left, right);
    };
    return node;
  }

  #push(left, right) {
    if (!this.recording) return;
    this.left.push(left);
    this.right.push(right);
    this.frames += left.length;
    if (this.frames >= this.maxFrames && this.onLimit) this.onLimit();
  }

  /** Stop and return the captured audio as { channels, sampleRate, seconds }. */
  async stop() {
    if (!this.recording) return null;
    if (this.node.port) {
      await new Promise((resolve) => {
        this.flushResolve = resolve;
        this.node.port.postMessage('flush');
        setTimeout(resolve, 400);
      });
      this.node.port.postMessage('stop');
    }
    this.recording = false;
    try {
      this.source.disconnect(this.node);
    } catch {
      /* already disconnected */
    }
    this.node.disconnect();
    this.sink.disconnect();
    const frames = Math.min(this.frames, this.maxFrames);
    const channels = [concatChunks(this.left, frames), concatChunks(this.right, frames)];
    this.left = [];
    this.right = [];
    return { channels, sampleRate: this.ctx.sampleRate, seconds: frames / this.ctx.sampleRate };
  }

  static toWav(capture) {
    return new Uint8Array(encodeWav(capture.channels, capture.sampleRate));
  }
}

/* global AudioWorkletProcessor, registerProcessor */

/**
 * AudioWorklet that copies the master output into 4096-frame stereo blocks and
 * posts them to the main thread. Silent/disconnected input is captured as zeros
 * so the recording timeline stays intact.
 */
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 4096;
    this.left = new Float32Array(this.size);
    this.right = new Float32Array(this.size);
    this.count = 0;
    this.active = true;
    this.port.onmessage = (event) => {
      if (event.data === 'flush') {
        this.flush();
        this.port.postMessage({ type: 'flushed' });
      } else if (event.data === 'stop') {
        this.flush();
        this.active = false;
      }
    };
  }

  flush() {
    if (this.count === 0) return;
    const left = this.left.slice(0, this.count);
    const right = this.right.slice(0, this.count);
    this.port.postMessage({ type: 'data', left, right }, [left.buffer, right.buffer]);
    this.count = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const frames = input && input[0] ? input[0].length : 128;
    const l = input && input[0];
    const r = input && (input[1] || input[0]);
    for (let i = 0; i < frames; i++) {
      this.left[this.count] = l ? l[i] : 0;
      this.right[this.count] = r ? r[i] : 0;
      this.count += 1;
      if (this.count === this.size) this.flush();
    }
    return this.active;
  }
}

registerProcessor('lk61-capture', CaptureProcessor);

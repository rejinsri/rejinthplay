/**
 * Polyphonic voice allocation.
 *
 * Voices are any object implementing:
 *   release(time) -> end time (seconds)   start the release phase
 *   stop(time)                            fast fade + stop (voice stealing / panic)
 *   setDetune(cents, time)                pitch bend (optional)
 *   onEnded(callback)                     called once when the voice has finished
 *
 * Keys identify who owns a voice ("kbd:KeyA", "mouse:1", "play:60", ...).
 */
export class VoiceManager {
  constructor({ maxVoices = 48, now = () => 0 } = {}) {
    this.maxVoices = Math.max(1, Math.trunc(maxVoices));
    this.now = now;
    this.entries = [];
    this.sustain = false;
    this.sequence = 0;
  }

  get activeCount() {
    return this.entries.length;
  }

  setMaxVoices(n) {
    if (Number.isFinite(n) && n >= 1) this.maxVoices = Math.trunc(n);
    while (this.entries.length > this.maxVoices) this.#kill(this.#pickVictim(), this.now());
  }

  /** Start a voice for `key`. `createVoice` is only called once a slot is available. */
  noteOn(key, createVoice, time = this.now()) {
    for (const entry of this.entries) {
      if (entry.key === key && !entry.released) this.#release(entry, time);
    }
    while (this.entries.length >= this.maxVoices) {
      const victim = this.#pickVictim();
      if (!victim) break;
      this.#kill(victim, time);
    }
    const voice = createVoice();
    if (!voice) return null;
    const entry = { id: ++this.sequence, key, voice, startTime: time, released: false, sustained: false, endTime: Infinity };
    this.entries.push(entry);
    if (typeof voice.onEnded === 'function') voice.onEnded(() => this.#remove(entry));
    return entry;
  }

  /** Release all voices for `key`; with sustain on, they are held until the pedal lifts. */
  noteOff(key, time = this.now()) {
    let count = 0;
    for (const entry of this.entries) {
      if (entry.key !== key || entry.released) continue;
      if (this.sustain) entry.sustained = true;
      else this.#release(entry, time);
      count += 1;
    }
    return count;
  }

  setSustain(on, time = this.now()) {
    this.sustain = Boolean(on);
    if (this.sustain) return;
    for (const entry of this.entries) {
      if (entry.sustained && !entry.released) this.#release(entry, time);
    }
  }

  /** Release every voice whose key starts with `prefix` (all voices when omitted). */
  releaseAll(time = this.now(), prefix = '') {
    for (const entry of this.entries) {
      if (!entry.released && entry.key.startsWith(prefix)) this.#release(entry, time);
    }
  }

  /** Immediately silence everything (panic). */
  killAll(time = this.now(), prefix = '') {
    for (const entry of [...this.entries]) {
      if (entry.key.startsWith(prefix)) this.#kill(entry, time);
    }
    if (!prefix) this.sustain = false;
  }

  forEachActive(fn) {
    for (const entry of this.entries) if (!entry.released) fn(entry);
  }

  /** Drop voices whose end time has long passed (safety net if onEnded never fired). */
  sweep(now = this.now(), grace = 0.5) {
    for (const entry of [...this.entries]) {
      if (entry.released && entry.endTime + grace < now) {
        try {
          entry.voice.stop(now);
        } catch {
          /* already stopped */
        }
        this.#remove(entry);
      }
    }
  }

  #pickVictim() {
    let victim = null;
    for (const entry of this.entries) {
      if (!victim) victim = entry;
      else if (entry.released && !victim.released) victim = entry;
      else if (entry.released === victim.released && entry.startTime < victim.startTime) victim = entry;
    }
    return victim;
  }

  #release(entry, time) {
    entry.released = true;
    entry.sustained = false;
    const end = entry.voice.release(time);
    entry.endTime = Number.isFinite(end) ? end : time;
  }

  #kill(entry, time) {
    if (!entry) return;
    try {
      entry.voice.stop(time);
    } catch (err) {
      console.warn('[voice-manager] stop failed', err);
    }
    this.#remove(entry);
  }

  #remove(entry) {
    const index = this.entries.indexOf(entry);
    if (index !== -1) this.entries.splice(index, 1);
  }
}

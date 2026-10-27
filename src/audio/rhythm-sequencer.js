/**
 * Step sequencer driven by the audio clock ("lookahead scheduling"), with
 * arranger sections (intro, variation A/B, fill-in, ending).
 *
 * A coarse JavaScript timer wakes up every `lookahead` seconds and schedules every
 * step that falls inside the next `scheduleAhead` seconds at an exact audio-clock
 * time. Timer jitter therefore never reaches the audio; it only changes how early a
 * step is queued. Listeners receive the exact `time` at which to play each step.
 *
 * Section behaviour (modelled on home arranger keyboards):
 *  - start({ intro: true }) plays the intro, then the current variation.
 *  - requestFill() plays a fill from the current beat to the bar line, then returns.
 *  - setVariation() while playing plays a fill, then switches variation.
 *  - requestEnding() plays the ending from the next bar line, then stops by itself.
 *  - Style changes while playing take effect at the next bar line.
 */

import { clamp } from '../core/note-utils.js';

export const MIN_TEMPO = 30;
export const MAX_TEMPO = 300;
export const MAX_SWING = 0.5;
export const VARIATIONS = Object.freeze(['A', 'B']);

/** Durations of [even, odd] steps; swing lengthens on-beats and shortens off-beats. */
export function stepDurations(bpm, stepsPerBeat, swing = 0) {
  const base = 60 / bpm / stepsPerBeat;
  if (swing <= 0 || stepsPerBeat % 2 !== 0) return [base, base];
  const s = clamp(swing, 0, MAX_SWING);
  return [base * (1 + s), base * (1 - s)];
}

export class RhythmSequencer {
  constructor({
    getTime,
    lookahead = 0.025,
    scheduleAhead = 0.12,
    startDelay = 0.06,
    setTimer = (fn, ms) => setInterval(fn, ms),
    clearTimer = (id) => clearInterval(id),
  } = {}) {
    if (typeof getTime !== 'function') throw new TypeError('RhythmSequencer requires getTime()');
    this.getTime = getTime;
    this.lookahead = lookahead;
    this.scheduleAhead = scheduleAhead;
    this.startDelay = startDelay;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.listeners = new Set();
    this.sectionListeners = new Set();
    this.endListeners = new Set();
    this.base = null; // the selected style's main pattern (sections hang off it)
    this.pattern = null; // the pattern currently being played
    this.section = 'main';
    this.variation = 'A';
    this.fillTarget = 'A';
    this.pending = { style: null, fill: null, ending: false, intro: false };
    this.tempo = 120;
    this.swing = 0;
    this.state = 'stopped';
    this.step = 0;
    this.bar = 0;
    this.nextTime = 0;
    this.timer = null;
  }

  get isPlaying() {
    return this.state === 'playing';
  }

  get hasSections() {
    return Boolean(this.base?.sections);
  }

  onStep(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Called with { section, variation, time } whenever the playing section changes. */
  onSection(listener) {
    this.sectionListeners.add(listener);
    return () => this.sectionListeners.delete(listener);
  }

  /** Called with { time } when an ending finishes and the rhythm stops by itself. */
  onEnd(listener) {
    this.endListeners.add(listener);
    return () => this.endListeners.delete(listener);
  }

  /** Change style/pattern. While playing, the switch happens at the next bar line. */
  setPattern(pattern, { immediate = false } = {}) {
    if (!pattern || !Number.isInteger(pattern.totalSteps) || pattern.totalSteps < 1) {
      throw new TypeError('setPattern expects a parsed pattern');
    }
    if (this.state !== 'playing' || immediate || !this.pattern) {
      this.base = pattern;
      this.pending.style = null;
      if (this.section !== 'main' && this.state !== 'playing') this.section = 'main';
      this.pattern = this.#patternFor(this.section);
      this.step = this.state === 'stopped' ? 0 : this.step % this.pattern.totalSteps;
    } else {
      this.pending.style = pattern;
    }
  }

  setTempo(bpm) {
    if (typeof bpm === 'number' && Number.isFinite(bpm)) this.tempo = clamp(Math.round(bpm), MIN_TEMPO, MAX_TEMPO);
    return this.tempo;
  }

  setSwing(amount) {
    if (typeof amount === 'number' && Number.isFinite(amount)) this.swing = clamp(amount, 0, MAX_SWING);
    return this.swing;
  }

  /** Select variation A/B. While playing this plays a fill first, then switches. */
  setVariation(variation) {
    if (!VARIATIONS.includes(variation)) return false;
    if (this.state === 'playing' && this.hasSections) return this.requestFill(variation);
    this.variation = variation;
    if (this.section === 'main' && this.base) this.pattern = this.#patternFor('main');
    this.#emitSection(this.getTime());
    return true;
  }

  /** Play a fill to the end of the bar (or through the next bar if the bar is nearly over). */
  requestFill(target = this.variation) {
    if (!VARIATIONS.includes(target)) target = this.variation;
    if (this.state !== 'playing' || !this.hasSections || this.section !== 'main') return false;
    const stepInBar = this.step % this.pattern.stepsPerBar;
    if (this.pattern.stepsPerBar - stepInBar < this.pattern.stepsPerBeat) {
      this.pending.fill = target;
    } else {
      this.#enterSection('fill', stepInBar, target);
    }
    return true;
  }

  /** Play the ending from the next bar line, then stop. */
  requestEnding() {
    if (this.state !== 'playing' || !this.hasSections || this.section === 'ending') return false;
    this.pending.ending = true;
    return true;
  }

  /** Restart with the intro at the next bar line (while playing). */
  requestIntro() {
    if (this.state !== 'playing' || !this.hasSections) return false;
    this.pending.intro = true;
    return true;
  }

  start({ atTime, intro = false } = {}) {
    if (this.state === 'playing') return false;
    if (!this.pattern) throw new Error('No rhythm pattern selected');
    const now = this.getTime();
    this.nextTime = Math.max(Number.isFinite(atTime) ? atTime : now + this.startDelay, now);
    if (intro && this.hasSections && this.state === 'stopped') this.#enterSection('intro', 0);
    else if (this.state === 'stopped') this.#emitSection(this.nextTime);
    this.state = 'playing';
    this.timer = this.setTimer(() => this.tick(), this.lookahead * 1000);
    this.tick();
    return true;
  }

  /** Halt but keep the position; start() resumes from the next step. */
  pause() {
    if (this.state !== 'playing') return false;
    this.#clearTimer();
    this.state = 'paused';
    return true;
  }

  /** Halt and rewind to bar 1, beat 1 of the current variation. */
  stop() {
    this.#clearTimer();
    this.state = 'stopped';
    this.step = 0;
    this.bar = 0;
    if (this.pending.style) this.base = this.pending.style;
    this.pending = { style: null, fill: null, ending: false, intro: false };
    this.section = 'main';
    if (this.base) this.pattern = this.#patternFor('main');
  }

  /** Stop, rewind and restore the style's default tempo and swing. */
  reset() {
    this.stop();
    if (this.base) {
      this.setTempo(this.base.bpm);
      this.setSwing(this.base.swing);
    }
  }

  tick() {
    if (this.state !== 'playing') return;
    const now = this.getTime();
    // After a long stall (sleep, debugger) skip ahead instead of firing a burst of old steps.
    if (this.nextTime < now - 0.25) this.nextTime = now + 0.02;
    const horizon = now + this.scheduleAhead;
    let guard = 0;
    while (this.state === 'playing' && this.nextTime < horizon && guard++ < 512) {
      this.#emitStep();
      this.#advance();
    }
  }

  #patternFor(section) {
    const sections = this.base?.sections;
    if (!sections) return this.base;
    if (section === 'main') return sections[this.variation] ?? this.base;
    return sections[section] ?? sections[this.variation] ?? this.base;
  }

  #enterSection(section, step = 0, target) {
    this.section = section;
    if (section === 'fill') this.fillTarget = target ?? this.variation;
    this.pattern = this.#patternFor(section);
    this.step = step;
    this.#emitSection(this.nextTime);
  }

  #toMain() {
    if (this.pending.style) {
      this.base = this.pending.style;
      this.pending.style = null;
    }
    if (this.pending.ending) {
      this.pending.ending = false;
      this.#enterSection('ending');
      return;
    }
    this.section = 'main';
    this.pattern = this.#patternFor('main');
    this.step = 0;
    this.#emitSection(this.nextTime);
  }

  #emitSection(time) {
    const info = { section: this.section, variation: this.section === 'fill' ? this.fillTarget : this.variation, time };
    for (const listener of this.sectionListeners) {
      try {
        listener(info);
      } catch (err) {
        console.error('[sequencer] section listener failed', err);
      }
    }
  }

  #emitStep() {
    const p = this.pattern;
    const stepInBar = this.step % p.stepsPerBar;
    const [even, odd] = stepDurations(this.tempo, p.stepsPerBeat, this.swing);
    const info = {
      time: this.nextTime,
      step: this.step,
      stepInBar,
      bar: this.bar,
      beat: Math.floor(stepInBar / p.stepsPerBeat),
      beatsPerBar: p.beatsPerBar,
      isBeatStart: stepInBar % p.stepsPerBeat === 0,
      isBarStart: stepInBar === 0,
      stepDuration: this.step % 2 === 0 ? even : odd,
      tempo: this.tempo,
      section: this.section,
      variation: this.variation,
      pattern: p,
      hits: p.steps[this.step],
    };
    for (const listener of this.listeners) {
      try {
        listener(info);
      } catch (err) {
        console.error('[sequencer] step listener failed', err);
      }
    }
  }

  #advance() {
    const p = this.pattern;
    const [even, odd] = stepDurations(this.tempo, p.stepsPerBeat, this.swing);
    this.nextTime += this.step % 2 === 0 ? even : odd;
    this.step += 1;
    const atBarLine = this.step % p.stepsPerBar === 0;
    if (atBarLine) this.bar += 1;
    const wrapped = this.step >= p.totalSteps;
    if (wrapped) this.step = 0;
    if (!atBarLine) return;

    switch (this.section) {
      case 'intro':
        if (wrapped) this.#toMain();
        break;
      case 'fill':
        this.variation = this.fillTarget;
        this.#toMain();
        break;
      case 'ending':
        if (wrapped) this.#finish();
        break;
      default:
        if (this.pending.ending) {
          this.pending.ending = false;
          this.#enterSection('ending');
        } else if (this.pending.intro) {
          this.pending.intro = false;
          this.#enterSection('intro');
        } else if (this.pending.fill) {
          const target = this.pending.fill;
          this.pending.fill = null;
          this.#enterSection('fill', 0, target);
        } else if (this.pending.style) {
          this.base = this.pending.style;
          this.pending.style = null;
          this.pattern = this.#patternFor('main');
          this.step = 0;
        }
    }
  }

  #finish() {
    const time = this.nextTime;
    this.stop();
    for (const listener of this.endListeners) {
      try {
        listener({ time });
      } catch (err) {
        console.error('[sequencer] end listener failed', err);
      }
    }
  }

  #clearTimer() {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }
}

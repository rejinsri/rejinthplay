/**
 * 61-key virtual keyboard (C2–C7). Mouse/touch/pen playing with glissando;
 * velocity comes from where the key is struck (nearer the front = louder).
 */

import { clamp, isBlackKey, midiToNoteName } from '../core/note-utils.js';
import { h } from './dom.js';

export class KeyboardView {
  constructor(container, { low = 36, high = 96, onNoteOn, onNoteOff } = {}) {
    this.container = container;
    this.low = low;
    this.high = high;
    this.onNoteOn = onNoteOn;
    this.onNoteOff = onNoteOff;
    this.keys = new Map();
    this.counts = new Map();
    this.pointers = new Map();
    this.render();
    this.#bindPointer();
  }

  render() {
    const whiteCount = [...Array(this.high - this.low + 1).keys()].filter((i) => !isBlackKey(this.low + i)).length;
    const whiteWidth = 100 / whiteCount;
    this.bed = h('div', { class: 'keys' });
    let whiteIndex = 0;
    for (let note = this.low; note <= this.high; note++) {
      const black = isBlackKey(note);
      const key = h(
        'div',
        { class: `key ${black ? 'black' : 'white'}`, dataset: { note }, 'aria-label': midiToNoteName(note) },
        h('span', { class: 'key-label' }),
        !black && note % 12 === 0 ? h('span', { class: 'key-note' }, midiToNoteName(note)) : null,
      );
      if (black) {
        key.style.left = `${whiteIndex * whiteWidth - whiteWidth * 0.31}%`;
        key.style.width = `${whiteWidth * 0.62}%`;
      } else {
        key.style.left = `${whiteIndex * whiteWidth}%`;
        key.style.width = `${whiteWidth}%`;
        whiteIndex += 1;
      }
      this.keys.set(note, key);
      this.bed.append(key);
    }
    this.container.replaceChildren(this.bed);
  }

  #bindPointer() {
    const bed = this.bed;
    bed.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const key = e.target.closest('.key');
      if (!key) return;
      e.preventDefault();
      bed.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { note: null });
      this.#press(e.pointerId, key, e);
    });
    bed.addEventListener('pointermove', (e) => {
      const current = this.pointers.get(e.pointerId);
      if (!current) return;
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const key = hit && hit.closest ? hit.closest('.key') : null;
      const note = key ? Number(key.dataset.note) : null;
      if (note === current.note) return;
      this.#release(e.pointerId);
      if (key) this.#press(e.pointerId, key, e);
    });
    const end = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.#release(e.pointerId);
      this.pointers.delete(e.pointerId);
    };
    bed.addEventListener('pointerup', end);
    bed.addEventListener('pointercancel', end);
    bed.addEventListener('lostpointercapture', end);
    bed.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  #press(pointerId, keyEl, event) {
    const note = Number(keyEl.dataset.note);
    const rect = keyEl.getBoundingClientRect();
    const depth = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    const velocity = Math.round(35 + 92 * depth);
    this.pointers.get(pointerId).note = note;
    this.onNoteOn?.(`p${pointerId}`, note, velocity);
  }

  #release(pointerId) {
    const current = this.pointers.get(pointerId);
    if (current && current.note !== null) {
      this.onNoteOff?.(`p${pointerId}`, current.note);
      current.note = null;
    }
  }

  /** Release every pointer-held note (focus loss). */
  releasePointers() {
    for (const id of [...this.pointers.keys()]) {
      this.#release(id);
      this.pointers.delete(id);
    }
  }

  /** kind: 'live' (player) or 'play' (recorded playback). Reference counted. */
  setActive(note, on, kind = 'live') {
    const id = `${kind}:${note}`;
    const count = Math.max(0, (this.counts.get(id) ?? 0) + (on ? 1 : -1));
    if (count === 0) this.counts.delete(id);
    else this.counts.set(id, count);
    this.keys.get(note)?.classList.toggle(kind === 'live' ? 'is-down' : 'is-play', count > 0);
  }

  clearActive(kind) {
    for (const id of [...this.counts.keys()]) {
      if (!id.startsWith(`${kind}:`)) continue;
      this.counts.delete(id);
      this.keys.get(Number(id.split(':')[1]))?.classList.remove(kind === 'live' ? 'is-down' : 'is-play');
    }
  }

  /** @param {Map<number, string>} labels note -> laptop key label */
  setLabels(labels) {
    for (const [note, key] of this.keys) {
      key.querySelector('.key-label').textContent = labels.get(note) ?? '';
      key.classList.toggle('in-zone', labels.has(note));
    }
  }

  /** Hover titles per key (e.g. drum names); null restores the note names. */
  setTitles(titleFor) {
    for (const [note, key] of this.keys) {
      const title = titleFor ? titleFor(note) : '';
      key.title = title || midiToNoteName(note);
      key.classList.toggle('has-sound', Boolean(titleFor && title));
    }
  }

  showLabels(on) {
    this.container.classList.toggle('hide-labels', !on);
  }

  /** Highlight the chord zone (notes below `split`), or clear it with null. */
  setChordZone(split) {
    for (const [note, key] of this.keys) key.classList.toggle('chord-zone', split !== null && note < split);
  }
}

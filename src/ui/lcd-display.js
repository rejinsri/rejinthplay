import { h, signed } from './dom.js';

const INDICATORS = [
  ['accomp', 'ACMP'],
  ['sync', 'SYNC'],
  ['sustain', 'SUS'],
  ['metronome', 'METR'],
  ['rec', 'REC'],
  ['play', 'PLAY'],
  ['wav', 'WAV'],
];

/** The backlit "LCD" in the middle of the control deck. */
export class LcdDisplay {
  constructor(container) {
    const field = (label, cls = '') => {
      const value = h('span', { class: `lcd-value ${cls}` }, '');
      return { el: h('div', { class: 'lcd-field' }, h('span', { class: 'lcd-label' }, label), value), value };
    };

    this.number = h('span', { class: 'lcd-number' }, '001');
    this.name = h('span', { class: 'lcd-name' }, '');
    this.badge = h('span', { class: 'lcd-badge' }, 'SYN');
    this.rhythm = field('RHYTHM');
    this.chord = field('CHORD', 'lcd-chord');
    this.tempo = field('TEMPO', 'lcd-digits');
    this.position = field('BAR:BEAT', 'lcd-digits');
    this.octave = field('OCT', 'lcd-digits');
    this.transpose = field('TRANS', 'lcd-digits');
    this.velocity = field('VEL', 'lcd-digits');
    this.poly = field('POLY', 'lcd-digits');
    this.beats = h('div', { class: 'lcd-beats' });
    this.indicators = new Map(INDICATORS.map(([id, label]) => [id, h('span', { class: 'lcd-ind' }, label)]));
    this.message = h('div', { class: 'lcd-message' }, '');

    container.replaceChildren(
      h(
        'div',
        { class: 'lcd' },
        h('div', { class: 'lcd-row lcd-main' }, this.number, this.name, this.badge),
        h('div', { class: 'lcd-row lcd-sub' }, this.rhythm.el, this.chord.el),
        h('div', { class: 'lcd-row lcd-stats' }, this.tempo.el, this.position.el, this.octave.el, this.transpose.el, this.velocity.el, this.poly.el),
        h('div', { class: 'lcd-row lcd-status' }, this.beats, h('div', { class: 'lcd-inds' }, [...this.indicators.values()])),
        this.message,
      ),
    );
    this.setBeats(4, -1);
  }

  setInstrument({ number, name, kind }) {
    this.number.textContent = String(number).padStart(3, '0');
    this.name.textContent = name.toUpperCase();
    this.badge.textContent = kind === 'sampled' ? 'SMP' : kind === 'drums' ? 'DRM' : 'SYN';
    this.badge.title = kind === 'sampled' ? 'Sampled instrument (user samples)' : kind === 'drums' ? 'Drum kit: each key is a drum' : 'Synthesized instrument';
    this.badge.classList.toggle('is-sampled', kind === 'sampled');
  }

  setRhythm(name) {
    this.rhythm.value.textContent = name.toUpperCase();
  }

  setChord(name) {
    this.chord.value.textContent = name || '—';
  }

  setTempo(bpm) {
    this.tempo.value.textContent = String(bpm).padStart(3, '0');
  }

  setPosition(bar, beat) {
    this.position.value.textContent = bar < 0 ? '---:-' : `${String(bar + 1).padStart(3, '0')}:${beat + 1}`;
  }

  setValues({ octave, transpose, velocity }) {
    if (octave !== undefined) this.octave.value.textContent = signed(octave);
    if (transpose !== undefined) this.transpose.value.textContent = signed(transpose);
    if (velocity !== undefined) this.velocity.value.textContent = String(velocity).padStart(3, '0');
  }

  setPoly(count) {
    this.poly.value.textContent = String(count).padStart(2, '0');
  }

  setBeats(beatsPerBar, current) {
    if (this.beats.children.length !== beatsPerBar) {
      this.beats.replaceChildren(...Array.from({ length: beatsPerBar }, () => h('span', { class: 'beat-dot' })));
    }
    [...this.beats.children].forEach((dot, i) => {
      dot.classList.toggle('on', i === current);
      dot.classList.toggle('downbeat', i === current && i === 0);
    });
  }

  setIndicator(id, on) {
    this.indicators.get(id)?.classList.toggle('on', Boolean(on));
  }

  showMessage(text, ms = 1600) {
    this.message.textContent = text;
    this.message.classList.add('on');
    clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => this.message.classList.remove('on'), ms);
  }
}

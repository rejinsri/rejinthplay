import { DRUM_KITS } from '../audio/drum-kit.js';
import { MAX_TEMPO, MIN_TEMPO } from '../audio/rhythm-sequencer.js';
import { button, h, ledButton, panelHeader, select, slider } from './dom.js';

/** Style and drum kit selection, transport, tempo (with tap), swing, metronome and arranger sections. */
export class RhythmPanel {
  constructor(container, options) {
    const { patterns, patternId, drumKit, tempo, swing, metronome, variation } = options;
    const { onPattern, onDrumKit, onStartStop, onPause, onReset, onTempo, onSwing, onMetronome, onIntro, onVariation, onFill, onEnding } = options;
    this.onTempo = onTempo;
    this.pattern = select({
      label: 'STYLE',
      options: patterns.map((p) => ({ value: p.id, label: p.name, group: p.category })),
      value: patternId,
      onChange: onPattern,
    });
    this.kit = select({
      label: 'DRUM KIT',
      options: Object.entries(DRUM_KITS).map(([id, kit]) => ({ value: id, label: kit.name })),
      value: drumKit,
      onChange: onDrumKit,
    });
    this.startButton = ledButton({ label: 'START/STOP', title: 'Start or stop the rhythm (Enter)', onClick: onStartStop, className: 'btn-primary' });
    this.pauseButton = button('PAUSE', { title: 'Pause (keeps position)', onClick: onPause });
    this.resetButton = button('RESET', { title: 'Stop, rewind and restore the style tempo', onClick: onReset });
    this.metronomeButton = ledButton({ label: 'METRO', title: 'Metronome (F6)', active: metronome, onClick: onMetronome });

    this.introButton = ledButton({ label: 'INTRO', title: 'Intro (F7)', onClick: onIntro, className: 'btn-arr' });
    this.varA = ledButton({ label: 'VAR A', title: 'Variation A (F8) — plays a fill-in when pressed during play', onClick: () => onVariation('A'), className: 'btn-arr' });
    this.varB = ledButton({ label: 'VAR B', title: 'Variation B (F9) — plays a fill-in when pressed during play', onClick: () => onVariation('B'), className: 'btn-arr' });
    this.fillButton = ledButton({ label: 'FILL', title: 'Fill-in (F10)', onClick: onFill, className: 'btn-arr' });
    this.endingButton = ledButton({ label: 'ENDING', title: 'Ending, then stop (F11)', onClick: onEnding, className: 'btn-arr' });

    this.tempoDisplay = h('span', { class: 'tempo-digits' }, String(tempo));
    this.tempoSlider = slider({ label: 'TEMPO', min: MIN_TEMPO, max: MAX_TEMPO, value: tempo, format: (v) => `${v}`, onInput: onTempo });
    this.swing = slider({ label: 'SWING', min: 0, max: 50, value: Math.round(swing * 100), format: (v) => `${v}%`, onInput: (v) => onSwing(v / 100) });
    this.taps = [];

    container.replaceChildren(
      panelHeader('RHYTHM'),
      h('div', { class: 'panel-body' },
        h('div', { class: 'field-row' }, this.pattern.root, this.kit.root),
        h('div', { class: 'tempo-row' },
          h('button', { type: 'button', class: 'btn btn-step', 'aria-label': 'Tempo down', onClick: () => onTempo(this.tempo - 1) }, '−'),
          this.tempoDisplay,
          h('button', { type: 'button', class: 'btn btn-step', 'aria-label': 'Tempo up', onClick: () => onTempo(this.tempo + 1) }, '+'),
          button('TAP', { className: 'btn-small', title: 'Tap tempo', onClick: () => this.#tap() }),
        ),
        h('div', { class: 'field-row' }, this.tempoSlider.root, this.swing.root),
        h('div', { class: 'transport-row' }, this.startButton, this.pauseButton, this.resetButton, this.metronomeButton),
        h('div', { class: 'arranger-row' }, this.introButton, this.varA, this.varB, this.fillButton, this.endingButton),
      ),
    );
    this.tempo = tempo;
    this.setSection({ section: 'main', variation });
  }

  #tap() {
    const now = performance.now();
    this.taps = this.taps.filter((t) => now - t < 2500);
    this.taps.push(now);
    if (this.taps.length >= 2) {
      const intervals = this.taps.slice(1).map((t, i) => t - this.taps[i]);
      const average = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      this.onTempo(Math.round(60000 / average));
    }
  }

  setPattern(id) {
    this.pattern.setValue(id);
  }

  setDrumKit(id) {
    this.kit.setValue(id);
  }

  setTempo(bpm) {
    this.tempo = bpm;
    this.tempoDisplay.textContent = String(bpm);
    this.tempoSlider.setValue(bpm);
  }

  setSwing(amount) {
    this.swing.setValue(Math.round(amount * 100));
  }

  setState(state) {
    this.startButton.setActive(state === 'playing');
    this.pauseButton.classList.toggle('is-active', state === 'paused');
  }

  setMetronome(on) {
    this.metronomeButton.setActive(on);
  }

  /** Light the arranger buttons for the playing section; `armedIntro` shows a pending intro. */
  setSection({ section, variation, armedIntro = false, endingPending = false }) {
    this.introButton.setActive(section === 'intro' || armedIntro);
    this.fillButton.setActive(section === 'fill');
    this.endingButton.setActive(section === 'ending' || endingPending);
    this.varA.setActive(variation === 'A');
    this.varB.setActive(variation === 'B');
  }
}

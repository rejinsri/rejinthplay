import { CHORD_TYPES } from '../audio/chord-detector.js';
import { NOTE_NAMES, midiToNoteName } from '../core/note-utils.js';
import { button, h, ledButton, panelHeader, select } from './dom.js';

const MODES = [
  { value: 'fingered', label: 'Fingered (play full chords)' },
  { value: 'casio', label: 'Single finger (below split)' },
  { value: 'manual', label: 'Manual chord' },
];

/** Auto-accompaniment controls and the current chord. */
export class AccompanimentPanel {
  constructor(container, { mode, splitPoint, manualRoot, manualType, onToggle, onStart, onMode, onSplit, onManual, onClear }) {
    this.toggleButton = ledButton({ label: 'ACCOMP', title: 'Accompaniment on/off (F2)', onClick: onToggle, className: 'btn-primary' });
    this.startButton = ledButton({ label: 'SYNC START', title: 'Arm sync start (F5): the rhythm starts with your first chord', onClick: onStart, className: 'btn-sync' });
    this.clearButton = button('CLEAR CHORD', { title: 'Forget the current chord', onClick: onClear });
    this.chordDisplay = h('div', { class: 'chord-display' }, '—');
    this.styleDisplay = h('div', { class: 'chord-style' }, '');

    this.mode = select({ label: 'CHORD MODE', options: MODES, value: mode, onChange: onMode, className: 'field-wide' });
    const splitOptions = [];
    for (let n = 48; n <= 72; n++) splitOptions.push({ value: n, label: midiToNoteName(n) });
    this.split = select({ label: 'SPLIT', options: splitOptions, value: splitPoint, onChange: (v) => onSplit(Number(v)) });
    this.root = select({
      label: 'ROOT',
      options: NOTE_NAMES.map((name, i) => ({ value: i, label: name })),
      value: manualRoot,
      onChange: (v) => onManual(Number(v), this.type.select.value),
    });
    this.type = select({
      label: 'TYPE',
      options: CHORD_TYPES.map((t) => ({ value: t.id, label: `${t.symbol || 'maj'} · ${t.name}` })),
      value: manualType,
      onChange: (v) => onManual(Number(this.root.select.value), v),
    });
    this.manualRow = h('div', { class: 'field-row' }, this.root.root, this.type.root);
    this.splitRow = h('div', { class: 'field-row' }, this.split.root);

    container.replaceChildren(
      panelHeader('ACCOMPANIMENT'),
      h('div', { class: 'panel-body' },
        h('div', { class: 'chord-box' }, this.chordDisplay, this.styleDisplay),
        this.mode.root,
        this.splitRow,
        this.manualRow,
        h('div', { class: 'button-row' }, this.toggleButton, this.startButton, this.clearButton),
      ),
    );
    this.setMode(mode);
  }

  setEnabled(on) {
    this.toggleButton.setActive(on);
  }

  setSync(armed) {
    this.startButton.setActive(armed);
  }

  setMode(mode) {
    this.mode.setValue(mode);
    this.manualRow.hidden = mode !== 'manual';
    this.splitRow.hidden = mode !== 'casio';
  }

  setChord(name) {
    this.chordDisplay.textContent = name || '—';
  }

  setStyle(text) {
    this.styleDisplay.textContent = text;
  }
}

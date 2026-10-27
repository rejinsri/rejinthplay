import { DEFAULT_NOTE_MAP, NOTE_OFFSET_MAX, NOTE_OFFSET_MIN, codeToLabel, isValidNoteKeyCode, validateNoteMap } from '../core/key-mapping.js';
import { NOTE_NAMES, mod12 } from '../core/note-utils.js';
import { button, h } from './dom.js';
import { Modal } from './modal.js';

const offsetLabel = (offset) => `${NOTE_NAMES[mod12(offset)]}  (${offset >= 0 ? '+' : ''}${offset})`;

/**
 * Settings dialog: general options, audio options and the key-mapping editor.
 * `capture` is shared with the app so note playing pauses while a key is being assigned.
 */
export class SettingsPanel {
  constructor({ settings, getNoteMap, onSetting, onKeyMap, onResetAll, getAudioInfo, capture }) {
    this.settings = settings;
    this.getNoteMap = getNoteMap;
    this.onSetting = onSetting;
    this.onKeyMap = onKeyMap;
    this.onResetAll = onResetAll;
    this.getAudioInfo = getAudioInfo;
    this.capture = capture;
    this.working = {};
    this.body = h('div', { class: 'settings' });
    this.modal = new Modal({ title: 'Settings', content: this.body, className: 'modal-wide', onClose: () => this.#stopCapture() });
    window.addEventListener('keydown', (e) => this.#onCaptureKey(e));
  }

  open() {
    this.working = { ...this.getNoteMap() };
    this.#render();
    this.modal.open();
  }

  get isOpen() {
    return this.modal.isOpen;
  }

  close() {
    this.modal.close();
  }

  #render() {
    const s = this.settings.get();
    const check = (path, label, hint) =>
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: Boolean(s[path]), onChange: (e) => this.onSetting(path, e.target.checked) }),
        h('span', {}, label),
        hint ? h('small', {}, hint) : null,
      );
    const choose = (path, label, options, hint) => {
      const el = h('select', { onChange: (e) => this.onSetting(path, isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value)) },
        options.map(([value, text]) => h('option', { value }, text)));
      el.value = String(s[path]);
      return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), el, hint ? h('small', {}, hint) : null);
    };
    const tuning = h('input', { type: 'number', min: 415, max: 466, step: 0.5, value: s.tuningA4 });
    tuning.addEventListener('change', () => {
      const stored = this.onSetting('tuningA4', Number(tuning.value));
      tuning.value = String(stored ?? this.settings.get('tuningA4'));
    });
    const info = this.getAudioInfo();
    this.status = h('div', { class: 'keymap-status' });
    this.captureButton = button('ADD KEY…', { className: 'btn-small', onClick: () => this.#startCapture() });
    this.resetAllButton = button('RESET ALL SETTINGS', { className: 'btn-danger', onClick: () => this.#confirmReset() });

    this.body.replaceChildren(
      h('section', { class: 'settings-section' },
        h('h3', {}, 'Playing'),
        check('showKeyLabels', 'Show laptop key labels on the piano'),
        check('accentOnShift', 'Hold Shift for accented (louder) notes'),
        check('humanize', 'Humanize velocity', 'small random variation, like a real player'),
        choose('sustainMode', 'Space bar sustain', [['hold', 'Hold (pedal)'], ['toggle', 'Toggle (latch)']]),
      ),
      h('section', { class: 'settings-section' },
        h('h3', {}, 'Audio'),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Tuning (A4 Hz)'), tuning),
        choose('maxPolyphony', 'Max polyphony', [16, 24, 32, 48, 64, 96, 128].map((n) => [n, `${n} voices`])),
        choose('latencyHint', 'Latency mode', [['interactive', 'Lowest latency'], ['balanced', 'Balanced'], ['playback', 'Most stable (higher latency)']], 'applies after reloading the page'),
        h('p', { class: 'muted' }, info
          ? `Sample rate ${info.sampleRate} Hz · base latency ${(info.base * 1000).toFixed(1)} ms · output latency ${(info.output * 1000).toFixed(1)} ms`
          : 'Audio is not running.'),
      ),
      h('section', { class: 'settings-section settings-keymap' },
        h('h3', {}, 'Key mapping'),
        h('p', { class: 'muted' }, 'Offsets are semitones above the current octave root (C4 at octave 0). Note keys override shortcuts on the same key.'),
        this.#keymapTable(),
        h('div', { class: 'button-row' },
          this.captureButton,
          button('APPLY MAPPING', { className: 'btn-small btn-primary', onClick: () => this.#apply() }),
          button('RESTORE DEFAULTS', { className: 'btn-small', onClick: () => { this.working = { ...DEFAULT_NOTE_MAP }; this.#apply(); } }),
        ),
        this.status,
      ),
      h('section', { class: 'settings-section' }, h('h3', {}, 'Reset'), this.resetAllButton),
    );
  }

  #keymapTable() {
    const entries = Object.entries(this.working).sort((a, b) => a[1] - b[1]);
    const offsets = [];
    for (let o = NOTE_OFFSET_MIN; o <= NOTE_OFFSET_MAX; o++) offsets.push(o);
    this.table = h('div', { class: 'keymap-table' },
      entries.map(([code, offset]) => {
        const sel = h('select', { 'aria-label': `Note for key ${codeToLabel(code)}`, onChange: (e) => { this.working[code] = Number(e.target.value); } },
          offsets.map((o) => h('option', { value: o }, offsetLabel(o))));
        sel.value = String(offset);
        return h('div', { class: 'keymap-row' },
          h('kbd', {}, codeToLabel(code)),
          sel,
          h('button', { type: 'button', class: 'btn btn-ghost', 'aria-label': `Remove ${codeToLabel(code)}`, onClick: () => { delete this.working[code]; this.#refreshTable(); } }, '✕'),
        );
      }),
    );
    return this.table;
  }

  #refreshTable() {
    this.table.replaceWith(this.#keymapTable());
  }

  #apply() {
    const result = validateNoteMap(this.working);
    if (!result.valid) {
      this.#setStatus(result.errors.join(' · '), 'error');
      return;
    }
    this.onKeyMap(result.map);
    this.working = { ...result.map };
    this.#refreshTable();
    this.#setStatus(result.warnings.length ? `Applied. Note: ${result.warnings.join(' · ')}` : 'Key mapping applied.', result.warnings.length ? 'warning' : 'success');
  }

  #setStatus(text, type) {
    this.status.textContent = text;
    this.status.dataset.type = type;
  }

  #startCapture() {
    this.capture.active = true;
    this.captureButton.textContent = 'PRESS A KEY…';
    this.captureButton.classList.add('is-active');
  }

  #stopCapture() {
    this.capture.active = false;
    if (this.captureButton) {
      this.captureButton.textContent = 'ADD KEY…';
      this.captureButton.classList.remove('is-active');
    }
  }

  #onCaptureKey(e) {
    if (!this.capture.active || !this.isOpen) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') return this.#stopCapture();
    if (!isValidNoteKeyCode(e.code)) {
      this.#setStatus(`${codeToLabel(e.code)} cannot be used as a note key.`, 'error');
      return;
    }
    this.#stopCapture();
    if (e.code in this.working) {
      this.#setStatus(`${codeToLabel(e.code)} is already mapped.`, 'warning');
      return;
    }
    const highest = Math.max(-1, ...Object.values(this.working));
    this.working[e.code] = Math.min(NOTE_OFFSET_MAX, highest + 1);
    this.#refreshTable();
    this.#setStatus(`Added ${codeToLabel(e.code)} — choose its note, then Apply.`, 'info');
  }

  #confirmReset() {
    if (!this.resetAllButton.classList.contains('is-armed')) {
      this.resetAllButton.classList.add('is-armed');
      this.resetAllButton.textContent = 'CLICK AGAIN TO CONFIRM';
      setTimeout(() => {
        this.resetAllButton.classList.remove('is-armed');
        this.resetAllButton.textContent = 'RESET ALL SETTINGS';
      }, 3000);
      return;
    }
    this.onResetAll();
    this.close();
  }
}

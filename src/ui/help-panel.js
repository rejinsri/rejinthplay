import { DRUM_BANK_SIZE, drumNoteForKey, drumSoundForNote } from '../audio/drum-map.js';
import { CONTROL_DESCRIPTIONS, CONTROL_KEY_MAP, codeToLabel } from '../core/key-mapping.js';
import { midiToNoteName } from '../core/note-utils.js';
import { h } from './dom.js';
import { Modal } from './modal.js';

/** Keyboard shortcut reference (F1). */
export class HelpPanel {
  constructor({ getMapper, getRootNote, getInstruments }) {
    this.getMapper = getMapper;
    this.getRootNote = getRootNote;
    this.getInstruments = getInstruments;
    this.body = h('div', { class: 'help' });
    this.modal = new Modal({ title: 'Keyboard shortcuts', content: this.body, className: 'modal-wide' });
  }

  get isOpen() {
    return this.modal.isOpen;
  }

  toggle() {
    if (!this.modal.isOpen) this.#render();
    this.modal.toggle();
  }

  close() {
    this.modal.close();
  }

  #render() {
    const mapper = this.getMapper();
    const root = this.getRootNote();
    const notes = mapper.entries().map(([code, offset]) => h('div', { class: 'help-key' }, h('kbd', {}, codeToLabel(code)), h('span', {}, midiToNoteName(root + offset))));

    const grouped = new Map();
    for (const [code, action] of Object.entries(CONTROL_KEY_MAP)) {
      if (code in mapper.noteMap) continue;
      const desc = action.startsWith('instrument:') ? 'Select instrument 1–10' : CONTROL_DESCRIPTIONS[action];
      if (!grouped.has(desc)) grouped.set(desc, []);
      grouped.get(desc).push(codeToLabel(code));
    }
    const controls = [...grouped].map(([desc, keys]) =>
      h('div', { class: 'help-row' }, h('span', { class: 'help-keys' }, keys.length > 4 ? h('kbd', {}, `${keys[0]}–${keys[keys.length - 1]}`) : keys.map((k) => h('kbd', {}, k))), h('span', {}, desc)));

    const instruments = this.getInstruments()
      .slice(0, 10)
      .map((inst) => h('div', { class: 'help-key' }, h('kbd', {}, String(inst.number % 10)), h('span', {}, inst.name)));
    const drumBank = (octave) =>
      Array.from({ length: DRUM_BANK_SIZE }, (_, offset) => {
        const code = mapper.keysForOffset(offset)[0];
        const sound = drumSoundForNote(drumNoteForKey(offset, octave));
        return code && sound ? h('div', { class: 'help-key' }, h('kbd', {}, codeToLabel(code)), h('span', {}, sound.name)) : null;
      });

    this.body.replaceChildren(
      h('section', {}, h('h3', {}, `Notes (octave root ${midiToNoteName(root)})`), h('div', { class: 'help-grid' }, notes)),
      h('section', {}, h('h3', {}, 'Controls'), h('div', { class: 'help-list' }, controls)),
      h('section', {}, h('h3', {}, 'Instruments'), h('div', { class: 'help-grid' }, instruments)),
      h('section', {}, h('h3', {}, 'Drum Kit (9) · Kit bank, low → high'), h('div', { class: 'help-grid' }, drumBank(0))),
      h('section', {}, h('h3', {}, 'Drum Kit · Percussion bank (press X), low → high'), h('div', { class: 'help-grid' }, drumBank(1))),
      h('section', {},
        h('h3', {}, 'Tips'),
        h('ul', { class: 'help-tips' },
          h('li', {}, 'Mouse / touch: click a key near its front edge to play louder; drag across keys for a glissando.'),
          h('li', {}, 'Accompaniment: switch ACCOMP on, start the rhythm, then play a chord (3+ notes in Fingered mode).'),
          h('li', {}, 'Arranger: press SYNC (F5), optionally INTRO (F7), then play a chord to start. FILL-IN (F10) and VAR A/B (F8/F9) add fills; ENDING (F11) finishes the song.'),
          h('li', {}, 'On many laptops the F-keys need the Fn key held down.'),
          h('li', {}, 'Some laptops cannot report more than 3–6 simultaneous keys ("key ghosting"); this is a hardware limit.'),
          h('li', {}, 'Esc silences all notes if anything ever hangs. Notes are also released automatically when the window loses focus.'),
        ),
      ),
    );
  }
}

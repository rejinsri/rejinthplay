import { h, panelHeader } from './dom.js';

/** Instrument browser: built-in synth tones and the drum kit. */
export class InstrumentPanel {
  constructor(container, { onSelect }) {
    this.onSelect = onSelect;
    this.grid = h('div', { class: 'instrument-grid', role: 'listbox', 'aria-label': 'Instruments' });
    container.replaceChildren(panelHeader('INSTRUMENT'), this.grid);
    this.buttons = new Map();
  }

  setInstruments(list, selectedId) {
    this.buttons.clear();
    this.grid.replaceChildren(
      ...list.map((inst) => {
        const btn = h(
          'button',
          {
            type: 'button',
            class: 'instrument',
            role: 'option',
            title:
              inst.kind === 'sampled'
                ? `Sampled instrument${inst.license ? ` · ${inst.license}` : ''}`
                : inst.kind === 'drums'
                  ? 'Drum kit: every key plays a drum (kit chosen in the Rhythm panel)'
                  : 'Synthesized tone',
            onClick: () => this.onSelect(inst.id),
          },
          h('span', { class: 'instrument-number' }, String(inst.number).padStart(2, '0')),
          h('span', { class: 'instrument-name' }, inst.name),
          h('span', { class: `instrument-badge is-${inst.kind}` }, { sampled: 'SAMPLED', drums: 'DRUMS' }[inst.kind] ?? 'SYNTH'),
        );
        this.buttons.set(inst.id, btn);
        return btn;
      }),
    );
    this.setSelected(selectedId);
  }

  setSelected(id) {
    for (const [instId, btn] of this.buttons) {
      btn.classList.toggle('is-selected', instId === id);
      btn.setAttribute('aria-selected', String(instId === id));
    }
  }
}

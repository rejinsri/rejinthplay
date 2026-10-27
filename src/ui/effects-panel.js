import { h, ledButton, logSlider, panelHeader, slider } from './dom.js';

const PARTS = [
  ['keyboard', 'KEYS'],
  ['drums', 'DRUMS'],
  ['bass', 'BASS'],
  ['chord', 'CHORD'],
  ['metronome', 'METRO'],
];

const pct = (v) => `${Math.round(v * 100)}%`;
const hz = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`);

const EFFECTS = [
  { id: 'reverb', label: 'REVERB', params: [
    { key: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, format: pct },
    { key: 'decay', label: 'SIZE', min: 0.3, max: 8, step: 0.1, format: (v) => `${v.toFixed(1)}s` },
  ] },
  { id: 'chorus', label: 'CHORUS', params: [
    { key: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, format: pct },
    { key: 'rate', label: 'RATE', min: 0.05, max: 8, step: 0.05, format: (v) => `${v.toFixed(2)}Hz` },
    { key: 'depth', label: 'DEPTH', min: 0, max: 1, step: 0.01, format: pct },
  ] },
  { id: 'delay', label: 'DELAY', params: [
    { key: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, format: pct },
    { key: 'time', label: 'TIME', min: 0.02, max: 1.5, step: 0.01, format: (v) => `${Math.round(v * 1000)}ms` },
    { key: 'feedback', label: 'FDBK', min: 0, max: 0.9, step: 0.01, format: pct },
  ] },
  { id: 'lowpass', label: 'LOW-PASS', params: [
    { key: 'frequency', label: 'FREQ', min: 200, max: 20000, log: true, format: hz },
    { key: 'q', label: 'RES', min: 0.1, max: 20, step: 0.1, format: (v) => v.toFixed(1) },
  ] },
  { id: 'highpass', label: 'HIGH-PASS', params: [
    { key: 'frequency', label: 'FREQ', min: 20, max: 5000, log: true, format: hz },
    { key: 'q', label: 'RES', min: 0.1, max: 20, step: 0.1, format: (v) => v.toFixed(1) },
  ] },
  { id: 'distortion', label: 'DRIVE', params: [
    { key: 'amount', label: 'AMT', min: 0, max: 1, step: 0.01, format: pct },
    { key: 'mix', label: 'MIX', min: 0, max: 1, step: 0.01, format: pct },
  ] },
];

/** Mixer (per-part volume) and effect strips with independent bypass. */
export class EffectsPanel {
  constructor(container, { partVolumes, effects, onPartVolume, onEffect }) {
    this.faders = new Map();
    this.toggles = new Map();
    this.controls = new Map();

    const mixer = h('div', { class: 'mixer' },
      PARTS.map(([part, label]) => {
        const fader = slider({ label, min: 0, max: 100, value: Math.round(partVolumes[part] * 100), vertical: true, onInput: (v) => onPartVolume(part, v / 100) });
        this.faders.set(part, fader);
        return fader.root;
      }),
    );

    const strips = h('div', { class: 'fx-strips' },
      EFFECTS.map((fx) => {
        const state = effects[fx.id];
        const toggle = ledButton({ label: fx.label, title: `${fx.label} on/off`, active: state.enabled, onClick: () => onEffect(fx.id, 'enabled', !toggle.classList.contains('is-active')), className: 'btn-fx' });
        this.toggles.set(fx.id, toggle);
        const params = fx.params.map((p) => {
          const options = { label: p.label, value: state[p.key], format: p.format, onInput: (v) => onEffect(fx.id, p.key, v), className: 'slider-compact' };
          const control = p.log ? logSlider({ ...options, min: p.min, max: p.max }) : slider({ ...options, min: p.min, max: p.max, step: p.step });
          this.controls.set(`${fx.id}.${p.key}`, control);
          return control.root;
        });
        return h('div', { class: 'fx-strip', dataset: { fx: fx.id } }, toggle, h('div', { class: 'fx-params' }, params));
      }),
    );

    container.replaceChildren(panelHeader('MIXER · EFFECTS'), h('div', { class: 'effects-body' }, mixer, strips));
  }

  setEffect(id, state) {
    this.toggles.get(id)?.setActive(state.enabled);
    this.toggles.get(id)?.closest('.fx-strip').classList.toggle('is-on', state.enabled);
    for (const [key, value] of Object.entries(state)) {
      if (key !== 'enabled') this.controls.get(`${id}.${key}`)?.setValue(value);
    }
  }

  setPartVolume(part, value) {
    this.faders.get(part)?.setValue(Math.round(value * 100));
  }
}

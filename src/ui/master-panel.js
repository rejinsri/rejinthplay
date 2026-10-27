import { h, ledButton, panelHeader, signed, slider, stepper } from './dom.js';

/** Volume, octave, transpose, velocity, sustain and output meter. */
export class MasterPanel {
  constructor(container, { volume, octave, transpose, velocity, onVolume, onOctave, onTranspose, onVelocity, onSustain }) {
    this.volume = slider({ label: 'VOLUME', min: 0, max: 100, value: Math.round(volume * 100), format: (v) => `${v}`, onInput: (v) => onVolume(v / 100) });
    this.octave = stepper({ label: 'OCTAVE', value: octave, format: signed, onStep: onOctave, title: 'Z / X' });
    this.transpose = stepper({ label: 'TRANSPOSE', value: transpose, format: signed, onStep: onTranspose, title: '← / →' });
    this.velocity = slider({ label: 'VELOCITY', min: 1, max: 127, value: velocity, onInput: onVelocity });
    this.sustain = ledButton({ label: 'SUSTAIN', title: 'Sustain pedal (Space)', onClick: onSustain, className: 'btn-wide' });
    this.meterFill = h('div', { class: 'meter-fill' });
    this.meterPeak = h('div', { class: 'meter-peak' });

    container.replaceChildren(
      panelHeader('MASTER'),
      h('div', { class: 'master-grid' },
        h('div', { class: 'field-row' }, this.volume.root, this.velocity.root),
        h('div', { class: 'master-steppers' }, this.octave.root, this.transpose.root),
        this.sustain,
        h('div', { class: 'meter', title: 'Output level' }, this.meterFill, this.meterPeak),
      ),
    );
    this.peak = -60;
  }

  setVolume(v) {
    this.volume.setValue(Math.round(v * 100));
  }

  setOctave(v) {
    this.octave.setValue(v);
  }

  setTranspose(v) {
    this.transpose.setValue(v);
  }

  setVelocity(v) {
    this.velocity.setValue(v);
  }

  setSustain(on) {
    this.sustain.setActive(on);
  }

  /** @param {number} db output level in dBFS */
  setLevel(db) {
    const value = Number.isFinite(db) ? Math.max(-60, Math.min(0, db)) : -60;
    this.peak = Math.max(value, this.peak - 0.6);
    this.meterFill.style.width = `${((value + 60) / 60) * 100}%`;
    this.meterPeak.style.left = `${((this.peak + 60) / 60) * 100}%`;
    this.meterFill.classList.toggle('hot', value > -3);
  }
}

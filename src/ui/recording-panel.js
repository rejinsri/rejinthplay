import { button, formatTime, h, ledButton, panelHeader } from './dom.js';

/** Performance (event) recorder and rendered-audio (WAV) capture. */
export class RecordingPanel {
  constructor(container, handlers) {
    const { onRecord, onPlay, onPause, onStop, onClear, onSave, onLoad, onExportMidi, onAudioCapture } = handlers;
    this.recordButton = ledButton({ label: 'REC', title: 'Record performance (F3)', onClick: onRecord, className: 'btn-rec' });
    this.playButton = ledButton({ label: 'PLAY', title: 'Play recording (F4)', onClick: onPlay });
    this.pauseButton = button('PAUSE', { onClick: onPause, title: 'Pause / resume playback' });
    this.stopButton = button('STOP', { onClick: onStop, title: 'Stop playback' });
    this.clearButton = button('CLEAR', { onClick: onClear, title: 'Discard the recording' });
    this.saveButton = button('SAVE', { onClick: onSave, title: 'Save the performance (.json)', className: 'btn-small' });
    this.loadButton = button('LOAD', { onClick: onLoad, title: 'Load a saved performance', className: 'btn-small' });
    this.midiButton = button('MIDI', { onClick: onExportMidi, title: 'Export as Standard MIDI File (.mid)', className: 'btn-small' });
    this.audioButton = ledButton({ label: 'REC AUDIO → WAV', title: 'Capture everything you hear and export it as WAV', onClick: onAudioCapture, className: 'btn-rec btn-wide' });
    this.time = h('span', { class: 'rec-time' }, formatTime(0));
    this.info = h('span', { class: 'rec-info' }, 'No recording');
    this.audioTime = h('span', { class: 'rec-info' }, '');

    container.replaceChildren(
      panelHeader('RECORDER'),
      h('div', { class: 'panel-body' },
        h('div', { class: 'rec-display' }, this.time, this.info),
        h('div', { class: 'button-row' }, this.recordButton, this.playButton, this.pauseButton, this.stopButton),
        h('div', { class: 'button-row' }, this.clearButton, this.saveButton, this.loadButton, this.midiButton),
        h('div', { class: 'rec-divider' }, 'RENDERED AUDIO'),
        h('div', { class: 'button-row' }, this.audioButton, this.audioTime),
      ),
    );
  }

  setState({ recording, playing, paused, hasPerformance, capturing }) {
    this.recordButton.setActive(recording);
    this.playButton.setActive(playing);
    this.pauseButton.classList.toggle('is-active', paused);
    this.playButton.disabled = recording || !hasPerformance;
    this.pauseButton.disabled = !(playing || paused);
    this.stopButton.disabled = !(playing || paused);
    this.recordButton.disabled = playing || paused;
    for (const btn of [this.clearButton, this.saveButton, this.midiButton]) btn.disabled = recording || !hasPerformance;
    this.audioButton.setActive(capturing);
  }

  setTime(seconds, info) {
    this.time.textContent = formatTime(seconds);
    if (info !== undefined) this.info.textContent = info;
  }

  setAudioTime(seconds) {
    this.audioTime.textContent = seconds === null ? '' : formatTime(seconds);
  }
}

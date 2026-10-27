/**
 * Application bootstrap: wires the engines (audio, sequencer, accompaniment,
 * recorder) to the UI panels and to laptop-keyboard / mouse input.
 */

import { AccompanimentEngine } from '../audio/accompaniment-engine.js';
import { AudioCapture } from '../audio/audio-capture.js';
import { AudioEngine } from '../audio/audio-engine.js';
import { detectCasioChord, detectChord, manualChord } from '../audio/chord-detector.js';
import { DRUM_KITS } from '../audio/drum-kit.js';
import { DRUM_BANKS, drumBankForOctave, drumNoteForKey, drumSoundForNote } from '../audio/drum-map.js';
import { InstrumentEngine } from '../audio/instrument-engine.js';
import { performanceToMidi } from '../audio/midi-exporter.js';
import { PerformancePlayer, PerformanceRecorder, parsePerformance, serializePerformance } from '../audio/recording-engine.js';
import { PARSED_PATTERNS, getPattern } from '../audio/rhythm-patterns.js';
import { RhythmSequencer } from '../audio/rhythm-sequencer.js';
import { EventBus } from '../core/event-bus.js';
import { DEFAULT_NOTE_MAP, KeyMapper, codeToLabel } from '../core/key-mapping.js';
import { KeyboardController } from '../core/keyboard-controller.js';
import { clamp, midiToNoteName } from '../core/note-utils.js';
import { APP_VERSION, platform } from '../core/platform.js';
import { SettingsStore } from '../core/settings.js';
import { AccompanimentPanel } from './accompaniment-panel.js';
import { formatTime, signed } from './dom.js';
import { EffectsPanel } from './effects-panel.js';
import { HelpPanel } from './help-panel.js';
import { InstrumentPanel } from './instrument-panel.js';
import { KeyboardView } from './keyboard-view.js';
import { LcdDisplay } from './lcd-display.js';
import { MasterPanel } from './master-panel.js';
import { Modal } from './modal.js';
import { initNotifications, notify } from './notifications.js';
import { RecordingPanel } from './recording-panel.js';
import { RhythmPanel } from './rhythm-panel.js';
import { SettingsPanel } from './settings-panel.js';

const $ = (id) => document.getElementById(id);
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const BEND_RANGE = 2;
const SECTION_LABELS = { intro: 'INTRO', fill: 'FILL-IN', ending: 'ENDING' };

function isEditable(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  return target.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(target.type);
}

export class App {
  constructor() {
    this.bus = new EventBus();
    this.settings = new SettingsStore();
    const s = this.settings.get();

    this.instruments = new InstrumentEngine({ tuning: s.tuningA4 });
    this.audio = new AudioEngine({ bus: this.bus, instruments: this.instruments });
    this.mapper = new KeyMapper(DEFAULT_NOTE_MAP);
    if (s.keyMap) {
      try {
        this.mapper.setNoteMap(s.keyMap);
      } catch {
        this.settings.set('keyMap', null);
      }
    }
    this.keyboard = new KeyboardController({ mapper: this.mapper, octave: s.octave });
    this.sequencer = new RhythmSequencer({ getTime: () => this.audio.time });
    this.accomp = new AccompanimentEngine({ scheduleNote: (note) => this.audio.scheduleNote(note) });
    this.recorder = new PerformanceRecorder({ now: () => this.audio.time });
    this.player = new PerformancePlayer({
      getTime: () => this.audio.time,
      onEvent: (event, time) => this.onPlaybackEvent(event, time),
      onEnd: () => this.onPlaybackEnd(),
    });
    this.capture = null;
    this.keyCapture = { active: false };
    this.active = new Map();
    this.visualQueue = [];

    this.state = {
      instrumentId: this.instruments.has(s.instrumentId) ? s.instrumentId : 'piano',
      transpose: s.transpose,
      velocity: s.velocity,
      volume: s.masterVolume,
      metronome: s.rhythm.metronome,
      sustain: false,
      bendUp: false,
      bendDown: false,
      accompOn: false,
      syncArmed: false,
      introArmed: false,
      performance: null,
      playbackInstrument: 'piano',
    };
    this.sequencer.variation = s.rhythm.variation;
  }

  get drumMode() {
    return this.state.instrumentId === 'drums';
  }

  // ---------------------------------------------------------------- startup

  async start() {
    initNotifications($('toast-root'));
    this.buildUi();
    this.bindGlobalEvents();
    this.bus.on('audio:status', (status) => this.showAudioStatus(status));
    if (this.settings.loadError) notify(this.settings.loadError, { type: 'warning' });

    const s = this.settings.get();
    this.selectPattern(s.rhythm.patternId, { initial: true });
    this.selectInstrument(this.state.instrumentId, { quiet: true });
    this.updateKeyLabels();
    requestAnimationFrame(() => this.frame());

    await this.audio.init({ latencyHint: s.latencyHint, maxPolyphony: s.maxPolyphony });
    if (this.audio.ctx) {
      this.applyAudioSettings();
      // Pre-render plucked-string buffers in small chunks so the UI stays responsive.
      (async () => {
        await this.instruments.prepare(this.audio.ctx, 'guitar');
        await this.instruments.prepare(this.audio.ctx, 'harpsichord');
      })().catch((err) => console.warn('[app] plucked-string pre-render failed', err));
    }

    $('footer-info').textContent = `v${APP_VERSION}`;
  }

  buildUi() {
    const s = this.settings.get();
    this.lcd = new LcdDisplay($('lcd'));
    this.view = new KeyboardView($('keyboard'), {
      onNoteOn: (id, note, velocity) => this.noteOn('mouse', id, note, velocity),
      onNoteOff: (id) => this.noteOff('mouse', id),
    });
    this.view.showLabels(s.showKeyLabels);

    this.master = new MasterPanel($('master-panel'), {
      volume: s.masterVolume,
      octave: this.keyboard.octave,
      transpose: s.transpose,
      velocity: s.velocity,
      onVolume: (v) => this.setVolume(v),
      onOctave: (d) => this.shiftOctave(d),
      onTranspose: (d) => this.setTranspose(this.state.transpose + d),
      onVelocity: (v) => this.setVelocity(v),
      onSustain: () => this.setSustain(!this.state.sustain),
    });

    this.instrumentPanel = new InstrumentPanel($('instrument-panel'), {
      onSelect: (id) => this.selectInstrument(id),
    });
    this.instrumentPanel.setInstruments(this.instruments.list(), this.state.instrumentId);

    this.rhythmPanel = new RhythmPanel($('rhythm-panel'), {
      patterns: PARSED_PATTERNS,
      patternId: s.rhythm.patternId,
      drumKit: s.rhythm.drumKit,
      tempo: s.rhythm.tempo,
      swing: s.rhythm.swing,
      metronome: s.rhythm.metronome,
      variation: s.rhythm.variation,
      onPattern: (id) => this.selectPattern(id),
      onDrumKit: (id) => this.setDrumKit(id),
      onStartStop: () => this.toggleRhythm(),
      onPause: () => this.pauseRhythm(),
      onReset: () => this.resetRhythm(),
      onTempo: (bpm) => this.setTempo(bpm),
      onSwing: (amount) => this.setSwing(amount),
      onMetronome: () => this.setMetronome(!this.state.metronome),
      onIntro: () => this.intro(),
      onVariation: (v) => this.setVariation(v),
      onFill: () => this.fillIn(),
      onEnding: () => this.ending(),
    });

    this.accompPanel = new AccompanimentPanel($('accomp-panel'), {
      mode: s.accomp.chordMode,
      splitPoint: s.accomp.splitPoint,
      manualRoot: s.accomp.manualRoot,
      manualType: s.accomp.manualType,
      onToggle: () => this.setAccomp(!this.state.accompOn),
      onStart: () => this.toggleSync(),
      onMode: (mode) => this.setChordMode(mode),
      onSplit: (note) => {
        this.settings.set('accomp.splitPoint', note);
        this.updateChordZone();
      },
      onManual: (root, type) => this.setManualChord(root, type),
      onClear: () => {
        this.accomp.clearChord();
        this.showChord(null);
      },
    });

    this.effectsPanel = new EffectsPanel($('effects-panel'), {
      partVolumes: s.partVolumes,
      effects: s.effects,
      onPartVolume: (part, v) => {
        this.settings.set(`partVolumes.${part}`, v);
        if (this.audio.ctx) this.audio.setPartVolume(part, v);
      },
      onEffect: (fx, param, value) => this.setEffect(fx, param, value),
    });
    for (const [id, state] of Object.entries(s.effects)) this.effectsPanel.setEffect(id, state);

    this.recordingPanel = new RecordingPanel($('recording-panel'), {
      onRecord: () => this.toggleRecord(),
      onPlay: () => this.togglePlay(),
      onPause: () => this.pausePlayback(),
      onStop: () => this.stopPlayback(),
      onClear: () => this.clearPerformance(),
      onSave: () => this.savePerformance(),
      onLoad: () => this.loadPerformance(),
      onExportMidi: () => this.exportMidi(),
      onAudioCapture: () => this.toggleAudioCapture(),
    });

    this.settingsPanel = new SettingsPanel({
      settings: this.settings,
      getNoteMap: () => this.mapper.noteMap,
      onSetting: (path, value) => this.changeSetting(path, value),
      onKeyMap: (map) => this.setKeyMap(map),
      onResetAll: () => this.resetAllSettings(),
      getAudioInfo: () => this.audio.latency,
      capture: this.keyCapture,
    });
    this.help = new HelpPanel({
      getMapper: () => this.mapper,
      getRootNote: () => this.keyboard.rootNote,
      getInstruments: () => this.instruments.list(),
    });

    $('btn-settings').addEventListener('click', () => this.settingsPanel.open());
    $('btn-help').addEventListener('click', () => this.help.toggle());
    $('btn-audio-start').addEventListener('click', () => this.audio.resume());

    this.bendMarker = $('bend-marker');
    this.lcd.setValues({ octave: this.keyboard.octave, transpose: s.transpose, velocity: s.velocity });
    this.lcd.setTempo(s.rhythm.tempo);
    this.lcd.setPosition(-1, 0);
    this.lcd.setChord(null);
    this.lcd.setIndicator('metronome', s.rhythm.metronome);
    this.updateRecordingUi();
    this.updateChordZone();
  }

  bindGlobalEvents() {
    window.addEventListener('keydown', (e) => this.onKeyDown(e), true);
    window.addEventListener('keyup', (e) => this.onKeyUp(e), true);
    window.addEventListener('blur', () => this.releaseAllInput());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAllInput();
    });
    // Buttons keep focus after a click, and Space/Enter would "click" them again.
    document.addEventListener('pointerup', (e) => {
      const el = e.target instanceof Element ? e.target.closest('button, input[type=checkbox]') : null;
      if (el) setTimeout(() => el.blur(), 0);
    });
    document.addEventListener('pointerdown', () => {
      if (this.audio.state === 'suspended') this.audio.resume();
    });
    window.addEventListener('error', (e) => notify(`Unexpected error: ${e.message}`, { type: 'error' }));
    window.addEventListener('unhandledrejection', (e) => notify(`Unexpected error: ${e.reason?.message ?? e.reason}`, { type: 'error' }));
  }

  applyAudioSettings() {
    const s = this.settings.get();
    this.audio.setMasterVolume(s.masterVolume);
    for (const [part, value] of Object.entries(s.partVolumes)) this.audio.setPartVolume(part, value);
    this.audio.effects.apply(s.effects);
    this.audio.setDrumKit(s.rhythm.drumKit);
  }

  showAudioStatus({ state, message }) {
    const pill = $('audio-status');
    pill.dataset.state = state;
    pill.querySelector('.status-text').textContent = message;
    $('btn-audio-start').hidden = state !== 'suspended';
    if (state === 'unavailable' || state === 'error') {
      notify(`${message} The interface still works, but no sound can be produced.`, { type: 'error' });
    }
  }

  // ---------------------------------------------------------------- input

  onKeyDown(e) {
    if (this.keyCapture.active || isEditable(e.target)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (Modal.current && e.code === 'Escape') {
      e.preventDefault();
      Modal.current.close();
      return;
    }
    const action = this.keyboard.keyDown({ code: e.code, repeat: e.repeat });
    if (action.type === 'ignored') {
      if (action.reason === 'repeat') e.preventDefault();
      return;
    }
    e.preventDefault();
    if (this.audio.state === 'suspended') this.audio.resume();
    this.handleKeyAction(action, e.shiftKey);
  }

  onKeyUp(e) {
    // Always processed (even while typing or capturing) so a held note can never stick.
    const action = this.keyboard.keyUp({ code: e.code });
    if (action.type === 'ignored') return;
    e.preventDefault();
    this.handleKeyAction(action, false);
  }

  handleKeyAction(action, shift) {
    if (action.type === 'noteOn') {
      // In Drum Kit mode each key picks a drum (low → high) from the bank chosen by the octave.
      const note = this.drumMode ? drumNoteForKey(action.note - this.keyboard.rootNote, this.keyboard.octave) : action.note;
      if (note !== null) this.noteOn('kbd', action.code, note, this.keyVelocity(shift));
    } else if (action.type === 'noteOff') this.noteOff('kbd', action.code);
    else if (action.type === 'control') this.control(action.action, action.pressed);
  }

  keyVelocity(shift) {
    const s = this.settings.get();
    let v = this.state.velocity;
    if (shift && s.accentOnShift) v += 24;
    if (s.humanize) v += Math.round((Math.random() * 2 - 1) * 8);
    return clamp(v, 1, 127);
  }

  releaseAllInput() {
    for (const action of this.keyboard.releaseAll()) this.handleKeyAction(action, false);
    this.view.releasePointers();
    if (this.state.sustain && this.settings.get('sustainMode') === 'hold') this.setSustain(false);
  }

  control(action, pressed) {
    if (action.startsWith('instrument:')) {
      const inst = this.instruments.list()[Number(action.split(':')[1]) - 1];
      if (pressed && inst) this.selectInstrument(inst.id);
      return;
    }
    switch (action) {
      case 'sustain':
        if (this.settings.get('sustainMode') === 'hold') this.setSustain(pressed);
        else if (pressed) this.setSustain(!this.state.sustain);
        return;
      case 'bendUp':
        this.state.bendUp = pressed;
        return this.applyBend();
      case 'bendDown':
        this.state.bendDown = pressed;
        return this.applyBend();
    }
    if (!pressed) return;
    switch (action) {
      case 'octaveDown': return this.shiftOctave(-1);
      case 'octaveUp': return this.shiftOctave(1);
      case 'transposeDown': return this.setTranspose(this.state.transpose - 1);
      case 'transposeUp': return this.setTranspose(this.state.transpose + 1);
      case 'velocityDown': return this.setVelocity(this.state.velocity - 8);
      case 'velocityUp': return this.setVelocity(this.state.velocity + 8);
      case 'tempoDown': return this.setTempo(this.sequencer.tempo - 1);
      case 'tempoUp': return this.setTempo(this.sequencer.tempo + 1);
      case 'volumeDown': return this.setVolume(this.state.volume - 0.05);
      case 'volumeUp': return this.setVolume(this.state.volume + 0.05);
      case 'rhythmToggle': return this.toggleRhythm();
      case 'help': return this.help.toggle();
      case 'accompToggle': return this.setAccomp(!this.state.accompOn);
      case 'recordToggle': return this.toggleRecord();
      case 'playToggle': return this.togglePlay();
      case 'metronomeToggle': return this.setMetronome(!this.state.metronome);
      case 'syncStart': return this.toggleSync();
      case 'intro': return this.intro();
      case 'variationA': return this.setVariation('A');
      case 'variationB': return this.setVariation('B');
      case 'fillIn': return this.fillIn();
      case 'ending': return this.ending();
      case 'panic': return this.panic();
    }
  }

  // ---------------------------------------------------------------- notes

  noteOn(source, id, displayNote, velocity) {
    const key = `${source}:${id}`;
    if (this.active.has(key)) this.noteOff(source, id);
    const drum = this.drumMode;
    const sounding = drum ? displayNote : displayNote + this.state.transpose;
    if (sounding < 0 || sounding > 127) return;
    const s = this.settings.get('accomp');
    const chordOnly = !drum && this.state.accompOn && s.chordMode === 'casio' && sounding < s.splitPoint;
    this.active.set(key, { display: displayNote, sounding, chordOnly, drum });
    this.view.setActive(displayNote, true);
    if (!chordOnly) {
      this.audio.noteOn(key, sounding, velocity, { instrumentId: this.state.instrumentId });
      this.recorder.noteOn(sounding, velocity, this.state.instrumentId);
    }
    if (drum) {
      const sound = drumSoundForNote(sounding);
      if (sound) this.lcd.showMessage(sound.name.toUpperCase(), 700);
    }
    const chord = this.updateChord();
    if (this.state.syncArmed && !this.sequencer.isPlaying) {
      const needsChord = this.state.accompOn && s.chordMode !== 'manual';
      if (!needsChord || chord) this.startRhythm({ intro: this.state.introArmed });
    }
  }

  noteOff(source, id) {
    const key = `${source}:${id}`;
    const entry = this.active.get(key);
    if (!entry) return;
    this.active.delete(key);
    this.view.setActive(entry.display, false);
    if (entry.chordOnly) return;
    this.audio.noteOff(key);
    const stillHeld = [...this.active.values()].some((e) => !e.chordOnly && e.sounding === entry.sounding);
    if (!stillHeld) this.recorder.noteOff(entry.sounding);
  }

  setSustain(on) {
    this.state.sustain = on;
    this.audio.setSustain(on);
    this.recorder.sustain(on);
    this.master.setSustain(on);
    this.lcd.setIndicator('sustain', on);
  }

  applyBend() {
    const semitones = (this.state.bendUp ? BEND_RANGE : 0) - (this.state.bendDown ? BEND_RANGE : 0);
    this.audio.setPitchBend(semitones);
    this.bendMarker.style.transform = `translateY(${-semitones * 18}px)`;
    this.bendMarker.parentElement.classList.toggle('is-bent', semitones !== 0);
  }

  panic() {
    for (const action of this.keyboard.releaseAll()) {
      if (action.type === 'noteOff') this.noteOff('kbd', action.code);
    }
    this.view.releasePointers();
    this.active.clear();
    this.audio.panic();
    this.view.clearActive('live');
    this.state.bendUp = this.state.bendDown = false;
    this.applyBend();
    this.setSustain(false);
    this.lcd.showMessage('ALL NOTES OFF');
  }

  // ---------------------------------------------------------------- instrument & master

  selectInstrument(id, { quiet = false } = {}) {
    if (!this.instruments.has(id)) id = 'piano';
    this.state.instrumentId = id;
    this.settings.set('instrumentId', id);
    const inst = this.instruments.get(id);
    this.lcd.setInstrument(inst);
    this.instrumentPanel.setSelected(id);
    this.updateKeyLabels();
    if (!quiet) {
      const kit = id === 'drums' ? ` · ${DRUM_KITS[this.settings.get('rhythm.drumKit')].name.toUpperCase()}` : '';
      this.lcd.showMessage(`${String(inst.number).padStart(3, '0')} ${inst.name.toUpperCase()}${kit}`);
    }
  }

  setDrumKit(id) {
    const stored = this.settings.set('rhythm.drumKit', id);
    this.audio.setDrumKit(stored);
    this.rhythmPanel.setDrumKit(stored);
    this.lcd.showMessage(`DRUM KIT · ${DRUM_KITS[stored].name.toUpperCase()}`);
  }


  setVolume(v) {
    this.state.volume = clamp(v, 0, 1);
    this.settings.set('masterVolume', this.state.volume);
    if (this.audio.ctx) this.audio.setMasterVolume(this.state.volume);
    this.master.setVolume(this.state.volume);
  }

  setVelocity(v) {
    this.state.velocity = clamp(Math.round(v), 1, 127);
    this.settings.set('velocity', this.state.velocity);
    this.master.setVelocity(this.state.velocity);
    this.lcd.setValues({ velocity: this.state.velocity });
  }

  shiftOctave(delta) {
    const octave = this.keyboard.shiftOctave(delta);
    this.settings.set('octave', octave);
    this.master.setOctave(octave);
    this.lcd.setValues({ octave });
    if (this.drumMode) this.lcd.showMessage(`DRUM BANK · ${DRUM_BANKS[drumBankForOctave(octave)].name.toUpperCase()}`);
    else this.lcd.showMessage(`OCTAVE ${signed(octave)} · ${midiToNoteName(this.keyboard.rootNote)}`);
    this.updateKeyLabels();
  }

  setTranspose(value) {
    const t = clamp(Math.round(value), -12, 12);
    this.state.transpose = t;
    this.settings.set('transpose', t);
    this.master.setTranspose(t);
    this.lcd.setValues({ transpose: t });
    this.lcd.showMessage(`TRANSPOSE ${signed(t)}`);
  }

  updateKeyLabels() {
    const labels = new Map();
    for (const [code, offset] of this.mapper.entries()) {
      const note = this.drumMode ? drumNoteForKey(offset, this.keyboard.octave) : this.keyboard.rootNote + offset;
      if (note === null) continue;
      labels.set(note, labels.has(note) ? `${labels.get(note)}/${codeToLabel(code)}` : codeToLabel(code));
    }
    this.view.setLabels(labels);
    this.view.setTitles(this.drumMode ? (note) => drumSoundForNote(note)?.name ?? '' : null);
  }

  setKeyMap(map) {
    this.releaseAllInput();
    this.mapper.setNoteMap(map);
    const isDefault = JSON.stringify(Object.entries(map).sort()) === JSON.stringify(Object.entries(DEFAULT_NOTE_MAP).sort());
    this.settings.set('keyMap', isDefault ? null : map);
    this.updateKeyLabels();
  }

  changeSetting(path, value) {
    const stored = this.settings.set(path, value);
    if (path === 'showKeyLabels') this.view.showLabels(stored);
    if (path === 'tuningA4') this.instruments.setTuning(stored);
    if (path === 'maxPolyphony') this.audio.setMaxPolyphony(stored);
    if (path === 'sustainMode' && this.state.sustain) this.setSustain(false);
    if (path === 'latencyHint') notify('Latency mode will apply the next time the app starts.', { type: 'info' });
    return stored;
  }

  resetAllSettings() {
    this.settings.reset();
    notify('Settings reset. Reloading…', { type: 'info' });
    setTimeout(() => location.reload(), 600);
  }

  setEffect(fx, param, value) {
    const stored = this.settings.set(`effects.${fx}.${param}`, value);
    if (this.audio.effects) this.audio.effects.setParam(fx, param, stored);
    if (param === 'enabled') this.effectsPanel.setEffect(fx, this.settings.get(`effects.${fx}`));
  }

  // ---------------------------------------------------------------- rhythm

  selectPattern(id, { initial = false } = {}) {
    const pattern = getPattern(id) ?? PARSED_PATTERNS[0];
    this.sequencer.setPattern(pattern);
    const s = this.settings.get('rhythm');
    const keepTempo = initial || this.sequencer.isPlaying;
    this.setTempo(keepTempo ? s.tempo : pattern.bpm);
    this.setSwing(initial ? s.swing : pattern.swing);
    this.settings.set('rhythm.patternId', pattern.id);
    this.rhythmPanel.setPattern(pattern.id);
    this.lcd.setRhythm(this.rhythmLabel(pattern.name, this.sequencer.section, this.sequencer.variation));
    this.lcd.setBeats(pattern.beatsPerBar, -1);
    const style = pattern.accomp;
    this.accompPanel.setStyle(style ? `${pattern.name} · bass + ${style.chordPatch}${style.arp ? ' + arpeggio' : ''}` : `${pattern.name} has no accompaniment`);
  }

  setTempo(bpm) {
    const tempo = this.sequencer.setTempo(bpm);
    this.settings.set('rhythm.tempo', tempo);
    this.rhythmPanel.setTempo(tempo);
    this.lcd.setTempo(tempo);
  }

  setSwing(amount) {
    const swing = this.sequencer.setSwing(amount);
    this.settings.set('rhythm.swing', swing);
    this.rhythmPanel.setSwing(swing);
  }

  setMetronome(on) {
    this.state.metronome = on;
    this.settings.set('rhythm.metronome', on);
    this.rhythmPanel.setMetronome(on);
    this.lcd.setIndicator('metronome', on);
  }

  toggleRhythm() {
    if (this.sequencer.isPlaying) this.stopRhythm();
    else this.startRhythm();
  }

  startRhythm({ intro = false } = {}) {
    if (!this.audio.isReady) {
      notify('Audio is not running, so the rhythm cannot start.', { type: 'error' });
      return;
    }
    this.setSync(false);
    this.sequencer.start({ intro });
    this.rhythmPanel.setState('playing');
  }

  stopRhythm() {
    this.sequencer.stop();
    this.afterRhythmHalt('stopped');
    this.lcd.setPosition(-1, 0);
  }

  // ---------------------------------------------------------------- arranger

  /** Sync start: the rhythm (and accompaniment) starts with the first chord you play. */
  toggleSync() {
    if (this.sequencer.isPlaying) {
      this.lcd.showMessage('SYNC: STOP THE RHYTHM FIRST');
      return;
    }
    const armed = !this.state.syncArmed;
    if (armed && !this.state.accompOn) this.setAccomp(true);
    this.setSync(armed);
    this.lcd.showMessage(armed ? 'SYNC START — PLAY A CHORD' : 'SYNC OFF');
  }

  setSync(armed) {
    this.state.syncArmed = armed;
    if (!armed) this.state.introArmed = false;
    this.accompPanel.setSync(armed);
    this.lcd.setIndicator('sync', armed);
    this.refreshSectionUi();
  }

  intro() {
    if (this.sequencer.isPlaying) {
      if (this.sequencer.requestIntro()) this.lcd.showMessage('INTRO AT NEXT BAR');
    } else if (this.state.syncArmed) {
      this.state.introArmed = !this.state.introArmed;
      this.refreshSectionUi();
      this.lcd.showMessage(this.state.introArmed ? 'INTRO ARMED — PLAY A CHORD' : 'INTRO OFF');
    } else {
      this.startRhythm({ intro: true });
    }
  }

  setVariation(variation) {
    const playing = this.sequencer.isPlaying;
    this.sequencer.setVariation(variation);
    this.settings.set('rhythm.variation', variation);
    if (playing) this.lcd.showMessage(`FILL-IN → VARIATION ${variation}`);
    else this.refreshSectionUi();
  }

  fillIn() {
    if (!this.sequencer.requestFill()) this.lcd.showMessage('FILL-IN: START THE RHYTHM FIRST');
  }

  ending() {
    if (this.sequencer.requestEnding()) {
      this.refreshSectionUi();
      this.lcd.showMessage('ENDING');
    } else if (!this.sequencer.isPlaying) {
      this.lcd.showMessage('ENDING: START THE RHYTHM FIRST');
    }
  }

  rhythmLabel(name, section, variation) {
    return `${name} · ${SECTION_LABELS[section] ?? `VAR ${variation}`}`;
  }

  refreshSectionUi(section = this.sequencer.section, variation = this.sequencer.variation) {
    this.rhythmPanel.setSection({
      section,
      variation,
      armedIntro: this.state.introArmed,
      endingPending: this.sequencer.pending.ending,
    });
    this.lcd.setRhythm(this.rhythmLabel(this.sequencer.base?.name ?? '', section, variation));
  }

  onSection({ section, variation, time }) {
    this.queueVisual(time, 'beat', () => this.refreshSectionUi(section, variation));
  }

  /** The ending finished: the rhythm stopped by itself; let the final chord ring out. */
  onRhythmEnd({ time }) {
    this.queueVisual(time, 'end', () => {
      this.rhythmPanel.setState('stopped');
      this.lcd.setBeats(this.sequencer.pattern.beatsPerBar, -1);
      this.lcd.setPosition(-1, 0);
      this.refreshSectionUi();
    });
  }

  pauseRhythm() {
    if (this.sequencer.isPlaying) {
      this.sequencer.pause();
      this.afterRhythmHalt('paused');
    } else if (this.sequencer.state === 'paused') {
      this.startRhythm();
    }
  }

  resetRhythm() {
    this.sequencer.reset();
    this.afterRhythmHalt('stopped');
    this.setTempo(this.sequencer.tempo);
    this.setSwing(this.sequencer.swing);
    this.lcd.setPosition(-1, 0);
  }

  afterRhythmHalt(state) {
    this.audio.stopChannel('accomp');
    this.visualQueue = this.visualQueue.filter((item) => item.kind !== 'beat' && item.kind !== 'end');
    this.lcd.setBeats(this.sequencer.pattern.beatsPerBar, -1);
    this.rhythmPanel.setState(state);
    this.refreshSectionUi();
  }

  onStep(info) {
    for (const hit of info.hits) this.audio.playDrum(hit.voice, info.time, hit.velocity);
    if (this.state.metronome && info.isBeatStart) this.audio.playClick(info.time, info.beat === 0);
    this.accomp.handleStep({ style: info.pattern.accomp, step: info.step, time: info.time, stepDuration: info.stepDuration });
    if (info.isBeatStart) {
      this.queueVisual(info.time, 'beat', () => {
        this.lcd.setBeats(info.beatsPerBar, info.beat);
        this.lcd.setPosition(info.bar, info.beat);
        if (info.isBarStart) this.lcd.setRhythm(this.rhythmLabel(info.pattern.name, info.section, info.variation));
      });
    }
  }

  // ---------------------------------------------------------------- accompaniment

  setAccomp(on) {
    this.state.accompOn = on;
    this.accomp.setEnabled(on);
    this.accompPanel.setEnabled(on);
    this.lcd.setIndicator('accomp', on);
    this.lcd.showMessage(on ? 'ACCOMP ON' : 'ACCOMP OFF');
    if (on && this.settings.get('accomp.chordMode') === 'manual') {
      const s = this.settings.get('accomp');
      this.setManualChord(s.manualRoot, s.manualType);
    }
    if (!on) this.audio.stopChannel('accomp');
    this.updateChordZone();
  }

  setChordMode(mode) {
    this.settings.set('accomp.chordMode', mode);
    this.accompPanel.setMode(mode);
    if (mode === 'manual') {
      const s = this.settings.get('accomp');
      this.setManualChord(s.manualRoot, s.manualType);
    }
    this.updateChordZone();
  }

  setManualChord(root, type) {
    this.settings.set('accomp.manualRoot', root);
    this.settings.set('accomp.manualType', type);
    const chord = manualChord(root, type);
    if (chord) {
      this.accomp.setChord(chord);
      this.showChord(chord);
    }
  }

  /** Detect a chord from held keys; returns the detected chord (or null). */
  updateChord() {
    if (!this.state.accompOn) return null;
    const mode = this.settings.get('accomp.chordMode');
    if (mode === 'manual') return null;
    const entries = [...this.active.values()].filter((e) => !e.drum);
    const chord =
      mode === 'casio'
        ? detectCasioChord(entries.filter((e) => e.chordOnly).map((e) => e.sounding))
        : detectChord(entries.map((e) => e.sounding), { minNotes: 3 });
    if (chord && this.accomp.setChord(chord)) this.showChord(chord);
    return chord;
  }

  showChord(chord) {
    const name = chord ? chord.name : null;
    this.lcd.setChord(name);
    this.accompPanel.setChord(name);
  }

  updateChordZone() {
    const s = this.settings.get('accomp');
    this.view.setChordZone(this.state.accompOn && s.chordMode === 'casio' ? s.splitPoint : null);
  }

  // ---------------------------------------------------------------- recording & playback

  toggleRecord() {
    if (this.recorder.recording) {
      const performance = this.recorder.stop();
      this.state.performance = performance;
      this.player.load(performance);
      notify(`Recorded ${performance.events.length} events (${formatTime(performance.duration)}).`, { type: 'success' });
    } else {
      if (this.player.state !== 'stopped') this.stopPlayback();
      this.recorder.start({ tempo: this.sequencer.tempo, instrument: this.state.instrumentId });
      if (this.state.sustain) this.recorder.sustain(true);
      this.lcd.showMessage('RECORDING');
    }
    this.updateRecordingUi();
  }

  togglePlay() {
    if (this.player.state === 'playing') this.stopPlayback();
    else this.play();
  }

  play() {
    if (this.recorder.recording) return;
    if (!this.state.performance) {
      notify('Nothing recorded yet. Press REC (F3) and play.', { type: 'info' });
      return;
    }
    if (!this.audio.isReady) {
      notify('Audio is not running.', { type: 'error' });
      return;
    }
    this.state.playbackInstrument = this.state.performance.instrument;
    this.player.play();
    this.updateRecordingUi();
  }

  pausePlayback() {
    if (this.player.state === 'playing') {
      this.player.pause();
      this.silencePlayback();
    } else if (this.player.state === 'paused') {
      this.player.resume();
    }
    this.updateRecordingUi();
  }

  stopPlayback() {
    this.player.stop();
    this.silencePlayback();
    this.updateRecordingUi();
  }

  silencePlayback() {
    this.audio.stopChannel('playback');
    this.visualQueue = this.visualQueue.filter((item) => item.kind !== 'play');
    this.view.clearActive('play');
  }

  onPlaybackEvent(event, time) {
    switch (event.type) {
      case 'program':
        this.state.playbackInstrument = this.instruments.has(event.instrument) ? event.instrument : this.state.instrumentId;
        break;
      case 'noteOn':
        this.audio.noteOn(`play:${event.note}`, event.note, event.velocity, { channel: 'playback', instrumentId: this.state.playbackInstrument, time });
        this.queueVisual(time, 'play', () => this.view.setActive(event.note, true, 'play'));
        break;
      case 'noteOff':
        this.audio.noteOff(`play:${event.note}`, { channel: 'playback', time });
        this.queueVisual(time, 'play', () => this.view.setActive(event.note, false, 'play'));
        break;
      case 'sustain':
        this.audio.setSustain(event.value, { channel: 'playback', time });
        break;
    }
  }

  onPlaybackEnd() {
    this.audio.setSustain(false, { channel: 'playback' });
    setTimeout(() => this.view.clearActive('play'), 300);
    this.updateRecordingUi();
  }

  clearPerformance() {
    this.stopPlayback();
    this.state.performance = null;
    this.player.load(null);
    this.updateRecordingUi();
  }

  async savePerformance() {
    if (!this.state.performance) return;
    const result = await platform.saveFile({ kind: 'performance', defaultName: `performance-${stamp()}.lk61.json`, data: serializePerformance(this.state.performance) });
    this.reportSave(result, 'Performance saved');
  }

  async loadPerformance() {
    const result = await platform.openPerformance();
    if (!result.ok) {
      if (!result.canceled) notify(result.error, { type: 'error' });
      return;
    }
    const parsed = parsePerformance(result.text);
    if (!parsed.ok) {
      notify(`Could not load performance: ${parsed.errors.join('; ')}`, { type: 'error' });
      return;
    }
    this.stopPlayback();
    this.state.performance = parsed.performance;
    this.player.load(parsed.performance);
    this.updateRecordingUi();
    notify(`Loaded ${parsed.performance.events.length} events (${formatTime(parsed.performance.duration)}).`, { type: 'success' });
  }

  async exportMidi() {
    if (!this.state.performance) return;
    let bytes;
    try {
      bytes = performanceToMidi(this.state.performance);
    } catch (err) {
      notify(`MIDI export failed: ${err.message}`, { type: 'error' });
      return;
    }
    const result = await platform.saveFile({ kind: 'midi', defaultName: `performance-${stamp()}.mid`, data: bytes });
    this.reportSave(result, 'MIDI file exported');
  }

  async toggleAudioCapture() {
    if (this.capture) {
      const capture = this.capture;
      if (capture.stopping) return;
      capture.stopping = true;
      const result = await capture.stop();
      this.capture = null;
      this.lcd.setIndicator('wav', false);
      this.updateRecordingUi();
      if (!result || result.seconds < 0.05) {
        notify('Nothing was captured.', { type: 'info' });
        return;
      }
      const saved = await platform.saveFile({ kind: 'wav', defaultName: `lk61-${stamp()}.wav`, data: AudioCapture.toWav(result) });
      this.reportSave(saved, `WAV exported (${formatTime(result.seconds)})`);
      return;
    }
    if (!this.audio.isReady) {
      notify('Audio is not running.', { type: 'error' });
      return;
    }
    const capture = new AudioCapture(this.audio.ctx, this.audio.outputNode);
    capture.onLimit = () => {
      notify('Audio capture reached the 10 minute limit.', { type: 'warning' });
      this.toggleAudioCapture();
    };
    try {
      await capture.start();
      this.capture = capture;
      this.lcd.setIndicator('wav', true);
    } catch (err) {
      notify(`Audio capture failed: ${err.message}`, { type: 'error' });
    }
    this.updateRecordingUi();
  }

  reportSave(result, message) {
    if (result?.ok) notify(`${message}: ${result.filePath}`, { type: 'success' });
    else if (result && !result.canceled) notify(result.error || 'Save failed', { type: 'error' });
  }

  updateRecordingUi() {
    const state = this.player.state;
    this.recordingPanel.setState({
      recording: this.recorder.recording,
      playing: state === 'playing',
      paused: state === 'paused',
      hasPerformance: Boolean(this.state.performance),
      capturing: Boolean(this.capture),
    });
    this.lcd.setIndicator('rec', this.recorder.recording);
    this.lcd.setIndicator('play', state === 'playing');
    if (!this.recorder.recording && state === 'stopped') {
      const perf = this.state.performance;
      this.recordingPanel.setTime(perf ? perf.duration : 0, perf ? `${perf.events.length} events · ${perf.tempo} BPM` : 'No recording');
    }
  }

  // ---------------------------------------------------------------- rendering

  queueVisual(time, kind, apply) {
    const queue = this.visualQueue;
    queue.push({ time, kind, apply });
    if (queue.length > 1 && queue[queue.length - 2].time > time) queue.sort((a, b) => a.time - b.time);
  }

  frame() {
    const latency = this.audio.ctx?.outputLatency || 0;
    const now = this.audio.time - latency;
    const queue = this.visualQueue;
    while (queue.length && queue[0].time <= now) queue.shift().apply();

    if (this.audio.isReady) this.master.setLevel(this.audio.getLevel());
    this.lcd.setPoly(this.audio.activeVoiceCount);
    if (this.recorder.recording) this.recordingPanel.setTime(this.recorder.elapsed, `${this.recorder.eventCount} events`);
    else if (this.player.state !== 'stopped') this.recordingPanel.setTime(this.player.position, this.player.state === 'paused' ? 'Paused' : 'Playing');
    this.recordingPanel.setAudioTime(this.capture ? this.capture.seconds : null);
    requestAnimationFrame(() => this.frame());
  }
}

const app = new App();
app.sequencer.onStep((info) => app.onStep(info));
app.sequencer.onSection((info) => app.onSection(info));
app.sequencer.onEnd((info) => app.onRhythmEnd(info));
window.addEventListener('DOMContentLoaded', () => {
  app.start().catch((err) => {
    console.error(err);
    notify(`Startup failed: ${err.message}`, { type: 'error' });
  });
});

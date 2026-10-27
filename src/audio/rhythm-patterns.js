/**
 * Rhythm and accompaniment style library.
 *
 * Drum tracks use one character per step:
 *   X = accent, x = normal, o = soft/ghost, . = rest
 *
 * Accompaniment parts (same length as the pattern):
 *   bass:  R root, 3 third, 5 fifth, 6 sixth, 7 seventh, 8 octave, - hold, . rest
 *   chord: C chord stab, - hold, . rest
 *   arp:   1-4 chord tone index (played an octave up), - hold, . rest
 */

export const DRUM_VOICES = Object.freeze([
  'kick', 'snare', 'rim', 'clap', 'chh', 'ohh', 'crash', 'ride', 'tomLow', 'tomHigh', 'conga', 'cowbell', 'shaker', 'clave',
  'boom808', 'kickPunch', 'tomFloor', 'tomMid', 'snareTight', 'pedalHat', 'splash',
  'surdo', 'congaLow', 'bongoLow', 'bongoHigh', 'timbaleLow', 'timbaleHigh', 'agogoLow', 'agogoHigh',
  'woodLow', 'woodHigh', 'snap', 'tambourine', 'guiro', 'rideBell', 'triangle',
]);
const DRUM_VOICE_SET = new Set(DRUM_VOICES);

export const STEP_VELOCITY = Object.freeze({ X: 1, x: 0.75, o: 0.4, '.': 0 });
const ACCOMP_CHARSETS = {
  bass: /^[R35678.\-]+$/,
  chord: /^[C.\-]+$/,
  arp: /^[1-4.\-]+$/,
};
const PATCH_IDS = new Set(['piano', 'epiano', 'organ', 'synth', 'strings', 'flute', 'guitar', 'bass']);

export const RHYTHM_PATTERNS = [
  {
    id: '8beat', name: '8 Beat', category: 'Pop', bpm: 112, beatsPerBar: 4, stepsPerBeat: 4, bars: 1, swing: 0,
    tracks: {
      kick:  'X.......x.x.....',
      snare: '....X.......X...',
      chh:   'x.x.x.x.x.x.x.x.',
    },
    accomp: { bassPatch: 'bass', chordPatch: 'epiano', bass: 'R--.R-R-5--.5-8-', chord: 'C---..C-C---..C-' },
  },
  {
    id: '16beat', name: '16 Beat', category: 'Pop', bpm: 100, beatsPerBar: 4, stepsPerBeat: 4, bars: 1, swing: 0,
    tracks: {
      kick:  'X.....x.X.x.....',
      snare: '....X.......X..o',
      chh:   'xoxoxoxoxoxoxoxo',
    },
    accomp: { bassPatch: 'bass', chordPatch: 'epiano', bass: 'R..R..R.R.R..5.8', chord: '..C...C...C..C..' },
  },
  {
    id: 'poprock', name: 'Pop Rock', category: 'Rock', bpm: 124, beatsPerBar: 4, stepsPerBeat: 4, bars: 2, swing: 0,
    tracks: {
      kick:  'X.......X.x.....X.......X.x...x.',
      snare: '....X.......X.......X.......X...',
      chh:   'x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.',
      crash: 'X...............................',
    },
    accomp: {
      bassPatch: 'bass', chordPatch: 'guitar',
      bass:  'R-R-R-R-R-R-R-R-R-R-R-R-5-5-8-8-',
      chord: 'C-C-C-C-C-C-C-C-C-C-C-C-C-C-C-C-',
    },
  },
  {
    id: 'ballad', name: 'Pop Ballad', category: 'Ballad', bpm: 72, beatsPerBar: 4, stepsPerBeat: 4, bars: 1, swing: 0,
    tracks: {
      kick:  'X.......x.x.....',
      rim:   '....x.......x...',
      chh:   'x.x.x.x.x.x.x.x.',
    },
    accomp: {
      bassPatch: 'bass', chordPatch: 'strings', arpPatch: 'piano',
      bass:  'R-------5-------',
      chord: 'C---------------',
      arp:   '1.2.3.4.1.2.3.4.',
    },
  },
  {
    id: 'disco', name: 'Disco', category: 'Dance', bpm: 120, beatsPerBar: 4, stepsPerBeat: 4, bars: 1, swing: 0,
    tracks: {
      kick:  'X...X...X...X...',
      clap:  '....x.......x...',
      chh:   'x...x...x...x...',
      ohh:   '..x...x...x...x.',
    },
    accomp: { bassPatch: 'bass', chordPatch: 'strings', bass: 'R-8-R-8-R-8-R-8-', chord: '..C-..C-..C-..C-' },
  },
  {
    id: 'funk', name: 'Funk', category: 'Dance', bpm: 98, beatsPerBar: 4, stepsPerBeat: 4, bars: 1, swing: 0,
    tracks: {
      kick:  'X.x....x..X.....',
      snare: '....X..o.o..X..o',
      chh:   'xoxoxoxoxoxoxoxo',
    },
    accomp: { bassPatch: 'bass', chordPatch: 'guitar', bass: 'R..R..5.8.R..7.5', chord: '..C..C....C..C..' },
  },
  {
    id: 'hiphop', name: 'Hip-Hop', category: 'Urban', bpm: 90, beatsPerBar: 4, stepsPerBeat: 4, bars: 1, swing: 0.15,
    tracks: {
      kick:  'X......x..X.....',
      snare: '....X.......X...',
      chh:   'x.x.x.x.x.x.x.xx',
    },
    accomp: { bassPatch: 'bass', chordPatch: 'epiano', bass: 'R-------..R-5---', chord: 'C-----..........' },
  },
  {
    id: 'bossa', name: 'Bossa Nova', category: 'Latin', bpm: 130, beatsPerBar: 4, stepsPerBeat: 4, bars: 1, swing: 0,
    tracks: {
      kick:  'X..xX..xX..xX..x',
      rim:   'x..x..x...x..x..',
      shaker:'xoxoxoxoxoxoxoxo',
    },
    accomp: { bassPatch: 'bass', chordPatch: 'guitar', bass: 'R--5----R--5----', chord: 'C..C..C...C..C..' },
  },
  {
    id: 'reggae', name: 'Reggae', category: 'World', bpm: 76, beatsPerBar: 4, stepsPerBeat: 4, bars: 1, swing: 0,
    tracks: {
      kick:  '........X.......',
      rim:   '........x.......',
      chh:   'x.x.x.x.x.x.x.x.',
    },
    accomp: { bassPatch: 'bass', chordPatch: 'organ', bass: 'R--.....R-5-3-..', chord: '....C-......C-..' },
  },
  {
    id: 'waltz', name: 'Waltz', category: 'Traditional', bpm: 132, beatsPerBar: 3, stepsPerBeat: 4, bars: 1, swing: 0,
    tracks: {
      kick:  'X...........',
      chh:   '....x...x...',
      snare: '....o...o...',
    },
    accomp: { bassPatch: 'bass', chordPatch: 'piano', bass: 'R---........', chord: '....C-..C-..' },
  },
  {
    id: 'swing', name: 'Jazz Swing', category: 'Jazz', bpm: 140, beatsPerBar: 4, stepsPerBeat: 2, bars: 1, swing: 0.33,
    tracks: {
      ride:  'x.xxx.xx',
      chh:   '..x...x.',
      kick:  'o...o...',
    },
    accomp: { bassPatch: 'bass', chordPatch: 'piano', bass: 'R-3-5-7-', chord: '..C....C' },
  },
  {
    id: 'slowrock', name: 'Slow Rock 12/8', category: 'Rock', bpm: 66, beatsPerBar: 4, stepsPerBeat: 3, bars: 1, swing: 0,
    tracks: {
      kick:  'X.....x.x...',
      snare: '...X.....X..',
      chh:   'xxxxxxxxxxxx',
    },
    accomp: { bassPatch: 'bass', chordPatch: 'piano', bass: 'R--R--5--5--', chord: 'C..C..C..C..' },
  },
  {
    id: 'metronome', name: 'Metronome Only', category: 'Utility', bpm: 100, beatsPerBar: 4, stepsPerBeat: 1, bars: 1, swing: 0,
    tracks: {},
    accomp: null,
  },
];

/** Validate and compile a pattern definition into per-step hit lists. Throws on invalid data. */
export function parsePattern(def) {
  if (!def || typeof def !== 'object') throw new TypeError('Pattern must be an object');
  const { id, beatsPerBar, stepsPerBeat, bars = 1 } = def;
  if (typeof id !== 'string' || !id) throw new TypeError('Pattern needs an id');
  for (const [name, value, max] of [['beatsPerBar', beatsPerBar, 12], ['stepsPerBeat', stepsPerBeat, 8], ['bars', bars, 8]]) {
    if (!Number.isInteger(value) || value < 1 || value > max) throw new RangeError(`Pattern "${id}": ${name} must be 1-${max}`);
  }
  const stepsPerBar = beatsPerBar * stepsPerBeat;
  const totalSteps = stepsPerBar * bars;
  const steps = Array.from({ length: totalSteps }, () => []);

  for (const [voice, track] of Object.entries(def.tracks || {})) {
    if (!DRUM_VOICE_SET.has(voice)) throw new RangeError(`Pattern "${id}": unknown drum voice "${voice}"`);
    if (typeof track !== 'string' || track.length !== totalSteps) {
      throw new RangeError(`Pattern "${id}": track "${voice}" has ${track?.length ?? 0} steps, expected ${totalSteps}`);
    }
    [...track].forEach((ch, index) => {
      const velocity = STEP_VELOCITY[ch];
      if (velocity === undefined) throw new RangeError(`Pattern "${id}": invalid character "${ch}" in track "${voice}"`);
      if (velocity > 0) steps[index].push({ voice, velocity });
    });
  }

  let accomp = null;
  if (def.accomp) {
    accomp = { ...def.accomp };
    for (const part of ['bass', 'chord', 'arp']) {
      const value = accomp[part];
      if (value === undefined) continue;
      if (typeof value !== 'string' || value.length !== totalSteps || !ACCOMP_CHARSETS[part].test(value)) {
        throw new RangeError(`Pattern "${id}": accompaniment part "${part}" must be ${totalSteps} valid characters`);
      }
    }
    for (const key of ['bassPatch', 'chordPatch', 'arpPatch']) {
      if (accomp[key] !== undefined && !PATCH_IDS.has(accomp[key])) throw new RangeError(`Pattern "${id}": unknown ${key}`);
    }
    accomp.bassPatch ??= 'bass';
    accomp.chordPatch ??= 'piano';
    accomp.arpPatch ??= accomp.chordPatch;
  }

  return {
    id,
    name: String(def.name || id),
    category: String(def.category || ''),
    bpm: Number.isFinite(def.bpm) ? def.bpm : 120,
    swing: Number.isFinite(def.swing) ? def.swing : 0,
    beatsPerBar,
    stepsPerBeat,
    bars,
    stepsPerBar,
    totalSteps,
    steps,
    accomp,
  };
}

// ---------------------------------------------------------------------------
// Arranger sections: Variation B, Fill-in, Intro and Ending.
// Generated from the main (Variation A) pattern unless a style defines its own
// `variation`, `fill`, `intro` or `ending` ({ tracks, accomp? }).

export const SECTION_IDS = Object.freeze(['A', 'B', 'fill', 'intro', 'ending']);

const dots = (n) => '.'.repeat(n);
const setChar = (str, i, ch) => str.slice(0, i) + ch + str.slice(i + 1);
const held = (first, n) => first + '-'.repeat(n - 1);

function mapParts(accomp, fn) {
  if (!accomp) return null;
  const out = {};
  for (const part of ['bass', 'chord', 'arp']) if (accomp[part]) out[part] = fn(accomp[part], part);
  return out;
}

/** Variation B: busier time-keeping, open hat lift, crash on the downbeat, kick pickup. */
function variationTracks(def) {
  const { beatsPerBar: bpb, stepsPerBeat: spb, bars = 1 } = def;
  const stepsPerBar = bpb * spb;
  const total = stepsPerBar * bars;
  const tracks = { ...def.tracks };
  const keeper = ['chh', 'ride', 'shaker'].find((v) => tracks[v]);
  if (keeper && spb % 2 === 0) tracks[keeper] = tracks[keeper].replace(/\./g, 'o');
  if (tracks.chh && spb % 2 === 0) {
    let ohh = tracks.ohh ?? dots(total);
    for (let bar = 0; bar < bars; bar++) {
      const i = bar * stepsPerBar + stepsPerBar - spb / 2;
      ohh = setChar(ohh, i, 'x');
      tracks.chh = setChar(tracks.chh, i, '.');
    }
    tracks.ohh = ohh;
  }
  if (tracks.kick && bpb === 4 && spb >= 2) {
    for (let bar = 0; bar < bars; bar++) {
      const i = bar * stepsPerBar + 2 * spb - 1;
      if (tracks.kick[i] === '.') tracks.kick = setChar(tracks.kick, i, 'o');
    }
  }
  tracks.crash = setChar(tracks.crash ?? dots(total), 0, 'X');
  return tracks;
}

/** One-bar fill: groove for the first half, then a snare crescendo and a tom run. */
function fillTracks(def) {
  const { beatsPerBar: bpb, stepsPerBeat: spb } = def;
  const stepsPerBar = bpb * spb;
  const half = Math.floor(bpb / 2) * spb;
  const lastBeat = stepsPerBar - spb;
  const tracks = {};
  for (const [voice, track] of Object.entries(def.tracks)) tracks[voice] = track.slice(0, half) + dots(stepsPerBar - half);
  const snare = [...(tracks.snare ?? dots(stepsPerBar))];
  const kick = [...(tracks.kick ?? dots(stepsPerBar))];
  const tomHigh = [...dots(stepsPerBar)];
  const tomLow = [...dots(stepsPerBar)];
  for (let i = half; i < stepsPerBar; i++) {
    if ((i - half) % spb === 0) kick[i] = 'x';
    if (i < lastBeat) {
      const progress = (i - half) / Math.max(1, lastBeat - half);
      snare[i] = progress < 0.34 ? 'o' : progress < 0.67 ? 'x' : 'X';
    } else if (i - lastBeat < spb / 2) {
      tomHigh[i] = 'X';
    } else {
      tomLow[i] = 'X';
    }
  }
  return { ...tracks, snare: snare.join(''), kick: kick.join(''), tomHigh: tomHigh.join(''), tomLow: tomLow.join('') };
}

function firstBar(track, stepsPerBar) {
  return track.slice(0, stepsPerBar);
}

/** Build a style: the main pattern plus all arranger sections (each a parsed pattern). */
export function parseStyle(def) {
  const main = parsePattern(def);
  const { stepsPerBar, stepsPerBeat: spb } = main;
  const hasDrums = Object.keys(def.tracks || {}).length > 0;
  const patches = def.accomp ? { bassPatch: def.accomp.bassPatch, chordPatch: def.accomp.chordPatch, arpPatch: def.accomp.arpPatch } : null;
  const section = (suffix, bars, tracks, parts) =>
    Object.assign(
      parsePattern({ ...def, id: `${def.id}:${suffix}`, bars, tracks, accomp: patches && parts ? { ...patches, ...parts } : null }),
      { section: suffix },
    );
  const custom = (key) => def[key] && { bars: def[key].bars ?? 1, tracks: def[key].tracks, parts: def[key].accomp ?? null };

  const countIn = { rim: [...dots(stepsPerBar)].map((_, i) => (i % spb === 0 ? (i === 0 ? 'X' : 'x') : '.')).join('') };
  const fill = hasDrums ? fillTracks(def) : {};
  const barOne = mapParts(def.accomp, (track) => firstBar(track, stepsPerBar));
  const sustained = def.accomp ? { bass: held('R', stepsPerBar), chord: held('C', stepsPerBar) } : null;

  const b = custom('variation') ?? { tracks: hasDrums ? variationTracks(def) : def.tracks, parts: mapParts(def.accomp, (t) => t) };
  const f = custom('fill') ?? { tracks: fill, parts: barOne };
  const intro = custom('intro') ?? {
    bars: 2,
    tracks: Object.fromEntries(
      [...new Set([...Object.keys(countIn), ...Object.keys(fill)])].map((voice) => [voice, (countIn[voice] ?? dots(stepsPerBar)) + (fill[voice] ?? dots(stepsPerBar))]),
    ),
    parts: def.accomp ? { chord: held('C', stepsPerBar) + held('C', stepsPerBar), bass: dots(stepsPerBar) + held('R', stepsPerBar) } : null,
  };
  const endingBar2 = hasDrums ? { kick: setChar(dots(stepsPerBar), 0, 'X'), crash: setChar(dots(stepsPerBar), 0, 'X') } : {};
  const ending = custom('ending') ?? {
    bars: 2,
    tracks: Object.fromEntries(
      [...new Set([...Object.keys(fill), ...Object.keys(endingBar2)])].map((voice) => [voice, (fill[voice] ?? dots(stepsPerBar)) + (endingBar2[voice] ?? dots(stepsPerBar))]),
    ),
    parts: barOne && sustained ? Object.fromEntries(Object.keys(barOne).map((p) => [p, barOne[p] + (sustained[p] ?? dots(stepsPerBar))])) : null,
  };

  main.section = 'A';
  main.sections = {
    A: main,
    B: section('B', def.bars ?? 1, b.tracks, b.parts),
    fill: section('fill', 1, f.tracks, f.parts),
    intro: section('intro', intro.bars, intro.tracks, intro.parts),
    ending: section('ending', ending.bars, ending.tracks, ending.parts),
  };
  return main;
}

export const PARSED_PATTERNS = RHYTHM_PATTERNS.map(parseStyle);

export function getPattern(id) {
  return PARSED_PATTERNS.find((p) => p.id === id) ?? null;
}

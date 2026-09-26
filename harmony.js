/* ════════════════════════════════════════════════════════════════════
   HARMONY — shared music theory for the site. No audio, no DOM.
   Used by the hero chord-namer + Lab teaser (index.html) and the Harmony Lab
   (lab.html). Tests: node tests/harmony.test.js
   Exposes window.Harmony.
   ════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const PC_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const mod12 = n => ((n % 12) + 12) % 12;

  function pcName(pc)      { return PC_NAMES[mod12(Math.round(pc))]; }
  function midiName(m)     { m = Math.round(m); return pcName(m) + (Math.floor(m / 12) - 1); }
  function midiToFreq(m)   { return 440 * Math.pow(2, (m - 69) / 12); }
  function freqToMidi(f)   { return 69 + 12 * Math.log2(f / 440); }
  function cents(a, b)     { return 1200 * Math.log2(a / b); }

  /* ── Chord dictionary ────────────────────────────────────────────
     Ordered roughly by how "plain" the reading is — earlier wins ties.
     Each entry: [suffix, intervals above the root, colour note]      */
  const CHORDS = [
    ['',        [0, 4, 7],             'bright, home'],
    ['m',       [0, 3, 7],             'wistful'],
    ['sus2',    [0, 2, 7],             'open, undecided'],
    ['sus4',    [0, 5, 7],             'leaning, waiting'],
    ['°',       [0, 3, 6],             'tight, uneasy'],
    ['+',       [0, 4, 8],             'dreamy, unresolved'],
    ['maj7',    [0, 4, 7, 11],         'sunlight through a window'],
    ['7',       [0, 4, 7, 10],         'wants to go somewhere'],
    ['m7',      [0, 3, 7, 10],         'soft and a bit soulful'],
    ['6',       [0, 4, 7, 9],          'old-Hollywood sweet'],
    ['m6',      [0, 3, 7, 9],          'film-noir'],
    ['ø7',      [0, 3, 6, 10],         'on the edge of something'],
    ['°7',      [0, 3, 6, 9],          'pure suspense'],
    ['m(maj7)', [0, 3, 7, 11],         'spy-movie tension'],
    ['7sus4',   [0, 5, 7, 10],         'gospel, just before the lift'],
    ['add9',    [0, 2, 4, 7],          'a little lift'],
    ['m(add9)', [0, 2, 3, 7],          'bittersweet'],
    ['6/9',     [0, 2, 4, 7, 9],       'pentatonic sparkle'],
    ['m6/9',    [0, 2, 3, 7, 9],       'dorian glow'],
    ['maj9',    [0, 2, 4, 7, 11],      'warm, wide open'],
    ['9',       [0, 2, 4, 7, 10],      'funky, loose'],
    ['m9',      [0, 2, 3, 7, 10],      'neo-soul warmth'],
    ['m11',     [0, 3, 5, 7, 10],      'deep, velvety'],
    ['9sus4',   [0, 2, 5, 7, 10],      'floating, unresolved'],
    ['maj7♯11', [0, 4, 6, 7, 11],      'Lydian — the Djesse colour'],
    ['maj9♯11', [0, 2, 4, 6, 7, 11],   'Lydian, fully bloomed'],
    ['m11',     [0, 2, 3, 5, 7, 10],   'deep, velvety'],
    ['maj13',   [0, 2, 4, 7, 9, 11],   'the whole sky'],
    ['13',      [0, 2, 4, 7, 9, 10],   'church on a Sunday'],
    ['7♭9',     [0, 1, 4, 7, 10],      'dark, cinematic pull'],
    ['7♯9',     [0, 3, 4, 7, 10],      'bluesy grit'],
    ['7♯11',    [0, 4, 6, 7, 10],      'bright and bent'],
    ['maj7♯5',  [0, 4, 8, 11],         'glassy, suspended in air'],
    ['sus4(add9)', [0, 2, 5, 7],       'quartal shimmer'],
    ['7sus2',   [0, 2, 7, 10],         'hollow and modern'],
    ['maj13♯11', [0, 2, 4, 6, 7, 9, 11], 'every Lydian colour at once'],
    ['m13',     [0, 2, 3, 5, 7, 9, 10], 'the whole Dorian mode in one breath'],
    ['maj13(11)', [0, 2, 4, 5, 7, 9, 11], 'the entire major scale, stacked'],
    ['m11♭13',  [0, 2, 3, 5, 7, 8, 10], 'the entire minor scale, stacked'],
  ];

  // Build lookup keyed by a 12-bit mask. No-fifth variants get a small penalty.
  const LOOKUP = new Map();
  function addShape(mask, entry) {
    const prev = LOOKUP.get(mask);
    if (!prev || entry.rank < prev.rank) LOOKUP.set(mask, entry);
  }
  const maskOf = ivs => ivs.reduce((m, i) => m | (1 << mod12(i)), 0);
  CHORDS.forEach(([suffix, ivs, colour], idx) => {
    addShape(maskOf(ivs), { suffix, colour, rank: idx });
    // A chord with a 7th/6th/extension still reads fine with the 5th left out.
    if (ivs.length >= 4 && ivs.includes(7)) {
      addShape(maskOf(ivs.filter(i => i !== 7)), { suffix, colour, rank: idx + 15 });
    }
  });

  const INTERVALS = ['unison', 'minor 2nd', 'major 2nd', 'minor 3rd', 'major 3rd', 'perfect 4th',
                     'tritone', 'perfect 5th', 'minor 6th', 'major 6th', 'minor 7th', 'major 7th'];

  /* nameChord(notes, opts) — notes are MIDI numbers (the lowest is treated as the bass)
     or bare pitch classes. opts.free = true ignores the bass and just finds the
     plainest reading (for pitch-class sets that have no real bass note).
     Returns { name, root, bass, colour, pcs } or null. */
  function nameChord(notes, opts) {
    if (!notes || !notes.length) return null;
    const sorted = notes.slice().sort((a, b) => a - b);
    const free = !!(opts && opts.free);
    let bass = mod12(opts && opts.bass != null ? opts.bass : sorted[0]);
    const pcs = [...new Set(sorted.map(n => mod12(Math.round(n))))];

    if (pcs.length === 1) return { name: pcName(pcs[0]), root: pcs[0], bass, colour: 'a single note', pcs, kind: 'note' };
    if (pcs.length === 2) {
      const other = pcs.find(p => p !== bass);
      const iv = mod12(other - bass);
      return { name: pcName(bass) + ' + ' + pcName(other), root: bass, bass, colour: INTERVALS[iv], pcs, kind: 'interval' };
    }

    let best = null;
    for (const root of pcs) {
      const mask = pcs.reduce((m, p) => m | (1 << mod12(p - root)), 0);
      const hit = LOOKUP.get(mask);
      if (!hit) continue;
      const score = hit.rank + (free || root === bass ? 0 : 20);
      if (!best || score < best.score) best = { score, root, hit };
    }
    if (!best) {
      return { name: pcs.map(pcName).join(' · '), root: bass, bass, colour: 'a cluster — Jacob would call it a colour', pcs, kind: 'cluster' };
    }
    if (free) bass = best.root;
    const slash = best.root !== bass ? '/' + pcName(bass) : '';
    return {
      name: pcName(best.root) + best.hit.suffix + slash,
      root: best.root, bass, colour: best.hit.colour, pcs, kind: 'chord',
      quality: best.hit.suffix,
    };
  }

  /* ── Negative harmony ────────────────────────────────────────────
     Reflect every pitch class across the axis between the tonic and the
     dominant (between E and E♭ in C). In C: C↔G, D↔F, E↔E♭, A↔B♭, B↔A♭, F♯↔D♭. */
  function negativePc(pc, tonic = 0) { return mod12(2 * tonic + 7 - pc); }
  function negativeSet(pcs, tonic = 0) { return pcs.map(p => negativePc(p, tonic)); }

  /* Circle-of-fifths position of a pitch class (C = 0, G = 1, D = 2 …) */
  function fifthsIndex(pc) { return mod12(pc * 7); }

  /* Simple, singable voicing: root in the bass, the rest in close position above. */
  function voiceChord(pcs, rootPc, { bassLow = 43, upperLow = 57 } = {}) {
    const out = [bassLow + mod12(rootPc - bassLow)];
    const upper = pcs.map(pc => upperLow + mod12(pc - upperLow)).sort((a, b) => a - b);
    return out.concat(upper);
  }

  /* ── Scales ─────────────────────────────────────────────────────── */
  const SCALES = {
    major:  [0, 2, 4, 5, 7, 9, 11],
    lydian: [0, 2, 4, 6, 7, 9, 11],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    minor:  [0, 2, 3, 5, 7, 8, 10],
  };
  // Scale degree (can be negative / above 7) → MIDI, relative to a tonic MIDI note
  function degreeToMidi(deg, tonicMidi, scale = SCALES.major) {
    const n = scale.length;
    const oct = Math.floor(deg / n);
    return tonicMidi + oct * 12 + scale[((deg % n) + n) % n];
  }
  // Nearest scale degree for a (fractional) MIDI pitch
  function midiToDegree(m, tonicMidi, scale = SCALES.major) {
    const n = scale.length;
    const rel = m - tonicMidi;
    const oct = Math.floor(rel / 12);
    let best = 0, bestD = Infinity;
    for (let o = oct - 1; o <= oct + 1; o++) {
      for (let i = 0; i < n; i++) {
        const d = Math.abs(o * 12 + scale[i] - rel);
        if (d < bestD) { bestD = d; best = o * n + i; }
      }
    }
    return best;
  }

  /* ── Circle-of-fifths wheel geometry (numbers only, no DOM) ───────
     C sits at 12 o'clock. The negative-harmony axis in C runs between
     C|G and F♯|D♭, i.e. at −75° in SVG coordinates (y points down).     */
  const MIRROR_AXIS_DEG = -75;
  function wheelPoint(pc, r) {
    const a = (-90 + fifthsIndex(pc) * 30) * Math.PI / 180;
    return [Math.cos(a) * r, Math.sin(a) * r];
  }
  // SVG path through the chord's notes in circle order (one note = a small ring)
  function wheelPath(pcs, r) {
    const pts = [...new Set(pcs.map(mod12))]
      .sort((a, b) => fifthsIndex(a) - fifthsIndex(b))
      .map(pc => wheelPoint(pc, r));
    if (!pts.length) return '';
    if (pts.length === 1) {
      const [x, y] = pts[0], d = r * 0.2;
      return `M ${x - d} ${y} a ${d} ${d} 0 1 0 ${2 * d} 0 a ${d} ${d} 0 1 0 ${-2 * d} 0`;
    }
    return 'M ' + pts.map(([x, y]) => x.toFixed(1) + ' ' + y.toFixed(1)).join(' L ') + ' Z';
  }
  // Reflects across the axis when s = −1; animating s from 1 to −1 draws the flip
  function mirrorTransform(s) {
    return `rotate(${MIRROR_AXIS_DEG}) scale(1 ${s.toFixed(4)}) rotate(${-MIRROR_AXIS_DEG})`;
  }
  function easeInOutCubic(k) { return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; }

  /* ── Harmonizer brain ────────────────────────────────────────────
     Given a melody note already snapped to the major key, pick a diatonic
     chord that contains it (with a little memory via lastRoot so it doesn't
     flicker) and voice the rest of the chord around it. Guarantees, checked
     by tests/harmony.test.js:
       · no harmony voice below HZ_FLOOR, none within a semitone of the tune
       · the bass (chord root) sits strictly below everything, or is null
         when the singer is already down in bass territory                 */
  const HZ_FLOOR = 41, BASS_FLOOR = 28;
  const HZ_PREF = { 0: 0, 3: 0.15, 4: 0.15, 5: 0.3, 1: 0.35, 2: 0.6 };   // I IV V vi ii iii
  const HZ_WANT = { triad: 2, seventh: 3, jacob: 4 };
  function harmonize(mel, { tonicPc = 0, mode = 'jacob', lastRoot = null } = {}) {
    const scale = SCALES.major;
    const tonicMidi = 48 + mod12(tonicPc);
    const melDeg = ((midiToDegree(mel, tonicMidi, scale) % 7) + 7) % 7;
    let best = null;
    for (const r of [0, 3, 4, 5, 1, 2]) {
      const tones = [0, 2, 4].map(x => (r + x) % 7);
      if (!tones.includes(melDeg)) continue;
      const score = HZ_PREF[r] + (lastRoot === r ? -0.3 : 0) + (tones[0] === melDeg ? 0.1 : 0);
      if (!best || score < best.score) best = { score, r };
    }
    const r = best.r;
    const stack = mode === 'triad' ? [0, 2, 4] : mode === 'seventh' ? [0, 2, 4, 6] : [0, 2, 4, 6, 8];
    if (mode === 'jacob' && r === 3) stack.push(10);          // IV gets the Lydian ♯11
    const chosen = [];
    for (const p of [2, 6, 4, 8, 10, 0]) {                     // 3rd, 7th, 5th, 9th, ♯11, root
      if (!stack.includes(p)) continue;
      const dc = (r + p) % 7;
      if (dc === melDeg || chosen.includes(dc)) continue;
      chosen.push(dc);
      if (chosen.length >= (HZ_WANT[mode] || 2)) break;
    }
    const clash = m => Math.abs(m - mel) <= 1;
    const notes = chosen.map(dc => {
      const pc = mod12(degreeToMidi(dc, tonicMidi, scale));
      let m = mel - 1 - mod12(mel - 1 - pc);                  // closest spot under the tune
      if (clash(m)) m -= 12;
      if (m < HZ_FLOOR) {                                      // tune is low: sing this voice above it
        m = mel + 1 + mod12(pc - mel - 1);
        if (clash(m)) m += 12;
        while (m < HZ_FLOOR) m += 12;
      }
      return m;
    }).sort((a, b) => b - a);
    const rootPc = mod12(degreeToMidi(r, tonicMidi, scale));
    const low = Math.min(mel, ...notes);
    let bass = low - 3 - mod12(low - 3 - rootPc);              // highest root at least 3 semitones under everything
    if (bass < BASS_FLOOR) bass = null;
    const all = (bass == null ? [] : [bass]).concat(notes, [mel]);
    return { notes, bass, rootDeg: r, name: nameChord(all, bass == null ? undefined : { bass }) };
  }

  global.Harmony = {
    PC_NAMES, mod12, pcName, midiName, midiToFreq, freqToMidi, cents,
    nameChord, negativePc, negativeSet, fifthsIndex, voiceChord,
    SCALES, degreeToMidi, midiToDegree, INTERVALS,
    MIRROR_AXIS_DEG, wheelPoint, wheelPath, mirrorTransform, easeInOutCubic,
    harmonize, HZ_FLOOR,
  };
})(window);

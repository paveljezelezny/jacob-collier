/* ════════════════════════════════════════════════════════════════════
   06 REHARM REELS — pure core. No audio, no DOM.
   Two tunes, the chord vocabulary, the fit rule, voice-leading, the
   seeded Viterbi spin, scores and the share-link codec. Everything is
   checked over the whole input range: node tests/reharm-reels.test.js
   Needs window.LabCores.kit (mulberry32). Exposes window.LabCores['reharm-reels'].
   ════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const mod = (n, m) => ((n % m) + m) % m;
  const PC_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const pcName = pc => PC_NAMES[mod(Math.round(pc), 12)];   // the key <select>'s names

  /* ── Spelling for the key ──────────────────────────────────────────
     A note is named by its degree above the tonic, so every key's seven
     scale notes use seven letters (C♯m in A, E♯ø7 in F♯) and borrowed
     degrees are flats (♭II ♭III ♭VI ♭VII: E♭ in D, G♭maj7 in E♭).
     The tonic's letter is the key select's: C D♭ D E♭ E F F♯ G A♭ A B♭ B.
     Degrees 1 ♭2 2 ♭3 3 4 ♯4 5 ♭6 6 ♭7 7. A double accidental falls back
     to PC_NAMES (♭VI in D♭ is A, not B𝄫).                              */
  const LETTERS = 'CDEFGAB', NATURAL = [0, 2, 4, 5, 7, 9, 11];
  const DEG_STEP = [0, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6];
  function spell(key, off) {
    key = mod(Math.round(+key || 0), 12);
    off = mod(Math.round(+off || 0), 12);
    const pc = mod(key + off, 12), L = (LETTERS.indexOf(PC_NAMES[key][0]) + DEG_STEP[off]) % 7;
    const acc = mod(pc - NATURAL[L] + 6, 12) - 6;
    if (acc === 0) return LETTERS[L];
    if (acc === -1) return LETTERS[L] + '♭';
    if (acc === 1) return LETTERS[L] + '♯';
    return PC_NAMES[pc];
  }
  // A chord's root: by degree. A chord from outside the key that would read C♭, F♭, B♯ or E♯
  // takes the plain white-key name instead (Bmaj7 and E7 in E♭, C for the ♯IV in F♯): only
  // the one scale note E♯, in F♯, keeps its letter, so E♯ø7 there is in the key and reads so.
  const ODD = ['C♭', 'F♭', 'B♯', 'E♯'];
  function rootSpelling(key, off, fam) {
    const n = spell(key, off);
    return fam !== 'dia' && ODD.includes(n) ? pcName(key + off) : n;
  }

  /* ── Tunes: stored in C, octave 5. [midi, length in 8ths] ─────── */
  function build(id, name, slot8, bars, plain) {
    const notes = [];
    let t = 0;
    bars.forEach(([midi, len8]) => { notes.push(Object.freeze({ midi, start8: t, len8 })); t += len8; });
    const mids = notes.map(n => n.midi);
    return Object.freeze({
      id, name, slot8, total8: t, notes: Object.freeze(notes),
      min: Math.min(...mids), max: Math.max(...mids),
      plain: Object.freeze(plain),              // root offsets of the plain major triads
    });
  }
  const FRERE_A = [[72, 2], [74, 2], [76, 2], [72, 2]];
  const FRERE_B = [[76, 2], [77, 2], [79, 4]];
  const FRERE_C = [[79, 1], [81, 1], [79, 1], [77, 1], [76, 2], [72, 2]];
  const FRERE_D = [[72, 2], [67, 2], [72, 4]];
  const TUNES = Object.freeze({
    twinkle: build('twinkle', 'Twinkle, Twinkle', 4, [
      [72, 2], [72, 2], [79, 2], [79, 2], [81, 2], [81, 2], [79, 4],
      [77, 2], [77, 2], [76, 2], [76, 2], [74, 2], [74, 2], [72, 4],
    ], [0, 0, 5, 0, 5, 0, 7, 0]),
    frere: build('frere', 'Frère Jacques', 8,
      [].concat(FRERE_A, FRERE_A, FRERE_B, FRERE_B, FRERE_C, FRERE_C, FRERE_D, FRERE_D),
      [0, 0, 0, 0, 0, 0, 0, 0]),
  });
  const SLOTS = 8;
  const TEMPOS = Object.freeze([76, 92, 108]);
  const shiftOf = key => (key <= 6 ? key : key - 12);

  const LEVELS = Object.freeze([
    { id: 1, name: 'Campfire' }, { id: 2, name: 'Sunday' }, { id: 3, name: 'Jazz club' },
    { id: 4, name: 'Film score' }, { id: 5, name: 'Off the map' },
  ].map(Object.freeze));

  // say: how the family reads inside a sentence ("Slot 3 is now A♭maj7, borrowed.")
  const FAMILIES = Object.freeze({
    dia: Object.freeze({ label: 'In the key',  say: 'in the key',  token: 'paper' }),
    sec: Object.freeze({ label: 'Pulls',       say: 'a pull',      token: 'h2' }),
    bor: Object.freeze({ label: 'Borrowed',    say: 'borrowed',    token: 'h3' }),
    med: Object.freeze({ label: 'Sideways',    say: 'sideways',    token: 'h1' }),
    far: Object.freeze({ label: 'Off the map', say: 'off the map', token: 'h4' }),
  });

  // Suffixes match Harmony.nameChord; colour phrases follow harmony.js.
  // 'home' only on the tonic: G before the final C is exactly the chord that isn't home.
  const QUAL = Object.freeze({
    maj:   { ivs: [0, 4, 7],             suffix: '',        colour: 'Bright and plain.', home: 'Bright, home.' },
    min:   { ivs: [0, 3, 7],             suffix: 'm',       colour: 'Wistful.' },
    dom7:  { ivs: [0, 4, 7, 10],         suffix: '7',       colour: 'Wants to go somewhere.' },
    maj7:  { ivs: [0, 4, 7, 11],         suffix: 'maj7',    colour: 'Sunlight through a window.' },
    min7:  { ivs: [0, 3, 7, 10],         suffix: 'm7',      colour: 'Soft and a bit soulful.' },
    add9:  { ivs: [0, 2, 4, 7],          suffix: 'add9',    colour: 'A little lift.' },
    sus7:  { ivs: [0, 5, 7, 10],         suffix: '7sus4',   colour: 'Gospel, just before the lift.' },
    maj9:  { ivs: [0, 2, 4, 7, 11],      suffix: 'maj9',    colour: 'Warm, wide open.' },
    min9:  { ivs: [0, 2, 3, 7, 10],      suffix: 'm9',      colour: 'Neo-soul warmth.' },
    dom9:  { ivs: [0, 2, 4, 7, 10],      suffix: '9',       colour: 'Funky, loose.' },
    dom13: { ivs: [0, 2, 4, 7, 9, 10],   suffix: '13',      colour: 'Church on a Sunday.' },
    six9:  { ivs: [0, 2, 4, 7, 9],       suffix: '6/9',     colour: 'Pentatonic sparkle.' },
    hdim:  { ivs: [0, 3, 6, 10],         suffix: 'ø7',      colour: 'On the edge of something.' },
    m6:    { ivs: [0, 3, 7, 9],          suffix: 'm6',      colour: 'Film noir.' },
    sus9:  { ivs: [0, 2, 5, 7, 10],      suffix: '9sus4',   colour: 'Floating, unresolved.' },
    lyd:   { ivs: [0, 4, 6, 7, 11],      suffix: 'maj7♯11', colour: 'Lydian, the Djesse colour.' },
    m11:   { ivs: [0, 3, 5, 7, 10],      suffix: 'm11',     colour: 'Deep, velvety.' },
    d7s11: { ivs: [0, 4, 6, 7, 10],      suffix: '7♯11',    colour: 'Bright and bent.' },
  });
  Object.values(QUAL).forEach(q => { Object.freeze(q.ivs); Object.freeze(q); });

  /* ── VOCAB: [root offset above the tonic, quality, level, family] ── */
  const V = [];
  const add = (lvl, fam, list) => list.forEach(([off, q]) => V.push([off, q, lvl, fam]));
  add(1, 'dia', [[0, 'maj'], [5, 'maj'], [7, 'maj'], [9, 'min'], [2, 'min'], [4, 'min'], [7, 'dom7']]);
  add(2, 'dia', [[0, 'add9'], [5, 'add9'], [7, 'sus7'], [2, 'min7'], [9, 'min7']]);
  add(2, 'sec', [[2, 'dom7'], [4, 'dom7'], [9, 'dom7'], [0, 'dom7']]);
  add(2, 'bor', [[5, 'min']]);
  add(3, 'dia', [[0, 'maj7'], [5, 'maj7'], [0, 'maj9'], [5, 'maj9'], [2, 'min9'], [9, 'min9'], [4, 'min7'],
    [7, 'dom9'], [7, 'dom13'], [0, 'six9'], [11, 'hdim']]);
  add(3, 'sec', [[1, 'dom7'], [2, 'dom9'], [8, 'dom7']]);
  add(4, 'bor', [[8, 'maj7'], [10, 'maj'], [3, 'maj7'], [5, 'm6'], [1, 'maj7'], [0, 'min']]);
  add(4, 'med', [[4, 'maj'], [9, 'maj'], [8, 'maj'], [3, 'maj']]);
  add(4, 'dia', [[7, 'sus9']]);
  add(5, 'far', [0, 1, 2, 3, 5, 6, 7, 8, 10].map(r => [r, 'lyd']));
  add(5, 'far', [1, 3, 6, 8, 10].map(r => [r, 'six9']));
  add(5, 'far', [1, 2, 4, 6, 9].map(r => [r, 'm11']));
  add(5, 'far', [1, 2, 10].map(r => [r, 'd7s11']));
  // Level 5 keeps Fmaj7♯11, Dm11, Em11 and Am11 (in C), but every note of those is in the
  // key, so they wear the In the key colour and label rather than Off the map.
  const SCALE = [0, 2, 4, 5, 7, 9, 11];
  const inKey = (off, q) => QUAL[q].ivs.every(i => SCALE.includes(mod(off + i, 12)));
  // Only the first entry of each (root, intervals) pair counts; the id is stable across keys
  const seen = new Set();
  const VOCAB = Object.freeze(V.filter(([off, q]) => {
    const k = off + ':' + QUAL[q].ivs.join(',');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).map(([off, q, lvl, fam], vocabId) => Object.freeze({
    vocabId, off, q, lvl, fam: fam === 'far' && inKey(off, q) ? 'dia' : fam, id: off + ':' + q,
  })));

  /* ── Slots ─────────────────────────────────────────────────────── */
  const slotCache = new Map();
  function validTune(tune) { return Object.prototype.hasOwnProperty.call(TUNES, tune); }
  function normKey(key) { return mod(Math.round(+key || 0), 12); }

  // 8 × { anchors, anchorPcs, melMin, notes, plainIdx: 0 }, transposed into `key`
  function slotInfo(tune, key) {
    key = normKey(key);
    const ck = tune + '|' + key;
    if (slotCache.has(ck)) return slotCache.get(ck);
    const T = TUNES[tune], sh = shiftOf(key);
    const out = [];
    for (let s = 0; s < SLOTS; s++) {
      const a = s * T.slot8, b = a + T.slot8;
      const notes = T.notes.filter(n => n.start8 >= a && n.start8 < b)
        .map(n => Object.freeze({ midi: n.midi + sh, start8: n.start8, pos: n.start8 - a, len8: n.len8 }));
      // Anchors: the notes that start on the slot's beat 1 or beat 3
      const anchors = notes.filter(n => n.pos === 0 || n.pos === 4).map(n => n.midi);
      out.push(Object.freeze({
        slot: s,
        anchors: Object.freeze(anchors),
        anchorPcs: Object.freeze([...new Set(anchors.map(m => mod(m, 12)))]),
        melMin: Math.min(...notes.map(n => n.midi)),
        notes: Object.freeze(notes),
        plainIdx: 0,
      }));
    }
    Object.freeze(out);
    slotCache.set(ck, out);
    return out;
  }

  /* ── The fit rule ──────────────────────────────────────────────────
     rel = the melody anchor's interval above the chord root. It must be a
     chord tone or an idiomatic tension, and no chord tone may sit a
     semitone under it.                                                 */
  function allowedOver(rel, ivs) {
    rel = mod(rel, 12);
    if (ivs.includes(mod(rel - 1, 12))) return false;
    if (ivs.includes(rel)) return true;
    const has = i => ivs.includes(i);
    switch (rel) {
      case 2:  return !has(1);
      case 5:  return !has(4);
      case 6:  return has(4);
      case 9:  return !has(8);
      case 11: return has(4) && !has(10);
      case 10: return !has(11);
      default: return false;
    }
  }

  /* ── Voicing ───────────────────────────────────────────────────────
     Bass = root in 36–47. Three upper voices picked 3rd → 7th/6th →
     extension → 5th → root, placed between the bass and 2 semitones under
     the lowest melody note of the slot, as close as possible to `prev`.  */
  // 3rd · 7th/6th · extension · 5th · root, walked group by group
  const UPPER_ORDER = [[3, 4], [10, 11, 9], [9, 2, 6, 5], [7, 6, 8], [0]].flat();
  const PAD_ORDER = [7, 6, 8, 0];

  function upperIntervals(ivs, anchorRels) {
    const out = [];
    const take = allowDoubles => {
      for (const iv of UPPER_ORDER) {
        if (out.length >= 3) return;
        if (!ivs.includes(iv) || out.includes(iv)) continue;
        if (!allowDoubles && anchorRels.includes(iv)) continue;   // don't double the tune
        out.push(iv);
      }
    };
    take(false);
    take(true);
    // Only a chord with fewer than three tones gets here: double its 5th or root
    for (let i = 0; out.length < 3 && i < 8; i++) {
      const iv = PAD_ORDER.find(x => ivs.includes(x));
      out.push(iv === undefined ? 0 : iv);
    }
    return out;
  }

  // Every legal placement of the three upper voices: distinct, ascending, span ≤ 16
  function voiceOptions(chord, info) {
    if (!chord || !info) return null;
    const bass = 36 + mod(chord.root - 36, 12);
    const lo = Math.max(45, bass + 3), hi = info.melMin - 2;
    const rels = info.anchorPcs.map(p => mod(p - chord.root, 12));
    const spots = upperIntervals(chord.ivs, rels).map(iv => {
      const pc = mod(chord.root + iv, 12), list = [];
      for (let m = lo + mod(pc - lo, 12); m <= hi; m += 12) list.push(m);
      return list;
    });
    const uppers = [];
    for (const a of spots[0]) {
      for (const b of spots[1]) {
        for (const c of spots[2]) {
          if (a === b || b === c || a === c) continue;
          const v = [a, b, c].sort((x, y) => x - y);
          if (v[2] - v[0] <= 16) uppers.push(v);
        }
      }
    }
    return { bass, uppers };
  }
  const moved = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

  // [bass, u1, u2, u3]: closest to prev's upper voices, or with no prev the middle voice near melMin − 9
  function voiceSlot(chord, info, prev) {
    const o = voiceOptions(chord, info);
    if (!o || !o.uppers.length) return null;
    const pu = prev ? prev.slice(1) : null, target = info.melMin - 9;
    let best = null, bestCost = Infinity;
    for (const v of o.uppers) {
      const cost = pu ? moved(v, pu) : Math.abs(v[1] - target);
      if (cost < bestCost) { bestCost = cost; best = v; }
    }
    return [o.bass].concat(best);
  }

  /* ── Candidates ────────────────────────────────────────────────── */
  const candCache = new Map();
  function makeChord(entry, key) {
    const Q = QUAL[entry.q], root = mod(key + entry.off, 12), rootName = rootSpelling(key, entry.off, entry.fam);
    return Object.freeze({
      vocabId: entry.vocabId, id: entry.id, off: entry.off, q: entry.q,
      root, ivs: Q.ivs,
      pcs: Object.freeze(Q.ivs.map(i => mod(root + i, 12))),
      lvl: entry.lvl, fam: entry.fam,
      rootName, suffix: Q.suffix,
      name: rootName + Q.suffix,
      colour: (entry.off === 0 && Q.home) || Q.colour,
    });
  }
  function fits(entry, info, key) {
    const root = mod(key + entry.off, 12), ivs = QUAL[entry.q].ivs;
    if (!info.anchorPcs.every(p => allowedOver(mod(p - root, 12), ivs))) return false;
    // A quarter note or longer between the anchors (Frère's C at the end of bars 5–6) is
    // heard just as clearly: no chord tone a semitone under it either, unless the tune
    // itself sings that pitch in this slot (then it is the melody's own step).
    const sung = info.notes.map(n => mod(n.midi, 12));
    return info.notes.every(n => {
      if (n.len8 < 2 || n.pos === 0 || n.pos === 4) return true;
      const under = mod(n.midi - 1, 12);
      return sung.includes(under) || !ivs.includes(mod(under - root, 12));
    });
  }
  // All 8 slots at once: [slot][i]. Index 0 is always the slot's plain chord.
  function candidateTable(tune, key, level) {
    key = normKey(key);
    const ck = tune + '|' + key + '|' + level;
    if (candCache.has(ck)) return candCache.get(ck);
    const info = slotInfo(tune, key), T = TUNES[tune];
    const table = info.map((inf, s) => {
      const plainId = T.plain[s] + ':maj';
      const list = [];
      VOCAB.forEach(e => {
        if (e.lvl > level || !fits(e, inf, key)) return;
        const ch = makeChord(e, key);
        if (!voiceSlot(ch, inf, null)) return;
        if (e.id === plainId) list.unshift(ch); else list.push(ch);
      });
      return Object.freeze(list);
    });
    Object.freeze(table);
    candCache.set(ck, table);
    return table;
  }
  function candidates(tune, slot, key, level) {
    if (!validTune(tune)) return [];
    level = Math.max(1, Math.min(5, Math.round(+level || 1)));
    return candidateTable(tune, key, level)[mod(Math.round(+slot || 0), SLOTS)];
  }

  /* The loop is a circle, so the voicing is too. Chaining slot by slot and
     then re-voicing slot 1 against slot 8 (the first idea) can leave a
     15-semitone leap between slots 1 and 2 once the voices have drifted
     round the loop. Instead: the placement per slot that minimises the
     total movement all the way round, back to the start.              */
  function voicePath(tune, key, chords) {
    const info = slotInfo(tune, key);
    const opts = info.map((inf, s) => voiceOptions(chords[s], inf));
    if (opts.some(o => !o || !o.uppers.length)) {
      const out = [];
      for (let s = 0; s < SLOTS; s++) out.push(voiceSlot(chords[s], info[s], s ? out[s - 1] : null));
      return out;
    }
    let bestTotal = Infinity, bestPick = null;
    opts[0].uppers.forEach((v0, i0) => {
      let cost = [0], prevList = [v0];
      const back = [];
      for (let s = 1; s < SLOTS; s++) {
        const cur = opts[s].uppers, next = [], bk = [];
        for (const v of cur) {
          let b = Infinity, arg = 0;
          for (let j = 0; j < prevList.length; j++) {
            const x = cost[j] + moved(prevList[j], v);
            if (x < b) { b = x; arg = j; }
          }
          next.push(b);
          bk.push(arg);
        }
        cost = next; prevList = cur; back[s] = bk;
      }
      let b = Infinity, arg = 0;
      for (let j = 0; j < prevList.length; j++) {
        const x = cost[j] + moved(prevList[j], v0);
        if (x < b) { b = x; arg = j; }
      }
      if (b < bestTotal) {
        bestTotal = b;
        const pick = new Array(SLOTS);
        pick[0] = i0; pick[SLOTS - 1] = arg;
        for (let s = SLOTS - 1; s >= 2; s--) pick[s - 1] = back[s][pick[s]];
        bestPick = pick;
      }
    });
    return bestPick.map((k, s) => [opts[s].bass].concat(opts[s].uppers[k]));
  }

  /* ── Scores ────────────────────────────────────────────────────── */
  const hasIv = (ch, i) => ch.ivs.includes(i);
  function isTonic(ch, key) { return !!ch && mod(ch.root - key, 12) === 0 && hasIv(ch, 4) && !hasIv(ch, 10); }
  function isPull(ch, key) {
    if (!ch) return false;
    const off = mod(ch.root - key, 12);
    return (off === 7 && hasIv(ch, 4)) || (off === 1 && hasIv(ch, 10)) || off === 10 || off === 5 || (off === 11 && hasIv(ch, 3));
  }
  function cadence(chords, key) {
    const last = chords[SLOTS - 1], before = chords[SLOTS - 2];
    if (isTonic(last, key) && isPull(before, key)) return 'home';
    if (isTonic(last, key) && isTonic(before, key)) return 'still';
    return 'hanging';
  }
  function heat(chords) {
    if (!chords || !chords.length) return 0;
    return Math.round(100 * chords.reduce((s, c) => s + (c.lvl - 1) / 4, 0) / chords.length);
  }

  /* ── Spin: Viterbi over the candidates ────────────────────────────
     Rewards smooth voice movement, strong root motion and the chosen
     level, punishes repeats (next door, and two back along the best path
     so far), and adds seeded noise so every seed deals a different hand.
     Pinned by the spec examples: seed 1 in C gives F Dm G7 C F Dm G7 C
     at level 1 on Twinkle.                                             */
  function circDist(a, b) { const d = mod(a - b, 12); return Math.min(d, 12 - d); }
  function pcDistance(p, c) {
    let s = 0;
    for (const x of p.pcs) { let m = 6; for (const y of c.pcs) m = Math.min(m, circDist(x, y)); s += m; }
    for (const y of c.pcs) { let m = 6; for (const x of p.pcs) m = Math.min(m, circDist(x, y)); s += m; }
    return s;
  }
  const ROOT_MOVE = [1.5, 0.5, 0.5, 0, 0, -1, 1, 0, 0, 0, 0.5, 0.5];
  // Transposing both chords changes nothing, so one table serves every key
  const TRANS = new Float64Array(VOCAB.length * VOCAB.length).fill(NaN);
  function transition(p, c) {
    const k = p.vocabId * VOCAB.length + c.vocabId;
    if (TRANS[k] === TRANS[k]) return TRANS[k];
    return (TRANS[k] = 0.35 * pcDistance(p, c) + ROOT_MOVE[mod(c.root - p.root, 12)] + (c.id === p.id ? 4 : 0));
  }

  // locks: 8 entries, each a candidate index to keep or null
  function spin(tune, key, level, seed, locks) {
    key = normKey(key);
    level = Math.max(1, Math.min(5, Math.round(+level || 1)));
    const table = candidateTable(tune, key, level);
    const rng = global.LabCores.kit.mulberry32(seed);
    // At level 5 the pull goes to the chords that leave the key: the in-key m11s voice-lead
    // so smoothly that they would otherwise win most slots and make 5 tamer than 4.
    const bias = c => (c.lvl === level && (level < 5 || c.fam === 'far') ? -2 : 0) + (c.lvl < level - 1 ? 1 : 0);
    const lockAt = s => {
      const v = locks && locks[s];
      return Number.isInteger(v) && v >= 0 && v < table[s].length ? v : -1;
    };
    // What each slot may land on: its lock, else tonic last, else a pull just before it (when there is one)
    const allowed = table.map((list, s) => {
      const lk = lockAt(s);
      if (lk >= 0) return [lk];
      const all = list.map((_, i) => i);
      if (s === SLOTS - 1) return all.filter(i => isTonic(list[i], key));
      if (s === SLOTS - 2) {
        const pulls = all.filter(i => isPull(list[i], key));
        if (pulls.length) return pulls;
      }
      return all;
    });
    // One noise draw per allowed (slot, candidate), slot by slot, in list order
    const local = allowed.map((ids, s) => ids.map(i => bias(table[s][i]) + 3 * rng()));
    const chord = (s, k) => table[s][allowed[s][k]];

    let cost = local[0].slice();
    const back = [allowed[0].map(() => -1)];
    for (let s = 1; s < SLOTS; s++) {
      const next = [], bk = [];
      // The same chord twice next door is only ever a lock's doing. The +4 in transition()
      // alone can lose when a short list (Frère, spice 1) leaves few other routes. Skipping
      // those steps never changes a hand that had no twins, since it only raises other costs.
      const noTwins = lockAt(s) < 0 && lockAt(s - 1) < 0;
      for (let c = 0; c < allowed[s].length; c++) {
        const cc = chord(s, c);
        let best = Infinity, arg = 0;
        for (let p = 0; p < allowed[s - 1].length; p++) {
          if (noTwins && chord(s - 1, p).id === cc.id) continue;
          let v = cost[p] + transition(chord(s - 1, p), cc);
          const two = back[s - 1][p];
          if (two >= 0 && chord(s - 2, two).id === cc.id) v += 2.5;
          if (v < best) { best = v; arg = p; }
        }
        next.push(best + local[s][c]);
        bk.push(arg);
      }
      cost = next;
      back.push(bk);
    }
    let k = 0;
    for (let c = 1; c < cost.length; c++) if (cost[c] < cost[k]) k = c;
    const pick = new Array(SLOTS);
    for (let s = SLOTS - 1; s >= 0; s--) { pick[s] = allowed[s][k]; k = back[s][k]; }
    return pick;
  }

  // Keep each chord if the target list still has it (same root and intervals), else plain
  function remapIdx(tune, key, fromLevel, toLevel, idx, fromKey) {
    const fromT = candidateTable(tune, fromKey == null ? key : fromKey, fromLevel);
    const toT = candidateTable(tune, key, toLevel);
    return toT.map((list, s) => {
      const was = fromT[s][idx && idx[s]];
      if (!was) return 0;
      const j = list.findIndex(c => c.id === was.id);
      return j < 0 ? 0 : j;
    });
  }

  /* ── Share codec ───────────────────────────────────────────────────
     1.<t|f>.<key 0-b>.<tempo 0-2>.<level 1-5>.<8 idx chars>.<locks 2 hex>.<layers 1 hex>.<b|v>
     An idx char is base 36 (0-9a-z) extended with A-Z for 36–61:
     the Off the map lists run past 36 chords.                        */
  const IDX = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const LAYERS = Object.freeze({ choir: 1, bass: 2, keys: 4, brushes: 8 });

  function defaultState() {
    return { v: 1, tune: 'twinkle', key: 0, tempo: 1, level: 3, idx: [0, 0, 0, 0, 0, 0, 0, 0], locks: 0, layers: 3, melody: 'box', before: false };
  }

  function encode(st) {
    const idx = Array.from({ length: SLOTS }, (_, s) => {
      const v = st.idx && st.idx[s];
      return Number.isInteger(v) && v >= 0 && v < IDX.length ? IDX[v] : '0';
    }).join('');
    return [
      '1', st.tune === 'frere' ? 'f' : 't',
      normKey(st.key).toString(16),
      Math.max(0, Math.min(2, st.tempo | 0)),
      Math.max(1, Math.min(5, st.level | 0)),
      idx,
      ((st.locks | 0) & 255).toString(16).padStart(2, '0'),
      ((st.layers | 0) & 15).toString(16),
      st.melody === 'voice' ? 'v' : 'b',
    ].join('.');
  }

  function decode(str) {
    if (typeof str !== 'string' || str.length > 64) return null;
    const p = str.split('.');
    if (p.length !== 9 || p[0] !== '1') return null;
    if (!/^[tf]$/.test(p[1]) || !/^[0-9ab]$/.test(p[2]) || !/^[0-2]$/.test(p[3]) || !/^[1-5]$/.test(p[4])) return null;
    if (!/^[0-9a-zA-Z]{8}$/.test(p[5]) || !/^[0-9a-f]{2}$/.test(p[6]) || !/^[0-9a-f]$/.test(p[7]) || !/^[bv]$/.test(p[8])) return null;
    const tune = p[1] === 't' ? 'twinkle' : 'frere';
    const key = parseInt(p[2], 16), level = +p[4];
    const table = candidateTable(tune, key, level);
    const idx = p[5].split('').map((ch, s) => {
      const v = IDX.indexOf(ch);
      return v < table[s].length ? v : 0;
    });
    return {
      v: 1, tune, key, tempo: +p[3], level, idx,
      locks: parseInt(p[6], 16), layers: parseInt(p[7], 16),
      melody: p[8] === 'v' ? 'voice' : 'box', before: false,
    };
  }

  const api = {
    TUNES, LEVELS, QUAL, VOCAB, FAMILIES, TEMPOS, LAYERS, SLOTS, PC_NAMES,
    shiftOf, pcName, spell, slotInfo, allowedOver, candidates, voiceOptions, voiceSlot, voicePath,
    spin, isTonic, isPull, cadence, heat, remapIdx, encode, decode, defaultState,
    pcDistance, transition,
  };
  (global.LabCores = global.LabCores || {})['reharm-reels'] = api;
})(window);

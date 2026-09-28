/* ════════════════════════════════════════════════════════════════════
   DOWNBEAT CORE — the music and maths behind 07 Downbeat. No audio, no DOM.
   Ode to Joy (public domain) with a voice-led SATB choir, a tap-tempo
   follower, pad mappings, take review, the score-ribbon layout and the
   share-link codec. Tests: node tests/downbeat.test.js
   Needs harmony.js (names) and lab/kit-core.js (clamp, median, base64url)
   at call time. Exposes window.LabCores.downbeat.
   ════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const kit = () => global.LabCores.kit;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mod = (n, m) => ((n % m) + m) % m;

  /* ── Data ──────────────────────────────────────────────────────
     MELODY: 16 bars of [midi, length in 8ths] in D major, one octave up.
     Every bar totals 8 eighths; bars 5–7 and 13–15 repeat 1–3, 16 = 8.  */
  const B1 = [[78, 2], [78, 2], [79, 2], [81, 2]];
  const B2 = [[81, 2], [79, 2], [78, 2], [76, 2]];
  const B3 = [[74, 2], [74, 2], [76, 2], [78, 2]];
  const B8 = [[76, 3], [74, 1], [74, 4]];
  const MELODY = [
    B1, B2, B3, [[78, 3], [76, 1], [76, 4]],
    B1, B2, B3, B8,
    [[76, 2], [76, 2], [78, 2], [74, 2]],
    [[76, 2], [78, 1], [79, 1], [78, 2], [74, 2]],
    [[76, 2], [78, 1], [79, 1], [78, 2], [76, 2]],
    [[74, 2], [76, 2], [69, 4]],
    B1, B2, B3, B8,
  ];
  const MELODY_TONIC = 2;                 // written in D
  const BEATS = 64, HALVES = 32;

  // Roman numerals → root above the tonic, triad, and which Gospel upgrades apply
  const DEGREES = {
    'I':   { rel: 0, ivs: [0, 4, 7],     q: 'maj' },
    'IV':  { rel: 5, ivs: [0, 4, 7],     q: 'maj' },
    'V':   { rel: 7, ivs: [0, 4, 7],     q: 'dom' },
    'vi':  { rel: 9, ivs: [0, 3, 7],     q: 'min' },
    'V/V': { rel: 2, ivs: [0, 4, 7, 10], q: 'sec' },
  };
  const PLAN_HYMN = [
    'I', 'IV', 'I', 'V',  'I', 'V',  'I', 'V',
    'I', 'IV', 'I', 'V',  'I', 'V',  'V', 'I',
    'V', 'I',  'V', 'I',  'V', 'vi', 'V/V', 'V',
    'I', 'IV', 'I', 'V',  'I', 'V',  'V', 'I',
  ];
  // First option that fits every melody note of the half-bar wins; none fits → keep the hymn chord
  const GOSPEL = {
    maj: [[0, 4, 7, 9, 2], [0, 4, 7, 11], [0, 4, 7, 9]],
    min: [[0, 3, 7, 10, 2], [0, 3, 7, 10]],
    dom: [[0, 4, 7, 10, 2], [0, 4, 7, 10]],
    sec: [[0, 4, 7, 10, 2], [0, 4, 7, 10]],
  };
  const STYLES = ['Hymn', 'Gospel', 'Lullaby'];
  // colour: intervals the ending's alto and tenor reach for first
  const ENDINGS = [
    { name: 'Plain',    rel: 0, ivs: [0, 4, 7],         colour: [] },
    { name: 'Warm',     rel: 0, ivs: [0, 2, 4, 7, 9],   colour: [9, 2] },
    { name: 'Sideways', rel: 8, ivs: [0, 4, 6, 7, 11],  colour: [6, 11] },
  ];
  const SECTIONS = [
    { id: 'low',   label: 'Low end', colour: 'h4' },
    { id: 'choir', label: 'Choir',   colour: 'paper' },
    { id: 'keys',  label: 'Keys',    colour: 'h3' },
    { id: 'bells', label: 'Bells',   colour: 'h1' },
  ];
  const RANGES = { a: [55, 74], t: [48, 67], b: [38, 57] };
  const FIRST_VOICING = { a: 64, t: 57, b: 45 };
  const SUFFIX = {
    '0,4,7': '', '0,3,7': 'm', '0,4,7,10': '7', '0,4,7,11': 'maj7', '0,4,7,9': '6',
    '0,2,4,7,9': '6/9', '0,2,4,7,10': '9', '0,3,7,10': 'm7', '0,2,3,7,10': 'm9', '0,4,6,7,11': 'maj7♯11',
  };
  const DYN_SHORT = ['pp', 'p', 'mp', 'mf', 'f', 'ff'];
  const DYN_WORDS = ['pianissimo', 'piano', 'mezzo-piano', 'mezzo-forte', 'forte', 'fortissimo'];

  const sortIvs = ivs => Array.from(new Set(ivs.map(i => mod(i, 12)))).sort((a, b) => a - b);
  function makeChord(rootPc, ivs) {
    const iv = sortIvs(ivs), root = mod(rootPc, 12);
    const H = global.Harmony;
    const pcName = H ? H.pcName(root) : String(root);
    return { root, ivs: iv, pcs: iv.map(i => mod(root + i, 12)), name: pcName + (SUFFIX[iv.join(',')] || '') };
  }
  // Transpose by the smallest move from D (−5 … +6), so the tune stays near its written register
  function keyShift(keyPc) { const s = mod(Math.round(keyPc) - MELODY_TONIC, 12); return s <= 6 ? s : s - 12; }

  /* ── Melody timeline: 128 eighths ─────────────────────────────── */
  function melodyNotes(keyPc) {
    const shift = keyShift(keyPc), notes = [];
    let e = 0;
    MELODY.forEach(bar => bar.forEach(([m, len]) => { notes.push({ midi: m + shift, start: e, len }); e += len; }));
    return notes;
  }
  function soundingAt(notes, eighth) {
    for (let k = notes.length - 1; k >= 0; k--) if (notes[k].start <= eighth) return notes[k];
    return null;
  }
  function halfMelody(notes, h) {
    const mids = [];
    for (let e = 4 * h; e < 4 * h + 4; e++) mids.push(soundingAt(notes, e).midi);
    return { min: Math.min(...mids), pcs: Array.from(new Set(mids.map(m => mod(m, 12)))), anchor: mids[0] };
  }

  /* ── Fit rule (same as 06 Reharm reels) ────────────────────────
     rel = melody pc above the chord root. A chord tone or an accepted
     tension passes, and no chord tone may sit a semitone under the tune. */
  function allowedOver(rel, ivs) {
    const r = mod(rel, 12), has = i => ivs.includes(i);
    const fits = has(r)
      || (r === 2 && !has(1)) || (r === 5 && !has(4)) || (r === 6 && has(4))
      || (r === 9 && !has(8)) || (r === 11 && has(4) && !has(10)) || (r === 10 && !has(11));
    return fits && !has(mod(r - 1, 12));
  }

  /* ── Chords ───────────────────────────────────────────────────── */
  function endingChord(idx, keyPc) {
    const e = ENDINGS[clamp(Math.round(idx) || 0, 0, 2)];
    return makeChord(mod(keyPc, 12) + e.rel, e.ivs);
  }
  const planCache = new Map();
  function chordPlan(style, keyPc) {
    style = clamp(Math.round(style) || 0, 0, 2); keyPc = mod(Math.round(keyPc) || 0, 12);
    const ck = style + ':' + keyPc;
    if (planCache.has(ck)) return planCache.get(ck).map(c => Object.assign({}, c));
    const notes = melodyNotes(keyPc);
    const plan = PLAN_HYMN.map((deg, h) => {
      const d = DEGREES[deg], root = keyPc + d.rel;
      let ivs = d.ivs;
      if (style === 1) {
        const mel = halfMelody(notes, h);
        const up = GOSPEL[d.q].find(opt => mel.pcs.every(pc => allowedOver(pc - root, sortIvs(opt))));
        if (up) ivs = up;
      }
      return Object.assign(makeChord(root, ivs), { degree: deg });
    });
    planCache.set(ck, plan);
    return plan.map(c => Object.assign({}, c));
  }

  /* ── SATB ─────────────────────────────────────────────────────
     B < T < A ≤ melMin − 2, A − T ≤ 12, the 3rd sounds somewhere, bass on
     the root, then the smallest |ΔA| + |ΔT| + ½|ΔB|. Ties go to more
     different pitch classes, then the higher alto.                   */
  function inRange(pc, lo, hi) { const out = []; for (let m = lo + mod(pc - lo, 12); m <= hi; m += 12) out.push(m); return out; }
  function voiceHalf(chord, melMin, prev, colourFirst, melPcs) {
    const p = prev || FIRST_VOICING, root = chord.root;
    const third = chord.ivs.includes(4) ? mod(root + 4, 12) : chord.ivs.includes(3) ? mod(root + 3, 12) : null;
    const melSet = new Set((melPcs || []).map(x => mod(x, 12)));
    const colour = (colourFirst || []).map(i => mod(root + i, 12));
    const aHi = Math.min(RANGES.a[1], melMin - 2);
    const upper = (lo, hi) => chord.pcs.reduce((acc, pc) => acc.concat(inRange(pc, lo, hi)), []).sort((x, y) => x - y);
    const As = upper(RANGES.a[0], aHi), Ts = upper(RANGES.t[0], RANGES.t[1]), Bs = inRange(root, RANGES.b[0], RANGES.b[1]);
    let best = null;
    for (const a of As) for (const t of Ts) {
      if (t >= a || a - t > 12) continue;
      for (const b of Bs) {
        if (b >= t) continue;
        const pcs = new Set([mod(a, 12), mod(t, 12), mod(b, 12)]);
        if (third != null && !pcs.has(third) && !melSet.has(third)) continue;
        const key = [
          -colour.filter(c => c === mod(a, 12) || c === mod(t, 12)).length,
          Math.abs(a - p.a) + Math.abs(t - p.t) + 0.5 * Math.abs(b - p.b),
          -pcs.size, -a, -t, -b,
        ];
        if (!best || lexLess(key, best.key)) best = { key, v: { a, t, b } };
      }
    }
    return best ? best.v : null;
  }
  function lexLess(x, y) { for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i]; return false; }

  // The keys' broken chord: root (52–63), tenor, alto → [n0, n1, n2], played n0 n1 n2 n1
  function arpNotes(half) {
    const { chord, satb } = half;
    const set = Array.from(new Set([52 + mod(chord.root - 52, 12), satb.t, satb.a])).sort((x, y) => x - y);
    if (set.length < 3) {
      // Root doubled by a voice: borrow the nearest other chord tone so the pattern keeps three notes
      const mid = set.reduce((s, m) => s + m, 0) / set.length;
      const cand = chord.pcs.reduce((acc, pc) => acc.concat(inRange(pc, 48, 74)), [])
        .filter(m => !set.includes(m))
        .sort((x, y) => Math.abs(x - mid) - Math.abs(y - mid) || x - y);
      while (set.length < 3 && cand.length) set.push(cand.shift());
      set.sort((x, y) => x - y);
    }
    return set;
  }

  /* The keys' block chord: B, T, A plus any chord tone neither they nor the
     tune sound, tucked in above the tenor and still ≥ 2 under the melody.
     The choir's voice leading often drops a Gospel chord's 6th or 9th; the
     stab puts it back so what you hear matches the chord name.          */
  function stabNotes(half) {
    const { chord, satb, mel } = half;
    const notes = [satb.b, satb.t, satb.a];
    const have = new Set(notes.map(m => mod(m, 12)).concat(mel.pcs.map(p => mod(p, 12))));
    const top = mel.min - 2;
    chord.pcs.forEach(pc => {
      if (have.has(pc)) return;
      let m = satb.t + 1 + mod(pc - satb.t - 1, 12);
      if (m > top) m -= 12;
      if (m > satb.b && m <= top && !notes.includes(m)) { notes.push(m); have.add(pc); }
    });
    return notes.sort((x, y) => x - y);
  }

  // Every ending pc, stacked up from the root between 55 and 72, then rolled low to high
  function endingBloom(idx, keyPc) {
    const ch = endingChord(idx, keyPc);
    const r0 = 55 + mod(ch.root - 55, 12);
    return Array.from(new Set(ch.ivs.map(i => (r0 + i > 72 ? r0 + i - 12 : r0 + i)))).sort((x, y) => x - y);
  }

  /* ── Beat events: the whole piece as 64 beats ─────────────────
     { i 0–63, bar 1–16, beatInBar 1–4, half 0–31, halfStart, melodyOn,
       melodyAnd (MIDI or null = held), melodyNow (the tune note sounding
       on the beat), chord, satb {a,t,b}, melMin, stab (the keys' block
       chord), arp {on, and}, swing (the off-beat's place in the beat),
       timp (MIDI on bar downbeats or null) }                            */
  const evCache = new Map();
  function beatEvents(style, keyPc, ending) {
    style = clamp(Math.round(style) || 0, 0, 2); keyPc = mod(Math.round(keyPc) || 0, 12);
    ending = clamp(Math.round(ending) || 0, 0, 2);
    const ck = style + ':' + keyPc + ':' + ending;
    if (evCache.has(ck)) return evCache.get(ck);
    const notes = melodyNotes(keyPc);
    const plan = chordPlan(style, keyPc);
    plan[HALVES - 1] = Object.assign(endingChord(ending, keyPc), { degree: 'end' });
    const halves = [];
    let prev = null;
    for (let h = 0; h < HALVES; h++) {
      const mel = halfMelody(notes, h);
      const satb = voiceHalf(plan[h], mel.min, prev, h === HALVES - 1 ? ENDINGS[ending].colour : null, mel.pcs);
      const half = { chord: plan[h], satb, mel };
      half.arp = arpNotes(half);
      half.stab = stabNotes(half);
      halves.push(half);
      prev = satb;
    }
    const onAt = e => { const n = notes.find(x => x.start === e); return n ? n.midi : null; };
    const events = [];
    for (let i = 0; i < BEATS; i++) {
      const h = i >> 1, half = halves[h], second = i % 2 === 1, beatInBar = (i % 4) + 1;
      const [n0, n1, n2] = half.arp;
      events.push(Object.freeze({
        i, bar: (i >> 2) + 1, beatInBar, half: h, halfStart: !second,
        melodyOn: onAt(2 * i), melodyAnd: onAt(2 * i + 1), melodyNow: soundingAt(notes, 2 * i).midi,
        chord: half.chord, satb: half.satb, melMin: half.mel.min, stab: half.stab,
        arp: second ? { on: n2, and: n1 } : { on: n0, and: n1 },
        swing: style === 1 ? 2 / 3 : 1 / 2,
        timp: beatInBar === 1 && style !== 2 ? 38 + mod(half.chord.root - 38, 12) : null,
      }));
    }
    Object.freeze(events);
    evCache.set(ck, events);
    return events;
  }

  /* ── One-shots: everything a beat plays besides the choir ──────
     As data, so the budget is testable: 4 held choir voices plus at most
     MAX_HITS one-shots per beat (the keys are outside the kit's voice cap).
     { role bass·timp·bell·arp·stab·pick·lull·bloom, midi, off (beats after
       the tap), roll (extra seconds), gate 'beat' = cut by an early next
       tap | 'run' = rings on }. secs: [low end, choir, keys, bells] in.   */
  const MAX_HITS = 6, BLOOM_BEAT = 62;
  function beatHits(style, keyPc, ending, i, secs, band) {
    style = clamp(Math.round(style) || 0, 0, 2);
    const evs = beatEvents(style, keyPc, ending), ev = evs[i];
    if (!ev) return [];
    secs = secs || [];
    const hit = (role, midi, off = 0, gate = 'run') => ({ role, midi, off, roll: 0, gate });
    const hits = [];
    if (ev.halfStart && secs[0]) {
      hits.push(hit('bass', ev.satb.b));
      if (ev.timp != null && band >= 4) hits.push(hit('timp', ev.timp));
    }
    if (secs[3] && ev.melodyOn != null) hits.push(hit('bell', ev.melodyOn + 12));
    if (secs[3] && ev.melodyAnd != null) hits.push(hit('bell', ev.melodyAnd + 12, ev.swing, 'beat'));
    let keys = [];
    if (i === BLOOM_BEAT) {
      // The ending's bloom replaces the keys pattern, and sounds even with the keys out
      keys = endingBloom(ending, keyPc).map(m => hit('bloom', m));
    } else if (secs[2]) {
      if (style === 0) keys = [hit('arp', ev.arp.on), hit('arp', ev.arp.and, ev.swing, 'beat')];
      else if (style === 1) {
        if (ev.beatInBar % 2 === 0) keys = ev.stab.map(m => hit('stab', m)).concat(hit('pick', ev.arp.and, ev.swing, 'beat'));
      } else if (ev.halfStart) keys = [ev.arp.on, ev.arp.and, evs[i + 1].arp.on].map(m => hit('lull', m));
    }
    // Over budget: the Gospel pickup goes first, then keys notes the choir or
    // the tune already sound, lowest first, so every chord tone is still heard
    const room = MAX_HITS - hits.length;
    if (keys.length > room) keys = keys.filter(h => h.role !== 'pick');
    const sung = new Set([ev.satb.a, ev.satb.t, ev.satb.b, ev.melodyNow, ev.melodyOn, ev.melodyAnd]
      .filter(m => m != null).map(m => mod(m, 12)));
    while (keys.length > room) {
      const j = keys.findIndex(h => sung.has(mod(h.midi, 12)));
      keys.splice(Math.max(0, j), 1);
    }
    keys.filter(h => h.role === 'bloom').forEach((h, n) => { h.roll = 0.06 * n; });
    return hits.concat(keys);
  }

  /* ── Tempo follower ───────────────────────────────────────────────
     A long gap is a fermata and leaves the tempo alone. Two long gaps in a
     row that agree (±25%) and are still a playable tempo mean you have
     settled slower: the second one adopts that tempo (retempo: true), so a
     player who starts fast and calms down is followed, not "waited for".
     tap(t, held): held = the beat before this gap was held (or the take was
     paused there), so the gap was meant and is never a new tempo.       */
  const MIN_GAP = 0.12, FIRST_BPM = 72, FERMATA_K = 1.8, BPM_LO = 48, BPM_HI = 168;
  const RETEMPO_MAX = 1.1 * 60 / BPM_LO, RETEMPO_TOL = 0.25;
  function makeTempoFollower() {
    let last = null, gaps = [], bpm = FIRST_BPM, longGap = null;
    const res = (accepted, fermata, retempo) => ({ accepted, fermata, retempo: !!retempo, bpm, beatDur: 60 / bpm });
    const f = {
      get bpm() { return bpm; },
      get beatDur() { return 60 / bpm; },
      // A long gap that the next one may confirm as the new tempo, or null
      get longGap() { return longGap; },
      reset() { last = null; gaps = []; bpm = FIRST_BPM; longGap = null; },
      tap(t, held) {
        if (!Number.isFinite(t)) return res(false, false);
        if (last == null) { last = t; bpm = FIRST_BPM; return res(true, false); }
        const gap = t - last;
        if (gap < MIN_GAP - 1e-9) return res(false, false);
        last = t;
        if (gap > FERMATA_K * 60 / bpm) {
          const prev = longGap;
          longGap = held || gap > RETEMPO_MAX ? null : gap;
          if (prev == null || longGap == null || Math.abs(gap - prev) > RETEMPO_TOL * prev) return res(true, true);
          longGap = null;
          gaps = [prev, gap];
          bpm = clamp(60 / kit().median(gaps), BPM_LO, BPM_HI);
          return res(true, false, true);
        }
        longGap = null;
        gaps.push(gap);
        if (gaps.length > 3) gaps = gaps.slice(-3);
        bpm = clamp(60 / kit().median(gaps), BPM_LO, BPM_HI);
        return res(true, false);
      },
    };
    return f;
  }

  /* ── Pad mappings (integer, clamped, monotonic; bad input → the default) ── */
  const bad = (v, size) => typeof v !== 'number' || Number.isNaN(v) || !(size > 0) || size === Infinity;
  function bandFromY(y, h) {
    if (bad(y, h)) return 3;
    return clamp(Math.floor((1 - y / h) * 6), 0, 5);
  }
  function laneFromX(x, w) {
    if (bad(x, w)) return 1;
    return clamp(Math.floor((x / w) * 4), 0, 3);
  }
  function endingFromX(x, w) {
    if (bad(x, w)) return 1;
    return clamp(Math.floor((x / w) * 3), 0, 2);
  }
  function tempoWord(bpm) {
    const b = Math.round(bpm);
    return b < 60 ? 'Largo' : b < 76 ? 'Adagio' : b < 108 ? 'Andante' : b < 132 ? 'Allegro' : 'Presto';
  }

  /* ── Takes ────────────────────────────────────────────────────
     { v: 1, style 0–2, mode 0 you | 1 auto, ending 0–2,
       beats: [{ dt ms since the previous beat (0 first), band 0–5, lane 0–3, hold 0|1 }] } */
  const MAX_DT10 = 4095;
  /* A take's gaps in seconds, as the UI records them: 120 ms to 8 s. A share link
     is untrusted and the auto-beat format allows any dt, so everything that
     replays or reviews a take reads its gaps through here.                    */
  const MIN_DT = 120, MAX_DT = 8000;
  const gapOf = (b, i) => (i === 0 ? 0 : clamp(Number.isFinite(+b.dt) ? +b.dt : 0, MIN_DT, MAX_DT) / 1000);
  // From bar 16 on, the pad's lanes pick the ending: taps there cue no sections
  const ENDING_FROM = 60;

  /* When each beat of a take falls (t, seconds from the first) and the beat length
     the band assumed there: the follower's guess for a take you conducted (so an
     early tap still cuts the off-beat on replay), the clock's step for auto-beat.
     Either way it stays inside the follower's 48–168 BPM.                     */
  function replayTimes(take) {
    const beats = (take && take.beats) || [];
    const out = [];
    let t = 0;
    const f = makeTempoFollower();
    for (let i = 0; i < beats.length; i++) {
      t += gapOf(beats[i], i);
      const r = f.tap(t, i > 0 && !!beats[i - 1].hold);
      let beatDur = r.beatDur;
      if (take.mode === 1) {
        const next = beats[i + 1];
        beatDur = clamp(next ? gapOf(next, i + 1) : beatDur, 60 / BPM_HI, 60 / BPM_LO);
        if (!next && i > 0) beatDur = out[i - 1].beatDur;
      }
      out.push({ t, beatDur, fermata: r.fermata, retempo: r.retempo });
    }
    return out;
  }

  function reviewTake(take) {
    const beats = (take && take.beats) || [];
    const times = replayTimes(take);
    // A long gap is a fermata unless the next gap showed it was the new tempo
    const ferm = times.map((x, i) => x.fermata && !(times[i + 1] && times[i + 1].retempo));
    const all = [], steady = [], fermataBeats = new Set();
    for (let i = 1; i < beats.length; i++) {
      const g = gapOf(beats[i], i);
      if (ferm[i]) { fermataBeats.add(i - 1); continue; }   // the beat before the long gap was held
      all.push(g);
      if (i > 1) steady.push(g);
    }
    beats.forEach((b, i) => { if (b.hold) fermataBeats.add(i); });
    const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;
    // Clamped like the follower, so the card agrees with the footer
    const avgBpm = all.length ? clamp(Math.round(60 / mean(all)), BPM_LO, BPM_HI) : null;
    let steadiness = null;
    if (steady.length >= 4) {
      const m = mean(steady), sd = Math.sqrt(mean(steady.map(x => (x - m) * (x - m))));
      steadiness = clamp(Math.round(100 - (sd / m) * 250), 0, 100);
    }
    const bands = beats.map(b => clamp(b.band | 0, 0, 5));
    const lo = bands.length ? Math.min(...bands) : 3, hi = bands.length ? Math.max(...bands) : 3;
    // Range in bands between the softest and loudest beat: pp → ff is 5
    const dynRange = hi - lo;
    const secs = new Set([1]);
    beats.forEach((b, i) => { if (i < ENDING_FROM) secs.add(clamp(b.lane | 0, 0, 3)); });
    const fermatas = fermataBeats.size;
    let name;
    if (avgBpm != null && avgBpm < 66) name = 'Cathedral';
    else if (avgBpm != null && avgBpm > 132) name = 'Caffeine';
    else if (steadiness != null && steadiness < 45) name = 'Heart-rate monitor';
    else if (fermatas >= 3) name = 'Dramatic pauses';
    else if (dynRange >= 4) name = 'Rollercoaster';
    else if (steadiness != null && steadiness >= 88) name = 'Swiss watch';
    else name = 'Sunday best';
    return { avgBpm, steadiness, dynRange, dynLo: lo, dynHi: hi, fermatas, sectionsIn: secs.size, sections: Array.from(secs).sort(), beats: beats.length, name };
  }

  function statsLine(review, take, keyPc = MELODY_TONIC) {
    const parts = [];
    if (review.avgBpm != null) parts.push('Average ' + review.avgBpm + ' BPM');
    if (review.steadiness != null) parts.push('steadiness ' + review.steadiness + '%');
    parts.push(review.fermatas + (review.fermatas === 1 ? ' fermata' : ' fermatas'));
    parts.push(review.dynLo === review.dynHi ? DYN_SHORT[review.dynLo] + ' throughout' : DYN_SHORT[review.dynLo] + ' to ' + DYN_SHORT[review.dynHi]);
    parts.push(review.sectionsIn + (review.sectionsIn === 1 ? ' section in' : ' sections in'));
    if (review.beats >= BEATS - 1) {
      const e = clamp(take.ending | 0, 0, 2);
      parts.push('ending: ' + ENDINGS[e].name + ' (' + endingChord(e, keyPc).name + ')');
    } else parts.push('stopped in bar ' + (((review.beats - 1) >> 2) + 1));
    return parts.join(' · ');
  }

  /* For display: a ' · ' list that only wraps after a dot. Spaces inside an item
     become no-break spaces ('pp to ff', '4 sections in' stay whole), and so does
     the one before each dot, so a line never starts with '·'. */
  function noWrapItems(line) {
    return String(line == null ? '' : line).split(' · ').map(p => p.replace(/ /g, ' ')).join(' · ');
  }

  /* Score ribbon: 16 bars × 40 wide; a beat's width is its share of the bar's
     time, so rubato shows. Unplayed beats use predictedDur and band 3.      */
  function ribbonLayout(take, predictedDur) {
    const beats = (take && take.beats) || [];
    const pd = predictedDur > 0 && predictedDur < Infinity ? predictedDur : 60 / FIRST_BPM;
    const rects = [];
    for (let bar = 0; bar < 16; bar++) {
      const ds = [];
      for (let j = 0; j < 4; j++) {
        const i = bar * 4 + j, next = beats[i + 1];
        ds.push(i < beats.length && next ? gapOf(next, i + 1) : pd);
      }
      const sum = ds.reduce((s, d) => s + d, 0);
      let x = bar * 40;
      for (let j = 0; j < 4; j++) {
        const i = bar * 4 + j, b = beats[i], played = i < beats.length;
        const w = j === 3 ? bar * 40 + 40 - x : 40 * ds[j] / sum;
        const band = played ? clamp(b.band | 0, 0, 5) : 3;
        const h = 10 + 9 * band;
        rects.push({ i, x, w, y: 64 - h, h, band, lane: played ? clamp(b.lane | 0, 0, 3) : 1, played, hold: played ? !!b.hold : false });
        x += w;
      }
    }
    return rects;
  }

  function deadpanTake(style = 0) {
    const beats = [];
    for (let i = 0; i < BEATS; i++) beats.push({ dt: i ? 625 : 0, band: 3, lane: 1, hold: 0 });
    return { v: 1, style: clamp(style | 0, 0, 2), mode: 1, ending: 0, beats };
  }

  /* ── Share codec: '1.' + base64url(bytes) ─────────────────────
     [0] style | mode << 2 | ending << 3 · [1] n · then n × 24-bit words:
     dt10 (12) | band (3) | lane (2) | hold (1) | 6 zero bits          */
  function encodeTake(take) {
    if (!take || !Array.isArray(take.beats) || !take.beats.length) return null;
    const style = clamp(take.style | 0, 0, 2), mode = take.mode ? 1 : 0, ending = clamp(take.ending | 0, 0, 2);
    const beats = take.beats.slice(0, BEATS);
    const bytes = [style | (mode << 2) | (ending << 3), beats.length];
    beats.forEach((b, i) => {
      const dt10 = i === 0 ? 0 : clamp(Math.round((+b.dt || 0) / 10), mode === 0 ? 12 : 0, MAX_DT10);
      const w = (dt10 << 12) | (clamp(b.band | 0, 0, 5) << 9) | (clamp(b.lane | 0, 0, 3) << 7) | ((b.hold ? 1 : 0) << 6);
      bytes.push((w >>> 16) & 255, (w >>> 8) & 255, w & 255);
    });
    return '1.' + kit().b64uEncode(bytes);
  }
  function decodeTake(str) {
    try {
      if (typeof str !== 'string' || str.slice(0, 2) !== '1.') return null;
      const bytes = kit().b64uDecode(str.slice(2), 2 + 3 * BEATS);
      if (!bytes || bytes.length < 2) return null;
      const head = bytes[0], n = bytes[1];
      if (head & 0xE0 || n < 1 || n > BEATS || bytes.length !== 2 + 3 * n) return null;
      const style = head & 3, mode = (head >> 2) & 1, ending = (head >> 3) & 3;
      if (style > 2 || ending > 2) return null;
      const beats = [];
      for (let i = 0; i < n; i++) {
        const w = (bytes[2 + 3 * i] << 16) | (bytes[3 + 3 * i] << 8) | bytes[4 + 3 * i];
        const dt10 = w >>> 12, band = (w >> 9) & 7, lane = (w >> 7) & 3, hold = (w >> 6) & 1;
        if (w & 63 || band > 5) return null;
        if (i === 0 ? dt10 !== 0 : mode === 0 && dt10 < 12) return null;
        beats.push({ dt: dt10 * 10, band, lane, hold });
      }
      return { v: 1, style, mode, ending, beats };
    } catch (e) { return null; }
  }

  const api = {
    MELODY, PLAN_HYMN, STYLES, ENDINGS, SECTIONS, RANGES, DYN_SHORT, DYN_WORDS, BEATS,
    MAX_HITS, BLOOM_BEAT, ENDING_FROM, MIN_DT, MAX_DT, BPM_LO, BPM_HI,
    keyShift, melodyNotes, allowedOver, chordPlan, endingChord, voiceHalf, arpNotes, stabNotes, beatEvents, endingBloom, beatHits,
    makeTempoFollower, bandFromY, laneFromX, endingFromX, tempoWord,
    reviewTake, statsLine, noWrapItems, ribbonLayout, deadpanTake, replayTimes, encodeTake, decodeTake,
  };
  (global.LabCores = global.LabCores || {}).downbeat = api;
})(window);

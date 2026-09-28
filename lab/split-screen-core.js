/* ════════════════════════════════════════════════════════════════════
   SPLIT SCREEN — core of experiment 05. No audio, no DOM.
   Six squares loop over a shared 2-bar grid. Notes are stored as pad
   numbers relative to the chord, so a new Room or Key re-plays every
   part in the new harmony with the rhythm untouched.
   Tests: node tests/split-screen.test.js
   Exposes window.LabCores['split-screen'].
   ════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const H = global.Harmony;
  const K = global.LabCores && global.LabCores.kit;
  // Missing engine: stay unregistered, so the game shows its "couldn't load" message
  if (!H || !K) return;

  const mod12 = H.mod12;
  const STEPS = 16, NOTE_CAP = 24, STEPS_PER_CHORD = 4, PADS = 8;
  const MAX_BYTES = 9 + 2 * 6 * NOTE_CAP;          // 297

  const deepFreeze = o => {
    Object.values(o).forEach(v => { if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v); });
    return Object.freeze(o);
  };

  const ROLES = deepFreeze([
    { id: 'bass',    label: 'Bass',    lo: 28, hi: 51 },
    { id: 'keys',    label: 'Keys',    lo: 50, hi: 88 },
    { id: 'mallets', label: 'Mallets', lo: 67, hi: 88 },
    { id: 'voice',   label: 'Voice',   lo: 60, hi: 81 },
    { id: 'ooh',     label: 'Ooh',     lo: 50, hi: 71 },
    { id: 'beat',    label: 'Beat' },
  ]);

  /* Roots are semitones above the key; intervals sit above the chord root.
     Mirror is never typed in: it is Sunny reflected through the negative-harmony axis. */
  const ROOMS = deepFreeze([
    { id: 'sunny',      label: 'Sunny',      scale: H.SCALES.major,
      chords: [[0, [0, 4, 7]], [7, [0, 4, 7]], [9, [0, 3, 7]], [5, [0, 4, 7]]] },
    { id: 'late-night', label: 'Late night', scale: H.SCALES.major,
      chords: [[2, [0, 3, 7, 10, 14]], [7, [0, 4, 7, 10, 14, 21]], [0, [0, 4, 7, 11, 14]], [9, [0, 3, 7, 10, 14]]] },
    { id: 'floaty',     label: 'Floaty',     scale: H.SCALES.lydian,
      chords: [[0, [0, 4, 6, 7, 11]], [2, [0, 4, 7]], [11, [0, 3, 7, 10]], [4, [0, 3, 7, 10]]] },
    { id: 'mirror',     label: 'Mirror',     scale: H.SCALES.minor, mirrorOf: 0 },
  ]);

  const TEMPOS = Object.freeze([84, 96, 112]);
  const KIT = deepFreeze([['kick'], ['tom', 45], ['tom', 52], ['rim'], ['snap'], ['clap'], ['shaker'], ['hat']]);
  const KIT_NAMES = Object.freeze(['kick', 'low tom', 'high tom', 'rim', 'snap', 'clap', 'shaker', 'hat']);

  /* ── spelling ────────────────────────────────────────────────────
     H.pcName has one fixed table (C D♭ D E♭ E F F♯ G A♭ A B♭ B). Every note a
     square plays and every chord root is in its room's scale, so each room and
     key gets its own table: one letter per scale degree (C♯ in D, C♭ in E♭
     minor, E♯ in F♯). The tonic is spelled like the key menu unless its twin
     needs fewer accidentals: Mirror in D♭ and A♭ reads as C♯ and G♯ minor,
     Floaty in F♯ as G♭ Lydian. The key readout keeps the menu's name.       */
  const LETTERS = 'CDEFGAB', LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
  const SHARP_NAMES = Object.freeze(['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']);
  const FLAT_NAMES = Object.freeze(['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B']);
  const accOf = name => (name[1] === '♯' ? 1 : name[1] === '♭' ? -1 : 0);
  const pcOfName = name => mod12(LETTER_PC[LETTERS.indexOf(name[0])] + accOf(name));
  const spellCache = new Map();

  // The 12 note names for a room and key, indexed by pitch class
  function spelling(roomIdx, keyPc) {
    const r = K.clamp(Math.floor(+roomIdx) || 0, 0, ROOMS.length - 1);
    const key = mod12(Math.floor(+keyPc) || 0);
    const ck = r * 12 + key;
    if (spellCache.has(ck)) return spellCache.get(ck);
    const scale = ROOMS[r].scale.map(s => mod12(s + key));
    let best = null;
    [SHARP_NAMES[key], FLAT_NAMES[key]].forEach(tonic => {
      const t = LETTERS.indexOf(tonic[0]);
      const accs = scale.map((pc, d) => mod12(pc - LETTER_PC[(t + d) % 7] + 6) - 6);
      if (accs.some(a => Math.abs(a) > 1)) return;          // no double sharps or flats
      const cost = accs.reduce((s, a) => s + Math.abs(a), 0);
      if (!best || cost < best.cost || (cost === best.cost && tonic === H.PC_NAMES[key])) best = { t, accs, cost };
    });
    // Notes outside the scale (none are played today) follow the key's side
    const lean = best ? Math.sign(best.accs.reduce((s, a) => s + a, 0)) : 0;
    const names = (lean > 0 ? SHARP_NAMES : lean < 0 ? FLAT_NAMES : H.PC_NAMES).slice();
    if (best) scale.forEach((pc, d) => { names[pc] = LETTERS[(best.t + d) % 7] + ['♭', '', '♯'][best.accs[d] + 1]; });
    const out = Object.freeze(names);
    spellCache.set(ck, out);
    return out;
  }
  // 'C♯4'. The octave goes with the letter: C♭4 sounds as B3, B♯3 as C4.
  function spellMidi(m, names) {
    m = Math.round(+m) || 0;
    const name = names[mod12(m)];
    return name + (Math.floor((m - accOf(name)) / 12) - 1);
  }
  // Re-spell every note name in a name H.nameChord built from its fixed table
  const respell = (name, names) => name.replace(/[A-G][♭♯]?/g, t => names[pcOfName(t)]);

  /* ── chords ──────────────────────────────────────────────────── */
  const uniq = arr => arr.filter((x, i) => arr.indexOf(x) === i);
  const chordCache = new Map();

  function roomChords(roomIdx, keyPc) {
    const r = K.clamp(Math.floor(+roomIdx) || 0, 0, ROOMS.length - 1);
    const key = mod12(Math.floor(+keyPc) || 0);
    const ck = r * 12 + key;
    if (chordCache.has(ck)) return chordCache.get(ck);
    const room = ROOMS[r];
    const scalePcs = room.scale.map(s => mod12(s + key));
    const names = spelling(r, key);
    let out;
    if (room.mirrorOf != null) {
      out = roomChords(room.mirrorOf, key).map(src => {
        const pcs = uniq(H.negativeSet(src.pcs, key));
        const nm = H.nameChord(pcs, { free: true });
        const ivs = pcs.map(p => mod12(p - nm.root)).sort((a, b) => a - b);
        return { rootPc: nm.root, pcs, ivs, scalePcs, name: respell(nm.name, names), colour: nm.colour };
      });
    } else {
      out = room.chords.map(([root, ivs]) => {
        const rootPc = mod12(key + root);
        const nm = H.nameChord(ivs.map(i => 48 + rootPc + i), { bass: rootPc });
        return { rootPc, pcs: uniq(ivs.map(i => mod12(rootPc + i))), ivs: ivs.slice(), scalePcs, name: respell(nm.name, names), colour: nm.colour };
      });
    }
    out = deepFreeze(out);
    chordCache.set(ck, out);
    return out;
  }

  function chordIndexAt(loopStep) {
    return Math.floor(K.mod(Math.floor(+loopStep) || 0, STEPS) / STEPS_PER_CHORD);
  }

  // The room scale minus the classic avoid notes: a semitone above a chord tone
  function safePool(chord) {
    return chord.scalePcs.filter(p => chord.pcs.includes(p) || !chord.pcs.includes(mod12(p - 1)));
  }

  // The first n MIDI notes >= from whose pitch class is in pool
  function ladder(pool, from, n) {
    const out = [];
    if (!pool.length) return out;
    for (let m = from; out.length < n; m++) if (pool.includes(mod12(m))) out.push(m);
    return out;
  }
  function firstChordTone(chord, lo) {
    let m = lo;
    while (!chord.pcs.includes(mod12(m))) m++;
    return m;
  }

  /* Keys: the colour-carrying chord tones first (3rd, 7th/6th, one extension),
     then the 5th unless a ♯11 is there, then the root; at most four. */
  function keysPcs(chord) {
    const has = new Set(chord.ivs.map(mod12));
    const out = [];
    const take = list => { const i = list.find(x => has.has(x) && !out.includes(x)); if (i != null) out.push(i); };
    take([4, 3]);
    take([10, 11, 9]);
    take([9, 2, 6, 5]);
    if (!has.has(6)) take([7]);
    take([0]);
    return out.slice(0, 4).map(i => mod12(chord.rootPc + i));
  }

  /* Close position under the top. A note that would land within 9 semitones of
     Bass pad 4 is left out so the low end never muddies. Across the whole domain
     that only drops the root of Floaty's I chord in E♭, which the bass holds anyway. */
  function buildVoicing(chord, pad, kp, tops, pool, floor) {
    const top = tops[(pad - 1) % 4];
    const notes = [top];
    kp.forEach(p => {
      const m = top - mod12(top - p);
      if (p !== mod12(top) && m >= floor) notes.push(m);
    });
    notes.sort((a, b) => a - b);
    if (pad > 4) {
      let spark = null;
      for (let m = top + 2; m <= top + 7 && spark == null; m++) {
        if (pool.includes(mod12(m)) && !chord.pcs.includes(mod12(m))) spark = m;
      }
      notes.push(spark == null ? top + 12 : spark);
    }
    return notes;
  }

  // Every pad of every role for one chord, computed once per chord object
  const padCache = new WeakMap();
  function padTable(chord) {
    let t = padCache.get(chord);
    if (t) return t;
    const pool = safePool(chord);
    const kp = keysPcs(chord);
    const tops = ladder(kp, 62, 4);
    const line = lo => ladder(pool, firstChordTone(chord, lo), PADS);
    const bass = ladder(chord.scalePcs, 28 + K.mod(chord.rootPc - 28, 12), PADS);
    const keys = [];
    for (let p = 1; p <= PADS; p++) keys.push(buildVoicing(chord, p, kp, tops, pool, bass[3] + 9));
    t = deepFreeze({
      bass,
      keys,
      mallets: line(67),
      voice: line(60),
      ooh: line(50),
    });
    padCache.set(chord, t);
    return t;
  }
  const validPad = pad => Number.isInteger(pad) && pad >= 1 && pad <= PADS;

  function keysVoicing(pad, chord) {
    return validPad(pad) ? padTable(chord).keys[pad - 1].slice() : [];
  }

  // The pad's pitch; for Keys, the top of its voicing. Null for the Beat and bad input.
  function padMidi(roleId, pad, chord) {
    if (!validPad(pad) || roleId === 'beat') return null;
    const t = padTable(chord);
    if (roleId === 'keys') { const v = t.keys[pad - 1]; return v[v.length - 1]; }
    return t[roleId] ? t[roleId][pad - 1] : null;
  }

  function padIsColour(roleId, pad, chord) {
    if (roleId === 'beat' || !validPad(pad)) return false;
    if (roleId === 'keys') return pad > 4;
    const m = padMidi(roleId, pad, chord);
    return m != null && !chord.pcs.includes(mod12(m));
  }

  /* ── recording ───────────────────────────────────────────────── */
  function quantizeTap(tl, tapTime) { return K.quantizeAt(tl, tapTime, STEPS); }

  const copyNote = n => {
    const c = { step: n.step, pad: n.pad, len: n.len, vel: n.vel };
    if (n.skipLap != null) c.skipLap = n.skipLap;
    return c;
  };

  // Immutable: returns a new tile when the note is stored. The same (step, pad) merges.
  function addNote(tile, note, cap = NOTE_CAP) {
    const i = tile.findIndex(n => n.step === note.step && n.pad === note.pad);
    if (i >= 0) {
      const old = tile[i];
      const merged = { step: old.step, pad: old.pad, len: Math.max(old.len, note.len), vel: Math.max(old.vel, note.vel) };
      const skip = note.skipLap != null ? note.skipLap : old.skipLap;
      if (skip != null) merged.skipLap = skip;
      const out = tile.slice();
      out[i] = merged;
      return { tile: out, stored: true };
    }
    if (tile.length >= cap) return { tile, stored: false };
    return { tile: tile.concat([copyNote(note)]), stored: true };
  }

  function noteLen(pressT, releaseT, stepDur) {
    const steps = (releaseT - pressT) / stepDur;
    return Number.isFinite(steps) ? K.clamp(Math.round(steps), 1, 8) : 1;
  }

  /* ── state ───────────────────────────────────────────────────── */
  function starterJam() {
    const bass = [], beat = [];
    for (let c = 0; c < 4; c++) {
      bass.push({ step: 4 * c, pad: 1, len: 2, vel: 3 });
      bass.push({ step: 4 * c + 3, pad: 5, len: 1, vel: 2 });
    }
    for (let s = 0; s < STEPS; s++) {
      if (s === 0 || s === 8) beat.push({ step: s, pad: 1, len: 1, vel: 2 });
      if (s % 4 === 2) beat.push({ step: s, pad: 5, len: 1, vel: 2 });
      beat.push({ step: s, pad: 7, len: 1, vel: 1 });
    }
    return { v: 1, room: 0, key: 3, tempo: 1, mute: 0, sel: 2, tiles: [bass, [], [], [], [], beat] };
  }

  const filledCount = state => state.tiles.filter(t => t.length > 0).length;
  const isFullBand = state => filledCount(state) === ROLES.length && (state.mute & 63) === 0;
  // Every filled square gets a solo lap, muted or not; mutes come back for the final lap
  const rollCallOrder = state => state.tiles.map((t, i) => (t.length ? i : -1)).filter(i => i >= 0);

  /* ── share format ────────────────────────────────────────────────
     '1.' + base64url of: [room | tempo<<2] [key] [mute] [6 counts]
     then 2 bytes per note, big-endian: step(4) pad−1(3) len−1(3) vel(2) 0000 */
  function encode(state) {
    const tiles = state.tiles.map(t => t.slice(0, NOTE_CAP));
    const bytes = [(state.room & 3) | ((state.tempo & 3) << 2), state.key & 15, state.mute & 63];
    tiles.forEach(t => bytes.push(t.length));
    tiles.forEach(t => t.forEach(n => {
      const v = ((n.step & 15) << 12) | (((n.pad - 1) & 7) << 9) | (((n.len - 1) & 7) << 6) | ((n.vel & 3) << 4);
      bytes.push(v >> 8, v & 255);
    }));
    return '1.' + K.b64uEncode(bytes);
  }

  // Share links are untrusted: anything off-spec gives null, never a throw
  function decode(str) {
    if (typeof str !== 'string' || str.slice(0, 2) !== '1.') return null;
    const b = K.b64uDecode(str.slice(2), MAX_BYTES);
    if (!b || b.length < 9) return null;
    if (b[0] & 0xF0) return null;
    const room = b[0] & 3, tempo = (b[0] >> 2) & 3, key = b[1], mute = b[2];
    if (tempo > 2 || key > 11 || (mute & 0xC0)) return null;
    const counts = Array.from(b.slice(3, 9));
    if (counts.some(c => c > NOTE_CAP)) return null;
    if (b.length !== 9 + 2 * counts.reduce((s, c) => s + c, 0)) return null;
    const tiles = [];
    let p = 9;
    for (const count of counts) {
      let tile = [];
      for (let k = 0; k < count; k++, p += 2) {
        const v = (b[p] << 8) | b[p + 1];
        const vel = (v >> 4) & 3;
        if ((v & 15) || vel === 0) return null;
        tile = addNote(tile, { step: v >> 12, pad: ((v >> 9) & 7) + 1, len: ((v >> 6) & 7) + 1, vel }, Infinity).tile;
      }
      tiles.push(tile);
    }
    // The selected square is not shared: land on Mallets if it is free, else the first free square
    const free = tiles.findIndex(t => !t.length);
    const sel = !tiles[2].length ? 2 : free >= 0 ? free : 0;
    return { v: 1, room, key, tempo, mute, sel, tiles };
  }

  (global.LabCores = global.LabCores || {})['split-screen'] = {
    ROLES, ROOMS, TEMPOS, KIT, KIT_NAMES, STEPS, NOTE_CAP, STEPS_PER_CHORD,
    spelling, spellMidi, roomChords, chordIndexAt, safePool, ladder, firstChordTone, keysPcs,
    padMidi, keysVoicing, padIsColour, quantizeTap, addNote, noteLen,
    starterJam, filledCount, isFullBand, rollCallOrder, encode, decode,
  };
})(window);

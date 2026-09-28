/* ════════════════════════════════════════════════════════════════════
   05 — SPLIT SCREEN
   A six-square looper over one shared 2-bar loop. Pick a square, tap its
   pads and the part loops back at you. Every square is always scheduled;
   mutes and solos are only bus-gain ramps, so nothing clicks.
   Music rules, state and the share format: lab/split-screen-core.js.
   ════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';

const section = document.getElementById('split');
if (!section) return;
const Lab = window.Lab, UI = window.LabUI, CORES = window.LabCores;
if (!Lab || !UI || !CORES || !CORES['split-screen'] || !CORES.kit || !Lab.clock) {
  const stage = section.querySelector('.stage');
  const text = (UI && UI.MSG && UI.MSG.noEngine) || 'This experiment couldn’t load its music engine. Refresh the page to try again.';
  // lab.js already says this in every stage when harmony.js is missing: don't say it twice
  if (stage && !Array.from(stage.querySelectorAll('.inline-msg.on')).some(p => p.textContent === text)) {
    const p = document.createElement('p');
    p.className = 'inline-msg on';
    p.style.margin = '22px';
    p.textContent = text;
    stage.prepend(p);
  }
  return;
}

const C = CORES['split-screen'], K = CORES.kit, H = window.Harmony;
const OWNER = 'split-screen', STORE_KEY = 'jc-lab-split-v1', MIRROR_KEY = 'jc-lab-split-mirror';
const REDUCED = !!UI.REDUCED;
const HAS_AUDIO = !!(window.AudioContext || window.webkitAudioContext);
const TEXT = {
  mirror: 'Mirror is Sunny flipped through the negative-harmony axis from experiment 01. Same rhythm, other side of the glass.',
  full: 'This square is full (24 notes). Undo or clear it to make room.',
  linked: 'Someone left you a jam. Press Play.',
  badLink: 'That link didn’t survive the trip, so here’s the starter jam instead.',
  copied: 'Link copied. Anyone who opens it gets this exact jam.',
  fullBand: 'Full band. Every square is you.',
};
const ROLES = C.ROLES, N = ROLES.length, STEPS = C.STEPS;
// [r, g, b, base alpha] per square
const COLOURS = [[180, 136, 255, 1], [77, 215, 255, 1], [255, 184, 74, 1], [255, 78, 38, 1], [244, 239, 230, 1], [244, 239, 230, 0.55]];
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${+(c[3] * a).toFixed(3)})`;
const BUS = [[0.15, 0.9], [0.3, 0.8], [0.35, 0.8], [0.4, 0.85], [0.55, 0.8], [0.12, 0.9]];   // [send, level]
const PAD_CODES = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'];
const PAD_KEYS = ['a', 's', 'd', 'f', 'j', 'k', 'l', ';'];
const HELD_ROLES = ['bass', 'keys', 'voice', 'ooh'];
const FLASH_MS = 180, UNDO_CAP = 20, HOLD_STEPS = 8;
const MONO = '"JetBrains Mono", ui-monospace, monospace';
const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);
const muted = (mask, i) => ((mask >> i) & 1) === 1;

const $ = id => document.getElementById(id);
const cv = $('ssGrid'), g = cv.getContext('2d');
const wrap = cv.parentElement;
const tilesEl = $('ssTiles'), padsEl = $('ssPads'), hintEl = $('ssHint');
const msgEl = $('ssMsg'), liveEl = $('ssLive');
const playBtn = $('ssPlay'), undoBtn = $('ssUndo'), clearBtn = $('ssClear'), recBtn = $('ssRec');
const rollBtn = $('ssRoll'), copyBtn = $('ssCopy'), resetBtn = $('ssReset');
const keySel = $('ssKey');
const footLabel = $('ssFootLabel'), chordEl = $('ssChord'), colourEl = $('ssColour'), countEl = $('ssCount'), metaEl = $('ssMeta');

/* ── state ─────────────────────────────────────────────────── */
let state = C.starterJam();
let chords = C.roomChords(state.room, state.key);
let heardIdx = 0;                      // the chord the listener is hearing (0 when stopped)
let heardMute = 0;                     // the mute mask the buses are actually at
const pend = new Array(N).fill(null);  // bar (abs step) where a cut lands, while it waits
let running = false, stepDur = 60 / C.TEMPOS[state.tempo] / 2;
let buses = null, liveBuses = null, gates = null, lastBass = null, liveBass = null;
let pass = null;                       // { tile, lap }: the recording pass for undo and the REC tag
let undoStack = [];
let rc = null;                         // roll call { order, startLap, solo, label }
let fullBandDone = false, fb = null;   // fb: { lap, at } while the Full band lap shows
const held = new Map();                // pointer / key id → the live note it holds
const flashAt = new Array(N).fill(-1e9);
const fullWarned = new Array(N).fill(false);
let mode = 'pick', recOn = true, audioDead = !HAS_AUDIO;
let hintOk = true, soundedOnce = false, mirrorHinted = false, visible = false, raf = 0;   // hintOk: opened (or reset) as the starter jam

/* ── messages ──────────────────────────────────────────────── */
function say(text) {
  if (audioDead) return;
  msgEl.classList.add('soft');
  UI.msg(msgEl, text);
}
// The Mirror note only belongs to Mirror: leaving the room takes it away
function dropMirrorNote() {
  if (C.ROOMS[state.room].id !== 'mirror' && msgEl.textContent === TEXT.mirror) say('');
}
function noAudio() {
  audioDead = true;
  msgEl.classList.remove('soft');
  UI.msg(msgEl, UI.MSG.noAudio);
  // A control about to disable itself under the focus would drop it to <body>, out of reach of 1–6, Z, M and Delete
  const a = document.activeElement;
  if (a === playBtn || a === rollBtn || padBtns.includes(a)) tileBtns[state.sel].focus({ preventScroll: true });
  playBtn.disabled = true;
  rollBtn.disabled = true;
  padBtns.forEach(b => { b.disabled = true; });
}
const announce = text => UI.announce(liveEl, text);
// 'Two of you already' is only true of the two starter squares, before anything has sounded
function syncHint() {
  hintEl.classList.toggle('off', !(hintOk && !soundedOnce && C.filledCount(state) === 2));
}
function firstSound() {
  if (!soundedOnce) { soundedOnce = true; syncHint(); UI.soundHint(msgEl); }
}

/* ════════════════════════════════════════════════════════════════════
   AUDIO — one bus per square for the loop (mutes and solos ramp these),
   one never-muted bus per square for live taps, one gate per square per run
   ════════════════════════════════════════════════════════════════════ */
function ensureAudio() {
  const c = Lab.unlock();
  if (!c) return null;
  if (!buses) {
    buses = BUS.map(([send, level], i) => {
      const b = Lab.bus(send, level);
      b.gain.value = muted(heardMute, i) ? 0 : level;
      return b;
    });
    liveBuses = BUS.map(([send, level]) => Lab.bus(send, level));
  }
  return c;
}
function rampBus(i, target, when) {
  if (!buses) return;
  const now = Lab.ctx.currentTime, p = buses[i].gain;
  // Cancel from now, not from `when`: a cut queued for an earlier bar line (before a
  // slower tempo moved the bar) must not land mid-bar. A ramp already under way is kept.
  p.cancelScheduledValues(now);
  p.setTargetAtTime(target, Math.max(when, now), 0.02);
}
const mixTarget = i => (muted(heardMute, i) ? 0 : BUS[i][1]);
// Everything lands now: pending cuts land, solos end (a stop, a new Roll call, Start over, a full undo, a new link)
function settleMix() {
  heardMute = state.mute;
  pend.fill(null);
  if (buses) for (let i = 0; i < N; i++) rampBus(i, mixTarget(i), Lab.ctx.currentTime);
}

/* Keys: the lab.js e-piano (an FM sine pair plus a bell partial) rebuilt with a
   handle per note. Lab.keys returns none, so nothing capped the Keys square, a held
   chord could not stop on release, and its envelope swells back up on notes under
   0.7 s. Oldest-first stealing above KEYS_CAP, like the kit's voice cap. */
const KEYS_CAP = Lab.lowPower ? 12 : 20;          // notes, 3 oscillators each
const keysLive = [];
function epiano(midi, start, dur, vel, dest) {
  const c = Lab.ctx;
  const t = Math.max(start, c.currentTime), f = H.midiToFreq(midi), d = Math.max(0.05, dur);
  const car = c.createOscillator(), mod = c.createOscillator(), bell = c.createOscillator();
  const modG = c.createGain(), bellG = c.createGain(), amp = c.createGain();
  car.frequency.value = f; mod.frequency.value = f; bell.frequency.value = f * 4;
  modG.gain.setValueAtTime(f * 1.5 * vel, t);
  modG.gain.exponentialRampToValueAtTime(f * 0.06 + 0.01, t + 1.1);
  bellG.gain.setValueAtTime(0.045 * vel, t);
  bellG.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  amp.gain.value = 0;                              // silent before t, even when stopped before it starts
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(0.19 * vel, t + 0.008);
  amp.gain.setTargetAtTime(0.035 * vel, t + 0.008, 0.45);   // about Lab.keys' 0.07 at 0.7 s
  amp.gain.setTargetAtTime(0, t + d, 0.16);
  mod.connect(modG); modG.connect(car.frequency);
  car.connect(amp); bell.connect(bellG); bellG.connect(amp);
  amp.connect(dest);
  const oscs = [car, mod, bell];
  let done = false;
  const stopAt = at => oscs.forEach(o => { try { o.stop(at); } catch (e) {} });
  const h = {
    end: t + d + 0.9,                              // 5.6 τ into the release: under 0.4 % of its start
    stop(when) {
      const now = c.currentTime, at = Math.max(when == null ? now : when, now);
      if (done || at >= h.end) return;
      if (amp.gain.cancelAndHoldAtTime) amp.gain.cancelAndHoldAtTime(at);
      else amp.gain.cancelScheduledValues(at);
      amp.gain.setTargetAtTime(0, at, 0.05);
      h.end = Math.min(h.end, at + 0.3);
      stopAt(h.end);
    },
    kill() {
      const now = c.currentTime;
      if (done) return;
      amp.gain.cancelScheduledValues(now);
      amp.gain.setValueAtTime(amp.gain.value, now);
      amp.gain.linearRampToValueAtTime(0, now + 0.012);
      h.end = Math.min(h.end, now + 0.02);
      stopAt(h.end);
    },
  };
  car.onended = () => {
    done = true;
    [amp, modG, bellG].forEach(n => { try { n.disconnect(); } catch (e) {} });
    const k = keysLive.indexOf(h);
    if (k >= 0) keysLive.splice(k, 1);
  };
  oscs.forEach(o => { o.start(t); o.stop(h.end); });
  for (let k = keysLive.length - 1; k >= 0; k--) if (keysLive[k].end <= c.currentTime) keysLive.splice(k, 1);
  keysLive.push(h);
  while (keysLive.length > KEYS_CAP) keysLive.shift().kill();
  return h;
}

function playNote(i, n, chord, when, sd, dest) {
  const role = ROLES[i].id;
  if (role === 'beat') {
    const [kind, midi] = C.KIT[n.pad - 1];
    Lab.perc(kind, when, { vel: 0.35 + 0.2 * n.vel, midi, dest });
    return;
  }
  const m = C.padMidi(role, n.pad, chord);
  if (role === 'bass') {
    const h = Lab.bass(m, when, { dur: n.len * sd * 0.9, vel: n.vel / 3, dest });
    if (lastBass) lastBass.stop(when);
    lastBass = h;
  } else if (role === 'keys') {
    C.keysVoicing(n.pad, chord).forEach(k => epiano(k, when, Math.max(0.3, n.len * sd), 0.5 * n.vel / 3, dest));
  } else if (role === 'mallets') {
    Lab.mallet(m, when, { kind: 'marimba', vel: 0.5 + 0.15 * n.vel, dest });
  } else if (role === 'voice') {
    Lab.vox(m, when, { syl: n.pad <= 4 ? 'doo' : 'bah', dur: Math.max(0.14, n.len * sd * 0.85), dest });
  } else {
    Lab.vox(m, when, { syl: 'oo', dur: n.len * sd, dest });
  }
}

// A tap sounds at once and, for the held roles, keeps going until release
function soundLive(h, chord, t) {
  const c = Lab.ctx, dest = liveBuses[h.tile], hold = HOLD_STEPS * stepDur;
  const m = C.padMidi(h.role, h.pad, chord);
  if (h.role === 'beat') {
    const [kind, midi] = C.KIT[h.pad - 1];
    Lab.perc(kind, t, { vel: 0.75, midi, dest });
  } else if (h.role === 'mallets') {
    Lab.mallet(m, t, { kind: 'marimba', vel: 0.8, dest });
  } else if (h.role === 'bass') {
    if (liveBass) liveBass.stop(c.currentTime);
    liveBass = Lab.bass(m, t, { dur: hold, vel: 2 / 3, dest });
    h.handles.push(liveBass);
  } else if (h.role === 'keys') {
    C.keysVoicing(h.pad, chord).forEach(k => h.handles.push(epiano(k, t, hold, 0.5 * 2 / 3, dest)));
  } else {
    h.handles.push(Lab.vox(m, t, { syl: h.role === 'ooh' ? 'oo' : h.pad <= 4 ? 'doo' : 'bah', dur: hold, dest }));
  }
}


/* ════════════════════════════════════════════════════════════════════
   TRANSPORT — Lab.clock, 16 eighth notes, 4 chords per loop
   ════════════════════════════════════════════════════════════════════ */
function startClock(startAt) {
  stripSkips();
  const bpm = C.TEMPOS[state.tempo];
  const ok = Lab.clock.start(OWNER, { bpm, stepsPerBeat: 2, loopSteps: STEPS, startAt, onStep, onStop });
  if (!ok) { noAudio(); return false; }
  running = true;
  stepDur = 60 / bpm / 2;
  gates = buses.map(b => Lab.gate(b));
  lastBass = null;
  UI.setPlayBtn(playBtn, true, 'Play', 'Stop');
  UI.track('lab_play', { exp: 'split', room: C.ROOMS[state.room].id });
  firstSound();
  wake();
  return true;
}

function onStep(abs, when, info) {
  const ls = info.loopStep, lap = info.lap;
  stepDur = info.stepDur;
  if (ls === 0) lapBoundary(lap, when);
  const ci = C.chordIndexAt(ls), chord = chords[ci];
  let fired = 0, selPads = 0;
  for (let i = 0; i < N; i++) {
    // Muted with nothing about to bring it back: its bus sits at 0, so don't spend voices on it
    if (!rc && pend[i] == null && muted(heardMute, i)) continue;
    for (const n of state.tiles[i]) {
      if (n.step !== ls || n.skipLap === lap) continue;
      playNote(i, n, chord, when, info.stepDur, gates[i]);
      fired |= 1 << i;
      if (i === state.sel) selPads |= 1 << (n.pad - 1);
    }
  }
  const change = ls % C.STEPS_PER_CHORD === 0;
  // Reduced motion has no continuous rAF: the playhead is drawn here, once per step
  if (!fired && !change && !REDUCED) return;
  Lab.clock.visual(when, () => {
    const now = performance.now();
    if (!REDUCED) {
      for (let i = 0; i < N; i++) if (fired & (1 << i) && audible(i)) flashAt[i] = now;
      padBtns.forEach((b, k) => { if (selPads & (1 << k) && audible(state.sel)) hit(b); });
    }
    if (change && ci !== heardIdx) { heardIdx = ci; relabelPads(); updateReadouts(); }
    wake();
  }, OWNER);
}

function lapBoundary(lap, when) {
  let rcStep = null;
  if (rc && lap >= rc.startLap) {
    const k = lap - rc.startLap, n = rc.order.length;
    if (k < n) {
      const solo = rc.order[k];
      for (let i = 0; i < N; i++) rampBus(i, i === solo ? BUS[i][1] : 0, when);
      rcStep = { solo, label: ROLES[solo].label };
    } else if (k === n) {
      for (let i = 0; i < N; i++) rampBus(i, mixTarget(i), when);
      rcStep = { solo: null, label: 'Everyone' };
    } else rcStep = { end: true };
  }
  let fbNow = false;
  if (C.isFullBand(state)) { if (!fullBandDone) fullBandDone = fbNow = true; }
  else fullBandDone = false;
  const myRc = rc;
  Lab.clock.visual(when, () => {
    if (pass && pass.lap < lap) { pass = null; staticDirty = true; }
    if (fb && lap > fb.lap) fb = null;
    if (fbNow) {
      fb = { lap, at: performance.now() };
      announce(TEXT.fullBand);
      if (!rc) rollBtn.classList.add('nudge');
    }
    if (rcStep && rc && rc === myRc) {
      if (rcStep.end) finishRollCall();
      else {
        rc.solo = rcStep.solo;
        rc.label = rcStep.label;
        announce('Roll call: ' + rcStep.label + '.');
      }
    }
    updateReadouts();
    wake();
  }, OWNER);
}

// Any stop: the Stop button, scrolling away, a hidden tab or another game's claim
function onStop(reason) {
  running = false;
  const c = Lab.ctx;
  if (gates) { gates.forEach(gt => Lab.closeGate(gt, c.currentTime)); gates = null; }
  lastBass = null;
  releaseAll();
  keysLive.slice().forEach(k => k.stop(c.currentTime + 0.05));
  pass = null;
  if (rc) finishRollCall();
  fb = null;
  settleMix();
  stripSkips();
  heardIdx = 0;
  UI.setPlayBtn(playBtn, false, 'Play', 'Stop');
  if (reason !== 'user' && reason !== 'ended') say(UI.MSG.paused);
  relabelPads();
  updateReadouts();
  staticDirty = true;
  wake();
}
// Lab.claim's stopFn: the clock may already be gone (a hidden tab stops it first)
function stopAll(reason) {
  if (Lab.clock.isRunning(OWNER)) { Lab.clock.stop(OWNER, reason); return; }
  if (held.size) { releaseAll(); say(UI.MSG.paused); }
}

function stripSkips() {
  state.tiles = state.tiles.map(t => (t.some(n => n.skipLap != null) ? t.map(({ step, pad, len, vel }) => ({ step, pad, len, vel })) : t));
}
function nextBar() {
  const now = Lab.ctx.currentTime;
  const q = Lab.clock.quantize(OWNER, now);
  let bar = Math.max(0, Math.ceil(q.abs / 8) * 8);
  while (Lab.clock.timeOfStep(OWNER, bar) <= now + 0.03) bar += 8;
  return bar;
}
// The cut lands on the bar line: flip the tag when the listener hears it
function commitAt(i, bar) {
  const T = Lab.clock.timeOfStep(OWNER, bar);
  if (T == null) return;
  Lab.clock.visual(T, () => {
    if (pend[i] !== bar) return;
    const T2 = Lab.clock.timeOfStep(OWNER, bar);
    if (T2 != null && Lab.audibleTime() < T2 - 0.005) { commitAt(i, bar); return; }   // the tempo moved it later
    pend[i] = null;
    heardMute = (heardMute & ~(1 << i)) | (state.mute & (1 << i));
    changedMix();
  }, OWNER);
}
function reschedulePending() {
  for (let i = 0; i < N; i++) {
    if (pend[i] == null) continue;
    const T = Lab.clock.timeOfStep(OWNER, pend[i]);
    if (T != null) rampBus(i, muted(state.mute, i) ? 0 : BUS[i][1], T);
  }
}

// The fractional loop position the listener is hearing, or null before the first step
function playPos() {
  const at = Lab.audibleTime();
  const q = Lab.clock.quantize(OWNER, at);
  if (!q) return null;
  let a = q.abs, ta = Lab.clock.timeOfStep(OWNER, a);
  if (at < ta) { a -= 1; ta = Lab.clock.timeOfStep(OWNER, a); }
  const tb = Lab.clock.timeOfStep(OWNER, a + 1);
  const pos = a + (tb > ta ? K.clamp((at - ta) / (tb - ta), 0, 1) : 0);
  return pos >= 0 ? pos : null;
}
function audible(i) {
  if (rc && rc.solo != null) return i === rc.solo;
  return !muted(heardMute, i);
}


/* ════════════════════════════════════════════════════════════════════
   PLAYING THE PADS
   ════════════════════════════════════════════════════════════════════ */
// Any part of the section on screen. Asked directly, because the IntersectionObserver
// only reports changes (and not at all until its first callback).
function inView() {
  const r = section.getBoundingClientRect();
  return r.bottom > 0 && r.top < (window.innerHeight || document.documentElement.clientHeight);
}
/* On a stacked layout #ssMsg sits above the stage. A message that shows up or goes
   away mid-play (the silent-switch hint, 'square full', the paused note) would slide
   the pads out from under the fingers, so the page scrolls by the same amount. */
function steady(fn) {
  const before = padsEl.getBoundingClientRect().top;
  fn();
  const d = padsEl.getBoundingClientRect().top - before;
  if (Math.abs(d) >= 1) window.scrollBy(0, d);
}

function press(pad, e, id) {
  if (held.has(id) || audioDead || !inView()) return;
  steady(() => pressNow(pad, e, id));
}
function pressNow(pad, e, id) {
  const c = ensureAudio();
  if (!c) { noAudio(); return; }
  Lab.claim(OWNER, stopAll);
  if (rc) endRollCall();
  const i = state.sel, role = ROLES[i].id;
  const h = { id, pad, tile: i, role, pressTap: Lab.tapTime(e), note: null, handles: [] };
  let chordIdx = heardIdx, rec = null;
  if (recOn && running) {
    const q = Lab.clock.quantize(OWNER, h.pressTap);
    // The loop a pad started is anchored in context time, taps in audible time: with a
    // slow output (Bluetooth) the second thumb of the opening dyad lands before step 0
    if (q) { rec = q.abs < 0 ? { step: 0, lap: 0 } : { step: q.step, lap: q.lap }; chordIdx = C.chordIndexAt(rec.step); }
  } else if (recOn) {
    rec = { step: 0, lap: 0, start: true };
    chordIdx = 0;
  }
  const t = c.currentTime + 0.005;
  if (rec && rec.start) {
    // The band comes in on your note: step 0 is the tap itself
    if (!startClock(t)) return;
    announce('Loop started on your note.');
    if (msgEl.textContent === UI.MSG.paused) say('');
  }
  soundLive(h, chords[chordIdx], t);
  if (rec && record(i, { step: rec.step, pad, len: 1, vel: 2, skipLap: rec.lap }, rec.lap) && HELD_ROLES.includes(role)) {
    h.note = { step: rec.step, pad };
  }
  if (HELD_ROLES.includes(role)) held.set(id, h);
  if (!REDUCED) flashAt[i] = performance.now();
  hit(padBtns[pad - 1]);
  firstSound();
  wake();
}

function release(id, e) {
  const h = held.get(id);
  if (!h) return;
  held.delete(id);
  const c = Lab.ctx;
  h.handles.forEach(x => x.stop(c.currentTime));
  if (h.handles.includes(liveBass)) liveBass = null;
  if (!h.note) return;
  const len = C.noteLen(h.pressTap, e ? Lab.tapTime(e) : Lab.audibleTime(), stepDur);
  const tile = state.tiles[h.tile];
  const old = tile.find(n => n.step === h.note.step && n.pad === h.note.pad);
  // Undo or Clear may have removed it while the finger was still down
  if (!old || len <= old.len) return;
  state.tiles[h.tile] = C.addNote(tile, { step: old.step, pad: old.pad, len, vel: old.vel }).tile;
  changed();
}
function releaseAll() { Array.from(held.keys()).forEach(id => release(id, null)); }

function record(i, note, lap) {
  const r = C.addNote(state.tiles[i], note);
  if (!r.stored) {
    if (!fullWarned[i]) { fullWarned[i] = true; say(TEXT.full); }
    return false;
  }
  if (!pass || pass.tile !== i || pass.lap !== lap) {
    pushUndo(false);
    pass = { tile: i, lap };
    announce('Recording into ' + ROLES[i].label + '.');
  }
  state.tiles[i] = r.tile;
  changed();
  return true;
}

function hit(b) {
  if (!b) return;
  b.classList.add('hit');
  clearTimeout(b.hitTimer);
  b.hitTimer = setTimeout(() => b.classList.remove('hit'), 120);
}


/* ════════════════════════════════════════════════════════════════════
   EDITING — undo, clear, start over, mutes, roll call
   ════════════════════════════════════════════════════════════════════ */
const plainTiles = tiles => tiles.map(t => t.map(({ step, pad, len, vel }) => ({ step, pad, len, vel })));
function pushUndo(full) {
  undoStack.push({ full, tiles: plainTiles(state.tiles), room: state.room, key: state.key, tempo: state.tempo, mute: state.mute });
  if (undoStack.length > UNDO_CAP) undoStack.shift();
}
function undo() {
  const snap = undoStack.pop();
  if (!snap) { announce('Nothing to undo.'); return; }
  state.tiles = plainTiles(snap.tiles);
  pass = null;
  if (snap.full) {
    if (rc) endRollCall();
    applySettings(snap.room, snap.key, snap.tempo);
    state.mute = snap.mute;
    settleMix();
  }
  // The count keeps two undos in a row from reading as one repeated message (the kit drops repeats)
  announce(undoStack.length ? `Undone. ${undoStack.length} more to undo.` : 'Undone. Nothing left to undo.');
  changed();
}
function clearPart() {
  const label = ROLES[state.sel].label;
  if (!state.tiles[state.sel].length) { announce(label + ' is already empty.'); return; }
  pushUndo(false);
  state.tiles[state.sel] = [];
  pass = null;
  announce('Cleared ' + label + '.');
  changed();
}
function startOver() {
  pushUndo(true);
  if (rc) endRollCall();
  const s = C.starterJam();
  state.tiles = s.tiles;
  state.mute = s.mute;
  applySettings(s.room, s.key, s.tempo);
  settleMix();
  pass = null;
  hintOk = true;
  select(s.sel);
  changed();
}
// Room, key and tempo from a snapshot or the starter jam, with the controls in sync
function applySettings(room, key, tempo) {
  state.room = room; state.key = key;
  chords = C.roomChords(room, key);
  if (tempo !== state.tempo) {
    state.tempo = tempo;
    if (running) { Lab.clock.setTempo(OWNER, C.TEMPOS[tempo]); reschedulePending(); }
  }
  syncControls();
  relabelPads();
  dropMirrorNote();
}

function toggleMute(i) {
  if (rc) endRollCall();
  state.mute ^= 1 << i;
  const want = muted(state.mute, i);
  if (running && buses) {
    const bar = nextBar();
    rampBus(i, want ? 0 : BUS[i][1], Lab.clock.timeOfStep(OWNER, bar));
    if (want === muted(heardMute, i)) pend[i] = null;
    else { pend[i] = bar; commitAt(i, bar); }
  } else {
    pend[i] = null;
    heardMute = (heardMute & ~(1 << i)) | (state.mute & (1 << i));
    if (buses) rampBus(i, mixTarget(i), Lab.ctx.currentTime);
  }
  scheduleSave();
  changedMix();
}
function changedMix() {
  staticDirty = true;
  updateTileAria();
  wake();
}

function toggleRollCall() {
  if (rc) { endRollCall(); return; }
  const order = C.rollCallOrder(state);
  if (order.length < 2 || audioDead || (!running && !inView())) return;
  const c = ensureAudio();
  if (!c) { noAudio(); return; }
  Lab.claim(OWNER, stopAll);
  settleMix();
  rc = { order, startLap: 0, solo: null, label: null };
  rollBtn.setAttribute('aria-pressed', 'true');
  rollBtn.classList.remove('nudge');
  if (running) rc.startLap = Math.ceil(Lab.clock.info(OWNER).nextStep / STEPS);
  else {
    if (msgEl.textContent === UI.MSG.paused) say('');
    if (!startClock()) { rc = null; return; }
  }
  changedMix();
}
// Ends at once: a pad tap, the button again, a cut or a stop
function endRollCall() {
  rc = null;
  rollBtn.setAttribute('aria-pressed', 'false');
  if (buses) for (let i = 0; i < N; i++) rampBus(i, mixTarget(i), Lab.ctx.currentTime);
  updateReadouts();
  changedMix();
}
// The natural end, after the lap of everyone: the gains are already back
function finishRollCall() {
  rc = null;
  rollBtn.setAttribute('aria-pressed', 'false');
  updateReadouts();
}

function select(i) {
  if (i === state.sel) return;
  state.sel = i;
  pass = null;
  relabelPads();
  updateTileAria();
  if (tileRoving) tileRoving.refresh();
  staticDirty = true;
  wake();
}

/* ── everything that follows a change to the notes ── */
function changed() {
  state.tiles.forEach((t, i) => { if (t.length < C.NOTE_CAP) fullWarned[i] = false; });
  const noUndo = !undoStack.length, noRoll = audioDead || (!rc && C.filledCount(state) < 2);
  // A focused button about to disable itself would drop the focus to <body>, where Z and 1–6 no longer reach
  const a = document.activeElement;
  if ((noUndo && a === undoBtn) || (noRoll && a === rollBtn)) (playBtn.disabled ? tileBtns[state.sel] : playBtn).focus({ preventScroll: true });
  undoBtn.disabled = noUndo;
  rollBtn.disabled = noRoll;
  syncHint();
  staticDirty = true;
  updateTileAria();
  updateReadouts();
  scheduleSave();
  wake();
}

let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    UI.store.set(STORE_KEY, C.encode(state));
    // An edited jam is yours now: a reload keeps your edits instead of re-opening the link
    if ((location.hash || '').startsWith('#split=')) {
      try { history.replaceState(null, '', location.pathname + location.search + '#split'); } catch (e) {}
    }
  }, 500);
}


/* ════════════════════════════════════════════════════════════════════
   DOM — tiles, pads, controls, readouts
   ════════════════════════════════════════════════════════════════════ */
const tileBtns = ROLES.map((r, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ss-tile';
  b.dataset.tile = String(i);
  tilesEl.appendChild(b);
  return b;
});
const padBtns = [1, 2, 3, 4, 5, 6, 7, 8].map(p => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ss-pad';
  b.dataset.pad = String(p);
  const n = document.createElement('span'); n.className = 'n';
  const k = document.createElement('span'); k.className = 'k'; k.textContent = PAD_KEYS[p - 1].toUpperCase();
  b.append(n, k);
  padsEl.appendChild(b);
  return b;
});
H.PC_NAMES.forEach((name, i) => {
  const o = document.createElement('option');
  o.value = String(i);
  o.textContent = name + ' major';
  keySel.appendChild(o);
});

function updateTileAria() {
  tileBtns.forEach((b, i) => {
    const n = state.tiles[i].length;
    let label = `Square ${i + 1}, ${ROLES[i].label}, ${n} note${n === 1 ? '' : 's'}`;
    const cut = mode === 'cut';
    // In Cuts the mix a square is a mute switch: pressed means muted (or muting on the next bar)
    if (cut) label = 'Mute s' + label.slice(1);
    else if (muted(heardMute, i)) label += ', muted';
    if (pend[i] != null) label += muted(state.mute, i) ? ', mutes on the next bar' : ', comes back on the next bar';
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-pressed', String(cut ? muted(state.mute, i) : i === state.sel));
  });
}
function relabelPads() {
  const i = state.sel, role = ROLES[i].id, ch = chords[heardIdx], c = COLOURS[i];
  const names = C.spelling(state.room, state.key);
  padsEl.style.setProperty('--ss-line', rgba(c, 0.4));
  padsEl.style.setProperty('--ss-hit', rgba(c, 0.22));
  padBtns.forEach((b, k) => {
    const pad = k + 1;
    let name, aria;
    if (role === 'beat') {
      name = C.KIT_NAMES[k];
      aria = `Pad ${pad}, ${name}`;
    } else {
      const m = C.padMidi(role, pad, ch);
      name = names[H.mod12(m)];
      aria = `Pad ${pad}, ${C.spellMidi(m, names)}, ${C.padIsColour(role, pad, ch) ? 'colour' : 'chord tone'}`;
    }
    const nEl = b.firstChild;
    if (nEl.textContent !== name) nEl.textContent = name;
    b.setAttribute('aria-label', aria);
    b.classList.toggle('colour', C.padIsColour(role, pad, ch));
    b.classList.toggle('beat', role === 'beat');
  });
}
const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };
function updateReadouts() {
  const ch = chords[heardIdx];
  const rolling = rc && rc.label;
  setText(footLabel, rolling ? 'Roll call' : 'The band is playing');
  setText(chordEl, rolling ? rc.label : ch.name);
  setText(colourEl, fb ? TEXT.fullBand : cap1(ch.colour) + '.');
  setText(countEl, `${C.filledCount(state)} of ${N} squares`);
  setText(metaEl, `${H.pcName(state.key)} · ${C.TEMPOS[state.tempo]} BPM · ${C.ROOMS[state.room].label}`);
}

const setRoomBtn = UI.segBind($('ssRoom'), d => setRoom(+d.room));
const setTempoBtn = UI.segBind($('ssTempo'), d => setTempo(+d.tempo));
UI.segBind($('ssTileMode'), d => { mode = d.mode === 'cut' ? 'cut' : 'pick'; updateTileAria(); });
function syncControls() {
  setRoomBtn($('ssRoom').querySelector(`[data-room='${state.room}']`));
  setTempoBtn($('ssTempo').querySelector(`[data-tempo='${state.tempo}']`));
  keySel.value = String(state.key);
}

function setRoom(r) {
  if (r === state.room) return;
  state.room = r;
  dropMirrorNote();
  chords = C.roomChords(state.room, state.key);
  relabelPads();
  updateReadouts();
  announce('Room: ' + C.ROOMS[r].label + '.');
  if (C.ROOMS[r].id === 'mirror' && !mirrorHinted) {
    mirrorHinted = true;
    let seen = false;
    try { seen = !!sessionStorage.getItem(MIRROR_KEY); sessionStorage.setItem(MIRROR_KEY, '1'); } catch (e) {}
    if (!seen) say(TEXT.mirror);
  }
  scheduleSave();
}
function setKey(k) {
  state.key = k;
  chords = C.roomChords(state.room, state.key);
  relabelPads();
  updateReadouts();
  scheduleSave();
}
function setTempo(t) {
  if (t === state.tempo) return;
  state.tempo = t;
  if (running) { Lab.clock.setTempo(OWNER, C.TEMPOS[t]); reschedulePending(); }
  else stepDur = 60 / C.TEMPOS[t] / 2;
  updateReadouts();
  scheduleSave();
}
keySel.addEventListener('change', () => setKey(K.clamp(+keySel.value || 0, 0, 11)));

function togglePlay() {
  if (running) {
    Lab.clock.stop(OWNER);
    Lab.release(OWNER);
    return;
  }
  if (audioDead || !inView()) return;      // a focused button can still take a key off-screen
  const c = ensureAudio();
  if (!c) { noAudio(); return; }
  Lab.claim(OWNER, stopAll);
  say('');
  startClock();
}
playBtn.addEventListener('click', togglePlay);
undoBtn.addEventListener('click', undo);
clearBtn.addEventListener('click', clearPart);
resetBtn.addEventListener('click', startOver);
rollBtn.addEventListener('click', toggleRollCall);
recBtn.addEventListener('click', () => {
  recOn = !recOn;
  recBtn.setAttribute('aria-pressed', String(recOn));
  if (!recOn && pass) { pass = null; staticDirty = true; wake(); }
});
copyBtn.addEventListener('click', () => {
  say('');                                  // a fallback link box then shows on its own
  UI.share('split', C.encode(state), msgEl).then(r => { if (r === 'copied') say(TEXT.copied); });
  UI.track('lab_share', { exp: 'split' });
});

/* A touch on a pad can end in a click on whatever tile slid under the finger (a
   message above the stage moved it). A pointer click only counts when it also
   started on that tile; keyboard and assistive-tech clicks (detail 0) always do. */
let downTile = null;
section.addEventListener('pointerdown', e => { downTile = e.target.closest ? e.target.closest('.ss-tile') : null; }, true);
tilesEl.addEventListener('click', e => {
  const b = e.target.closest('.ss-tile');
  const stray = e.detail !== 0 && b !== downTile;
  downTile = null;
  if (!b || stray) return;
  const i = +b.dataset.tile;
  if (mode === 'cut') toggleMute(i); else select(i);
});

padsEl.addEventListener('pointerdown', e => {
  const b = e.target.closest('.ss-pad');
  if (!b || b.disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
  try { b.setPointerCapture(e.pointerId); } catch (err) {}
  press(+b.dataset.pad, e, 'p' + e.pointerId);
});
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => {
  padsEl.addEventListener(type, e => release('p' + e.pointerId, e));
});
// The pads play on pointerdown: no compatibility mouse events or click after a touch
padsEl.addEventListener('touchend', e => { if (e.cancelable) e.preventDefault(); }, { passive: false });
// A click with no key or pointer behind it (a screen reader's activate): a one-step note
let enterSeq = 0;
padsEl.addEventListener('click', e => {
  const b = e.target.closest('.ss-pad');
  if (!b || e.detail !== 0 || b.disabled) return;
  const id = 'click' + (++enterSeq);
  press(+b.dataset.pad, e, id);
  setTimeout(() => release(id, null), stepDur * 1000);
});
padsEl.addEventListener('contextmenu', e => e.preventDefault());

function padIndexOf(e) {
  const key = (e.key || '').toLowerCase();
  if (key === 'z' || key === 'm') return -1;      // AZERTY has M where ';' is: the shortcut wins
  const k = PAD_CODES.indexOf(e.code);
  return k >= 0 ? k : PAD_KEYS.indexOf(key);
}
section.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // Scrolled away with focus still inside: Space scrolls the page, nothing starts unseen
  if (!inView()) return;
  const t = e.target, tag = t.tagName;
  if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (e.key === 'Enter' && t.classList.contains('ss-pad')) {
    // Held like a pad key: no click (so no auto-repeat retriggers), the keyup ends the note
    e.preventDefault();
    if (!e.repeat && !t.disabled) press(+t.dataset.pad, e, 'enter');
    return;
  }
  const pk = padIndexOf(e);
  if (pk >= 0) {
    e.preventDefault();
    if (!e.repeat && !audioDead) press(pk + 1, e, 'k' + pk);
    return;
  }
  const digit = /^Digit([1-6])$/.exec(e.code) || /^([1-6])$/.exec(e.key || '');
  /* The shortcuts change things away from the focus (the canvas is aria-hidden), so
     each says what it did. A tile click or the Play button already speaks for itself. */
  if (digit) {
    e.preventDefault();
    const i = +digit[1] - 1, was = state.sel;
    select(i);
    if (i !== was) {
      const n = state.tiles[i].length;
      announce(`Square ${i + 1}, ${ROLES[i].label}, ${n} note${n === 1 ? '' : 's'}${muted(state.mute, i) ? ', muted' : ''}.`);
    }
    return;
  }
  if (e.key === ' ') {
    if (t.closest('.btn, .seg, a')) return;            // buttons keep their own Space
    e.preventDefault();
    if (!e.repeat) {
      const was = running;
      togglePlay();
      if (running !== was) announce(running ? 'Loop playing.' : 'Loop stopped.');
    }
    return;
  }
  const key = (e.key || '').toLowerCase();
  if (key === 'z') { e.preventDefault(); undo(); }
  else if (key === 'm') {
    e.preventDefault();
    if (!e.repeat) {
      const i = state.sel;
      toggleMute(i);
      const out = muted(state.mute, i), later = pend[i] != null;
      announce(ROLES[i].label + (out ? (later ? ' mutes on the next bar.' : ' muted.') : (later ? ' comes back on the next bar.' : ' back in.')));
    }
  }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); if (!e.repeat) clearPart(); }
});
// On window: focus can leave the section while a key is down, and the note must still end
window.addEventListener('keyup', e => {
  if (e.key === 'Enter') release('enter', e);
  const pk = padIndexOf(e);
  if (pk >= 0) release('k' + pk, e);
});
window.addEventListener('blur', releaseAll);
Lab.unlockOn(section);
let tileRoving = null;                  // built once the selected square is known, so Tab lands on it


/* ════════════════════════════════════════════════════════════════════
   CANVAS — six tiles, drawn in batches over one static layer
   ════════════════════════════════════════════════════════════════════ */
const stat = document.createElement('canvas'), sg = stat.getContext('2d');
let W = 0, Hc = 0, DPR = 1, lastW = -1, lastNarrow = null, staticDirty = true;
let rects = [];
const narrowMq = window.matchMedia ? matchMedia('(max-width: 560px)') : null;

function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));        // arcTo throws on a negative radius
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function layout() {
  const narrow = !!(narrowMq && narrowMq.matches);
  W = Math.max(1, cv.clientWidth);
  const cols = narrow ? 2 : 3, rows = narrow ? 3 : 2, aspect = narrow ? 1.5 : 1.55, M = 4, GAP = 8;
  const tw = (W - 2 * M - (cols - 1) * GAP) / cols, th = tw / aspect;
  lastW = Math.round(W); lastNarrow = narrow;
  // Hidden (display: none gives width 0) or absurdly narrow: nothing sensible to draw.
  // The ResizeObserver brings it back when the grid gets a real size.
  if (tw < 40) { rects = []; return; }
  Hc = Math.round(2 * M + rows * th + (rows - 1) * GAP);
  cv.style.height = Hc + 'px';
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = stat.width = Math.round(W * DPR);
  cv.height = stat.height = Math.round(Hc * DPR);
  rects = ROLES.map((r, i) => {
    const x = M + (i % cols) * (tw + GAP), y = M + Math.floor(i / cols) * (th + GAP);
    const hr = Math.min(th * 0.16, 16), pad = 10;
    const rx0 = x + pad + 2 * hr + 14, rx1 = x + tw - pad;
    const ry0 = y + th * 0.45, ry1 = y + th - pad - 5;
    return {
      x, y, w: tw, h: th, hr,
      hx: x + pad + hr + 2, hy: y + th - 2.2 * hr - 3,
      rx0, rx1, ry0, ry1, colW: (rx1 - rx0) / STEPS, rowH: (ry1 - ry0) / 8,
    };
  });
  tilesEl.style.left = cv.offsetLeft + 'px';
  tilesEl.style.top = cv.offsetTop + 'px';
  tilesEl.style.width = W + 'px';
  tilesEl.style.height = Hc + 'px';
  tileBtns.forEach((b, i) => {
    const r = rects[i];
    Object.assign(b.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
  });
  staticDirty = true;
  draw(performance.now());
}

// A note as a capsule `len` columns wide; one that runs past the loop end wraps to the start
function capsule(ctx, r, n) {
  const h = Math.max(2.5, r.rowH * 0.62), y = r.ry1 - n.pad * r.rowH + (r.rowH - h) / 2;
  const seg = (s, len) => roundRect(ctx, r.rx0 + s * r.colW + 0.75, y, Math.max(h, len * r.colW - 1.5), h, h / 2);
  const end = n.step + n.len;
  if (end <= STEPS) seg(n.step, n.len);
  else { seg(n.step, STEPS - n.step); seg(0, end - STEPS); }
}
function tagFor(i) {
  if (pend[i] != null) return muted(state.mute, i) ? 'OUT ON 1' : 'IN ON 1';
  if (pass && pass.tile === i && state.sel === i) return 'REC';
  if (muted(heardMute, i)) return 'MUTED';
  return state.sel === i ? 'YOU' : '';
}
const spacing = (ctx, px) => { if ('letterSpacing' in ctx) ctx.letterSpacing = px; };

function drawStatic() {
  sg.setTransform(DPR, 0, 0, DPR, 0, 0);
  sg.clearRect(0, 0, W, Hc);
  sg.textBaseline = 'alphabetic';
  rects.forEach((r, i) => {
    const c = COLOURS[i], sel = state.sel === i, dim = muted(heardMute, i);
    sg.beginPath();
    roundRect(sg, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 10);
    sg.fillStyle = 'rgba(5,5,16,0.6)';
    sg.fill();
    sg.lineWidth = 1;
    sg.strokeStyle = rgba(c, sel ? 1 : 0.35);
    sg.stroke();

    sg.font = '500 10px ' + MONO;
    spacing(sg, '1.4px');
    sg.textAlign = 'left';
    sg.fillStyle = rgba(c, dim ? 0.45 : 0.95);
    // The number goes only when the tag would not fit beside it (a narrow tile saying 'OUT ON 1')
    const name = ROLES[i].label.toUpperCase(), full = '0' + (i + 1) + ' · ' + name;
    const tag = tagFor(i);
    const room = r.w - 22 - (tag ? sg.measureText(tag).width + (tag === 'REC' ? 12 : 0) + 10 : 0);
    sg.fillText(sg.measureText(full).width <= room ? full : name, r.x + 11, r.y + 20);
    if (tag) {
      sg.textAlign = 'right';
      sg.fillStyle = tag === 'MUTED' ? 'rgba(244,239,230,0.45)' : tag.includes(' ON ') ? '#FFB84A' : '#F4EFE6';
      const tx = r.x + r.w - 11;
      sg.fillText(tag, tx, r.y + 20);
      if (tag === 'REC') {
        sg.fillStyle = '#FF4E26';
        sg.beginPath();
        sg.arc(tx - sg.measureText(tag).width - 7, r.y + 16.5, 3.2, 0, Math.PI * 2);
        sg.fill();
      }
    }
    spacing(sg, '0px');

    // the bandmate: a head over a shoulder arc (the mouth is drawn per frame)
    sg.strokeStyle = rgba(c, dim ? 0.3 : 0.8);
    sg.lineWidth = 1.5;
    sg.beginPath();
    sg.arc(r.hx, r.hy, r.hr, 0, Math.PI * 2);
    sg.stroke();
    sg.save();
    sg.beginPath();
    sg.rect(r.x, r.y, r.w, r.h - 1.5);
    sg.clip();
    sg.beginPath();
    sg.arc(r.hx, r.y + r.h + r.hr * 0.5, r.hr * 1.7, Math.PI * 1.08, Math.PI * 1.92);
    sg.stroke();
    sg.restore();

    // the mini-roll: baseline ticks, then notes
    sg.fillStyle = 'rgba(244,239,230,0.14)';
    for (let s = 0; s < STEPS; s++) sg.fillRect(r.rx0 + (s + 0.5) * r.colW - 0.5, r.ry1 + 3, 1, s % 4 ? 2 : 4);
    const notes = state.tiles[i];
    if (!notes.length) {
      sg.font = '400 10px ' + MONO;
      sg.textAlign = 'center';
      sg.fillStyle = 'rgba(244,239,230,0.35)';
      sg.fillText('+ tap to pick', (r.rx0 + r.rx1) / 2, (r.ry0 + r.ry1) / 2 + 4);
    } else {
      sg.beginPath();
      notes.forEach(n => capsule(sg, r, n));
      sg.fillStyle = rgba(c, dim ? 0.25 : 0.75);
      sg.fill();
    }
  });
}

function flashLevel(i, now) { return K.clamp(1 - (now - flashAt[i]) / FLASH_MS, 0, 1); }
function busy(now) {
  if (running && !REDUCED) return true;
  if (!REDUCED && flashAt.some((t, i) => flashLevel(i, now) > 0)) return true;
  return false;
}

function draw(now) {
  if (!rects.length) return;
  if (staticDirty) { drawStatic(); staticDirty = false; }
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.clearRect(0, 0, W, Hc);
  g.drawImage(stat, 0, 0, W, Hc);
  const lv = rects.map((r, i) => (REDUCED ? 0 : flashLevel(i, now)));

  lv.forEach((f, i) => {
    if (f <= 0) return;
    const r = rects[i];
    g.beginPath();
    roundRect(g, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 10);
    g.fillStyle = rgba(COLOURS[i], 0.18 * f);
    g.fill();
  });

  g.beginPath();
  rects.forEach((r, i) => {
    const my = r.hy + r.hr * 0.4, mw = r.hr * 0.32, open = 5 * lv[i];
    if (open < 0.6) { g.moveTo(r.hx - mw, my); g.lineTo(r.hx + mw, my); }
    else { g.moveTo(r.hx + mw, my); g.ellipse(r.hx, my, mw, open / 2, 0, 0, Math.PI * 2); }
  });
  g.strokeStyle = 'rgba(244,239,230,0.7)';
  g.lineWidth = 1.5;
  g.stroke();

  const pos = running ? playPos() : null;
  if (pos != null) {
    const cur = Math.floor(pos), step = K.mod(cur, STEPS);
    const frac = (REDUCED ? step : K.mod(pos, STEPS)) / STEPS;
    g.beginPath();
    rects.forEach(r => {
      const x = Math.round(r.rx0 + frac * (r.rx1 - r.rx0)) + 0.5;
      g.moveTo(x, r.ry0 - 4);
      g.lineTo(x, r.ry1 + 5);
    });
    g.strokeStyle = 'rgba(244,239,230,0.55)';
    g.lineWidth = 1;
    g.stroke();
    g.beginPath();
    rects.forEach((r, i) => {
      if (!audible(i)) return;
      state.tiles[i].forEach(n => { if (K.mod(step - n.step, STEPS) < n.len) capsule(g, r, n); });
    });
    g.fillStyle = 'rgba(244,239,230,0.95)';
    g.fill();
  }

  if (fb) {
    const k = REDUCED ? 1 : K.clamp((now - fb.at) / 1200, 0, 1), len = 2 * (W + Hc);
    const grad = g.createLinearGradient(0, 0, W, Hc);
    grad.addColorStop(0, '#FFB84A'); grad.addColorStop(0.35, '#FF4E26');
    grad.addColorStop(0.7, '#B488FF'); grad.addColorStop(1, '#4DD7FF');
    g.beginPath();
    roundRect(g, 1.5, 1.5, W - 3, Hc - 3, 13);
    g.strokeStyle = grad;
    g.lineWidth = 2;
    g.setLineDash([len * k, len]);
    g.stroke();
    g.setLineDash([]);
  }
}

function frame(now) {
  raf = 0;
  if (!visible) return;
  draw(now);
  if (busy(now) || (fb && !REDUCED && now - fb.at < 1300)) raf = requestAnimationFrame(frame);
}
function wake() { if (visible && !raf) raf = requestAnimationFrame(frame); }

// Coalesce resize bursts and skip no-op sizes (the 03 pattern)
let resizeRaf = 0;
function scheduleLayout() {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = 0;
    const narrow = !!(narrowMq && narrowMq.matches);
    if (Math.round(cv.clientWidth) !== lastW || narrow !== lastNarrow) layout();
  });
}
if ('ResizeObserver' in window) new ResizeObserver(scheduleLayout).observe(wrap);
else window.addEventListener('resize', scheduleLayout);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { staticDirty = true; draw(performance.now()); });

UI.watchVisibility(section, v => {
  visible = v;
  if (v) { wake(); return; }
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  if (Lab.clock.isRunning(OWNER)) Lab.clock.stop(OWNER, 'offscreen');
  else if (held.size) { releaseAll(); say(UI.MSG.paused); }
  Lab.release(OWNER);
});


/* ════════════════════════════════════════════════════════════════════
   LOAD — a share link wins, then the autosave, then the starter jam
   ════════════════════════════════════════════════════════════════════ */
function loadInitial() {
  let msg = '', fromLink = false;
  if ((location.hash || '').startsWith('#split=')) {
    fromLink = true;
    const payload = UI.readHash('split');
    const s = payload && C.decode(payload);
    if (s) { state = s; msg = TEXT.linked; }
    else { state = C.starterJam(); msg = TEXT.badLink; }
  } else {
    const saved = UI.store.get(STORE_KEY, null);
    const s = typeof saved === 'string' ? C.decode(saved) : null;
    if (s) state = s;
  }
  chords = C.roomChords(state.room, state.key);
  heardMute = state.mute;
  stepDur = 60 / C.TEMPOS[state.tempo] / 2;
  hintOk = C.encode(state) === C.encode(C.starterJam());   // applyLoaded's changed() shows or hides the hint
  return { msg, fromLink };
}
function applyLoaded({ msg, fromLink }, keepUndo) {
  pass = null;
  if (!keepUndo) undoStack = [];
  syncControls();
  relabelPads();
  updateTileAria();
  if (tileRoving) tileRoving.refresh();
  changed();
  clearTimeout(saveTimer);                  // opening a jam is not an edit
  if (msg) say(msg);
  if (fromLink) section.scrollIntoView({ block: 'start' });
}

applyLoaded(loadInitial());
tileRoving = UI.roving(tilesEl, '.ss-tile');
UI.roving(padsEl, '.ss-pad');
if (audioDead) noAudio();
layout();
window.addEventListener('hashchange', () => {
  if (!(location.hash || '').startsWith('#split=')) return;
  if (running) { Lab.clock.stop(OWNER); Lab.release(OWNER); }
  if (rc) endRollCall();
  pushUndo(true);                           // a link opened in this tab replaces your jam: Z brings it back
  applyLoaded(loadInitial(), true);
  settleMix();
  staticDirty = true;
  draw(performance.now());
});

})();

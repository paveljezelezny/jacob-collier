/* ════════════════════════════════════════════════════════════════════
   06 — REHARM REELS
   A public-domain tune loops on a music box while eight slot-machine
   reels deal the chords underneath it, sung by a voice-led choir.
   The music theory, the spin and the share codec live in
   lab/reharm-reels-core.js; this file is the reels, the scheduler and
   the sound. Needs lab.js + lab/kit.js.
   ════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';

const section = document.getElementById('reels');
if (!section) return;
const Lab = window.Lab, UI = window.LabUI, H = window.Harmony, Cores = window.LabCores;
if (!Lab || !UI || !H || !Cores || !Cores['reharm-reels'] || !Cores.kit || !Lab.clock) {
  const stage = section.querySelector('.stage');
  // lab.js has already said so here when harmony.js itself is missing
  if (stage && !stage.querySelector(':scope > .inline-msg.on')) {
    const p = document.createElement('p');
    p.className = 'inline-msg on';
    p.style.margin = '22px';
    p.textContent = (UI && UI.MSG && UI.MSG.noEngine) || 'This experiment couldn’t load its music engine. Refresh the page to try again.';
    stage.prepend(p);
  }
  return;
}

const C = Cores['reharm-reels'], mod = Cores.kit.mod;
const OWNER = 'reharm-reels', STORE = 'jc-lab-reels-v1', SVGNS = 'http://www.w3.org/2000/svg';
const $ = sel => section.querySelector(sel);
const MSG = {
  fresh: 'The reels are showing the plain chords. Spin to deal new ones.',
  before: 'Playing the plain version. Turn Before off to hear yours.',
  beforeStill: 'Showing the plain version. Press Play to hear it, or turn Before off for yours.',
  link: 'Someone dealt you a hand. Press Play to hear it. Spin would deal new chords.',
  badLink: 'That link didn’t survive the trip, so here are the plain chords instead.',
  allLocked: 'Every reel is locked. Unlock one to spin.',
  copied: 'Link copied. Whoever opens it gets these exact chords.',
  copyHere: 'Copy this link: ',
};
const CADENCE = { home: 'Landed home', still: 'Home, no journey', hanging: 'Still hanging' };
const famColour = fam => (C.FAMILIES[fam].token === 'paper' ? 'rgba(244,239,230,0.5)' : `var(--${C.FAMILIES[fam].token})`);
const LAYER_LEVEL = { bass: 1, keys: 0.8, brushes: 0.9 };
const CHOIR_PAN = [-0.3, -0.1, 0.1, 0.3], CHOIR_GAIN = [0.11, 0.13, 0.13, 0.13];
const PADLOCK = '<svg viewBox="0 0 14 14" aria-hidden="true"><rect class="body" x="2.5" y="6.2" width="9" height="6.3" rx="1.4" stroke="currentColor" stroke-width="1.3"/><path d="M4.6 6.2V4.4a2.4 2.4 0 0 1 4.8 0v1.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';

const tuneSeg = $('#rrTune'), spiceSeg = $('#rrSpice'), tempoSeg = $('#rrTempo'), melSeg = $('#rrMelody');
const layersSeg = $('#rrLayers'), keySel = $('#rrKey');
const spinBtn = $('#rrSpin'), playBtn = $('#rrPlay'), beforeBtn = $('#rrBefore');
const undoBtn = $('#rrUndo'), copyBtn = $('#rrCopy'), msgEl = $('#rrMsg'), live = $('#rrLive');
const lane = $('#rrLane'), reelsEl = $('#rrReels'), thread = $('#rrThread'), histEl = $('#rrHistory');
const chordEl = $('#rrChord'), colourEl = $('#rrColour'), heatEl = $('#rrHeat'), pipText = $('#rrPipText'), pipsEl = $('#rrPips');
if (!tuneSeg || !reelsEl || !lane || !thread || !msgEl) return;

/* ════════════════════════════════════════════════════════════════════
   STATE
   ════════════════════════════════════════════════════════════════════ */
const state = C.defaultState();
let hist = [];                          // earlier hands, oldest first: { level, ids }
let voices = null, plainVoices = null;  // voicePath of your hand and of the plain chords
let lastNudge = -Infinity, lastCadence = null;
const pips = { twinkle: [false, false, false, false, false], frere: [false, false, false, false, false] };

const cands = s => C.candidates(state.tune, s, state.key, state.level);
const hand = () => state.idx.map((i, s) => cands(s)[i] || cands(s)[0]);
const plainHand = () => state.idx.map((_, s) => cands(s)[0]);
const layerOn = name => !!(state.layers & C.LAYERS[name]);
const isLocked = s => !!(state.locks & (1 << s));

// `last` is the visitor's own hand: opening someone's link (or playing it) never replaces it,
// only an edit does
let saveTimer = 0, ownLast = null;
function persist() {
  const data = { pips };
  if (ownLast) data.last = ownLast;
  UI.store.set(STORE, data);
}
function keepOwn() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  ownLast = C.encode(state);
  persist();
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    keepOwn();
    // An edited hand is yours now: a reload keeps it instead of re-opening the link (as in 05)
    if ((location.hash || '').startsWith('#reels=')) {
      try { history.replaceState(null, '', location.pathname + location.search + '#reels'); } catch (e) {}
    }
  }, 250);
}

function svg(tag, attrs, parent) {
  const el = document.createElementNS(SVGNS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(el);
  return el;
}
function span(cls, text) {
  const el = document.createElement('span');
  el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}
function say(text) { UI.announce(live, text); }
// Any part of the section on screen. Asked directly, because the IntersectionObserver only
// reports changes: a focused button can still take a key after the section scrolled away.
function inView() {
  const r = section.getBoundingClientRect();
  return r.bottom > 0 && r.top < (window.innerHeight || document.documentElement.clientHeight);
}
function clearMsg(...texts) { if (!texts.length || texts.includes(msgEl.textContent)) UI.msg(msgEl, ''); }


/* ════════════════════════════════════════════════════════════════════
   REELS
   ════════════════════════════════════════════════════════════════════ */
const reels = [];
const anims = [];                        // per reel: pending spin / tick timers
for (let s = 0; s < 8; s++) {
  const el = document.createElement('div');
  el.className = 'reel';
  el.dataset.slot = String(s);
  const win = document.createElement('button');
  win.type = 'button';
  win.className = 'reel-win';
  const strip = span('reel-strip'), tag = span('rr-tag', 'Before'), dot = span('rr-dot');
  // The border keeps the family colour (Borrowed is the section's cyan too), so a lock
  // shows on the face as its own filled padlock
  const badge = span('rr-lockmark');
  badge.innerHTML = PADLOCK;
  [tag, dot, badge].forEach(el => el.setAttribute('aria-hidden', 'true'));
  win.append(strip, tag, dot, badge);
  const lock = document.createElement('button');
  lock.type = 'button';
  lock.className = 'reel-lock';
  lock.tabIndex = -1;                    // L locks the focused reel; one tab stop per reel is plenty
  lock.setAttribute('aria-pressed', 'false');
  lock.setAttribute('aria-label', `Lock slot ${s + 1}`);
  lock.innerHTML = PADLOCK;
  el.append(win, lock);
  reelsEl.appendChild(el);
  reels.push({ el, win, strip, lock });
  anims.push([]);

  win.addEventListener('click', e => nudge(s, e.shiftKey ? -1 : 1));
  win.addEventListener('keydown', e => {
    if (!inView()) return;               // scrolled away: the arrows scroll the page
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); nudge(s, e.key === 'ArrowUp' ? -1 : 1, e.repeat); }
  });
  lock.addEventListener('click', () => toggleLock(s));
}
UI.roving(reelsEl, '.reel-win');

function curCell(ch) {
  const c = span('cur');
  c.append(span('root', ch.rootName), span('q', ch.suffix));
  return c;
}
function stopAnim(s) {
  anims[s].forEach(clearTimeout);
  anims[s] = [];
  const { strip, win } = reels[s];
  strip.classList.remove('rr-spinning', 'rr-tick');
  strip.style.transform = '';
  strip.style.transitionDelay = '';
  win.classList.remove('land');
}
// What the face shows is what the label says: with Before on, that is the plain chord
function faceLabel(s) {
  const info = C.slotInfo(state.tune, state.key)[s];
  const mel = info.anchorPcs.map(pc => C.spell(state.key, pc - state.key)).join(' and ');
  const slot = `Slot ${s + 1}${isLocked(s) ? ', locked' : ''}`;       // the padlock on the face is aria-hidden
  if (state.before) return `${slot}, melody ${mel}, plain chord ${plainHand()[s].name}, Before is on. Press to turn it off and change this chord.`;
  const ch = hand()[s];
  return `${slot}, melody ${mel}, chord ${ch.name}, ${C.FAMILIES[ch.fam].say}. Press for the next chord.`;
}
function renderFace(s) {
  stopAnim(s);
  const { el, win, strip } = reels[s];
  const list = cands(s), i = state.before ? 0 : state.idx[s], ch = list[i] || list[0];
  strip.textContent = '';
  strip.append(span('ghost', list[mod(i - 1, list.length)].name), curCell(ch), span('ghost', list[mod(i + 1, list.length)].name));
  el.style.setProperty('--fam', famColour(ch.fam));
  el.classList.toggle('before', state.before);
  renderLock(s);
}
// The lock and the face's label together: the label says whether the reel is locked
function renderLock(s) {
  const on = isLocked(s);
  reels[s].el.classList.toggle('locked', on);
  reels[s].lock.setAttribute('aria-pressed', String(on));
  reels[s].win.setAttribute('aria-label', faceLabel(s));
}
function renderFaces() { for (let s = 0; s < 8; s++) renderFace(s); }

function flash(s) {
  const el = reels[s].el;
  el.classList.add('rr-flash');
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('rr-flash')));
}
function land(s) {
  const { win } = reels[s];
  win.classList.remove('land');
  void win.offsetWidth;                  // restart the bounce
  win.classList.add('land');
  anims[s].push(setTimeout(() => win.classList.remove('land'), 160));
}

// Slot-machine spin: 4 random chords roll past, then the new one lands (CSS transition only)
function spinReel(s, delay) {
  if (UI.REDUCED) { renderFace(s); flash(s); return; }
  const { strip } = reels[s];
  anims[s].forEach(clearTimeout);
  anims[s] = [];
  strip.classList.remove('rr-spinning', 'rr-tick');
  strip.style.transform = '';
  // Spun again mid-roll: carry on from where the last roll was heading (its final three cells)
  while (strip.children.length > 3) strip.firstChild.remove();
  const from = strip.querySelector('.cur');
  const list = cands(s), i = state.idx[s];
  for (let k = 0; k < 4; k++) strip.appendChild(curCell(list[Math.floor(Math.random() * list.length)]));
  strip.appendChild(span('ghost', list[mod(i - 1, list.length)].name));
  const to = curCell(list[i]);
  strip.appendChild(to);
  strip.appendChild(span('ghost', list[mod(i + 1, list.length)].name));
  const dist = from ? to.offsetTop - from.offsetTop : 0;
  strip.style.transitionDelay = delay + 'ms';
  strip.classList.add('rr-spinning');
  strip.style.transform = `translateY(${-dist}px)`;
  anims[s].push(setTimeout(() => { renderFace(s); land(s); }, delay + 440));
}

// A nudge rolls the reel one notch: the new chord slides in from where its ghost was
function tick(s, dir) {
  renderFace(s);
  if (UI.REDUCED) { flash(s); return; }
  const { strip } = reels[s];
  strip.style.transform = `translateY(${dir * 36}px)`;
  void strip.offsetWidth;
  strip.classList.add('rr-tick');
  strip.style.transform = '';
  anims[s].push(setTimeout(() => strip.classList.remove('rr-tick'), 200));
}


/* ════════════════════════════════════════════════════════════════════
   LANE, THREAD, HISTORY, FOOTER
   ════════════════════════════════════════════════════════════════════ */
let laneNotes = [], laneBands = [];
function buildLane() {
  lane.textContent = '';
  const T = C.TUNES[state.tune], W = 800, lo = T.min - 2, hi = T.max + 2;
  const y = m => 92 - (m - lo) / (hi - lo) * 78;
  laneBands = [];
  for (let s = 0; s < 8; s++) laneBands.push(svg('rect', { class: 'rr-band', x: s * W / 8, y: 0, width: W / 8, height: 110 }, lane));
  for (let s = 1; s < 8; s++) svg('line', { class: 'rr-sep', x1: s * W / 8, x2: s * W / 8, y1: 4, y2: 106 }, lane);
  laneNotes = T.notes.map(n => svg('rect', {
    class: 'rr-note', x: (n.start8 / T.total8 * W).toFixed(2), y: (y(n.midi) - 4).toFixed(2),
    width: (n.len8 / T.total8 * W - 3).toFixed(2), height: 8, rx: 4,
  }, lane));
  lane.setAttribute('aria-label', `The melody: ${T.name}`);
}

function renderThread() {
  thread.textContent = '';
  const vp = state.before ? plainVoices : voices;
  const y = m => (56 - (m - 45) / 39 * 52).toFixed(1);
  for (let v = 1; v <= 3; v++) {
    const pts = vp.map((voicing, s) => [(s + 0.5) * 100, y(voicing[v])]);
    svg('polyline', { class: 'rr-v rr-v' + v, points: pts.map(p => p.join(',')).join(' ') }, thread);
    svg('path', { class: 'rr-d rr-v' + v, d: pts.map(([x, yy]) => `M${x} ${yy}h0`).join('') }, thread);
  }
}

function entryChords(e) {
  return e.ids.map((id, s) => {
    const list = C.candidates(state.tune, s, state.key, e.level);
    return list.find(c => c.id === id) || list[0];
  });
}
function renderHistory() {
  // The row is rebuilt, so a focused bar would drop focus to <body>: note its place first
  const bars = () => Array.from(histEl.querySelectorAll('button.rr-bar'));
  const focusAt = bars().indexOf(document.activeElement);
  // Undo spin is about to be disabled while it has focus: hand focus to Spin, not <body>
  if (!hist.length && document.activeElement === undoBtn) spinBtn.focus();
  histEl.textContent = '';
  const label = span('readout-label', 'Your last spins');
  label.setAttribute('aria-hidden', 'true');           // the group's aria-label says it already
  histEl.appendChild(label);
  for (let k = 0; k < 8; k++) {
    const e = hist[k];
    if (!e) {
      const ph = span('rr-bar empty');
      ph.setAttribute('aria-hidden', 'true');
      histEl.appendChild(ph);
      continue;
    }
    const chords = entryChords(e);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rr-bar';
    b.setAttribute('aria-label', `Spin ${k + 1}: ${chords.map(c => c.name).join(', ')}`);
    chords.forEach(c => { const i = document.createElement('i'); i.style.setProperty('--fam', famColour(c.fam)); b.appendChild(i); });
    b.addEventListener('click', () => restore(k));
    histEl.appendChild(b);
  }
  undoBtn.disabled = !hist.length;
  if (focusAt >= 0) {
    const now = bars();
    if (now.length) now[Math.min(focusAt, now.length - 1)].focus();
    else spinBtn.focus();
  }
}

const nowLabel = section.querySelector('.stage-foot .readout-label');
let footSlot = 0;                        // the reel the footer shows while stopped
function renderNow(ch, slot) {
  if (slot != null) footSlot = slot;
  chordEl.textContent = ch.name;
  colourEl.textContent = ch.colour;
  // Stopped, the footer names the reel it shows instead of claiming it plays
  if (nowLabel) nowLabel.textContent = run ? 'Now playing' : `Reel ${footSlot + 1}`;
}
// Stopped: the footer shows what its reel says now (the plain chord while Before is on)
function renderStill(slot) {
  if (run) return;
  if (slot != null) footSlot = slot;
  renderNow((state.before ? plainHand() : hand())[footSlot]);
}
function renderScore(announceHome) {
  const h = hand(), cad = C.cadence(h, state.key);
  heatEl.textContent = `Heat ${C.heat(h)} · ${CADENCE[cad]}`;
  if (announceHome && cad === 'home' && lastCadence !== 'home') say('Landed home.');
  lastCadence = cad;
}
function renderPips() {
  const p = pips[state.tune], n = p.filter(Boolean).length;
  // The dots are aria-hidden: this line is what gets read
  pipText.textContent = n === 5 ? 'Five floors, one tune.' : `Heard at ${n} of 5 spice levels`;
  Array.from(pipsEl.children).forEach((i, k) => {
    i.classList.toggle('on', p[k]);
    i.title = `${k + 1} ${C.LEVELS[k].name}`;
  });
}

// After any change to the chords: new voicings, thread, score, saved state
function handChanged({ faces = true, announceHome = true, keep = true } = {}) {
  voices = C.voicePath(state.tune, state.key, hand());
  plainVoices = C.voicePath(state.tune, state.key, plainHand());
  if (faces) renderFaces();
  renderThread();
  renderScore(announceHome);
  if (keep) save();
}


/* ════════════════════════════════════════════════════════════════════
   SOUND — one clock run at a time; every one-shot goes through a gate
   per run so Stop silences what is already scheduled.
   ════════════════════════════════════════════════════════════════════ */
let buses = null, run = null, audGate = null, hinted = false;

function ensureBuses() {
  if (buses) return buses;
  buses = {
    choir: Lab.bus(0.5, 0.9), bass: Lab.bus(0.25, 1), keys: Lab.bus(0.3, 0.8),
    brushes: Lab.bus(0.2, 0.9), melody: Lab.bus(0.3, 0.9), audition: Lab.bus(0.3, 0.9),
  };
  Object.keys(LAYER_LEVEL).forEach(n => { buses[n].gain.value = layerOn(n) ? LAYER_LEVEL[n] : 0; });
  return buses;
}
function rampLayer(name) {
  if (!buses || !Lab.ctx) return;
  buses[name].gain.setTargetAtTime(layerOn(name) ? LAYER_LEVEL[name] : 0, Lab.ctx.currentTime, 0.03);
}
function fadeGate(g) {
  const c = Lab.ctx;
  if (!c || !g) return;
  g.gain.setTargetAtTime(0, c.currentTime, 0.05);
  setTimeout(() => { try { g.disconnect(); } catch (e) {} }, 600);
}
function soundHint() {
  if (hinted) return;
  hinted = true;
  UI.soundHint(msgEl);
}
function noAudio() { UI.msg(msgEl, UI.MSG.noAudio); }

function makeChoir(r, voicing, at) {
  const n = Lab.lowPower ? 2 : 3;
  r.choir = voicing.map((m, v) => {
    const cv = Lab.choirVoice({ vowel: 'oo', n, spread: 7, vibDepth: 8, pan: CHOIR_PAN[v], dest: buses.choir });
    cv.jump(H.midiToFreq(m));
    cv.gainAt(CHOIR_GAIN[v], at, 0.08);
    return cv;
  });
}
function dropChoir(r) {
  if (r.choir) r.choir.forEach(cv => cv.stop(0.4));
  r.choir = null;
}
function dropMelVoice(r) {
  if (r.mel) r.mel.stop(0.3);
  r.mel = null;
}

function start() {
  if (!inView()) return false;           // a key on a focused button, scrolled away: nothing starts unseen
  const c = Lab.unlock();
  if (!c) { noAudio(); return false; }
  Lab.claim(OWNER, stopAll);
  ensureBuses();
  closeAudition();
  const T = C.TUNES[state.tune], t0 = c.currentTime + 0.06;
  const r = {
    tune: state.tune, cur: null, lap: null, choir: null, mel: null, cue: { keys: false, bass: false },
    gates: { bass: Lab.gate(buses.bass), keys: Lab.gate(buses.keys), brushes: Lab.gate(buses.brushes), mel: Lab.gate(buses.melody) },
    noteAt: [],
  };
  T.notes.forEach((n, k) => { r.noteAt[n.start8] = { midi: n.midi, k }; });
  const ok = Lab.clock.start(OWNER, {
    bpm: C.TEMPOS[state.tempo], stepsPerBeat: 2, loopSteps: T.total8, startAt: t0,
    onStep: (abs, when, info) => onStep(r, when, info),
    onStop: reason => endRun(r, reason),
  });
  if (!ok) { Object.values(r.gates).forEach(fadeGate); noAudio(); return false; }
  run = r;
  if (layerOn('choir')) makeChoir(r, (state.before ? plainVoices : voices)[0], t0);
  UI.setPlayBtn(playBtn, true, 'Play', 'Stop');
  if (nowLabel) nowLabel.textContent = 'Now playing';
  clearMsg(UI.MSG.paused, UI.MSG.noAudio);
  if (state.before && msgEl.textContent === MSG.beforeStill) UI.msg(msgEl, MSG.before);
  soundHint();
  return true;
}

function endRun(r, reason) {
  if (run === r) run = null;
  dropChoir(r);
  dropMelVoice(r);
  Object.values(r.gates).forEach(fadeGate);
  clearNow();
  UI.setPlayBtn(playBtn, false, 'Play', 'Stop');
  renderStill();
  if (state.before && msgEl.textContent === MSG.before) UI.msg(msgEl, MSG.beforeStill);
  if (reason !== 'user' && reason !== 'ended') UI.msg(msgEl, UI.MSG.paused);
}

// Lab.claim's stop function: another game took the sound, or the page was hidden
function stopAll(reason) {
  Lab.clock.stop(OWNER, reason || 'claimed');
  closeAudition();
}
function stopPlaying() {
  Lab.clock.stop(OWNER, 'user');
  Lab.release(OWNER);
}
function togglePlay() {
  if (run) stopPlaying();
  else start();
}

function onStep(r, when, info) {
  const T = C.TUNES[r.tune], step = info.loopStep, dur8 = info.stepDur;
  const slot = Math.floor(step / T.slot8), pos = step % T.slot8;
  // Latch on the slot change itself, so a dropped downbeat can't leave the old chord in charge
  if (!r.cur || r.cur.slot !== slot || r.cur.lap !== info.lap) startSlot(r, slot, when, info);
  const cur = r.cur;

  const note = r.noteAt[step];
  if (note) {
    playMelody(r, note.midi + cur.shift, when);
    Lab.clock.visual(when, () => showNote(note.k), OWNER);
  }
  // Layers that are off schedule nothing (Keys is off by default, and its notes sit outside
  // the voice cap). Turning Keys or Bass on leaves a cue, so it comes in on this very step,
  // about 120 ms after the tap, instead of waiting for its next beat or slot.
  const offBeat24 = step % 8 === 2 || step % 8 === 6;    // beats 2 and 4 of the bar
  const keysCue = r.cue.keys, bassCue = r.cue.bass;
  r.cue.keys = r.cue.bass = false;
  if (layerOn('keys') && (offBeat24 || keysCue)) cur.voicing.slice(1).forEach(m => Lab.keys(m, when, 0.8 * dur8, 0.4, r.gates.keys));
  if (bassCue && layerOn('bass') && !cur.bassNote && when < cur.bassEnd - 0.05) {
    cur.bassNote = Lab.bass(cur.voicing[0], when, { dur: cur.bassEnd - when, vel: 0.7, dest: r.gates.bass });
  }
  if (layerOn('brushes')) {
    if (step % 2 === 0) Lab.perc('shaker', when, { vel: 0.3, dest: r.gates.brushes });
    else Lab.perc('shaker', when + 0.16 * dur8, { vel: 0.18, dest: r.gates.brushes });
    if (offBeat24) Lab.perc('rim', when, { vel: 0.25, dest: r.gates.brushes });
  }
  // Chromatic walk-up into the next slot's bass
  if (pos === T.slot8 - 1 && !state.before && state.level >= 3 && layerOn('bass')) {
    const next = voices[(slot + 1) % 8][0] - 1;
    if (cur.bassNote) cur.bassNote.stop(when);
    Lab.bass(next, when, { dur: dur8 * 0.9, vel: 0.55, dest: r.gates.bass });
  }
  if (step === T.total8 - 1) {
    const lap = r.lap, level = state.level;
    Lab.clock.visual(when + dur8, () => {
      if (lap && lap.clean && lap.spiced) earnPip(r.tune, lap.level);
      UI.track('lab_play', { exp: 'reels', level });
    }, OWNER);
  }
}

// A lap earns its level's pip only if it actually played that level's colour: a chord from
// that level (at 1, any chord that isn't the plain one). Plain laps earn nothing.
function spiced(chord, slot, level) {
  return level === 1 ? chord.id !== cands(slot)[0].id : chord.lvl === level;
}
function startSlot(r, slot, when, info) {
  if (slot === 0) r.lap = { level: state.level, clean: true, spiced: false };
  else if (!r.lap) r.lap = { level: state.level, clean: false, spiced: false };
  const before = state.before;
  if (before || state.level !== r.lap.level) r.lap.clean = false;
  const chord = (before ? plainHand() : hand())[slot];
  const voicing = (before ? plainVoices : voices)[slot];
  if (!before && spiced(chord, slot, r.lap.level)) r.lap.spiced = true;
  const beat = 2 * info.stepDur, slotDur = C.TUNES[r.tune].slot8 * info.stepDur;
  const bassDur = Math.min(slotDur, 2 * beat) * 0.9;
  r.cur = { slot, lap: info.lap, before, chord, voicing, shift: C.shiftOf(state.key), bassEnd: when + bassDur, bassNote: null };
  if (layerOn('bass')) r.cur.bassNote = Lab.bass(voicing[0], when, { dur: bassDur, vel: 0.7, dest: r.gates.bass });
  if (r.choir) r.choir.forEach((cv, v) => cv.setAt(H.midiToFreq(voicing[v]), when, 0.06));
  Lab.clock.visual(when, () => showSlot(slot, chord), OWNER);
}

function playMelody(r, midi, when) {
  if (state.melody === 'voice') {
    if (!r.mel) {
      r.mel = Lab.choirVoice({ vowel: 'oo', n: 2, dest: buses.melody });
      r.mel.jump(H.midiToFreq(midi));
    }
    r.mel.setAt(H.midiToFreq(midi), when, 0.02);
    // A dip before every note, so Twinkle's repeated pitches are sung twice
    r.mel.gainAt(0.05, when - 0.04, 0.01);
    r.mel.gainAt(0.2, when, 0.02);
    return;
  }
  dropMelVoice(r);
  Lab.mallet(midi, when, { kind: 'musicbox', vel: 0.75, dest: r.gates.mel });
}

/* ── visuals, fired by Lab.clock.visual in time with the sound ── */
let nowSlot = -1, nowNote = -1;
function showSlot(slot, chord) {
  if (nowSlot >= 0) { reels[nowSlot].el.classList.remove('now'); laneBands[nowSlot].classList.remove('now'); }
  nowSlot = slot;
  reels[slot].el.classList.add('now');
  laneBands[slot].classList.add('now');
  renderNow(chord, slot);
  if (chord.id === hand()[slot].id || state.before) reels[slot].el.classList.remove('pending');
}
function showNote(k) {
  if (nowNote >= 0 && laneNotes[nowNote]) laneNotes[nowNote].classList.remove('now');
  nowNote = k;
  if (laneNotes[k]) laneNotes[k].classList.add('now');
}
function clearNow() {
  reels.forEach(r => r.el.classList.remove('now', 'pending'));
  laneBands.forEach(b => b.classList.remove('now'));
  laneNotes.forEach(n => n.classList.remove('now'));
  nowSlot = nowNote = -1;
}

/* ── audition: a nudge while stopped plays that slot once ── */
let audTimer = 0, audAt = -Infinity;
function closeAudition() {
  clearTimeout(audTimer);
  if (audGate) Lab.closeGate(audGate);
  audGate = null;
}
function audition(s) {
  if (!inView()) return;
  const c = Lab.unlock();
  if (!c) { noAudio(); return; }
  Lab.claim(OWNER, stopAll);
  ensureBuses();
  closeAudition();
  audGate = Lab.gate(buses.audition);
  const t = c.currentTime + 0.02;
  voices[s].forEach(m => Lab.keys(m, t, 1.2, 0.5, audGate));
  Lab.mallet(C.slotInfo(state.tune, state.key)[s].anchors[0], t, { kind: 'musicbox', vel: 0.75, dest: audGate });
  soundHint();
}
// Lab.keys notes ring for 2.6 s outside the voice cap and a closed gate only mutes them.
// A tap auditions at once, then at most every 150 ms; a held arrow key (repeat) auditions
// once it lets go or pauses, so browsing 50 chords doesn't stack hundreds of oscillators.
function auditionSoon(s, held) {
  clearTimeout(audTimer);
  const go = () => { audAt = performance.now(); if (!run) audition(s); };
  const wait = held ? 180 : audAt + 150 - performance.now();
  if (wait > 0) audTimer = setTimeout(go, wait);
  else go();
}


/* ════════════════════════════════════════════════════════════════════
   ACTIONS
   ════════════════════════════════════════════════════════════════════ */
function randomSeed() {
  try {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0];
  } catch (e) { return Math.floor(Math.random() * 4294967296); }
}
// Below 960 px the controls stack above the stage, so on a phone the Spin button and the
// reels are never on screen together. Bring the reels up, and hold the roll until they land.
const stacked = window.matchMedia ? window.matchMedia('(max-width: 960px)') : null;
function bringReelsIntoView() {
  if (!stacked || !stacked.matches) return 0;
  const r = reelsEl.getBoundingClientRect(), top = 64;            // under the fixed topbar
  if (r.top >= top && r.bottom <= window.innerHeight) return 0;
  reelsEl.scrollIntoView({ block: 'center', behavior: UI.REDUCED ? 'auto' : 'smooth' });
  return UI.REDUCED ? 0 : 320;
}
const snapshot = () => ({ level: state.level, ids: hand().map(c => c.id) });
function pushHistory() {
  hist.push(snapshot());
  if (hist.length > 8) hist.shift();
  renderHistory();
}

function doSpin() {
  if (!inView()) return;                 // S or a focused Spin, scrolled away: no unseen deal
  Lab.unlock();
  if (state.locks === 255) { UI.msg(msgEl, MSG.allLocked); return; }
  const locks = state.idx.map((v, s) => (isLocked(s) ? v : null));
  const old = hand();
  pushHistory();
  state.before = false;
  beforeBtn.setAttribute('aria-pressed', 'false');
  state.idx = C.spin(state.tune, state.key, state.level, randomSeed(), locks);
  lastNudge = -Infinity;
  const wasHome = lastCadence === 'home';
  handChanged({ faces: false, announceHome: false });
  const lead = bringReelsIntoView();
  for (let s = 0; s < 8; s++) {
    reels[s].el.classList.remove('before', 'pending');
    reels[s].win.setAttribute('aria-label', faceLabel(s));
    if (isLocked(s)) renderFace(s);
    else spinReel(s, lead + 70 * s);
  }
  // Announce the boldest chord that changed
  const now = hand();
  let pick = -1;
  now.forEach((c, s) => { if (!isLocked(s) && c.id !== old[s].id && (pick < 0 || c.lvl > now[pick].lvl)) pick = s; });
  say(pick < 0 ? 'Spun. Same chords as before.' : `Spun. Slot ${pick + 1} is now ${now[pick].name}, ${C.FAMILIES[now[pick].fam].say}.`);
  if (!wasHome && lastCadence === 'home') say('Landed home.');
  renderStill(0);
  UI.msg(msgEl, '');
  if (!run) start();
}

function nudge(s, dir, held) {
  if (!inView()) return;
  if (state.before) setBefore(false);
  const t = performance.now();
  if (t - lastNudge > 1500) pushHistory();       // a burst of nudges is one history entry
  lastNudge = t;
  const list = cands(s);
  state.idx[s] = mod(state.idx[s] + dir, list.length);
  handChanged({ faces: false });
  tick(s, dir);
  const ch = hand()[s];
  clearMsg(MSG.fresh, MSG.link, MSG.badLink);
  // The face's label changes too, but screen readers rarely re-read a focused button
  say(`Slot ${s + 1}: ${ch.name}, ${C.FAMILIES[ch.fam].say}.`);
  if (run) reels[s].el.classList.add('pending');
  else { renderNow(ch, s); auditionSoon(s, held); }
}

function toggleLock(s) {
  state.locks ^= 1 << s;
  renderLock(s);
  say(isLocked(s) ? `Locked slot ${s + 1}.` : `Unlocked slot ${s + 1}.`);
  if (state.locks !== 255) clearMsg(MSG.allLocked);
  save();
}

function setBefore(on) {
  state.before = on;
  beforeBtn.setAttribute('aria-pressed', String(on));
  renderFaces();
  renderThread();
  renderStill();                         // playing, the next slot swaps the footer in time
  if (on) UI.msg(msgEl, run ? MSG.before : MSG.beforeStill);
  else clearMsg(MSG.before, MSG.beforeStill);
}

function restore(k) {
  const entry = hist.splice(k, 1)[0];
  if (!entry) return;
  pushHistory();                                  // so this hand can be swapped back
  applyEntry(entry);
  say(`Back to spin ${k + 1}.`);
}
function undo() {
  const entry = hist.pop();
  if (!entry) return;
  renderHistory();
  applyEntry(entry);
  say('Undid the last spin.');
}
function applyEntry(entry) {
  const old = hand();
  if (entry.level !== state.level) {
    state.level = entry.level;
    setSpice(spiceSeg.querySelector(`[data-level="${entry.level}"]`));
  }
  state.idx = entry.ids.map((id, s) => Math.max(0, cands(s).findIndex(c => c.id === id)));
  state.before = false;
  beforeBtn.setAttribute('aria-pressed', 'false');
  clearMsg(MSG.before, MSG.beforeStill, MSG.fresh, MSG.link, MSG.badLink);   // none of them is true now
  lastNudge = -Infinity;
  handChanged();
  hand().forEach((c, s) => {
    if (c.id === old[s].id) return;
    if (UI.REDUCED) flash(s); else land(s);
  });
  renderStill(0);
}

// A lower spice (or a key where a chord no longer fits) drops chords back to plain. Put the
// hand in the history first, at its own level, so Undo spin or its bar brings it back.
// Flicking through levels is one change, like a burst of nudges.
let lastRemap = -Infinity;
function keepIfLost(idx, level, key) {
  const was = hand();
  const lost = idx.some((i, s) => C.candidates(state.tune, s, key, level)[i].id !== was[s].id);
  if (!lost) return;
  const t = performance.now();
  if (t - lastRemap > 1500) pushHistory();
  lastRemap = t;
}
function setLevel(level) {
  if (!(level >= 1 && level <= 5) || level === state.level) return;
  const idx = C.remapIdx(state.tune, state.key, state.level, level, state.idx);
  keepIfLost(idx, level, state.key);
  state.idx = idx;
  state.level = level;
  handChanged();
  renderStill();
}
function setKey(key) {
  if (!(key >= 0 && key <= 11) || key === state.key) return;
  const idx = C.remapIdx(state.tune, key, state.level, state.level, state.idx, state.key);
  keepIfLost(idx, state.level, key);
  state.idx = idx;
  state.key = key;
  renderHistory();                                 // the bars' labels name the chords in the new key
  handChanged();
  renderStill(0);
}
function setTempo(i) {
  if (!(i >= 0 && i <= 2)) return;
  state.tempo = i;
  if (run) Lab.clock.setTempo(OWNER, C.TEMPOS[i]);
  save();
}
function setTune(tune) {
  if (!C.TUNES[tune] || tune === state.tune) return;
  if (run) stopPlaying();
  closeAudition();
  state.tune = tune;
  state.idx = [0, 0, 0, 0, 0, 0, 0, 0];
  state.locks = 0;
  state.before = false;
  beforeBtn.setAttribute('aria-pressed', 'false');
  hist = [];
  lastNudge = -Infinity;
  buildLane();
  renderHistory();
  handChanged({ announceHome: false });
  renderPips();
  renderNow(hand()[0], 0);
  UI.msg(msgEl, MSG.fresh);
}
function toggleLayer(btn) {
  const name = btn.dataset.layer;
  if (!C.LAYERS[name]) return;
  state.layers ^= C.LAYERS[name];
  const on = layerOn(name);
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', String(on));
  if (name === 'choir') syncChoir();
  else {
    rampLayer(name);
    if (run && on && name in run.cue) run.cue[name] = true;
  }
  save();
}
// Each new choir is 4 voices of about 24 oscillators with a second-long tail. The first
// toggle acts at once; a burst (a held Enter) settles on its last state every 250 ms.
let choirTimer = 0, choirAt = -Infinity;
function syncChoir() {
  clearTimeout(choirTimer);
  const wait = choirAt + 250 - performance.now();
  if (wait > 0) { choirTimer = setTimeout(syncChoir, wait); return; }
  if (!run) return;
  const on = layerOn('choir');
  if (on === !!run.choir) return;
  choirAt = performance.now();
  if (on && Lab.ctx) makeChoir(run, run.cur ? run.cur.voicing : voices[0], Lab.ctx.currentTime);
  else if (!on) dropChoir(run);
}
function setMelody(m) {
  state.melody = m === 'voice' ? 'voice' : 'box';
  if (run && state.melody === 'box') dropMelVoice(run);
  save();
}

function earnPip(tune, level) {
  const p = pips[tune];
  if (!p || p[level - 1]) return;
  p[level - 1] = true;
  persist();
  if (tune !== state.tune) return;
  renderPips();
  if (p.every(Boolean)) say('Five floors, one tune.');
}

function copyLink() {
  UI.msg(msgEl, '');
  UI.share('reels', C.encode(state), msgEl).then(res => {
    if (res === 'copied') { UI.msg(msgEl, MSG.copied); return; }
    const inp = msgEl.querySelector('input.share-url');
    if (inp) msgEl.insertBefore(document.createTextNode(MSG.copyHere), inp);
  });
}


/* ════════════════════════════════════════════════════════════════════
   WIRING
   ════════════════════════════════════════════════════════════════════ */
for (let k = 0; k < 12; k++) {
  const o = document.createElement('option');
  o.value = String(k);
  o.textContent = C.pcName(k) + ' major';
  keySel.appendChild(o);
}
const setTuneBtn = UI.segBind(tuneSeg, d => setTune(d.tune));
const setSpice = UI.segBind(spiceSeg, d => setLevel(+d.level));
const setTempoBtn = UI.segBind(tempoSeg, d => setTempo(+d.tempo));
const setMelBtn = UI.segBind(melSeg, d => setMelody(d.melody));
layersSeg.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b && layersSeg.contains(b)) toggleLayer(b);
});
keySel.addEventListener('change', () => setKey(+keySel.value));
spinBtn.addEventListener('click', doSpin);
playBtn.addEventListener('click', togglePlay);
beforeBtn.addEventListener('click', () => setBefore(!state.before));
undoBtn.addEventListener('click', undo);
copyBtn.addEventListener('click', copyLink);
Lab.unlockOn(section);

section.addEventListener('keydown', e => {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  // Scrolled away with focus still inside: the key is not the game's, nothing changes unseen
  if (!inView()) return;
  if (e.target.closest('select, input, textarea')) return;
  const k = e.key.toLowerCase();
  if (k === 's') doSpin();
  else if (k === 'p') togglePlay();
  else if (k === 'b') setBefore(!state.before);
  else if (k === 'l') {
    const reel = e.target.closest('.reel');
    if (!reel) return;
    toggleLock(+reel.dataset.slot);
  } else return;
  e.preventDefault();
});

UI.watchVisibility(section, visible => {
  if (visible) return;
  if (run) Lab.clock.stop(OWNER, 'offscreen');
  closeAudition();
  Lab.release(OWNER);
});

// Put every control in line with `state` (after a link or a saved hand)
function syncControls() {
  setTuneBtn(tuneSeg.querySelector(`[data-tune="${state.tune}"]`));
  setSpice(spiceSeg.querySelector(`[data-level="${state.level}"]`));
  setTempoBtn(tempoSeg.querySelector(`[data-tempo="${state.tempo}"]`));
  setMelBtn(melSeg.querySelector(`[data-melody="${state.melody}"]`));
  keySel.value = String(state.key);
  layersSeg.querySelectorAll('button').forEach(b => {
    const on = layerOn(b.dataset.layer);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  beforeBtn.setAttribute('aria-pressed', String(state.before));
}

// A link's hand (or the plain chords, when it didn't survive): say so and bring the reels up
function showLinkResult(ok) {
  UI.msg(msgEl, ok ? MSG.link : MSG.badLink);
  setTimeout(() => {
    // Older engines reject 'instant'; the smooth page scroll is fine there
    try { section.scrollIntoView({ block: 'start', behavior: 'instant' }); } catch (e) { section.scrollIntoView(true); }
  }, 0);
}
const linkState = () => {
  const payload = UI.readHash('reels');
  return payload ? C.decode(payload) : null;
};

/* ── start-up: a share link beats the saved hand, which beats plain ── */
(function init() {
  const stored = UI.store.get(STORE, null);
  if (stored && stored.pips) {
    ['twinkle', 'frere'].forEach(t => {
      const p = stored.pips[t];
      if (Array.isArray(p)) for (let k = 0; k < 5; k++) pips[t][k] = p[k] === true;
    });
  }
  const own = stored && typeof stored.last === 'string' ? C.decode(stored.last) : null;
  if (own) ownLast = stored.last;
  const fromLink = (location.hash || '').startsWith('#reels='), st = fromLink ? linkState() : null;
  if (st) Object.assign(state, st);
  else if (!fromLink && own) Object.assign(state, own);
  syncControls();
  buildLane();
  renderHistory();
  // Only the visitor's own changes are saved: opening someone's link must not replace their last hand
  handChanged({ announceHome: false, keep: false });
  renderPips();
  renderNow(hand()[0], 0);
  if (fromLink) showLinkResult(!!st);
  else if (state.idx.every(i => i === 0)) UI.msg(msgEl, MSG.fresh);
})();

// A link opened in this tab (pasted over the address, or Back / Forward) loads like a fresh
// visit: no autoplay, the link message, the reels scrolled up. Undo spin brings your hand back.
window.addEventListener('hashchange', () => {
  // '#reels' alone (the contents list, or a link you have since edited) is not a hand
  if (!(location.hash || '').startsWith('#reels=')) return;
  const st = linkState();
  if (saveTimer) keepOwn();                        // an edit still waiting to be saved is yours
  if (run) stopPlaying();
  closeAudition();
  const next = st || C.defaultState();
  if (next.tune !== state.tune) hist = [];         // earlier hands only make sense within one tune
  else pushHistory();
  Object.assign(state, next);
  lastNudge = lastRemap = -Infinity;
  syncControls();
  buildLane();
  renderHistory();
  handChanged({ announceHome: false, keep: false });
  renderPips();
  renderNow(hand()[0], 0);
  showLinkResult(!!st);
});

})();

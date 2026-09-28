/* ════════════════════════════════════════════════════════════════════
   07 — DOWNBEAT
   A pocket orchestra plays Ode to Joy one beat per tap, at your speed.
   Stop and it holds the chord and waits. Height = dynamics, lane = which
   section comes in, where you tap the last chord = the ending. The take
   draws itself as a score ribbon and can be replayed, heard deadpan and
   shared. Music + maths live in lab/downbeat-core.js (LabCores.downbeat).
   ════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';

const OWNER = 'downbeat';
const section = document.getElementById('downbeat');
if (!section) return;
const Lab = window.Lab, UI = window.LabUI, Cores = window.LabCores;
if (!Lab || !UI || !Cores || !Cores[OWNER] || !Cores.kit || !Lab.clock) {
  const st = section.querySelector('.exp-stage .stage');
  // lab.js has already said so when harmony.js is missing; don't say it twice
  if (st && !st.querySelector(':scope > .inline-msg.on')) {
    const msg = document.createElement('p');
    msg.className = 'inline-msg on';
    msg.style.margin = '22px';
    msg.textContent = (UI && UI.MSG && UI.MSG.noEngine) || 'This experiment couldn’t load its music engine. Refresh the page to try again.';
    st.prepend(msg);
  }
  return;
}

const H = window.Harmony, D = Cores[OWNER];
const REDUCED = UI.REDUCED;
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;

const KEY = 2;                                     // the pad plays in D
const STORE_KEY = 'jc-lab-downbeat-v1';
const LANE_RGB = ['180,136,255', '244,239,230', '77,215,255', '255,78,38'];
const END_RGB = ['244,239,230', '255,184,74', '180,136,255'];
const AMBER = '255,184,74';
const BUS_LEVEL = [0.9, 0.9, 0.8, 0.7];
const PAN = { s: 0.15, a: -0.25, t: 0.25, b: -0.1 };
const SEC_NAMES = D.SECTIONS.map(s => s.label);
const WAIT_K = 1.4, REST_S = 10, REST_STOP_S = 3, HOLD_MS = 350;
const MAX_DT = D.MAX_DT;        // a longer wait replays as 8 s: nobody wants to re-watch a minute of silence
const EARLY_MIN = 8;            // Esc keeps a take this long or longer
const TXT = {
  idle: 'Tap to give the first beat',
  autoIdle: 'Tap to start. They’ll keep time, you shape it.',   // no lone 'it.' on the last line
  linkIdle: 'Someone sent you a take',
  linkIdleSub: 'Watch their take first, or tap to conduct your own',
  wait: 'Waiting for you',
  rest: 'They’re resting. Tap to carry on.',
  cap: 'Where you tap the last chord picks the ending.',
  link: 'Someone sent you a take. Watch it first, then have a go.',
  turn: 'Your turn. Tap the stage to conduct your own.',
  badLink: 'That take didn’t survive the trip. Tap the stage to conduct your own.',
  copied: 'Link copied. Whoever opens it can watch your take first.',
};
// All nine arrangements × endings up front; each is 64 frozen beats
const EV = [0, 1, 2].map(s => [0, 1, 2].map(e => D.beatEvents(s, KEY, e)));

const pad = $('dbPad'), lanesEl = $('dbLanes'), stateEl = $('dbState');
const reviewEl = $('dbReview'), takeNameEl = $('dbTakeName'), statsEl = $('dbStats');
const whereEl = $('dbWhere'), chordEl = $('dbChord'), colourEl = $('dbColour'), inEl = $('dbIn');
const liveEl = $('dbLive'), msgEl = $('dbMsg'), scoreEl = $('dbScore');
const replayBtn = $('dbReplay'), deadpanBtn = $('dbDeadpan'), resetBtn = $('dbReset'), copyBtn = $('dbCopy'), againBtn = $('dbAgain');
const styleSeg = $('dbStyle'), modeSeg = $('dbMode'), autoSeg = $('dbAutoTempo'), secSeg = $('dbSections');
const rulerEls = Array.from(section.querySelectorAll('.db-ruler span'));
if (!pad || !stateEl || !scoreEl || !lanesEl) return;
const g = pad.getContext('2d');
/* Once you have a take of your own, #dbReplay plays yours; a shared take stays
   reachable through this second button. Made here if the markup lacks it. */
let theirsBtn = $('dbTheirs');
if (!theirsBtn && replayBtn) {
  theirsBtn = document.createElement('button');
  theirsBtn.id = 'dbTheirs'; theirsBtn.type = 'button'; theirsBtn.className = 'btn ghost';
  theirsBtn.innerHTML = '<span class="ico play"></span><span class="lbl">Watch their take</span>';
  replayBtn.after(theirsBtn);
}
function showTheirsBtn(on) {
  if (!theirsBtn) return;
  if (!on && document.activeElement === theirsBtn) { try { replayBtn.focus({ preventScroll: true }); } catch (e) {} }
  theirsBtn.hidden = !on;
  theirsBtn.style.display = on ? '' : 'none';           // .btn is inline-flex, which beats [hidden]
}
showTheirsBtn(false);


/* ════════════════════════════════════════════════════════════════════
   SOUND — engine.beat is the one path for live, auto, replay and deadpan
   ════════════════════════════════════════════════════════════════════ */
let buses = null, runGates = null, beatGates = null, voices = null;
let curVowel = 'oh', choirLevel = 0;

function setupAudio() {
  if (!buses) buses = [Lab.bus(0.2, 0.9), Lab.bus(0.6, 0.9), Lab.bus(0.3, 0.8), Lab.bus(0.45, 0.7)];
  // One-shots run through these, so a stop also silences what the clock already scheduled
  if (!runGates) runGates = buses.map(b => Lab.gate(b));
}
const freq = m => H.midiToFreq(m);
function forVoices(fn) { if (voices) ['s', 'a', 't', 'b'].forEach(k => fn(voices[k], k)); }
const vowelFor = (band, style) => (style === 2 || band <= 1 ? 'oo' : band <= 3 ? 'oh' : 'ah');

function ensureVoices(ev, vowel) {
  if (voices) return false;
  const n = Lab.lowPower ? 2 : 3;
  voices = {};
  ['s', 'a', 't', 'b'].forEach(k => {
    voices[k] = Lab.choirVoice({ n, spread: 8, vibDepth: 10, vowel, pan: PAN[k], dest: buses[1] });
  });
  voices.s.jump(freq(ev.melodyNow));
  ['a', 't', 'b'].forEach(k => voices[k].jump(freq(ev.satb[k])));
  curVowel = vowel;
  return true;
}
function releaseVoices(rel) { forVoices(v => v.stop(rel)); voices = null; }
// cut: also close the run gates, silencing one-shots that are already scheduled
function silence(cut, rel) {
  if (beatGates) { beatGates.forEach(x => Lab.closeGate(x)); beatGates = null; }
  if (cut && runGates) { runGates.forEach(x => Lab.closeGate(x)); runGates = null; }
  releaseVoices(rel);
}

// A lane cue: that section's bus jumps ×1.6 and settles back within the beat
function spotlight(k, when, bd) {
  if (!buses) return;
  const p = buses[k].gain, base = BUS_LEVEL[k];
  if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(when); else p.cancelScheduledValues(when);
  p.setTargetAtTime(base * 1.6, when, 0.012);
  p.setTargetAtTime(base, when + 0.05, 0.5 * bd);
}
// choirVoice.vowel acts now; clock-driven beats are planned ~120 ms ahead, so wait for them
function atTime(when, fn) {
  const c = Lab.ctx;
  if (!c || when - c.currentTime < 0.03) fn();
  else Lab.clock.visual(when, fn, OWNER);
}
function setVowel(v, when) {
  if (v === curVowel) return;
  curVowel = v;
  atTime(when, () => forVoices(x => x.vowel(v)));
}
const levelOf = k => choirLevel + (k === 's' ? 0.02 : 0);
function swell(when, style) {
  forVoices((v, k) => v.gainAt(levelOf(k) * 1.35, when, 0.6));
  if (style !== 2) setVowel('ah', when);
}
function unswell(when, vowel) {
  forVoices((v, k) => v.gainAt(levelOf(k), when, 0.4));
  setVowel(vowel, when);
}

// One bass / timpani / bell / keys hit, as planned by D.beatHits
function playHit(h, when, bd, band) {
  const t = when + h.off * bd + h.roll;
  const kv = 0.3 + 0.1 * band, kd = Math.max(0.4, bd * 1.2);
  switch (h.role) {
    case 'bass': Lab.bass(h.midi, t, { dur: 2 * bd * 0.9, vel: 0.5 + 0.08 * band, dest: runGates[0] }); break;
    case 'timp': Lab.perc('timp', t, { midi: h.midi, vel: 0.6, dest: runGates[0] }); break;
    case 'bell': Lab.mallet(h.midi, t, { kind: 'bell', vel: 0.4 + 0.08 * band, dest: h.gate === 'beat' ? beatGates[1] : runGates[3] }); break;
    case 'arp': case 'stab': Lab.keys(h.midi, t, kd, kv, h.gate === 'beat' ? beatGates[0] : runGates[2]); break;
    case 'pick': Lab.keys(h.midi, t, kd * 0.6, kv * 0.8, beatGates[0]); break;
    case 'lull': Lab.keys(h.midi, t, 2 * bd, 0.35, runGates[2]); break;
    case 'bloom': Lab.keys(h.midi, t, 2.4, 0.5, runGates[2]); break;
  }
}

// o: { style, ending, beatDur, sections[4], hold, releaseAt }
function soundBeat(i, when, band, lane, o) {
  if (!Lab.ctx) return;
  const evs = EV[o.style][o.ending], ev = evs[i];
  if (!ev) return;
  setupAudio();
  const bd = o.beatDur, secs = o.sections;
  const vowel = vowelFor(band, o.style);
  const fresh = ensureVoices(ev, vowel);
  // 1 · an early tap must not let the last beat's off-beat 8th sound late
  if (beatGates) beatGates.forEach(x => Lab.closeGate(x, when));
  beatGates = [Lab.gate(runGates[2]), Lab.gate(runGates[3])];
  forVoices(v => v.clearFrom(when));
  spotlight(lane, when, bd);
  // 2 · the choir: lower voices move on the half-bar; the tune on every beat
  // (a held note is re-stated, which also mends an off-beat an early tap cancelled)
  if (ev.halfStart) ['a', 't', 'b'].forEach(k => voices[k].setAt(freq(ev.satb[k]), when, 0.05));
  voices.s.setAt(freq(ev.melodyOn != null ? ev.melodyOn : ev.melodyNow), when, 0.025);
  if (ev.melodyAnd != null) voices.s.setAt(freq(ev.melodyAnd), when + ev.swing * bd, 0.025);
  // 3 · low end, bells and keys: at most D.MAX_HITS one-shots
  D.beatHits(o.style, KEY, o.ending, i, secs, band).forEach(h => playHit(h, when, bd, band));
  // 4 · dynamics (louder is also brighter), and every tap is heard: the
  // choir is a held pad, so a new or repeated tune note is re-sung with a
  // quick dip in the soprano, and a held beat gets a soft pulse from all four
  choirLevel = 0.06 + 0.035 * band;
  const prev = evs[i - 1];
  const prevS = prev ? (prev.melodyAnd != null ? prev.melodyAnd : prev.melodyNow) : null;
  let settle = when;
  forVoices((v, k) => {
    const dip = fresh ? 1 : ev.melodyOn == null ? 0.8 : k !== 's' ? 1 : ev.melodyOn === prevS ? 0.4 : 0.7;
    if (dip < 1) {
      v.gainAt(levelOf(k) * dip, when, 0.012);
      v.gainAt(levelOf(k), when + 0.045, 0.05);
      settle = when + 0.045;
    } else v.gainAt(levelOf(k), when, fresh ? 0.12 : 0.08);
  });
  setVowel(vowel, when);
  if (o.hold) {
    swell(settle, o.style);
    if (o.releaseAt) unswell(Math.max(settle, o.releaseAt), vowel);
  }
}


/* ════════════════════════════════════════════════════════════════════
   STATE
   ════════════════════════════════════════════════════════════════════ */
let mode = 'you', style = 0, pendingStyle = 0, autoBpm = 88;
let phase = 'idle';                 // idle · live · done · replay
let next = 0;                       // the next beat to play, 0–63
let cur = null;                     // the take being conducted, or just finished
let mine = null, sessionTake = false, linkTake = null, ghost = null;
let ending = 0, takeNo = 0;
let kbBand = 3, aim = 1, kbHeld = false;
let lastBand = 3, lastLane = 1, lastFrac = 0.375;     // the latest tap; auto-beat reads these
const sections = [false, true, false, false];
const follower = D.makeTempoFollower();
let beatDur = 60 / 72, lastTapT = null, lastTapPerf = 0, lastBeatT = 0;
let waiting = false, resting = false, paused = false, waitStart = 0;
let holdInfo = null;                // { id, pos, fermata, timer }
let autoBase = 0;
let replay = null;                  // { which, take, theirs, times, sections, prevPhase, at }
let halting = false;
let cueQueue = [];                  // sections brought in by key or button, not yet written into the take
let kbAim = false;                  // draw the keyboard aim only for keyboard users
let deferredLink = null;            // a link opened mid-performance waits for it to end
let watchedLink = false;            // the visitor has started watching the take they were sent
let ownCard = null;                 // { title, stats } of your latest take's review card
const timers = { wait: 0, rest: 0, restStop: 0, end: 0 };

function clearTimer(k) { clearTimeout(timers[k]); timers[k] = 0; }
function clearTimers() { Object.keys(timers).forEach(clearTimer); }
const quantDt = s => clamp(Math.round(s * 100) * 10, D.MIN_DT, MAX_DT);
const replayTarget = () => (linkTake && !sessionTake ? linkTake : mine);
function clearPausedMsg() { if (msgEl.textContent === UI.MSG.paused) UI.msg(msgEl, ''); }
// A copied link (or the fallback share box) was about the take you had then
function clearShareMsg() {
  const box = msgEl.querySelector('input.share-url');
  const copied = msgEl.textContent === TXT.copied;
  if (!box && !copied) return;
  if (box) box.remove();
  UI.msg(msgEl, copied ? '' : msgEl.textContent);
}
// Your own take has begun: an invitation to watch or a copied link no longer applies
function clearTakeMsgs() {
  clearShareMsg();
  if ([TXT.link, TXT.turn, TXT.badLink].includes(msgEl.textContent)) UI.msg(msgEl, '');
}
/* The card's only focusable is Conduct again: hiding it with focus inside would drop
   focus to <body>, outside the section where Space, R and Esc are heard. */
function hideReview() {
  if (!reviewEl.hidden && reviewEl.contains(document.activeElement)) { try { pad.focus({ preventScroll: true }); } catch (e) {} }
  reviewEl.hidden = true;
}
function showCard(title, stats, again) {
  takeNameEl.textContent = title;
  statsEl.textContent = D.noWrapItems(stats);            // 'pp to ff' and '4 sections in' never split across lines
  againBtn.textContent = again;
  reviewEl.hidden = false;
}
// From bar 16 the lanes pick the ending, so a tap there cues nothing
function cue(secs, lane, i) {
  if (i >= D.ENDING_FROM || lane === 1 || secs[lane]) return false;   // the choir is always in; its lane only spotlights
  secs[lane] = true;
  return true;
}
/* The lane a beat is written with: its own cue, or else a section that a key or
   the Sections buttons brought in, so the take (stats, replay) has it too. */
function recordLane(lane, newly, i) {
  if (newly || !cueQueue.length || i >= D.ENDING_FROM) return lane;
  return cueQueue.shift();
}
/* UI.announce drops a repeat of the last text, but a second wait or fermata is
   news. A trailing no-break space makes it a new string that reads the same. */
const sayFlip = new Map();
function say(text, again) {
  let t = text;
  if (again) { const f = !sayFlip.get(text); sayFlip.set(text, f); if (f) t += ' '; }
  UI.announce(liveEl, t);
}


/* ════════════════════════════════════════════════════════════════════
   CONDUCTING
   ════════════════════════════════════════════════════════════════════ */
/* Gaps between taps are timed on the event clock, not the audio clock: on the very
   first tap the AudioContext is still starting and would under-read that tap. */
function tapSeconds(e) { return (e && e.timeStamp > 0 ? e.timeStamp : performance.now()) / 1000; }
function padPoint(e) {
  const r = pad.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
}

// p is null for the keyboard: then the ↑↓ band and ←→ aim stand in for the pointer
function input(p, e, holdId) {
  const c = Lab.unlock();
  if (!c) { UI.msg(msgEl, UI.MSG.noAudio); return; }
  if (phase === 'replay') { halt('user'); return; }
  if (phase === 'done') return;                         // until Conduct again
  if (phase === 'live' && next >= 64) return;           // the last beat has sounded; the card is on its way
  const band = p ? D.bandFromY(p.y, p.h) : kbBand;
  const lane = p ? D.laneFromX(p.x, p.w) : aim;
  const frac = p ? p.x / p.w : (aim + 0.5) / 4;
  const pos = p ? { x: p.x, y: p.y } : { x: laneX(aim), y: bandY(kbBand) };
  if (mode === 'auto') {
    lastBand = band; lastLane = lane; lastFrac = frac;
    tapFx(pos, lane);
    showRuler(band);
    if (!Lab.clock.isRunning(OWNER)) startAuto();
    return;
  }
  const t = tapSeconds(e);
  const prevBeat = cur && cur.beats[cur.beats.length - 1];
  const r = follower.tap(t, paused || !!(prevBeat && prevBeat.hold));
  if (!r.accepted) return;
  liveBeat(t, r, band, lane, frac, pos, holdId);
}

function beginTake() {
  phase = 'live';
  cur = { v: 1, style, mode: mode === 'auto' ? 1 : 0, ending: 0, beats: [] };
  ending = 0;
  cueQueue = [0, 2, 3].filter(k => sections[k]);
  hideReview();
  clearTakeMsgs();
  UI.track('lab_play', { exp: 'downbeat', style: D.STYLES[style].toLowerCase(), mode });
}
function record(beat) {
  cur.beats.push(beat);
  cur.style = style;
  cur.ending = ending;
}

function liveBeat(t, r, band, lane, frac, pos, holdId) {
  Lab.claim(OWNER, halt);
  const c = Lab.ctx, i = next;
  if (i === 0) beginTake();
  if (i % 2 === 0) style = pendingStyle;              // arrangement changes land on the half-bar
  if (i === 62) ending = D.endingFromX(frac, 1);
  const prevDur = beatDur;
  beatDur = r.beatDur;
  // A pause (scrolled away, tab hidden) is not rubato: record it as one ordinary beat
  const dt = i === 0 ? 0 : paused ? quantDt(prevDur) : quantDt(t - lastTapT);
  if (paused) { paused = false; clearPausedMsg(); }
  lastTapT = t; lastTapPerf = performance.now();
  stopWaiting();
  const newly = cue(sections, lane, i);
  const when = c.currentTime + 0.005;
  lastBeatT = t;
  soundBeat(i, when, band, lane, { style, ending, beatDur, sections });
  if (i === 0) UI.soundHint(msgEl);
  record({ dt, band, lane: recordLane(lane, newly, i), hold: 0 });
  lastBand = band; lastLane = lane; lastFrac = frac;
  next = i + 1;
  afterBeat(i, style, ending, band, lane, newly, r.bpm);
  tapFx(pos, lane);
  if (holdId != null) startHold(holdId, pos);
  if (i === 63) timers.end = setTimeout(() => finishTake(false), 2 * beatDur * 1000);
  else armWaiting();
}

// Readouts, ribbon, lanes and the live region after a beat has sounded
function afterBeat(i, st, en, band, lane, newly, bpm) {
  readout(i, st, en, bpm, band);
  const ev = EV[st][en][i];
  let line = i === 0 ? 'Choir in. Bar 1.' : ev.beatInBar === 1 && (ev.bar - 1) % 4 === 0 ? `Bar ${ev.bar}.` : '';
  if (i === 59) line = 'Bar 16. ' + TXT.cap;
  if (newly) line = `${SEC_NAMES[lane]} in.` + (line ? ' ' + line : '');
  if (line) say(line, i === 0);
  flash(lane, beatDur);
  renderSections(); renderLanes(); renderIn(); showState(); updateRibbon();
}
function readout(i, st, en, bpm, band) {
  const ev = EV[st][en][i];
  whereEl.textContent = `Bar ${ev.bar} · beat ${ev.beatInBar}`;
  chordEl.textContent = ev.chord.name;
  colourEl.textContent = `${D.tempoWord(bpm)} · ${Math.round(bpm)} BPM · ${D.DYN_WORDS[band]}`;
  showRuler(band);
}

/* ── waiting ── */
// After a long gap that may be your new, slower tempo, wait by that gap instead
function armWaiting() {
  clearTimer('wait');
  timers.wait = setTimeout(enterWaiting, (follower.longGap || beatDur) * WAIT_K * 1000);
}
function enterWaiting() {
  timers.wait = 0;
  if (phase !== 'live' || mode !== 'you' || (holdInfo && holdInfo.fermata)) return;
  waiting = true;
  waitStart = performance.now();
  say('Waiting for your next beat.', true);
  timers.rest = setTimeout(enterResting, REST_S * 1000);
  showState(); wake();
}
function enterResting() {
  timers.rest = 0;
  resting = true;
  const c = Lab.ctx;
  if (c) forVoices(v => v.gainAt(0, c.currentTime, 0.8));
  timers.restStop = setTimeout(() => { timers.restStop = 0; releaseVoices(0.35); }, REST_STOP_S * 1000);
  showState(); drawOnce();
}
function stopWaiting() {
  clearTimer('wait'); clearTimer('rest'); clearTimer('restStop');
  waiting = resting = false;
}

/* ── fermata: still down after 350 ms ── */
function startHold(id, pos) {
  if (holdInfo) { clearTimeout(holdInfo.timer); fermataAt = null; }
  const h = { id, pos, fermata: false, timer: 0 };
  h.timer = setTimeout(() => {
    if (holdInfo !== h || phase !== 'live' || mode !== 'you' || !Lab.ctx) return;
    h.fermata = true;
    clearTimer('wait');                                  // no "waiting" while you hold
    clearTimer('end');                                   // nor the card, on a held last chord
    swell(Lab.ctx.currentTime, style);
    const b = cur && cur.beats[cur.beats.length - 1];
    if (b) b.hold = 1;
    fermataAt = pos;
    say('Fermata.', true);
    drawOnce();
  }, HOLD_MS);
  holdInfo = h;
}
function endHold(id, quiet) {
  const h = holdInfo;
  if (!h || (id != null && h.id !== id)) return;
  holdInfo = null;
  clearTimeout(h.timer);
  if (!h.fermata) return;
  fermataAt = null;
  const c = Lab.ctx;
  if (!quiet && phase === 'live') {
    if (c && voices) unswell(c.currentTime, vowelFor(lastBand, style));
    if (next < 64) { if (voices) armWaiting(); }
    else { clearTimer('end'); timers.end = setTimeout(() => finishTake(false), 2 * beatDur * 1000); }
  }
  drawOnce();
}

/* ── auto-beat: the clock keeps time, taps shape it ── */
function startAuto() {
  if (next >= 64) return;
  Lab.claim(OWNER, halt);
  if (next === 0) beginTake();
  paused = false; clearPausedMsg();
  stopWaiting();
  autoBase = next;
  Lab.clock.start(OWNER, { bpm: autoBpm, stepsPerBeat: 1, onStep: autoStep, onStop: onClockStop });
  showState();
}
function autoStep(step, when, info) {
  const i = autoBase + step;
  if (i > 63) { Lab.clock.stop(OWNER, 'ended'); return; }
  if (i % 2 === 0) style = pendingStyle;
  if (i === 62) ending = D.endingFromX(lastFrac, 1);
  beatDur = info.stepDur;
  const band = lastBand, lane = lastLane, st = style, en = ending;
  const newly = cue(sections, lane, i);
  soundBeat(i, when, band, lane, { style: st, ending: en, beatDur, sections });
  if (i === 0) UI.soundHint(msgEl);
  record({ dt: i === 0 ? 0 : quantDt(info.stepDur), band, lane: recordLane(lane, newly, i), hold: 0 });
  next = i + 1;
  lastBeatT = performance.now() / 1000 + (when - Lab.ctx.currentTime);   // when it sounds, on the event clock
  Lab.clock.visual(when, () => {
    if (phase !== 'live') return;
    afterBeat(i, st, en, band, lane, newly, info.bpm);
    if (!lastTapPerf || performance.now() - lastTapPerf > 250) beatFx(lane, band);
  }, OWNER);
  if (i === 63) timers.end = setTimeout(() => finishTake(false), (when - Lab.ctx.currentTime + 2 * beatDur) * 1000);
}
function onClockStop(reason) {
  if (halting || reason === 'ended' || reason === 'user') return;
  halt(reason);
}

/* ── the end ── */
function finishTake(early) {
  clearTimers();
  endHold(null, true);
  if (Lab.clock.isRunning(OWNER)) Lab.clock.stop(OWNER, 'ended');
  silence(false, early ? 0.5 : 1.2);
  waiting = resting = paused = false;
  if (!cur || !cur.beats.length) { toIdle(); return; }
  phase = 'done';
  const review = D.reviewTake(cur);
  takeNo++;
  mine = cur; sessionTake = true;
  const saved = UI.store.get(STORE_KEY, null);
  const best = Math.max((saved && +saved.bestSteadiness) || 0, review.steadiness || 0);
  UI.store.set(STORE_KEY, { last: D.encodeTake(cur), bestSteadiness: best });
  ownCard = { title: `Take ${takeNo} · ${review.name}`, stats: D.statsLine(review, cur, KEY) };
  showCard(ownCard.title, ownCard.stats, 'Conduct again');
  // Taps are ignored until Conduct again: tell a keyboard user on the pad where it is
  const hint = document.activeElement === pad ? ' Tab to Conduct again.' : '';
  say((cur.beats.length >= 63 ? `Final chord: ${D.ENDINGS[cur.ending].name}. ` : '') + `Take named ${review.name}.` + hint, true);
  Lab.release(OWNER);
  refreshButtons(); renderLanes(); showState(); updateRibbon(); drawOnce();
  flushLink();
}
function finishEarly() {
  if (phase === 'replay') { halt('user'); return; }
  if (phase !== 'live') return;
  if (cur && cur.beats.length >= EARLY_MIN) finishTake(true);
  else resetToIdle();
}

/* ── stop everything (the claim's stopFn, off-screen, hidden tab, Stop) ── */
function halt(reason) {
  if (halting) return;
  halting = true;
  try {
    // A paused take carries on with a tap, and the pad says so; the kit's
    // 'Press Play' message is only true of a replay
    const wasReplay = phase === 'replay';
    clearTimers();
    endHold(null, true);
    kbHeld = false;
    Lab.clock.stop(OWNER, reason);
    silence(true, 0.5);
    waiting = resting = false;
    if (phase === 'replay') endReplay(false);
    else if (phase === 'live') {
      if (cur && cur.beats.length >= 64) finishTake(false);
      else paused = true;                          // keep the partial take; the next tap carries on
    }
    if (reason !== 'user' && wasReplay) UI.msg(msgEl, UI.MSG.paused);
    Lab.release(OWNER);
    showState(); drawOnce();
  } finally { halting = false; }
}

function toIdle() {
  phase = 'idle'; next = 0; ending = 0;
  paused = waiting = resting = false;
  ghost = replayTarget() || ghost;                     // the last take (or theirs, from a link) stays as the ghost
  cur = null;
  cueQueue = [];
  sections.fill(false); sections[1] = true;
  follower.reset(); lastTapT = null; lastTapPerf = 0; beatDur = 60 / 72;
  style = pendingStyle;
  hideReview();
  dotPos = fermataAt = ghostPos = null;
  ripples.length = 0;
  whereEl.textContent = 'Bar 1 · beat 1';
  chordEl.textContent = EV[style][0][0].chord.name;
  colourEl.textContent = 'Waiting for a downbeat.';
  showRuler(-1);
  renderSections(); renderLanes(); renderIn(); showState(); refreshButtons(); updateRibbon(); drawOnce();
  flushLink();
}
function resetToIdle() {
  halt('user');
  clearPausedMsg();
  clearShareMsg();
  toIdle();
}


/* ════════════════════════════════════════════════════════════════════
   REPLAY · DEADPAN — the same engine, driven by Lab.clock.startEvents
   ════════════════════════════════════════════════════════════════════ */
function toggleReplay(which) {
  if (phase === 'replay' && replay && replay.which === which) { halt('user'); return; }
  startReplay(which);
}
/* which: 'mine' = the #dbReplay button (their take until you have one of your own),
   'theirs' = #dbTheirs, 'deadpan'. */
function startReplay(which) {
  if (!Lab.unlock()) { UI.msg(msgEl, UI.MSG.noAudio); return; }
  // Decide before a take in progress ends: ending it makes it yours, and the button said 'Watch their take'
  const theirs = which === 'theirs' || (which === 'mine' && !!linkTake && !sessionTake);
  if (phase === 'live') finishEarly();                 // a performance in progress ends the way Esc ends it
  if (phase === 'replay') halt('user');
  const tk = which === 'deadpan' ? D.deadpanTake(pendingStyle) : theirs ? linkTake : mine;
  if (!tk || !tk.beats.length) { refreshButtons(); return; }
  const prevPhase = phase;
  Lab.claim(OWNER, halt);
  clearPausedMsg();
  replay = {
    which, take: tk, theirs: which !== 'deadpan' && tk === linkTake,
    times: D.replayTimes(tk), prevPhase, at: -1,
    sections: which === 'deadpan' ? [true, true, true, true] : [false, true, false, false],
  };
  if (replay.theirs) watchedLink = true;
  phase = 'replay';
  hideReview();
  const r = replay;
  const events = tk.beats.map((b, i) => ({ t: r.times[i].t, fn: when => replayBeat(r, i, when) }));
  Lab.clock.startEvents(OWNER, events, { onEnd: () => replayEnded(r), onStop: onClockStop });
  UI.track('lab_play', { exp: 'downbeat', style: D.STYLES[tk.style].toLowerCase(), mode: which === 'deadpan' ? 'deadpan' : 'replay' });
  refreshButtons(); showState(); renderLanes(); renderIn(); updateRibbon(); drawOnce();
}
function replayBeat(r, i, when) {
  if (replay !== r) return;
  const b = r.take.beats[i], times = r.times;
  const releaseAt = i + 1 < times.length ? when + (times[i + 1].t - times[i].t) : when + 2 * times[i].beatDur;
  const newly = cue(r.sections, b.lane, i);
  soundBeat(i, when, b.band, b.lane, { style: r.take.style, ending: r.take.ending, beatDur: times[i].beatDur, sections: r.sections, hold: !!b.hold, releaseAt });
  if (i === 0) UI.soundHint(msgEl);
  Lab.clock.visual(when, () => {
    if (replay !== r) return;
    r.at = i;
    readout(i, r.take.style, r.take.ending, 60 / times[i].beatDur, b.band);
    const ev = EV[r.take.style][r.take.ending][i];
    let line = ev.beatInBar === 1 && (ev.bar - 1) % 4 === 0 ? `Bar ${ev.bar}.` : '';
    if (newly) line = `${SEC_NAMES[b.lane]} in.` + (line ? ' ' + line : '');
    if (line) say(line, true);
    flash(b.lane, times[i].beatDur);
    ghostFx(b.lane, b.band, !!b.hold);
    renderLanes(); renderIn(); updateRibbon();
  }, OWNER);
}
function replayEnded(r) {
  if (replay !== r) return;
  const last = r.times[r.times.length - 1];
  timers.end = setTimeout(() => {
    timers.end = 0;
    silence(false, 1.2);
    endReplay(true);
    Lab.release(OWNER);
  }, 2 * last.beatDur * 1000);
}
function endReplay(natural) {
  const r = replay;
  if (!r) return;
  replay = null;
  phase = r.prevPhase;
  fermataAt = ghostPos = null;
  if (r.theirs && natural) {
    const rv = D.reviewTake(r.take);
    showCard(`Their take · ${rv.name}`, D.statsLine(rv, r.take, KEY), sessionTake ? 'Conduct again' : 'Conduct your own');
    // 'Watch it first' is done with
    if (!sessionTake && msgEl.textContent === TXT.link) UI.msg(msgEl, TXT.turn);
  } else if (phase === 'done' && ownCard) showCard(ownCard.title, ownCard.stats, 'Conduct again');
  refreshButtons(); showState(); renderLanes(); renderIn(); updateRibbon(); drawOnce();
  flushLink();
}


/* ════════════════════════════════════════════════════════════════════
   DOM READOUTS — state text, lanes, ruler, sections, buttons
   ════════════════════════════════════════════════════════════════════ */
let stateSig = '';
function showState() {
  let text = '', cls = '', sub = '';
  const picking = phase === 'live' && next >= 60 && next <= 62;
  if (phase === 'idle') {
    // Sent a take and not watched it yet: the pad points at it too, as the message does
    if (linkTake && !sessionTake && !watchedLink) { text = TXT.linkIdle; sub = TXT.linkIdleSub; }
    else text = mode === 'auto' ? TXT.autoIdle : TXT.idle;
  } else if (phase === 'live') {
    if (paused || resting) { text = TXT.rest; cls = 'db-rest'; }
    else if (waiting) { text = TXT.wait; cls = 'db-wait'; }
    else if (picking) { text = TXT.cap; cls = 'db-cap'; }
  }
  if (!reviewEl.hidden) text = '';
  // Slowing down in bar 16 must not hide how the ending is picked
  if (picking && text && text !== TXT.cap) sub = TXT.cap;
  const sig = text + '|' + sub;
  if (text && sig !== stateSig) {
    stateSig = sig;
    stateEl.textContent = '';
    const main = document.createElement('span');
    main.textContent = text;
    stateEl.appendChild(main);
    if (sub) {
      const sm = document.createElement('small');
      sm.textContent = sub;
      main.appendChild(sm);
    }
  }
  stateEl.className = 'db-state' + (cls ? ' ' + cls : '') + (text ? '' : ' off');
}

function endingView() {
  if (replay) return replay.at >= 59;
  return phase === 'live' && next >= 60;
}
function chosenEnding() {
  if (replay) return replay.at >= 62 ? replay.take.ending : -1;
  return phase === 'live' && next > 62 ? ending : -1;
}
const viewSections = () => (replay ? replay.sections : sections);
let lanesSig = '';
function renderLanes() {
  const endV = endingView(), chosen = chosenEnding(), secs = viewSections();
  const late = replay ? replay.at >= 4 : phase === 'live' && next >= 4;
  const sig = [endV, chosen, secs.join(), late].join('|');
  if (sig === lanesSig) return;
  lanesSig = sig;
  lanesEl.classList.toggle('db-end', endV);
  lanesEl.textContent = '';
  const labels = endV ? D.ENDINGS.map(e => e.name) : SEC_NAMES;
  labels.forEach((name, k) => {
    const s = document.createElement('span');
    s.textContent = name;
    if (endV) s.classList.toggle('lit', k === chosen);
    else {
      s.classList.toggle('in', secs[k]);
      if (!secs[k] && late) {
        const sm = document.createElement('small');
        sm.textContent = 'tap to bring in';
        s.appendChild(sm);
      }
    }
    lanesEl.appendChild(s);
  });
}
function renderIn() {
  const secs = viewSections();
  inEl.textContent = 'In: ' + SEC_NAMES.filter((_, k) => secs[k]).map(n => n.toLowerCase()).join(', ');
}
function renderSections() {
  secSeg.querySelectorAll('button').forEach(b => {
    const on = sections[+b.dataset.sec];
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}
// band −1 = nothing highlighted
function showRuler(band) { rulerEls.forEach((el, k) => el.classList.toggle('on', 5 - k === band)); }
function refreshButtons() {
  const tgt = replayTarget();
  const mineOn = !!replay && replay.which === 'mine';
  replayBtn.disabled = !tgt && !mineOn;
  UI.setPlayBtn(replayBtn, mineOn, tgt && tgt === linkTake && !sessionTake ? 'Watch their take' : 'Replay my take', 'Stop replay');
  // A take you were sent stays playable after you've conducted your own
  if (theirsBtn) {
    const theirsOn = !!replay && replay.which === 'theirs';
    showTheirsBtn(theirsOn || (!!linkTake && sessionTake));
    UI.setPlayBtn(theirsBtn, theirsOn, 'Watch their take', 'Stop replay');
  }
  deadpanBtn.setAttribute('aria-pressed', String(!!replay && replay.which === 'deadpan'));
  copyBtn.disabled = !mine;
}

function toggleSection(k) {
  const c = Lab.ctx, live = phase === 'live' && c && buses;
  if (k === 1) { if (live) spotlight(1, c.currentTime + 0.005, beatDur); flash(1, beatDur); return; }
  sections[k] = !sections[k];
  if (phase === 'live') {
    cueQueue = cueQueue.filter(x => x !== k);
    if (sections[k]) cueQueue.push(k);
  }
  if (sections[k] && live) spotlight(k, c.currentTime + 0.005, beatDur);
  if (sections[k]) flash(k, beatDur);
  UI.announce(liveEl, `${SEC_NAMES[k]} ${sections[k] ? 'in' : 'out'}.`);
  renderSections(); renderLanes(); renderIn(); drawOnce();
}


/* ════════════════════════════════════════════════════════════════════
   SCORE RIBBON — 128 rects made once; a beat only touches what changed
   ════════════════════════════════════════════════════════════════════ */
const SVGNS = 'http://www.w3.org/2000/svg';
const mainEls = [], ghostEls = [];
(function buildRibbon() {
  for (let k = 1; k < 16; k++) {
    const l = document.createElementNS(SVGNS, 'line');
    [['x1', 40 * k], ['x2', 40 * k], ['y1', 4], ['y2', 68], ['class', 'db-tick']].forEach(([a, v]) => l.setAttribute(a, v));
    scoreEl.appendChild(l);
  }
  const mk = list => { for (let i = 0; i < 64; i++) { const r = document.createElementNS(SVGNS, 'rect'); r._c = {}; scoreEl.appendChild(r); list.push(r); } };
  mk(mainEls); mk(ghostEls);
})();
const INSET = 0.4;
function setRect(el, x, w, y, h, cls) {
  const c = el._c;
  x = Math.round(x * 100) / 100; w = Math.round(Math.max(0.2, w) * 100) / 100;
  if (c.x !== x) { el.setAttribute('x', x); c.x = x; }
  if (c.w !== w) { el.setAttribute('width', w); c.w = w; }
  if (c.y !== y) { el.setAttribute('y', y); c.y = y; }
  if (c.h !== h) { el.setAttribute('height', h); c.h = h; }
  if (c.cls !== cls) { el.setAttribute('class', cls); c.cls = cls; }
}
function ghostSource() {
  if (replay && replay.which === 'deadpan') return mine || ghost;
  if (replay && replay.theirs) return null;
  return ghost;
}
function updateRibbon() {
  const r = replay;
  const main = r ? r.take : cur;
  const pd = r ? r.times[Math.max(0, r.at)].beatDur : beatDur;
  const at = r ? r.at : phase === 'live' ? next - 1 : -1;
  D.ribbonLayout(main, pd).forEach((q, i) => {
    const cls = (main && q.played ? 'db-l' + q.lane : 'db-b') + (i === at ? ' db-cur' : '');
    setRect(mainEls[i], q.x + INSET, q.w - 2 * INSET, q.y, q.h, cls);
  });
  const gt = ghostSource();
  const gl = gt ? D.ribbonLayout(gt, 0.6) : null;
  ghostEls.forEach((el, i) => {
    const q = gl && gl[i];
    if (q && q.played) setRect(el, q.x + INSET, q.w - 2 * INSET, q.y, q.h, 'db-g');
    else setRect(el, el._c.x || 0, el._c.w || 1, el._c.y || 0, el._c.h || 1, 'db-g db-off');
  });
}


/* ════════════════════════════════════════════════════════════════════
   PAD CANVAS — idle-gated: rAF only while something is moving
   ════════════════════════════════════════════════════════════════════ */
let W = 1, Hh = 1, DPR = 1, raf = 0, visible = false, lastW = 0, lastH = 0;
const ripples = [], trail = [];
const flashAt = [-1e9, -1e9, -1e9, -1e9];
let flashTau = 300;
let dotPos = null, fermataAt = null, ghostPos = null;
const RIPPLE_MS = 500, TRAIL_MS = 600;

const laneX = k => (k + 0.5) * W / 4;
const bandY = b => (1 - (b + 0.5) / 6) * Hh;

function layout() {
  const r = pad.getBoundingClientRect();
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = Math.max(1, r.width); Hh = Math.max(1, r.height);
  pad.width = Math.round(W * DPR); pad.height = Math.round(Hh * DPR);
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  lastW = Math.round(W); lastH = Math.round(Hh);
  drawOnce();
}

function tapFx(pos, lane) {
  if (REDUCED) { dotPos = pos; drawOnce(); return; }
  ripples.push({ x: pos.x, y: pos.y, t0: performance.now(), rgb: LANE_RGB[lane], ghost: false });
  if (ripples.length > 6) ripples.shift();
  wake();
}
// An auto-beat with no fresh tap: a soft ripple where the last cue points
function beatFx(lane, band) { tapFx({ x: laneX(lane), y: bandY(band) }, lane); }
function ghostFx(lane, band, hold) {
  const x = laneX(lane), y = bandY(band);
  fermataAt = hold ? { x, y } : null;
  if (REDUCED) { dotPos = { x, y }; drawOnce(); return; }
  ripples.push({ x, y, t0: performance.now(), rgb: LANE_RGB[lane], ghost: true });
  if (ripples.length > 6) ripples.shift();
  ghostPos = ghostPos ? Object.assign(ghostPos, { tx: x, ty: y }) : { x: W / 2, y: Hh, tx: x, ty: y };
  wake();
}
function flash(lane, bd) {
  flashAt[lane] = performance.now();
  flashTau = clamp(500 * bd, 80, 625);
  if (!REDUCED) wake();
}

function draw(now) {
  g.clearRect(0, 0, W, Hh);
  const secs = viewSections(), endV = endingView();
  const lw = W / 4;
  if (endV) {
    const chosen = chosenEnding();
    for (let k = 0; k < 3; k++) {
      const x0 = k * W / 3;
      g.fillStyle = `rgba(${END_RGB[k]},${k === chosen ? 0.16 : 0.06})`;
      g.fillRect(x0, 0, W / 3, Hh);
    }
    g.strokeStyle = 'rgba(244,239,230,0.18)'; g.lineWidth = 1; g.setLineDash([3, 6]);
    g.beginPath();
    for (let k = 1; k < 3; k++) { const x = Math.round(k * W / 3) + 0.5; g.moveTo(x, 8); g.lineTo(x, Hh - 8); }
    g.stroke(); g.setLineDash([]);
  } else {
    for (let k = 0; k < 4; k++) {
      const x0 = k * lw;
      if (secs[k]) {
        const age = now - flashAt[k];
        const lift = !REDUCED && age < flashTau * 5 ? 0.1 * Math.exp(-age / flashTau) : 0;
        g.fillStyle = `rgba(${LANE_RGB[k]},${(0.06 + lift).toFixed(3)})`;
        g.fillRect(x0, 0, lw, Hh);
      } else {
        g.strokeStyle = `rgba(${LANE_RGB[k]},0.32)`; g.lineWidth = 1; g.setLineDash([4, 6]);
        g.strokeRect(Math.round(x0) + 4.5, 4.5, Math.round(lw) - 9, Math.round(Hh) - 9);
        g.setLineDash([]);
      }
    }
  }
  // keyboard aim: the lane (or ending third) Space will land in, and the ↑↓ level
  if (kbAim && document.activeElement === pad && phase !== 'done' && phase !== 'replay') {
    let x0 = aim * lw, w0 = lw;
    if (endV) { const k = D.endingFromX((aim + 0.5) / 4, 1); x0 = k * W / 3; w0 = W / 3; }
    g.strokeStyle = `rgba(${AMBER},0.75)`; g.lineWidth = 1.5;
    g.strokeRect(x0 + 3, 3, w0 - 6, Hh - 6);
    const y = Math.round(bandY(kbBand)) + 0.5;
    g.setLineDash([3, 5]); g.beginPath(); g.moveTo(x0 + 14, y); g.lineTo(x0 + w0 - 14, y); g.stroke(); g.setLineDash([]);
  }
  // waiting ring: one arc, breathing at the tempo you left off with
  if (phase === 'live' && (waiting || resting || paused)) {
    const cx = W / 2, cy = Hh / 2 - (Hh < 400 ? 36 : 46);
    let rad = 28, alpha = resting || paused ? 0.25 : 0.7;
    if (waiting && !resting && !REDUCED) {
      const ph = ((now - lastTapPerf) / 1000) / beatDur;
      const p = 0.5 + 0.5 * Math.cos(ph * TAU);
      rad = 22 + 12 * p; alpha = 0.3 + 0.55 * p;
    }
    g.strokeStyle = `rgba(${AMBER},${alpha.toFixed(3)})`; g.lineWidth = 2;
    g.beginPath(); g.arc(cx, cy, rad, 0, TAU); g.stroke();
  }
  if (!REDUCED) {
    // baton trail: one fading polyline
    const live = trail.filter(p => now - p.t < TRAIL_MS);
    if (live.length > 1) {
      const a = live[0], b = live[live.length - 1];
      const fade = 1 - (now - b.t) / TRAIL_MS;
      const grad = g.createLinearGradient(a.x, a.y, b.x + 0.01, b.y);
      grad.addColorStop(0, 'rgba(244,239,230,0)');
      grad.addColorStop(1, `rgba(244,239,230,${(0.55 * fade).toFixed(3)})`);
      g.strokeStyle = grad; g.lineWidth = 1.5; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(a.x, a.y);
      for (let k = 1; k < live.length; k++) g.lineTo(live[k].x, live[k].y);
      g.stroke();
    }
    // ripples: one path for taps, one dashed path for the ghost
    for (let i = ripples.length - 1; i >= 0; i--) if (now - ripples[i].t0 >= RIPPLE_MS) ripples.splice(i, 1);
    [false, true].forEach(isGhost => {
      const rs = ripples.filter(r => r.ghost === isGhost);
      if (!rs.length) return;
      // rAF's timestamp can be a little older than a ripple born this frame
      const age = r => clamp((now - r.t0) / RIPPLE_MS, 0, 1);
      const newest = rs[rs.length - 1], k = age(newest);
      g.beginPath();
      rs.forEach(r => { const rad = 60 * age(r); g.moveTo(r.x + rad, r.y); g.arc(r.x, r.y, rad, 0, TAU); });
      g.strokeStyle = `rgba(${newest.rgb},${(0.75 * (1 - k)).toFixed(3)})`;
      g.lineWidth = 1.5;
      if (isGhost) g.setLineDash([4, 5]);
      g.stroke();
      g.setLineDash([]);
    });
    // ghost baton: glides to each replayed beat
    if (ghostPos) {
      ghostPos.x += (ghostPos.tx - ghostPos.x) * 0.22;
      ghostPos.y += (ghostPos.ty - ghostPos.y) * 0.22;
      g.strokeStyle = 'rgba(244,239,230,0.35)'; g.lineWidth = 1; g.setLineDash([2, 5]);
      g.beginPath(); g.moveTo(W / 2, Hh - 6); g.lineTo(ghostPos.x, ghostPos.y); g.stroke(); g.setLineDash([]);
      g.fillStyle = 'rgba(244,239,230,0.85)';
      g.beginPath(); g.arc(ghostPos.x, ghostPos.y, 3.5, 0, TAU); g.fill();
    }
  } else if (dotPos) {
    g.fillStyle = 'rgba(244,239,230,0.9)';
    g.beginPath(); g.arc(dotPos.x, dotPos.y, 4, 0, TAU); g.fill();
  }
  // fermata glyph: an arch and a dot over the tap
  if (fermataAt) {
    const x = fermataAt.x, y = Math.max(26, fermataAt.y - 22);
    g.strokeStyle = `rgba(${AMBER},0.95)`; g.fillStyle = `rgba(${AMBER},0.95)`; g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, 15, Math.PI, TAU); g.stroke();
    g.beginPath(); g.arc(x, y - 3, 2.6, 0, TAU); g.fill();
  }
}

function busy(now) {
  if (REDUCED) return false;
  if (ripples.length) return true;
  if (trail.length && now - trail[trail.length - 1].t < TRAIL_MS) return true;
  if (flashAt.some(t => now - t < flashTau * 5)) return true;
  if (phase === 'live' && waiting && !resting && now - waitStart < REST_S * 1000) return true;
  if (ghostPos && (Math.abs(ghostPos.x - ghostPos.tx) > 0.5 || Math.abs(ghostPos.y - ghostPos.ty) > 0.5)) return true;
  return false;
}
function loop(now) {
  raf = 0;
  draw(now);
  if (visible && busy(now)) raf = requestAnimationFrame(loop);
}
function wake() { if (visible && !raf) raf = requestAnimationFrame(loop); }
function drawOnce() { if (!raf) draw(performance.now()); }


/* ════════════════════════════════════════════════════════════════════
   WIRING
   ════════════════════════════════════════════════════════════════════ */
pad.addEventListener('pointerdown', e => {
  kbAim = false;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  try { pad.setPointerCapture(e.pointerId); } catch (err) {}
  input(padPoint(e), e, e.pointerId);
});
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => pad.addEventListener(type, e => endHold(e.pointerId)));
pad.addEventListener('pointermove', e => {
  if (REDUCED) return;
  const p = padPoint(e);
  trail.push({ x: p.x, y: p.y, t: performance.now() });
  if (trail.length > 24) trail.shift();
  wake();
});
pad.addEventListener('contextmenu', e => e.preventDefault());
pad.addEventListener('focus', () => {
  try { kbAim = pad.matches(':focus-visible'); } catch (e) { kbAim = false; }
  drawOnce();
});
pad.addEventListener('blur', () => { if (kbHeld) { kbHeld = false; endHold('key'); } drawOnce(); });
Lab.unlockOn(pad);

const isField = el => !!(el && el.matches && el.matches('input, textarea, select, [contenteditable="true"]'));
const isControl = el => !!(el && el.closest && el.closest('button, a, input, select, textarea, summary'));
const BEAT_KEYS = [' ', 'Spacebar', 'Enter'];
// Geometry, not the `visible` flag: that only changes when the observer fires
function inView(el) {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < (window.innerHeight || document.documentElement.clientHeight);
}
section.addEventListener('keydown', e => {
  if (e.altKey || e.ctrlKey || e.metaKey || isField(e.target)) return;
  // Scrolled away with focus still on the pad: Space scrolls the page and nothing plays unseen
  if (!inView(section)) return;
  const tgt = e.target;
  // Keys aimed at the pad also need the pad on screen (on a phone the controls sit below it)
  const free = (tgt === pad || (!(tgt.closest && tgt.closest('.controls')) && !isControl(tgt))) && inView(pad);
  const k = e.key;
  if (!kbAim && tgt === pad && !['Shift', 'Tab'].includes(k)) { kbAim = true; drawOnce(); }
  if (BEAT_KEYS.includes(k)) {
    if (!free) return;
    e.preventDefault();
    if (e.repeat || kbHeld) return;
    kbHeld = true;
    input(null, e, 'key');
  } else if (k === 'ArrowUp' || k === 'ArrowDown') {
    if (!free) return;
    e.preventDefault();
    kbBand = clamp(kbBand + (k === 'ArrowUp' ? 1 : -1), 0, 5);
    if (mode === 'auto') lastBand = kbBand;
    showRuler(kbBand);
    UI.announce(liveEl, D.DYN_WORDS[kbBand]);
    drawOnce();
  } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
    if (!free) return;
    e.preventDefault();
    aim = clamp(aim + (k === 'ArrowRight' ? 1 : -1), 0, 3);
    if (mode === 'auto') { lastLane = aim; lastFrac = (aim + 0.5) / 4; }
    UI.announce(liveEl, 'Aiming at ' + (endingView() ? D.ENDINGS[D.endingFromX((aim + 0.5) / 4, 1)].name : SEC_NAMES[aim]) + '.');
    drawOnce();
  } else if (k >= '1' && k <= '4') {
    e.preventDefault();
    toggleSection(+k - 1);
  } else if (k === 'r' || k === 'R') {
    e.preventDefault();
    if (!replayBtn.disabled) { Lab.unlock(); toggleReplay('mine'); }
  } else if (k === 'Escape') {
    e.preventDefault();
    finishEarly();
  }
});
section.addEventListener('keyup', e => {
  if (BEAT_KEYS.includes(e.key) && kbHeld) { kbHeld = false; endHold('key'); }
});

const setStyleSeg = UI.segBind(styleSeg, d => {
  pendingStyle = clamp(+d.style || 0, 0, 2);
  if (phase !== 'live') { style = pendingStyle; if (phase === 'idle') chordEl.textContent = EV[style][0][0].chord.name; }
});
UI.segBind(modeSeg, d => {
  const was = mode;
  mode = d.mode === 'auto' ? 'auto' : 'you';
  autoSeg.hidden = mode !== 'auto';
  if (phase === 'live' && was !== mode && next < 64) {
    endHold(null, true);
    if (mode === 'auto') startAuto();                 // the band takes over from the next beat
    else {
      Lab.clock.stop(OWNER, 'user');
      // Your first tap is measured from the band's last beat
      follower.reset(); follower.tap(lastBeatT);
      lastTapT = lastBeatT; lastTapPerf = performance.now();
      if (!paused) armWaiting();
    }
  }
  showState();
});
UI.segBind(autoSeg, d => {
  autoBpm = clamp(+d.bpm || 88, 40, 200);
  if (phase === 'live') Lab.clock.setTempo(OWNER, autoBpm);
});
secSeg.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || !secSeg.contains(b)) return;
  Lab.unlock();
  toggleSection(+b.dataset.sec);
});

replayBtn.addEventListener('click', () => { Lab.unlock(); toggleReplay('mine'); });
if (theirsBtn) theirsBtn.addEventListener('click', () => { Lab.unlock(); toggleReplay('theirs'); });
deadpanBtn.addEventListener('click', () => { Lab.unlock(); toggleReplay('deadpan'); });
resetBtn.addEventListener('click', resetToIdle);
againBtn.addEventListener('click', () => { resetToIdle(); try { pad.focus({ preventScroll: true }); } catch (e) {} });
copyBtn.addEventListener('click', () => {
  const payload = mine && D.encodeTake(mine);
  if (!payload) return;
  UI.share('take', payload, msgEl).then(res => {
    if (res === 'copied') UI.msg(msgEl, TXT.copied);
    UI.track('lab_share', { exp: 'downbeat' });
  });
});

/* ── a shared take in the address bar: show it, never autoplay ── */
const revealSection = () => requestAnimationFrame(() => section.scrollIntoView({ block: 'start', behavior: REDUCED ? 'auto' : 'smooth' }));
function loadLink() {
  if (!(location.hash || '').startsWith('#take=')) return;
  const p = UI.readHash('take');
  const tk = p && D.decodeTake(p);
  // A broken link lands here too, as 05 and 06 do, or its message is never seen
  if (!tk) { UI.msg(msgEl, TXT.badLink); revealSection(); return; }
  // Mid-take or mid-replay it would change the arrangement and the Replay
  // button under you: it waits until that ends
  if (phase === 'live' || phase === 'replay') { deferredLink = tk; return; }
  applyLink(tk);
  revealSection();
}
function applyLink(tk) {
  deferredLink = null;
  linkTake = tk; sessionTake = false; ghost = tk; watchedLink = false;
  pendingStyle = style = tk.style;
  setStyleSeg(styleSeg.querySelector(`[data-style="${tk.style}"]`));
  if (phase === 'idle') chordEl.textContent = EV[style][0][0].chord.name;
  UI.msg(msgEl, TXT.link);
  refreshButtons(); showState(); updateRibbon(); drawOnce();
}
function flushLink() {
  if (deferredLink && phase !== 'live' && phase !== 'replay') applyLink(deferredLink);
}
window.addEventListener('hashchange', loadLink);

let resizeRaf = 0;
function scheduleLayout() {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    const r = pad.getBoundingClientRect();
    if (Math.round(r.width) !== lastW || Math.round(r.height) !== lastH) layout();
  });
}
if ('ResizeObserver' in window) new ResizeObserver(scheduleLayout).observe(pad);
else window.addEventListener('resize', scheduleLayout);

UI.watchVisibility(section, v => {
  visible = v;
  if (v) { drawOnce(); return; }
  cancelAnimationFrame(raf); raf = 0;
  if (phase === 'live' || phase === 'replay' || voices) halt('offscreen');
});

// Your last take comes back as the ghost, ready to replay or share
const saved = UI.store.get(STORE_KEY, null);
if (saved && typeof saved.last === 'string') {
  const t = D.decodeTake(saved.last);
  if (t) { mine = t; ghost = t; }
}
layout();
toIdle();
loadLink();
})();

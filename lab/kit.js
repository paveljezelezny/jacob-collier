/* ════════════════════════════════════════════════════════════════════
   KIT — shared runtime for the Harmony Lab games (05–07).
   Extends window.Lab (lab.js) with timing helpers, one-shot voices under
   a voice cap, gates, a look-ahead transport (Lab.clock) and sound
   ownership; adds DOM helpers to window.LabUI.
   Pure maths lives in lab/kit-core.js (window.LabCores.kit).
   ════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';

const Lab = window.Lab, UI = window.LabUI, H = window.Harmony;
const K = window.LabCores && window.LabCores.kit;
// Missing engine: leave window.Lab alone; each game shows its own "couldn't load" message
if (!Lab || !UI || !H || !K) return;

const NOOP = Object.freeze({ stop() {}, end: 0 });
function call(fn, ...args) {
  if (typeof fn !== 'function') return;
  // One broken callback must not kill the tick loop; rethrow later so it still surfaces
  try { fn(...args); } catch (e) { setTimeout(() => { throw e; }); }
}

/* ════════════════════════════════════════════════════════════════════
   TIMING HELPERS
   ════════════════════════════════════════════════════════════════════ */
Lab.lowPower = !!(window.matchMedia && matchMedia('(max-width: 600px)').matches) || (navigator.hardwareConcurrency || 8) <= 4;
Lab.voiceCap = Lab.lowPower ? 24 : 32;

Lab.unlock = function unlock() {
  const c = Lab.ensure();
  if (c && c.state !== 'running' && c.resume) c.resume().catch(() => {});
  return c;
};
// First-touch unlock on iOS is unreliable, so try on every kind of gesture
Lab.unlockOn = function unlockOn(el) {
  ['pointerdown', 'pointerup', 'click', 'keydown'].forEach(type => el.addEventListener(type, Lab.unlock));
};

Lab.audibleTime = function audibleTime() {
  const c = Lab.ctx;
  if (!c) return 0;
  const ts = c.getOutputTimestamp ? c.getOutputTimestamp() : null;
  if (ts && ts.contextTime > 0) {
    // contextTime was reaching the speakers at performanceTime; carry it forward to now
    const since = ts.performanceTime > 0 ? (performance.now() - ts.performanceTime) / 1000 : 0;
    return Math.min(c.currentTime, ts.contextTime + K.clamp(since, 0, 0.05));
  }
  return c.currentTime - (c.outputLatency || c.baseLatency || 0);
};

// The musical moment the player aimed at. Only for recording / quantizing:
// a tap itself sounds at ctx.currentTime + 0.005.
Lab.tapTime = function tapTime(e) {
  let late = e && e.timeStamp > 0 ? (performance.now() - e.timeStamp) / 1000 : 0;
  if (!(late > 0 && late < 1)) late = 0;         // very old browsers stamp events in epoch ms
  return Lab.audibleTime() - late;
};


/* ════════════════════════════════════════════════════════════════════
   VOICE REGISTRY — every one-shot returns { stop(when), end }.
   Oldest-first stealing above Lab.voiceCap.
   ════════════════════════════════════════════════════════════════════ */
const live = [];                 // handles still sounding, oldest first
let kitBus = null, noiseBuf = null;
const defaultBus = () => kitBus || (kitBus = Lab.bus(0.3, 1));

Lab.noise = function noise() {
  const c = Lab.ctx;
  if (!c) return null;
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
};

function prune(now) { for (let i = live.length - 1; i >= 0; i--) if (live[i].end <= now) live.splice(i, 1); }
Lab.liveVoices = function liveVoices() {
  if (Lab.ctx) prune(Lab.ctx.currentTime);
  return live.length;
};

// Freeze a param where it is at `t` and drop everything after it
function hold(p, t) {
  if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t);
  else p.cancelScheduledValues(t);
}
// 0 → peak (linear) → exponential-ish decay toward 0
function env(p, t, peak, att, tau) {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + att);
  p.setTargetAtTime(0, t + att, tau);
}

/* One voice under construction: tracks its nodes and sources, and ends in
   `out`, a kill switch that only voice stealing touches. */
function build(c, dest) {
  const nodes = [], srcs = [];
  const out = c.createGain();
  out.connect(dest || defaultBus());
  nodes.push(out);
  const b = {
    out,
    track(n) { nodes.push(n); return n; },
    gain(v, to) {
      const g = c.createGain(); g.gain.value = v;
      if (to) g.connect(to);
      return b.track(g);
    },
    filter(type, freq, q, to) {
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
      if (q != null) f.Q.value = q;
      if (to) f.connect(to);
      return b.track(f);
    },
    osc(type, freq, to, detune = 0) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
      if (detune) o.detune.value = detune;
      if (to) o.connect(to);
      srcs.push({ node: o, offset: 0 });
      return b.track(o);
    },
    noise(to) {
      const s = c.createBufferSource(); s.buffer = Lab.noise(); s.loop = true;
      if (to) s.connect(to);
      srcs.push({ node: s, offset: Math.random() * 0.9 });   // a different grain of noise each hit
      return b.track(s);
    },
    // Start every source at t, schedule the end, register. `release(at)` shapes an early stop
    // and returns when the voice is then silent.
    finish(t, end, release) {
      let ended = 0, done = false;
      const h = {
        end,
        stop(when) {
          const now = c.currentTime;
          const at = Math.max(when == null ? now : when, now);
          if (done || at >= h.end) return;
          h.end = Math.min(h.end, release(at));
          srcs.forEach(s => { try { s.node.stop(h.end); } catch (e) {} });
        },
      };
      const cleanup = () => {
        if (done) return;
        done = true;
        nodes.forEach(n => { try { n.disconnect(); } catch (e) {} });
        const i = live.indexOf(h);
        if (i >= 0) live.splice(i, 1);
      };
      srcs.forEach(s => {
        s.node.onended = () => { if (++ended === srcs.length) cleanup(); };
        if (s.offset) s.node.start(t, s.offset); else s.node.start(t);
        s.node.stop(end);
      });
      // Stolen: a 12 ms fade on the kill switch, then stop
      Object.defineProperty(h, 'kill', {
        value() {
          const now = c.currentTime;
          out.gain.cancelScheduledValues(now);
          out.gain.setValueAtTime(out.gain.value, now);
          out.gain.linearRampToValueAtTime(0, now + 0.012);
          h.end = Math.min(h.end, now + 0.02);
          srcs.forEach(s => { try { s.node.stop(h.end); } catch (e) {} });
        },
      });
      prune(c.currentTime);
      live.push(h);
      while (live.length > Lab.voiceCap) live.shift().kill();
      return h;
    },
  };
  return b;
}
const startTime = (c, when) => Math.max(when || 0, c.currentTime);


/* ════════════════════════════════════════════════════════════════════
   VOICES — bass · mallet · perc · vox
   ════════════════════════════════════════════════════════════════════ */
Lab.bass = function bass(midi, when, { dur = 0.45, vel = 0.8, dest, bright = 0.5 } = {}) {
  const c = Lab.ctx;
  if (!c || !Number.isFinite(midi)) return NOOP;
  const t = startTime(c, when), f = H.midiToFreq(midi), d = Math.max(0.01, dur);
  const b = build(c, dest);
  const amp = b.gain(0, b.out);
  const lp = b.filter('lowpass', 220 + 1600 * bright * vel, 2, amp);
  lp.frequency.setValueAtTime(220 + 1600 * bright * vel, t);
  lp.frequency.setTargetAtTime(160 + 300 * bright, t, 0.06);
  b.osc('sine', f, b.gain(0.8, lp));
  b.osc('sawtooth', f, b.gain(0.35, lp), 4);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(0.34 * vel, t + 0.004);
  amp.gain.setTargetAtTime(0.22 * vel, t + 0.004, 0.15);
  amp.gain.setTargetAtTime(0, t + d, 0.05);
  return b.finish(t, t + d + 0.35, at => {
    hold(amp.gain, at);
    amp.gain.setTargetAtTime(0, at, 0.05);
    return at + 0.35;
  });
};

// [ratio, level, own decay τ (optional)]
const MALLETS = {
  marimba:  { tau: 0.35, partials: [[1, 1], [3.9, 0.25, 0.05]], tick: true },
  vibes:    { tau: 1.2,  partials: [[1, 1], [4, 0.15], [10, 0.05]], trem: [5.5, 0.25] },
  bell:     { tau: 1.8,  partials: [[1, 1], [2.76, 0.4], [5.4, 0.2], [8.9, 0.08]] },
  musicbox: { tau: 0.6,  partials: [[1, 1], [3, 0.3], [6, 0.1]] },
};
Lab.mallet = function mallet(midi, when, { kind = 'marimba', vel = 0.8, dest, dur } = {}) {
  const c = Lab.ctx;
  if (!c || !Number.isFinite(midi)) return NOOP;
  const m = MALLETS[kind] || MALLETS.marimba;
  const t = startTime(c, when), f = H.midiToFreq(midi), peak = 0.22 * vel, ATT = 0.002;
  const b = build(c, dest);
  const amp = b.gain(0, b.out);
  let into = amp;
  if (m.trem) {
    // gain swings between 1 − depth and 1
    const trem = b.gain(1 - m.trem[1] / 2, amp);
    b.osc('sine', m.trem[0], b.gain(m.trem[1] / 2, trem.gain));
    into = trem;
  }
  m.partials.forEach(([ratio, level, tau]) => {
    if (f * ratio > c.sampleRate * 0.45) return;              // above Nyquist it would only alias
    const g = b.gain(level, into);
    if (tau) { g.gain.setValueAtTime(level, t); g.gain.setTargetAtTime(0, t, tau); }
    b.osc('sine', f * ratio, g);
  });
  if (m.tick) {
    const tg = b.gain(0, b.out);
    b.noise(b.filter('bandpass', Math.min(2 * f, c.sampleRate * 0.45), 4, tg));
    tg.gain.setValueAtTime(0.6 * peak, t);
    tg.gain.linearRampToValueAtTime(0, t + 0.005);
  }
  env(amp.gain, t, peak, ATT, m.tau);
  let end = t + ATT + m.tau * 5;
  if (Number.isFinite(dur)) {
    const at = t + Math.max(0.005, dur);
    amp.gain.setTargetAtTime(0, at, 0.015);                    // ~60 ms release
    end = Math.min(end, at + 0.1);
  }
  return b.finish(t, end, at => {
    hold(amp.gain, at);
    amp.gain.setTargetAtTime(0, at, 0.015);
    return at + 0.1;
  });
};

/* Percussion. Each kind wires its sources into `master` (gain 1, the stop
   target) with its own envelopes, and returns when it is silent. */
const PERC = {
  kick(b, master, t, vel) {
    const g = b.gain(0, master);
    const o = b.osc('sine', 120, g);
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.09);
    env(g.gain, t, 0.55 * vel, 0.002, 0.12);
    const click = b.gain(0, master);
    b.noise(b.filter('highpass', 2500, 0.7, click));
    click.gain.setValueAtTime(0.25 * vel, t);
    click.gain.linearRampToValueAtTime(0, t + 0.003);
    return t + 0.8;
  },
  snap(b, master, t, vel) {
    const bp = b.filter('bandpass', 2200, 1.2);
    b.noise(bp);
    [[0, 1], [0.012, 0.5]].forEach(([dt, k]) => {
      const g = b.gain(0, master); bp.connect(g);
      env(g.gain, t + dt, 1.2 * vel * k, 0.002, 0.035);
    });
    return t + 0.25;
  },
  clap(b, master, t, vel) {
    const bp = b.filter('bandpass', 1400, 1.1);
    b.noise(bp);
    [0, 0.011, 0.022].forEach((dt, i) => {
      const g = b.gain(0, master); bp.connect(g);
      env(g.gain, t + dt, 1.0 * vel, 0.001, i === 2 ? 0.08 : 0.006);
    });
    return t + 0.55;
  },
  shaker(b, master, t, vel) {
    const g = b.gain(0, master);
    b.noise(b.filter('highpass', 6000, 0.7, g));
    env(g.gain, t, 0.25 * vel, 0.006, 0.03);
    return t + 0.21;
  },
  hat(b, master, t, vel) {
    const g = b.gain(0, master);
    b.noise(b.filter('highpass', 8000, 0.7, g));
    env(g.gain, t, 0.2 * vel, 0.001, 0.02);
    return t + 0.15;
  },
  rim(b, master, t, vel) {
    const g = b.gain(0, master);
    b.osc('square', 1700, b.gain(0.5, g));
    b.osc('triangle', 820, g);
    env(g.gain, t, 0.12 * vel, 0.0005, 0.012);
    return t + 0.1;
  },
  tom(b, master, t, vel, midi = 45) {
    const f = H.midiToFreq(midi), g = b.gain(0, master);
    const o = b.osc('sine', f, g);
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.8, t + 0.15);
    env(g.gain, t, 0.5 * vel, 0.002, 0.18);
    return t + 1.1;
  },
  timp(b, master, t, vel, midi = 38) {
    const f = H.midiToFreq(midi), g = b.gain(0, master);
    const lp = b.filter('lowpass', 900, 0.7, g);
    b.osc('sine', f, lp);
    b.osc('triangle', f, b.gain(0.5, lp));
    env(g.gain, t, 0.45 * vel, 0.008, 0.6);
    return t + 3.7;
  },
  swell(b, master, t, vel, midi, dur) {
    const g = b.gain(0, master);
    const bp = b.filter('bandpass', 3000, 1.5, g);
    b.noise(bp);
    bp.frequency.setValueAtTime(3000, t);
    bp.frequency.exponentialRampToValueAtTime(8000, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.25 * vel, t + dur);
    g.gain.setTargetAtTime(0, t + dur, 0.3);
    return t + dur + 1.8;
  },
};
Lab.perc = function perc(kind, when, { vel = 0.8, dest, midi, dur = 1 } = {}) {
  const c = Lab.ctx;
  if (!c || !PERC[kind]) return NOOP;
  const t = startTime(c, when);
  const b = build(c, dest);
  const master = b.gain(1, b.out);
  const end = PERC[kind](b, master, t, vel, Number.isFinite(midi) ? midi : undefined, Math.max(0.02, Number.isFinite(dur) ? dur : 1));
  return b.finish(t, end, at => {
    hold(master.gain, at);
    master.gain.setTargetAtTime(0, at, 0.01);
    return at + 0.06;
  });
};

const VOX_MAKEUP = 3.0;                    // the same formant make-up gain as choirVoice
const VOX_ATTACK = { doo: 0.012, bah: 0.008, oo: 0.06 };
Lab.vox = function vox(midi, when, { dur = 0.3, syl = 'doo', vel = 0.8, pan = 0, dest } = {}) {
  const c = Lab.ctx;
  if (!c || !Number.isFinite(midi)) return NOOP;
  if (!VOX_ATTACK[syl]) syl = 'doo';
  const t = startTime(c, when), f = H.midiToFreq(midi), d = Math.max(0.02, dur);
  const b = build(c, dest);
  let into = b.out;
  if (c.createStereoPanner) {
    const p = b.track(c.createStereoPanner());
    p.pan.value = K.clamp(pan || 0, -1, 1);
    p.connect(b.out);
    into = p;
  }
  const amp = b.gain(0, into);
  const sum = b.gain(1, amp);
  const src = b.gain(1 / Math.SQRT2);
  let head = src;
  if (syl === 'doo') {
    // the "d": the source opens up from dark to bright
    const lp = b.filter('lowpass', 250, 0.7);
    src.connect(lp);
    lp.frequency.setValueAtTime(250, t);
    lp.frequency.exponentialRampToValueAtTime(3500, t + 0.025);
    head = lp;
  }
  const V = Lab.VOWELS, target = V[syl === 'bah' ? 'ah' : 'oo'];
  target.forEach(([ff, g, bw], i) => {
    const bp = b.filter('bandpass', ff, ff / bw);
    const gg = b.gain(g * VOX_MAKEUP, sum);
    head.connect(bp); bp.connect(gg);
    if (syl === 'bah') {
      // the "b": lips open from oo to ah
      const [f0, g0, bw0] = V.oo[i];
      bp.frequency.setValueAtTime(f0, t); bp.frequency.linearRampToValueAtTime(ff, t + 0.04);
      bp.Q.setValueAtTime(f0 / bw0, t);   bp.Q.linearRampToValueAtTime(ff / bw, t + 0.04);
      gg.gain.setValueAtTime(g0 * VOX_MAKEUP, t); gg.gain.linearRampToValueAtTime(g * VOX_MAKEUP, t + 0.04);
    }
  });
  const body = b.filter('lowpass', 700, 0.5);
  head.connect(body); body.connect(b.gain(0.22, sum));
  const oscs = [-6, 6].map(cents => b.osc('sawtooth', f, src, cents));
  if (d > 0.4) {
    const depth = b.gain(0);
    oscs.forEach(o => depth.connect(o.detune));
    b.osc('sine', 5, depth);
    depth.gain.setValueAtTime(0, t + 0.25);
    depth.gain.setTargetAtTime(8, t + 0.25, 0.08);
  }
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(0.16 * vel, t + VOX_ATTACK[syl]);
  amp.gain.setTargetAtTime(0, t + d, 0.06);
  return b.finish(t, t + d + 0.4, at => {
    hold(amp.gain, at);
    amp.gain.setTargetAtTime(0, at, 0.06);
    return at + 0.4;
  });
};

/* ── gates: cut off notes that are already scheduled ── */
Lab.gate = function gate(dest) {
  const c = Lab.ctx;
  if (!c) return null;
  const g = c.createGain();
  g.gain.value = 1;
  g.connect(dest || defaultBus());
  return g;
};
Lab.closeGate = function closeGate(g, when) {
  const c = Lab.ctx;
  if (!c || !g) return;
  const t = Math.max(when == null ? c.currentTime : when, c.currentTime);
  g.gain.setTargetAtTime(0, t, 0.006);
  setTimeout(() => { try { g.disconnect(); } catch (e) {} }, (t - c.currentTime + 0.4) * 1000);
};


/* ════════════════════════════════════════════════════════════════════
   TRANSPORT — Lab.clock. One owner at a time; a 25 ms setTimeout chain
   plans 120 ms ahead on a kit-core timeline.
   ════════════════════════════════════════════════════════════════════ */
const TICK_MS = 25, LOOKAHEAD = 0.12, LATE_DROP = 0.05, REANCHOR = 1.0;
let run = null, timer = 0;
let claimant = null;                     // { owner, stopFn }: whoever is making sound now
const visuals = [];
let visualRaf = 0;

function dropVisuals(owner) {
  for (let i = visuals.length - 1; i >= 0; i--) if (visuals[i].owner === owner) visuals.splice(i, 1);
}
// `natural`: an event list ran out. Its visuals already fired, and onEnd comes before onStop('ended').
function endRun(reason, natural) {
  const r = run;
  run = null;
  clearTimeout(timer); timer = 0;
  if (natural) call(r.onEnd);
  else dropVisuals(r.owner);
  call(r.onStop, reason);
}
function begin(r) {
  // Same owner restarting: the old run is replaced silently (no onStop)
  if (run) dropVisuals(run.owner);
  run = r;
  clearTimeout(timer);
  timer = setTimeout(tick, 0);           // never call onStep from inside start()
}

function tick() {
  const r = run, c = Lab.ctx;
  if (!r || !c) return;
  timer = setTimeout(tick, TICK_MS);     // keep the chain alive even if a callback throws
  const now = c.currentTime;
  if (r.kind === 'steps') {
    const p = K.planTick(r.tl, r.next, now, LOOKAHEAD, LATE_DROP, REANCHOR);
    r.tl = p.tl; r.next = p.nextStep;
    for (const d of p.due) {
      const info = {
        loopStep: r.loop ? K.mod(d.step, r.loop) : d.step,
        lap: r.loop ? Math.floor(d.step / r.loop) : 0,
        stepDur: K.stepDurAt(r.tl, d.step),
        bpm: r.bpm,
      };
      call(r.onStep, d.step, d.when, info);
      if (run !== r) return;
    }
    return;
  }
  const evs = r.events;
  if (r.k < evs.length && r.base + evs[r.k].t < now - REANCHOR) r.base = now + 0.05 - evs[r.k].t;
  while (r.k < evs.length && r.base + evs[r.k].t < now + LOOKAHEAD) {
    const e = evs[r.k++], when = r.base + e.t;
    if (when >= now - LATE_DROP) call(e.fn, when, e.i);
    if (run !== r) return;
  }
  if (r.k >= evs.length && Lab.audibleTime() >= r.base + r.lastT) endRun('ended', true);
}

function frame() {
  visualRaf = 0;
  const now = Lab.ctx ? Lab.audibleTime() : Infinity;
  const due = [];
  for (let i = 0; i < visuals.length;) {
    if (visuals[i].when <= now) due.push(visuals.splice(i, 1)[0]);
    else i++;
  }
  due.sort((a, b) => a.when - b.when).forEach(v => call(v.fn));
  if (visuals.length && !visualRaf) visualRaf = requestAnimationFrame(frame);
}

const clock = {
  start(owner, opts = {}) {
    const c = Lab.ensure();
    if (!c) return false;
    Lab.claim(owner);
    const bpm = K.clamp(+opts.bpm || 120, 40, 200);
    const spb = [1, 2, 4].includes(opts.stepsPerBeat) ? opts.stepsPerBeat : 2;
    const swing = K.clamp(+opts.swing || 0, 0, 0.33);
    const t0 = Number.isFinite(opts.startAt) ? opts.startAt : c.currentTime + 0.05;
    begin({
      owner, kind: 'steps', bpm, spb,
      loop: Math.max(0, Math.floor(+opts.loopSteps || 0)),
      tl: K.makeTimeline({ bpm, stepsPerBeat: spb, t0, swing }),
      next: 0, onStep: opts.onStep, onStop: opts.onStop,
    });
    return true;
  },
  startEvents(owner, events, { startAt, onStop, onEnd } = {}) {
    const c = Lab.ensure();
    if (!c) return false;
    Lab.claim(owner);
    const evs = (Array.isArray(events) ? events : [])
      .map((e, i) => ({ t: e ? e.t : NaN, fn: e && e.fn, i }))
      .filter(e => Number.isFinite(e.t) && typeof e.fn === 'function')
      .sort((a, b) => a.t - b.t || a.i - b.i);
    begin({
      owner, kind: 'events', events: evs, k: 0,
      base: Number.isFinite(startAt) ? startAt : c.currentTime + 0.05,
      lastT: evs.length ? evs[evs.length - 1].t : 0,
      onStop, onEnd,
    });
    return true;
  },
  stop(owner, reason = 'user') {
    if (!run || run.owner !== owner) return false;
    endRun(reason, false);
    return true;
  },
  setTempo(owner, bpm) {
    const r = run;
    if (!r || r.owner !== owner || r.kind !== 'steps') return false;
    r.bpm = K.clamp(+bpm || r.bpm, 40, 200);
    r.tl = K.withTempo(r.tl, r.next, r.bpm);
    return true;
  },
  isRunning(owner) { return owner === undefined ? !!run : !!run && run.owner === owner; },
  quantize(owner, ctxTime) {
    const r = run;
    if (!r || r.owner !== owner || r.kind !== 'steps' || !Number.isFinite(ctxTime)) return null;
    return K.quantizeAt(r.tl, ctxTime, r.loop);
  },
  timeOfStep(owner, abs) {
    const r = run;
    if (!r || r.owner !== owner || r.kind !== 'steps' || !Number.isFinite(abs)) return null;
    return K.timeOfStep(r.tl, abs);
  },
  info(owner) {
    const r = run;
    if (!r || r.owner !== owner) return null;
    if (r.kind !== 'steps') return { kind: 'events', startAt: r.base, next: r.k, count: r.events.length };
    return { kind: 'steps', bpm: r.bpm, stepsPerBeat: r.spb, loopSteps: r.loop, swing: r.tl.swing, stepDur: K.stepDurAt(r.tl, r.next), nextStep: r.next };
  },
  visual(when, fn, owner) {
    if (typeof fn !== 'function') return;
    visuals.push({ when: +when || 0, fn, owner });
    if (!visualRaf) visualRaf = requestAnimationFrame(frame);
  },
};
Lab.clock = clock;

/* ── ownership: one game makes sound at a time ── */
Lab.claim = function claim(owner, stopFn) {
  if (claimant && claimant.owner !== owner) {
    const prev = claimant;
    claimant = null;
    call(prev.stopFn, 'claimed');
  }
  if (run && run.owner !== owner) clock.stop(run.owner, 'claimed');
  if (!claimant) claimant = { owner, stopFn: typeof stopFn === 'function' ? stopFn : null };
  else if (typeof stopFn === 'function') claimant.stopFn = stopFn;
  noteHold();
};
Lab.release = function release(owner) {
  if (claimant && claimant.owner === owner) claimant = null;
};

// Hidden tab: stop, and never resume on our own
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  if (run) clock.stop(run.owner, 'hidden');
  if (claimant) {
    const prev = claimant;
    claimant = null;
    call(prev.stopFn, 'hidden');
  }
});

/* ── rotation / window resize: the game that's playing stays where it was on screen ──
   Chrome anchors a rotation on the fixed topbar (scrollY stays put) and CSS scroll
   anchoring gives up when the layout crosses the 960 px breakpoint, so the playing stage
   could land a screen away and then stop as 'offscreen'. The owner's section carries
   data-lab-owner; its [data-lab-hold] element (else its .stage) goes back to where it was
   on screen, or as near as fits under the topbar. Width changes only: a phone's URL bar
   changes the height mid-scroll, and scrolling then would fight the fling. */
const activeOwner = () => (claimant && claimant.owner) || (run && run.owner) || null;
function holdEl(owner) {
  if (!owner) return null;
  const sec = Array.from(document.querySelectorAll('[data-lab-owner]')).find(el => el.getAttribute('data-lab-owner') === owner);
  return sec ? sec.querySelector('[data-lab-hold]') || sec.querySelector('.stage') : null;
}
let place = null, placeRaf = 0, resizedAt = -Infinity, holdW = window.innerWidth;
function noteHold() {
  if (performance.now() - resizedAt < 500) return;        // mid-reflow positions aren't the player's
  const el = holdEl(activeOwner());
  place = el ? { el, top: el.getBoundingClientRect().top } : null;
}
function restoreHold() {
  if (!place || !place.el.isConnected || holdEl(activeOwner()) !== place.el) return;
  const r = place.el.getBoundingClientRect(), vh = window.innerHeight || document.documentElement.clientHeight;
  const bar = document.getElementById('topbar');
  const min = bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0;
  const d = r.top - Math.max(min, Math.min(place.top, vh - r.height));
  if (Math.abs(d) < 1) return;
  // 'instant': html { scroll-behavior: smooth } would otherwise glide, too late for the observers
  try { window.scrollBy({ top: d, behavior: 'instant' }); } catch (e) { window.scrollBy(0, d); }
}
function onReflow(e) {
  if (e.type === 'resize') {
    const w = window.innerWidth;
    if (w === holdW) return;
    holdW = w;
  }
  if (!place) return;
  resizedAt = performance.now();
  // Now (before this frame's IntersectionObserver pass), after the games' own relayouts,
  // and once more for iOS, whose innerHeight settles late
  restoreHold();
  requestAnimationFrame(() => requestAnimationFrame(restoreHold));
  setTimeout(restoreHold, 300);
}
window.addEventListener('scroll', () => {
  if (!placeRaf) placeRaf = requestAnimationFrame(() => { placeRaf = 0; noteHold(); });
}, { passive: true });
window.addEventListener('resize', onReflow);
window.addEventListener('orientationchange', onReflow);


/* ════════════════════════════════════════════════════════════════════
   LabUI — DOM helpers shared by the games
   ════════════════════════════════════════════════════════════════════ */
const MSG = Object.freeze({
  // Shown for every stop the player didn't ask for (another game took the sound, the
  // game scrolled off screen, the tab was hidden), so it names no reason and no button
  paused: 'Stopped. Start it again whenever you like.',
  noAudio: 'This browser can’t make sound here. Try a recent Chrome, Safari or Firefox.',
  noEngine: 'This experiment couldn’t load its music engine. Refresh the page to try again.',
  silentSwitch: 'No sound? Check the silent switch on the side of your phone.',
  copyHere: 'Copy this link:',
});
UI.MSG = MSG;

// Show (or with empty text, hide) an .inline-msg
UI.msg = function msg(el, text) {
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('on', !!text);
};

const announced = new WeakMap();
UI.announce = function announce(liveEl, text, { minGap = 900 } = {}) {
  if (!liveEl) return;
  if (!liveEl.hasAttribute('aria-live')) liveEl.setAttribute('aria-live', 'polite');
  let s = announced.get(liveEl);
  if (!s) announced.set(liveEl, s = { last: null, at: -Infinity, timer: 0, pending: null });
  const t = String(text == null ? '' : text);
  if (t === (s.timer ? s.pending : s.last)) return;
  const write = () => {
    const next = s.pending;
    s.timer = 0; s.pending = null;
    if (next === s.last) return;
    liveEl.textContent = next;
    s.last = next; s.at = performance.now();
  };
  s.pending = t;
  if (s.timer) return;                                   // a burst: the last one wins
  const wait = s.at + minGap - performance.now();
  if (wait <= 0) write();
  else s.timer = setTimeout(write, wait);
};

UI.readHash = function readHash(prefix) {
  const h = location.hash || '', head = '#' + prefix + '=';
  if (!h.startsWith(head)) return null;
  const p = h.slice(head.length);
  if (!p || p.length > 1200 || !/^[A-Za-z0-9._-]+$/.test(p)) return null;
  return p;
};

// Bring a status line into view if it isn't (on a phone the Copy button sits below the
// stage its message shows in). Only for replies to a button: never mid-play.
UI.reveal = function reveal(el) {
  if (!el || !el.getBoundingClientRect) return;
  const r = el.getBoundingClientRect(), vh = window.innerHeight || document.documentElement.clientHeight;
  if (!r.height || (r.top >= 64 && r.bottom <= vh)) return;
  try { el.scrollIntoView({ block: 'nearest', behavior: UI.REDUCED ? 'instant' : 'smooth' }); } catch (e) { el.scrollIntoView(false); }
};

UI.share = function share(prefix, payload, msgEl) {
  const url = location.origin + location.pathname + '#' + prefix + '=' + payload;
  if (msgEl) msgEl.querySelectorAll('input.share-url, .share-label').forEach(n => n.remove());
  const fallback = () => {
    if (msgEl) {
      UI.msg(msgEl, '');                 // whatever the line said was about something else
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.readOnly = true;
      inp.value = url;
      inp.className = 'share-url';
      inp.spellcheck = false;
      inp.setAttribute('aria-label', 'Copy this link');
      inp.addEventListener('focus', () => inp.select());
      msgEl.appendChild(inp);
      msgEl.classList.add('on');
      try { inp.focus({ preventScroll: true }); } catch (e) {}
      inp.select();
    }
    return 'shown';
  };
  let p = null;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) p = navigator.clipboard.writeText(url).then(() => 'copied', fallback);
  } catch (e) {}
  if (!p) p = Promise.resolve(fallback());
  /* Runs after the caller's own .then (reactions run in order, and this one queues one
     more microtask), so the game has written its reply or its own prompt by then. */
  p.then(res => queueMicrotask(() => {
    if (!msgEl) return;
    const inp = res === 'shown' && msgEl.querySelector('input.share-url');
    const prev = inp && inp.previousSibling;
    // A label unless the game put its own words before the field. Its text comes from CSS,
    // so the line's textContent (which the games compare) stays as the game left it.
    if (inp && !(prev && (prev.nodeType === 1 || prev.textContent.trim()))) {
      const lab = document.createElement('span');
      lab.className = 'share-label';
      lab.setAttribute('data-text', MSG.copyHere);
      lab.setAttribute('aria-hidden', 'true');
      msgEl.insertBefore(lab, inp);
    }
    if (msgEl.classList.contains('on')) UI.reveal(msgEl);
  }), () => {});
  return p;
};

UI.store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      const v = raw == null ? null : JSON.parse(raw);
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  },
};

const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let hinted = false;
UI.soundHint = function soundHint(msgEl) {
  if (!IOS || hinted || !msgEl) return false;
  hinted = true;
  try {
    if (sessionStorage.getItem('jc-lab-sound-hint')) return false;
    sessionStorage.setItem('jc-lab-sound-hint', '1');
  } catch (e) {}
  UI.msg(msgEl, MSG.silentSwitch);
  return true;
};

UI.roving = function roving(container, itemSelector, { vertical = false } = {}) {
  let current = null;
  const items = () => Array.from(container.querySelectorAll(itemSelector)).filter(el => !el.disabled && !el.hidden);
  const setCurrent = cur => { current = cur; items().forEach(el => { el.tabIndex = el === cur ? 0 : -1; }); };
  const itemOf = target => { const el = target.closest && target.closest(itemSelector); return el && items().includes(el) ? el : null; };
  const picked = el => el.classList.contains('on') || ['aria-pressed', 'aria-selected', 'aria-checked'].some(a => el.getAttribute(a) === 'true');
  // Re-sync after items change: keep the current one, else the picked one, else the first
  function refresh() {
    const all = items();
    if (all.length) setCurrent(all.includes(current) ? current : all.find(picked) || all[0]);
  }
  container.addEventListener('keydown', e => {
    const cur = itemOf(e.target);
    if (!cur) return;
    const all = items(), i = all.indexOf(cur);
    const back = vertical ? 'ArrowUp' : 'ArrowLeft', fwd = vertical ? 'ArrowDown' : 'ArrowRight';
    let j;
    if (e.key === back) j = Math.max(0, i - 1);
    else if (e.key === fwd) j = Math.min(all.length - 1, i + 1);
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = all.length - 1;
    else return;
    e.preventDefault();
    setCurrent(all[j]);
    all[j].focus();
  });
  container.addEventListener('focusin', e => { const el = itemOf(e.target); if (el) setCurrent(el); });
  refresh();
  return { refresh };
};

UI.longPress = function longPress(el, { ms = 500, onLong, onShort } = {}) {
  let st = null;
  const cancel = () => { if (st) clearTimeout(st.timer); st = null; };
  const down = e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    cancel();
    const s = st = { id: e.pointerId, x: e.clientX, y: e.clientY, fired: false };
    s.timer = setTimeout(() => { if (st === s) { s.fired = true; call(onLong, e); } }, ms);
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
  };
  const move = e => { if (st && e.pointerId === st.id && Math.hypot(e.clientX - st.x, e.clientY - st.y) > 8) cancel(); };
  const up = e => {
    if (!st || e.pointerId !== st.id) return;
    const fired = st.fired;
    cancel();
    if (!fired) call(onShort, e);
  };
  const click = e => { if (e.detail === 0) call(onShort, e); };      // keyboard Enter / Space
  const menu = e => e.preventDefault();
  const on = [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', cancel], ['click', click], ['contextmenu', menu]];
  on.forEach(([type, fn]) => el.addEventListener(type, fn));
  el.style.webkitTouchCallout = 'none';
  el.style.webkitUserSelect = 'none';
  el.style.userSelect = 'none';
  return () => { cancel(); on.forEach(([type, fn]) => el.removeEventListener(type, fn)); };
};

UI.segBind = function segBind(segEl, onPick) {
  const buttons = () => Array.from(segEl.querySelectorAll('button'));
  const set = btn => buttons().forEach(b => {
    const on = b === btn;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  buttons().forEach(b => b.setAttribute('aria-pressed', String(b.classList.contains('on'))));
  segEl.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !segEl.contains(b) || b.disabled) return;
    set(b);
    call(onPick, b.dataset);
  });
  return set;
};

})();

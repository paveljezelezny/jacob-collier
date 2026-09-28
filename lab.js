/* ════════════════════════════════════════════════════════════════════
   HARMONY LAB — four playable experiments.
   01 Negative harmony · 02 G half-sharp (comma drift)
   03 Audience choir   · 04 Harmonizer (mic pitch → diatonic harmony)
   Everything is synthesized with Web Audio. Depends on harmony.js.
   ════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';

const H = window.Harmony;
if (!H) {
  // harmony.js failed to load: say so in every experiment instead of failing silently
  document.querySelectorAll('.exp-stage .stage').forEach(st => {
    const msg = document.createElement('p');
    msg.className = 'inline-msg on';
    msg.style.margin = '22px';
    msg.textContent = 'This experiment couldn’t load its music engine. Refresh the page to try again.';
    st.prepend(msg);
  });
  return;
}
const REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const SVGNS = 'http://www.w3.org/2000/svg';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp  = (a, b, k) => a + (b - a) * k;
function svg(tag, attrs, parent) {
  const el = document.createElementNS(SVGNS, tag);
  if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(el);
  return el;
}
function fmtCents(c) { return (c < -0.05 ? '−' : '+') + Math.abs(c).toFixed(1) + '¢'; }
function track(name, props) { try { if (typeof window.track === 'function') window.track(name, props); } catch (e) {} }
// Runs `onChange(isVisible)` whenever the element enters / leaves the viewport.
// Right after a rotation or a window-width change the layout is still settling (and the
// kit may be scrolling the playing game back into place), so a 'gone' then is checked
// again 600 ms later instead of being taken as the visitor scrolling away.
let reflowAt = -Infinity, reflowW = window.innerWidth;
window.addEventListener('resize', () => { if (window.innerWidth !== reflowW) { reflowW = window.innerWidth; reflowAt = performance.now(); } });
window.addEventListener('orientationchange', () => { reflowAt = performance.now(); });
function watchVisibility(el, onChange, margin = '0px') {
  if (!('IntersectionObserver' in window)) { onChange(true); return; }
  let recheck = 0;
  const onScreen = () => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < (window.innerHeight || document.documentElement.clientHeight);
  };
  new IntersectionObserver(es => es.forEach(e => {
    clearTimeout(recheck); recheck = 0;
    if (!e.isIntersecting && margin === '0px' && performance.now() - reflowAt < 600) {
      recheck = setTimeout(() => { recheck = 0; if (!onScreen()) onChange(false); }, 600);
      return;
    }
    onChange(e.isIntersecting);
  }), { rootMargin: margin }).observe(el);
}
function setPlayBtn(btn, playing, playLabel, stopLabel) {
  btn.querySelector('.ico').className = 'ico ' + (playing ? 'stop' : 'play');
  btn.querySelector('.lbl').textContent = playing ? stopLabel : playLabel;
}

/* ════════════════════════════════════════════════════════════════════
   AUDIO CORE — one context, one hall reverb, two voice types
   ════════════════════════════════════════════════════════════════════ */
// Make sure the accidental face is ready before canvases draw ♭ / ♯
if (document.fonts && document.fonts.load) { document.fonts.load('16px Acc', '♭♯').catch(() => {}); }

const Lab = (function () {
  let ctx = null, dry, wet, reverb, comp, out, keysBus = null;

  function makeIR(seconds, decay) {
    const rate = ctx.sampleRate, len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4;
      comp.attack.value = 0.006;  comp.release.value = 0.25;
      out = ctx.createGain(); out.gain.value = 0.85;
      dry = ctx.createGain(); dry.gain.value = 0.85;
      reverb = ctx.createConvolver(); reverb.buffer = makeIR(3.4, 2.4);
      wet = ctx.createGain(); wet.gain.value = 0.55;
      dry.connect(comp);
      reverb.connect(wet); wet.connect(comp);
      comp.connect(out); out.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // A mix bus that feeds both the dry path and the hall
  function bus(send = 0.35, level = 1) {
    const g = ctx.createGain(); g.gain.value = level;
    const s = ctx.createGain(); s.gain.value = send;
    g.connect(dry); g.connect(s); s.connect(reverb);
    return g;
  }

  /* Electric-piano-ish keys: FM sine pair + a short bell partial */
  function keys(midi, when, dur = 1.3, vel = 0.7, dest) {
    if (!ctx) return;
    if (!dest && !keysBus) keysBus = bus(0.3, 1);
    const t = Math.max(when || 0, ctx.currentTime);
    const f = H.midiToFreq(midi);
    const car = ctx.createOscillator(); car.frequency.value = f;
    const mod = ctx.createOscillator(); mod.frequency.value = f;
    const modG = ctx.createGain();
    modG.gain.setValueAtTime(f * 1.5 * vel, t);
    modG.gain.exponentialRampToValueAtTime(f * 0.06 + 0.01, t + 1.1);
    mod.connect(modG); modG.connect(car.frequency);
    const bell = ctx.createOscillator(); bell.frequency.value = f * 4;
    const bellG = ctx.createGain();
    bellG.gain.setValueAtTime(0.045 * vel, t);
    bellG.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(0.19 * vel, t + 0.008);
    // Short notes must decay inside their own length, or the ramps fall out of time order
    const mid = dur >= 0.7 ? 0.7 : dur * 0.6;
    amp.gain.exponentialRampToValueAtTime(0.07 * vel, t + mid);
    amp.gain.exponentialRampToValueAtTime(0.035 * vel, t + dur);
    amp.gain.setTargetAtTime(0.0001, t + dur, 0.18);
    car.connect(amp); bell.connect(bellG); bellG.connect(amp);
    amp.connect(dest || keysBus);
    const end = t + dur + 1.4;
    [car, mod, bell].forEach(o => { o.start(t); o.stop(end); });
    car.onended = () => { try { amp.disconnect(); } catch (e) {} };
  }

  /* Choir voice: detuned saws → vowel formant bank. Sustains until stop(). */
  const VOWELS = {
    ah: [[780, 1.0, 90],  [1150, 0.45, 100], [2800, 0.16, 130]],
    oh: [[480, 1.0, 80],  [820,  0.35, 90],  [2700, 0.08, 120]],
    oo: [[330, 1.0, 60],  [760,  0.14, 80],  [2600, 0.04, 140]],
  };
  // Shared read-only with the kit (Lab.vox): freeze it so nobody retunes the choir by accident
  Object.values(VOWELS).forEach(v => { v.forEach(Object.freeze); Object.freeze(v); });
  Object.freeze(VOWELS);
  const MAKEUP = 3.0;

  function choirVoice(opts) {
    const o = Object.assign({ n: 3, spread: 9, vowel: 'ah', vibRate: 5.3, vibDepth: 12, glideVar: 0, pan: 0 }, opts);
    const t = ctx.currentTime;
    const src = ctx.createGain(); src.gain.value = 1 / Math.sqrt(o.n);
    const oscs = [];
    for (let i = 0; i < o.n; i++) {
      const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 220;
      const d = o.n === 1 ? 0 : ((i / (o.n - 1)) - 0.5) * 2 * o.spread;
      osc.detune.value = d + (Math.random() - 0.5) * o.spread * 0.5;
      const lfo = ctx.createOscillator(); lfo.frequency.value = o.vibRate * (0.88 + Math.random() * 0.24);
      const lg = ctx.createGain(); lg.gain.value = 0;
      lg.gain.setTargetAtTime(o.vibDepth, t + 0.35, 0.4);      // vibrato blooms after the onset
      lfo.connect(lg); lg.connect(osc.detune);
      osc.connect(src);
      osc.start(t); lfo.start(t);
      oscs.push({ osc, lfo, tau: 0.035 + Math.random() * o.glideVar });
    }
    const sum = ctx.createGain();
    const bank = VOWELS[o.vowel].map(([f, g, bw]) => {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = f / bw;
      const gg = ctx.createGain(); gg.gain.value = g * MAKEUP;
      src.connect(bp); bp.connect(gg); gg.connect(sum);
      return { bp, gg };
    });
    // A little low-passed body so low notes don't vanish between formants
    const body = ctx.createBiquadFilter(); body.type = 'lowpass'; body.frequency.value = 700; body.Q.value = 0.5;
    const bodyG = ctx.createGain(); bodyG.gain.value = 0.22;
    src.connect(body); body.connect(bodyG); bodyG.connect(sum);
    const amp = ctx.createGain(); amp.gain.value = 0;
    sum.connect(amp);
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner(); p.pan.value = o.pan;
      amp.connect(p); p.connect(o.dest);
    } else amp.connect(o.dest);

    let alive = true;
    return {
      set(freq, glide) {
        if (!alive) return;
        const now = ctx.currentTime;
        oscs.forEach(x => x.osc.frequency.setTargetAtTime(freq, now, glide != null ? glide : x.tau));
      },
      jump(freq) {
        if (!alive) return;
        const now = ctx.currentTime;
        oscs.forEach(x => { x.osc.frequency.cancelScheduledValues(now); x.osc.frequency.setValueAtTime(freq, now); });
      },
      gain(g, tau = 0.08) { if (alive) amp.gain.setTargetAtTime(g, ctx.currentTime, tau); },
      // Scheduled twins of set / gain, for callers that plan ahead on the kit clock
      setAt(freq, when, glide = 0.03) {
        if (!alive) return;
        oscs.forEach(x => x.osc.frequency.setTargetAtTime(freq, when, glide));
      },
      gainAt(g, when, tau = 0.08) { if (alive) amp.gain.setTargetAtTime(g, when, tau); },
      // Drop anything scheduled from `when` on (e.g. an off-beat pitch the next tap overtook)
      clearFrom(when) {
        if (!alive) return;
        const clear = p => (p.cancelAndHoldAtTime ? p.cancelAndHoldAtTime(when) : p.cancelScheduledValues(when));
        oscs.forEach(x => clear(x.osc.frequency));
        clear(amp.gain);
      },
      vowel(v, tau = 0.12) {
        if (!alive || !VOWELS[v]) return;
        const now = ctx.currentTime;
        VOWELS[v].forEach(([f, g, bw], i) => {
          bank[i].bp.frequency.setTargetAtTime(f, now, tau);
          bank[i].bp.Q.setTargetAtTime(f / bw, now, tau);
          bank[i].gg.gain.setTargetAtTime(g * MAKEUP, now, tau);
        });
      },
      stop(rel = 0.35) {
        if (!alive) return;
        alive = false;
        const now = ctx.currentTime;
        amp.gain.cancelScheduledValues(now);
        amp.gain.setTargetAtTime(0, now, rel / 3);
        const end = now + rel * 2 + 0.2;
        oscs.forEach(x => { try { x.osc.stop(end); x.lfo.stop(end); } catch (e) {} });
        setTimeout(() => { try { amp.disconnect(); } catch (e) {} }, (end - now) * 1000 + 120);
      },
    };
  }

  return { ensure, bus, keys, choirVoice, VOWELS, get ctx() { return ctx; } };
})();
// The games in lab/ extend these (lab/kit.js)
window.Lab = Lab;
window.LabUI = { REDUCED, watchVisibility, setPlayBtn, track };


/* ════════════════════════════════════════════════════════════════════
   HERO — a faint five-line staff that bends toward the pointer
   ════════════════════════════════════════════════════════════════════ */
(function heroStaff() {
  const el = $('#heroStaff');
  const hero = el && el.closest('.hero');
  if (!el || !hero) return;
  el.setAttribute('viewBox', '0 0 1000 600');
  const lines = [0, 1, 2, 3, 4].map(() => svg('path', null, el));
  const heads = Array.from({ length: 7 }, (_, i) => ({
    el: svg('ellipse', { rx: 9, ry: 6.5, transform: '' }, el),
    x: 120 + i * 140 + Math.random() * 60,
    slot: Math.floor(Math.random() * 9),
    speed: 0.012 + Math.random() * 0.018,
  }));
  const Y0 = 250, GAP = 26;
  let tx = -9999, ty = -9999, px = -9999, py = -9999, visible = true, raf = 0, last = 0;

  hero.addEventListener('pointermove', e => {
    const r = el.getBoundingClientRect();
    tx = (e.clientX - r.left) / r.width * 1000;
    ty = (e.clientY - r.top) / r.height * 600;
    if (px < -9000) { px = tx; py = ty; }
  });
  hero.addEventListener('pointerleave', () => { tx = ty = -9999; });

  function yAt(i, x, t) {
    const y0 = Y0 + i * GAP;
    const wave = Math.sin(x * 0.006 + t * 0.0005 + i * 0.5) * 9;
    let bend = 0;
    if (px > -9000) {
      const fall = Math.exp(-((x - px) ** 2) / 14000) * Math.exp(-((y0 - py) ** 2) / 26000);
      bend = (y0 < py ? -1 : 1) * 30 * fall;
    }
    return y0 + wave + bend;
  }
  function frame(t) {
    raf = visible ? requestAnimationFrame(frame) : 0;
    const dt = last ? Math.min(64, t - last) : 16; last = t;
    if (tx > -9000) { px = lerp(px, tx, 0.08); py = lerp(py, ty, 0.08); }
    else if (px > -9000) { py = lerp(py, -3000, 0.02); if (py < -2000) px = py = -9999; }
    lines.forEach((p, i) => {
      let d = '';
      for (let x = -20; x <= 1020; x += 20) d += (x === -20 ? 'M' : 'L') + x + ' ' + yAt(i, x, t).toFixed(1) + ' ';
      p.setAttribute('d', d);
    });
    heads.forEach(h => {
      h.x -= h.speed * dt;
      if (h.x < -20) { h.x = 1020; h.slot = Math.floor(Math.random() * 9); }
      const line = h.slot / 2;
      const i0 = Math.floor(line), frac = line - i0;
      const y = frac ? (yAt(i0, h.x, t) + yAt(Math.min(4, i0 + 1), h.x, t)) / 2 : yAt(i0, h.x, t);
      const edge = Math.min(1, h.x / 160, (1000 - h.x) / 160);
      h.el.setAttribute('transform', `translate(${h.x.toFixed(1)} ${y.toFixed(1)}) rotate(-20)`);
      h.el.style.opacity = (0.16 * clamp(edge, 0, 1)).toFixed(3);
    });
  }
  if (REDUCED) { frame(0); cancelAnimationFrame(raf); return; }
  watchVisibility(hero, v => { visible = v; if (v && !raf) { last = 0; raf = requestAnimationFrame(frame); } });
})();


/* ════════════════════════════════════════════════════════════════════
   01 — NEGATIVE HARMONY
   ════════════════════════════════════════════════════════════════════ */
(function negativeHarmony() {
  const section = $('#negative');
  const wheel = $('#nhWheel');
  if (!section || !wheel) return;

  const R = 160, NODE_R = 21, AXIS_DEG = H.MIRROR_AXIS_DEG;
  const PROGS = {
    twofive: [[2, 5, 9, 0], [7, 11, 2, 5], [0, 4, 7, 11]],   // Dm7 G7 Cmaj7
    pop:     [[0, 4, 7], [7, 11, 2], [9, 0, 4], [5, 9, 0]],  // C G Am F
    amen:    [[5, 9, 0], [0, 4, 7]],                         // F C
  };
  let progKey = 'twofive';
  let custom = [0, 4, 7, 11];
  let current = PROGS.twofive[0];
  let mirrored = false, autoFlip = true;
  let playing = false, step = -1, timer = null;

  const playBtn = $('#nhPlay'), mirrorBtn = $('#nhMirror'), autoBtn = $('#nhAuto');
  const origChips = $('#nhOrig'), negChips = $('#nhNeg');
  const rowOrig = $('#nhRowOrig'), rowNeg = $('#nhRowNeg');
  const hint = $('#nhHint');

  /* ── build the wheel ── */
  const defs = svg('defs', null, wheel);
  const grad = svg('radialGradient', { id: 'nhFill', cx: '50%', cy: '50%', r: '65%' }, defs);
  svg('stop', { offset: '0%',   'stop-color': '#FFB84A', 'stop-opacity': '0.34' }, grad);
  svg('stop', { offset: '100%', 'stop-color': '#B488FF', 'stop-opacity': '0.10' }, grad);
  svg('circle', { class: 'ring', cx: 0, cy: 0, r: R }, wheel);
  svg('circle', { class: 'ring', cx: 0, cy: 0, r: R - 58, 'stroke-dasharray': '2 6' }, wheel);
  const a = AXIS_DEG * Math.PI / 180, L = 206;
  svg('line', { class: 'axis', x1: Math.cos(a) * L, y1: Math.sin(a) * L, x2: -Math.cos(a) * L, y2: -Math.sin(a) * L }, wheel);
  const axLbl = svg('text', { class: 'axis-lbl', x: -Math.cos(a) * (L + 4), y: -Math.sin(a) * (L + 4) + 12, 'text-anchor': 'middle' }, wheel);
  axLbl.textContent = 'mirror axis';
  const ghostPath = svg('path', { class: 'ghost-poly' }, wheel);
  const flipG = svg('g', null, wheel);
  const polyPath = svg('path', { class: 'poly' }, flipG);

  svg('circle', { class: 'hub', cx: 0, cy: 0, r: 62 }, wheel);   // keeps the chord name readable over the axis
  const nodes = [];
  for (let pc = 0; pc < 12; pc++) {
    const [x, y] = H.wheelPoint(pc, R);
    const g = svg('g', { class: 'node', transform: `translate(${x.toFixed(2)} ${y.toFixed(2)})`, tabindex: '0', role: 'button', 'aria-label': 'Note ' + H.pcName(pc) }, wheel);
    svg('circle', { r: NODE_R }, g);
    svg('text', null, g).textContent = H.pcName(pc);
    g.addEventListener('click', () => onNode(pc));
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNode(pc); } });
    nodes[pc] = { g, x, y };
  }
  const centerLbl = svg('text', { class: 'center-lbl', x: 0, y: -8 }, wheel);
  const centerSub = svg('text', { class: 'center-sub', x: 0, y: 24 }, wheel);

  /* ── the flip: reflect the polygon across the axis by animating scaleY 1 → −1 ── */
  let flipS = 1, flipRaf = 0;
  function applyFlip(s) { flipG.setAttribute('transform', H.mirrorTransform(s)); }
  function animateFlip(to) {
    cancelAnimationFrame(flipRaf);
    const from = flipS, t0 = performance.now(), dur = REDUCED ? 1 : 640;
    const tick = now => {
      const k = clamp((now - t0) / dur, 0, 1);
      flipS = from + (to - from) * H.easeInOutCubic(k);
      applyFlip(flipS);
      if (k < 1) flipRaf = requestAnimationFrame(tick);
    };
    flipRaf = requestAnimationFrame(tick);
  }
  applyFlip(1);

  function seq() { return progKey === 'custom' ? [custom.slice()] : PROGS[progKey]; }

  function render() {
    const orig = current, neg = H.negativeSet(orig);
    const heard = mirrored ? neg : orig, other = mirrored ? orig : neg;
    polyPath.setAttribute('d', H.wheelPath(orig, R));
    polyPath.classList.toggle('mirrored', mirrored);
    ghostPath.setAttribute('d', H.wheelPath(other, R));
    for (let pc = 0; pc < 12; pc++) {
      nodes[pc].g.classList.toggle('on', heard.includes(pc));
      nodes[pc].g.classList.toggle('ghost', other.includes(pc) && !heard.includes(pc));
    }
    const nm = H.nameChord(heard, { free: true });
    centerLbl.textContent = nm ? nm.name : '';
    centerSub.textContent = mirrored ? 'the mirror' : 'original';

    origChips.innerHTML = ''; negChips.innerHTML = '';
    seq().forEach((pcs, i) => {
      const o = document.createElement('span'); o.className = 'chip';
      o.textContent = H.nameChord(pcs, { free: true }).name;
      const n = document.createElement('span'); n.className = 'chip';
      n.textContent = H.nameChord(H.negativeSet(pcs), { free: true }).name;
      if (playing && i === step) (mirrored ? n : o).classList.add('now');
      origChips.appendChild(o); negChips.appendChild(n);
    });
    rowOrig.classList.toggle('dim', mirrored);
    rowNeg.classList.toggle('dim', !mirrored);
    mirrorBtn.setAttribute('aria-pressed', String(mirrored));
    autoBtn.classList.toggle('on', autoFlip);
    autoBtn.setAttribute('aria-pressed', String(autoFlip));
    hint.classList.toggle('on', progKey === 'custom');
  }

  function playChord(pcs) {
    const nm = H.nameChord(pcs, { free: true });
    const notes = H.voiceChord(pcs, nm.root, { bassLow: 41, upperLow: 57 });
    const t = Lab.ctx.currentTime + 0.03;
    notes.forEach((m, i) => Lab.keys(m, t + i * 0.014, 1.25, i === 0 ? 0.8 : 0.62));
  }

  function tick() {
    const s = seq();
    step++;
    if (step >= s.length) {
      step = 0;
      if (autoFlip) setMirror(!mirrored);
    }
    current = s[step];
    playChord(mirrored ? H.negativeSet(current) : current);
    render();
    timer = setTimeout(tick, step === s.length - 1 ? 2100 : 1300);
  }

  function start() {
    if (!Lab.ensure()) return;
    playing = true; step = -1;
    setPlayBtn(playBtn, true, 'Play', 'Stop');
    track('lab_play', { exp: 'negative', prog: progKey });
    tick();
  }
  function stop() {
    playing = false; clearTimeout(timer); timer = null; step = -1;
    setPlayBtn(playBtn, false, 'Play', 'Stop');
    render();
  }
  function setMirror(on) {
    if (on === mirrored) return;
    mirrored = on;
    animateFlip(on ? -1 : 1);
    render();
  }

  playBtn.addEventListener('click', () => (playing ? stop() : start()));
  mirrorBtn.addEventListener('click', () => {
    autoFlip = false;
    setMirror(!mirrored);
    if (!playing && Lab.ensure()) playChord(mirrored ? H.negativeSet(current) : current);
  });
  autoBtn.addEventListener('click', () => { autoFlip = !autoFlip; render(); });

  $('#nhPresets').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#nhPresets button').forEach(x => x.classList.toggle('on', x === b));
    const wasPlaying = playing;
    if (playing) stop();
    progKey = b.dataset.prog;
    if (progKey === 'custom') custom = current.slice();
    current = seq()[0];
    render();
    if (wasPlaying) start();
  });

  function onNode(pc) {
    if (!Lab.ensure()) return;
    if (progKey !== 'custom') {
      if (playing) stop();
      progKey = 'custom';
      custom = current.slice();
      $$('#nhPresets button').forEach(x => x.classList.toggle('on', x.dataset.prog === 'custom'));
    }
    // `custom` lives in un-mirrored space; when the mirror is on, toggle the note
    // whose reflection is the one you tapped, so the tapped node is what lights up
    const src = mirrored ? H.negativePc(pc) : pc;
    if (custom.includes(src)) { if (custom.length > 1) custom = custom.filter(p => p !== src); }
    else if (custom.length < 6) custom = custom.concat(src);
    current = custom.slice();
    Lab.keys(60 + pc, 0, 0.9, 0.7);
    const n = nodes[pc].g;
    n.classList.remove('ping'); void n.getBBox(); n.classList.add('ping');
    render();
  }

  watchVisibility(section, v => { if (!v && playing) stop(); });
  render();
})();


/* ════════════════════════════════════════════════════════════════════
   02 — G HALF-SHARP · the comma pump
   Loop G – D – Am – Em in pure (5-limit) tuning. Every note shared by
   two neighbouring chords is held still, so each lap lands a syntonic
   comma (81/80 ≈ 21.5¢) higher.
   ════════════════════════════════════════════════════════════════════ */
(function commaPump() {
  const section = $('#halfsharp');
  if (!section) return;

  const LOOP = [
    { root: 7, q: 'maj', name: 'G'  },
    { root: 2, q: 'maj', name: 'D'  },
    { root: 9, q: 'min', name: 'Am' },
    { root: 4, q: 'min', name: 'Em' },
  ];
  const RATIOS = { maj: [[0, 1], [4, 5 / 4], [7, 3 / 2]], min: [[0, 1], [3, 6 / 5], [7, 3 / 2]] };
  const G2 = 97.9989, BASS_LO = 73.42;          // bass lives between D2 and D3
  const CHORD_MS = 1750;
  const UPPER_START = [G2 * 2 * 5 / 4, G2 * 3, G2 * 4]; // B3 D4 G4, justly tuned
  const RANGES = [[123, 330], [185, 440], [247, 700]];   // tenor, alto, soprano (Hz)

  const SHARP_NAMES = ['G', 'G♯', 'A', 'A♯', 'B', 'C', 'C♯'];
  const etFreq = pc => G2 * Math.pow(2, H.mod12(pc - 7) / 12);
  const normalize = f => { while (f < BASS_LO) f *= 2; while (f >= BASS_LO * 2) f /= 2; return f; };
  function centsVsET(pc, f) { let c = H.cents(f, etFreq(pc)); c = ((c % 1200) + 1200) % 1200; return c > 600 ? c - 1200 : c; }
  function chordFreqs(ch, rf) { return RATIOS[ch.q].map(([iv, r]) => ({ pc: H.mod12(ch.root + iv), f: rf * r })); }

  let tuning = 'just';
  let rootFreq = G2, idx = 0, lap = 0;
  let upper = UPPER_START.slice();
  let playing = false, timer = null, voices = null;
  let history = [];                         // one entry per chord: { c, lapStart }
  const lastCents = [0, 0, 0, 0];

  const playBtn = $('#cpPlay'), resetBtn = $('#cpReset');
  const keyEl = $('#cpKey'), centsEl = $('#cpCents'), descEl = $('#cpDesc'), nowEl = $('#cpNow');
  const ruler = $('#cpRuler'), needle = $('#cpNeedle');
  const stairs = $('#cpStairs'), chipsEl = $('#cpChips');

  /* chips */
  const chips = LOOP.map(ch => {
    const c = document.createElement('div'); c.className = 'cp-chip';
    c.innerHTML = `<div class="nm">${ch.name}</div><div class="ct">+0.0¢</div>`;
    chipsEl.appendChild(c);
    return c;
  });

  /* ruler */
  let rulerMax = 0;
  function buildRuler(max) {
    if (max === rulerMax) return;
    rulerMax = max;
    $$('.ruler-tick, .ruler-lbl', ruler).forEach(n => n.remove());
    for (let c = 0; c <= max; c += 25) {
      const x = (c / max) * 100;
      const t = document.createElement('div');
      t.className = 'ruler-tick' + (c % 50 ? ' minor' : '');
      t.style.left = x + '%';
      ruler.appendChild(t);
      if (c % 50 === 0) {
        const semis = Math.floor(c / 100), half = c % 100 === 50;
        const lbl = document.createElement('div');
        lbl.className = 'ruler-lbl' + (half ? ' hot' : '');
        lbl.style.left = x + '%';
        lbl.textContent = SHARP_NAMES[semis % 7] + (half ? ' half-sharp' : '');
        ruler.appendChild(lbl);
      }
    }
  }

  function describe(c) {
    if (tuning === 'et' && Math.abs(c) < 3) return 'Piano tuning. Nothing drifts, ever.';
    if (tuning === 'et') return 'Piano tuning: the drift has frozen where it was.';
    if (c < 5)   return 'Right where the piano is.';
    if (c < 35)  return 'Slightly sharp. Nobody has noticed yet.';
    if (c < 65)  return 'G half-sharp: in the crack between two keys.';
    if (c < 90)  return 'Past the quarter-tone. A piano would sound awful now.';
    if (c < 112) return 'A whole semitone. G♯, and nobody decided to change key.';
    return 'Still climbing. The comma never stops.';
  }

  function drawStairs() {
    const Wd = 640, Hd = 200, PAD_T = 14, PAD_B = 22;
    const max = rulerMax;
    const yOf = c => Hd - PAD_B - (clamp(c, -10, max) / max) * (Hd - PAD_T - PAD_B);
    stairs.innerHTML = '';
    for (let c = 0; c <= max; c += 50) {
      svg('line', { class: 'grid', x1: 0, x2: Wd, y1: yOf(c), y2: yOf(c) }, stairs);
    }
    svg('line', { class: 'ref', x1: 0, x2: Wd, y1: yOf(0), y2: yOf(0) }, stairs);
    svg('text', { class: 'ref-lbl', x: 4, y: yOf(0) + 14 }, stairs).textContent = 'piano';
    svg('line', { class: 'ref', x1: 0, x2: Wd, y1: yOf(50), y2: yOf(50) }, stairs);
    svg('text', { class: 'ref-lbl', x: 4, y: yOf(50) - 6 }, stairs).textContent = 'half-sharp';
    const VISIBLE = 20, stepW = Wd / VISIBLE;
    const pts = history.slice(-VISIBLE);
    if (!pts.length) return;
    let d = '';
    pts.forEach((p, i) => {
      const x0 = i * stepW, x1 = x0 + stepW, y = yOf(p.c);
      d += (i === 0 ? `M ${x0} ${y}` : ` V ${y}`) + ` H ${x1}`;
    });
    svg('path', { class: 'step' + (tuning === 'et' ? ' et' : ''), d }, stairs);
    pts.forEach((p, i) => {
      if (!p.lapStart) return;
      const x = i * stepW + 4, y = yOf(p.c);
      svg('circle', { class: 'lap-dot', cx: x, cy: y, r: 3.5 }, stairs);
      svg('text', { class: 'lap-lbl', x: x + stepW / 2 - 4, y: y - 9 }, stairs).textContent = 'lap ' + p.lap;
    });
  }

  function ui() {
    const ch = LOOP[idx];
    const c = centsVsET(ch.root, rootFreq);
    lastCents[idx] = c;
    // The story is about home: where G lands each time the loop comes round
    const home = history.filter(h => h.lapStart).slice(-1)[0];
    const homeC = home ? home.c : 0;
    buildRuler(Math.max(120, Math.ceil((homeC + 20) / 100) * 100 + 20));
    keyEl.textContent = 'G';
    centsEl.textContent = fmtCents(homeC);
    descEl.textContent = describe(homeC);
    nowEl.textContent = playing
      ? `Now singing ${ch.name} · ${fmtCents(c)} vs the piano · lap ${lap + 1}`
      : history.length ? `Paused after ${lap + 1} lap${lap ? 's' : ''}` : 'Press sing. Watch the needle each time the loop comes home to G.';
    const w = ruler.clientWidth || 1;
    needle.style.transform = `translateX(${((clamp(homeC, 0, rulerMax) / rulerMax) * w).toFixed(1)}px)`;
    chips.forEach((el, i) => {
      el.classList.toggle('now', playing && i === idx);
      el.querySelector('.ct').textContent = fmtCents(lastCents[i]);
    });
    drawStairs();
  }

  function voiceUpper(tones) {
    const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    let best = null;
    for (const p of perms) {
      let cost = 0; const out = [];
      for (let v = 0; v < 3; v++) {
        let f = tones[p[v]];
        f = f * Math.pow(2, Math.round(Math.log2(upper[v] / f)));
        const [lo, hi] = RANGES[v];
        if (f < lo || f > hi) cost += 2;
        cost += Math.abs(Math.log2(f / upper[v]));
        out.push(f);
      }
      if (out[0] >= out[1] || out[1] >= out[2]) cost += 3;
      if (!best || cost < best.cost) best = { cost, out };
    }
    upper = best.out;
    return upper;
  }

  function sound(first) {
    const tones = chordFreqs(LOOP[idx], rootFreq).map(t => t.f);
    const up = voiceUpper(tones);
    const all = [rootFreq].concat(up);
    voices.forEach((v, i) => (first ? v.jump(all[i]) : v.set(all[i], 0.07)));
    if (first) voices.forEach((v, i) => v.gain(i === 0 ? 0.3 : 0.2, 0.12));
    history.push({ c: centsVsET(LOOP[idx].root, rootFreq), lapStart: idx === 0, lap: lap + 1 });
    if (history.length > 200) history = history.slice(-100);
    ui();
  }

  function advance() {
    const prev = LOOP[idx];
    const prevTones = chordFreqs(prev, rootFreq);
    idx = (idx + 1) % LOOP.length;
    const next = LOOP[idx];
    if (tuning === 'et') {
      const off = centsVsET(prev.root, rootFreq);
      rootFreq = normalize(etFreq(next.root) * Math.pow(2, off / 1200));
    } else {
      // Hold the shared note: tune the new chord so it contains prev's frequency exactly
      let found = null;
      for (const [iv, r] of RATIOS[next.q]) {
        const pc = H.mod12(next.root + iv);
        const hit = prevTones.find(t => t.pc === pc);
        if (hit) { found = hit.f / r; break; }
      }
      rootFreq = normalize(found || etFreq(next.root));
    }
    if (idx === 0) lap++;
    sound(false);
    timer = setTimeout(advance, CHORD_MS);
  }

  function start() {
    if (!Lab.ensure()) return;
    const dest = Lab.bus(0.5, 1);
    voices = [
      Lab.choirVoice({ n: 3, spread: 7, vowel: 'oh', vibDepth: 8,  pan: 0,     dest }),
      Lab.choirVoice({ n: 3, spread: 8, vowel: 'ah', vibDepth: 11, pan: -0.35, dest }),
      Lab.choirVoice({ n: 3, spread: 8, vowel: 'ah', vibDepth: 11, pan: 0.35,  dest }),
      Lab.choirVoice({ n: 3, spread: 9, vowel: 'ah', vibDepth: 14, pan: 0.05,  dest }),
    ];
    playing = true;
    setPlayBtn(playBtn, true, 'Sing the loop', 'Stop');
    track('lab_play', { exp: 'halfsharp', tuning });
    sound(true);
    timer = setTimeout(advance, CHORD_MS);
  }
  function stop() {
    playing = false; clearTimeout(timer); timer = null;
    if (voices) { voices.forEach(v => v.stop(0.6)); voices = null; }
    setPlayBtn(playBtn, false, 'Sing the loop', 'Stop');
    ui();
  }
  function reset() {
    const was = playing;
    if (playing) stop();
    rootFreq = G2; idx = 0; lap = 0; upper = UPPER_START.slice(); history = [];
    lastCents.fill(0);
    ui();
    if (was) start();
  }

  playBtn.addEventListener('click', () => (playing ? stop() : start()));
  resetBtn.addEventListener('click', reset);
  $('#cpTuning').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#cpTuning button').forEach(x => x.classList.toggle('on', x === b));
    tuning = b.dataset.tuning;
    ui();
  });
  window.addEventListener('resize', () => ui());
  watchVisibility(section, v => { if (!v && playing) stop(); });
  ui();
})();


/* ════════════════════════════════════════════════════════════════════
   03 — AUDIENCE CHOIR
   Three wedges of a seated crowd. Press a wedge to hand it a note
   (height = pitch). Release and it keeps holding. Build chords of people.
   ════════════════════════════════════════════════════════════════════ */
(function audienceChoir() {
  const section = $('#choir');
  const cv = $('#crowd');
  if (!section || !cv) return;
  const g = cv.getContext('2d');

  const TONIC = 51;              // E♭3
  const STEPS = 10;              // notes available per section
  const TAU = Math.PI * 2, BUCKETS = 8, IDLE_FILL = 'rgba(244,239,230,0.13)', RIPPLE_S = 1.6;
  const SECTIONS = [
    { label: 'Left · low',    rgb: '180,136,255', hex: '#B488FF', degLo: -5, pan: -0.55, a0: -166, a1: -122 },
    { label: 'Centre · mid',  rgb: '255,184,74',  hex: '#FFB84A', degLo: 0,  pan: 0,     a0: -117, a1: -63  },
    { label: 'Right · high',  rgb: '255,78,38',   hex: '#FF4E26', degLo: 5,  pan: 0.55,  a0: -58,  a1: -14  },
  ];
  SECTIONS.forEach(s => Object.assign(s, { midi: null, voice: null, level: 0, changeT: -10, count: 0, dots: [], idlePath: null }));
  // Pre-built fills: dots are batched into a few alpha buckets per section instead of one fill per dot
  SECTIONS.forEach(s => { s.fills = Array.from({ length: BUCKETS }, (_, b) => `rgba(${s.rgb},${(0.13 + (b + 0.5) / BUCKETS * 0.85).toFixed(3)})`); });

  let scaleName = 'major', vowel = 'ah';
  let W = 0, Hh = 0, DPR = 1, cx = 0, cy = 0, rMin = 0, rMax = 0, kx = 1;
  let glowGrad = null, lastW = 0, lastH = 0;
  let hover = null, focusSec = 1, drag = null;
  let visible = false, raf = 0;
  let bus = null;
  let baton = { x: 0, y: 0, tx: 0, ty: 0, on: false };
  let demoTimers = [], demoOn = false;

  const hintEl = $('#acHint'), chordEl = $('#acChord'), colourEl = $('#acColour');
  const demoBtn = $('#acDemo');

  /* section readouts */
  const secWrap = $('#acSections');
  SECTIONS.forEach((s, i) => {
    const d = document.createElement('div');
    d.className = 'sec'; d.style.setProperty('--c', s.hex);
    d.innerHTML = `<div class="who"><i></i>${s.label}</div><div class="nt">—</div><div class="ct"></div>`;
    d.addEventListener('click', () => { focusSec = i; });
    secWrap.appendChild(d);
    s.el = d;
  });

  /* ── layout ── */
  function layout() {
    const r = cv.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, r.width); Hh = Math.max(1, r.height);
    cv.width = Math.round(W * DPR); cv.height = Math.round(Hh * DPR);
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    cx = W / 2; cy = Hh * 1.1;
    rMin = Hh * 0.36; rMax = Hh * 1.04;
    // Elliptical fan: squeeze or stretch horizontally so all three sections always fit
    kx = clamp((W / 2 - 10) / (rMax * Math.cos(14 * Math.PI / 180)), 0.4, 1.25);
    lastW = Math.round(W); lastH = Math.round(Hh);
    glowGrad = g.createRadialGradient(cx, Hh, 0, cx, Hh, Hh * 0.7);
    glowGrad.addColorStop(0, 'rgba(255,184,74,0.10)');
    glowGrad.addColorStop(1, 'rgba(255,184,74,0)');
    SECTIONS.forEach(s => { s.count = 0; s.dots = []; s.idlePath = new Path2D(); });
    const ROWS = W < 480 ? 9 : 12;
    for (let row = 0; row < ROWS; row++) {
      const k = row / (ROWS - 1);
      const rad = lerp(rMin, rMax, k);
      const size = lerp(3.6, 1.7, k) * (W < 480 ? 0.85 : 1);
      const spacing = size * 3.6;
      SECTIONS.forEach((s, si) => {
        const a0 = s.a0 * Math.PI / 180, a1 = s.a1 * Math.PI / 180;
        const n = Math.max(2, Math.floor(((a1 - a0) * rad * Math.sqrt((kx * kx + 1) / 2)) / spacing));
        for (let j = 0; j <= n; j++) {
          const ang = lerp(a0, a1, j / n) + (row % 2 ? 0.5 / n * (a1 - a0) : 0);
          if (ang > a1) continue;
          const x = cx + Math.cos(ang) * rad * kx + (Math.random() - 0.5) * size * 0.8;
          const y = cy + Math.sin(ang) * rad + (Math.random() - 0.5) * size * 0.8;
          if (x < 6 || x > W - 6 || y < 6 || y > Hh - 6) continue;
          s.dots.push({ x, y, r: size, row, phase: Math.random() * TAU });
          s.idlePath.moveTo(x + size, y); s.idlePath.arc(x, y, size, 0, TAU);
          s.count++;
        }
      });
    }
    SECTIONS.forEach(s => { s.el.querySelector('.ct').textContent = (s.count * 6).toLocaleString('en-GB') + ' voices'; });
    if (!raf) drawFrame(performance.now());
  }

  /* ── pitch mapping ── */
  const yTop = () => Hh * 0.08, ySpan = () => Hh * 0.8;
  function stepAtY(y) { return Math.round((1 - clamp((y - yTop()) / ySpan(), 0, 1)) * (STEPS - 1)); }
  function yAtStep(step) { return yTop() + (1 - step / (STEPS - 1)) * ySpan(); }
  function midiOf(s, step) { return H.degreeToMidi(s.degLo + step, TONIC, H.SCALES[scaleName]); }
  function stepOf(s, midi) {
    for (let k = 0; k < STEPS; k++) if (midiOf(s, k) >= midi) return k;
    return STEPS - 1;
  }
  function sectionAt(x, y) {
    const ang = Math.atan2(y - cy, (x - cx) / kx) * 180 / Math.PI;
    let best = null, bd = Infinity;
    SECTIONS.forEach(s => {
      const d = ang < s.a0 ? s.a0 - ang : ang > s.a1 ? ang - s.a1 : 0;
      if (d < bd) { bd = d; best = s; }
    });
    return best;
  }
  function pos(e) { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  /* ── sound ── */
  function sing(s, midi) {
    if (!Lab.ensure()) return;
    if (!bus) bus = Lab.bus(0.8, 0.9);
    const f = H.midiToFreq(midi);
    if (!s.voice) {
      s.voice = Lab.choirVoice({ n: 6, spread: 16, vowel, vibRate: 5.0, vibDepth: 16, glideVar: 0.18, pan: s.pan, dest: bus });
      s.voice.jump(f * Math.pow(2, -0.6 / 12));   // crowds scoop up into the note
      s.voice.set(f, 0.09);
      s.voice.gain(0.2, 0.14);
    } else if (midi !== s.midi) s.voice.set(f);
    if (midi !== s.midi) s.changeT = performance.now() / 1000;
    s.midi = midi;
    hintEl.classList.add('off');
    updateReadout();
    wake();
  }
  function hush(s) {
    if (s.voice) s.voice.stop(0.7);
    s.voice = null; s.midi = null;
    updateReadout();
    wake();
  }
  function hushAll() { SECTIONS.forEach(hush); }

  function updateReadout() {
    SECTIONS.forEach(s => {
      s.el.classList.toggle('singing', !!s.voice);
      s.el.querySelector('.nt').textContent = s.midi != null ? H.midiName(s.midi) : '—';
    });
    const held = SECTIONS.filter(s => s.midi != null).map(s => s.midi);
    if (!held.length) { chordEl.textContent = 'Silence'; colourEl.textContent = 'Waiting for a downbeat.'; return; }
    const nm = H.nameChord(held);
    if (held.length === 1) {
      chordEl.textContent = H.midiName(held[0]);
      colourEl.textContent = 'One section holding. Give the others something.';
      return;
    }
    chordEl.textContent = nm.name;
    colourEl.textContent = nm.colour.charAt(0).toUpperCase() + nm.colour.slice(1) + '.';
  }

  /* ── pointer ── */
  cv.addEventListener('pointerdown', e => {
    if (!Lab.ensure()) return;
    cancelDemo();
    const p = pos(e);
    const s = sectionAt(p.x, p.y);
    const midi = midiOf(s, stepAtY(p.y));
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    drag = { s, moved: false, toggleOff: s.voice && s.midi === midi };
    if (!drag.toggleOff) sing(s, midi);
    focusSec = SECTIONS.indexOf(s);
    baton.on = true; baton.tx = p.x; baton.ty = p.y;
    track('lab_play', { exp: 'choir' });
  });
  cv.addEventListener('pointermove', e => {
    const p = pos(e);
    hover = { x: p.x, y: p.y, s: drag ? drag.s : sectionAt(p.x, p.y) };
    baton.tx = p.x; baton.ty = p.y; baton.on = true;
    wake();
    if (drag) {
      const midi = midiOf(drag.s, stepAtY(p.y));
      if (midi !== drag.s.midi) { drag.moved = true; drag.toggleOff = false; sing(drag.s, midi); }
    }
  });
  const endDrag = () => {
    if (drag && drag.toggleOff && !drag.moved) hush(drag.s);
    drag = null;
  };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('pointerleave', () => { hover = null; if (!demoOn) baton.on = false; wake(); });
  cv.addEventListener('focus', () => wake());
  cv.addEventListener('blur', () => wake());

  cv.addEventListener('keydown', e => {
    if (e.key >= '1' && e.key <= '3') { focusSec = +e.key - 1; e.preventDefault(); wake(); return; }
    if (e.key === 'Escape' || e.key === '0') { cancelDemo(); hushAll(); e.preventDefault(); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (!Lab.ensure()) return;
      cancelDemo();
      const s = SECTIONS[focusSec];
      const cur = s.midi == null ? Math.floor(STEPS / 2) : stepOf(s, s.midi);
      const next = s.midi == null ? cur : clamp(cur + (e.key === 'ArrowUp' ? 1 : -1), 0, STEPS - 1);
      sing(s, midiOf(s, next));
    }
  });

  /* ── controls ── */
  $('#acHush').addEventListener('click', () => { cancelDemo(); hushAll(); });
  $('#acVowel').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#acVowel button').forEach(x => x.classList.toggle('on', x === b));
    vowel = b.dataset.vowel;
    SECTIONS.forEach(s => s.voice && s.voice.vowel(vowel));
  });
  $('#acScale').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#acScale button').forEach(x => x.classList.toggle('on', x === b));
    scaleName = b.dataset.scale;
    // Re-seat every held note onto the nearest step of the new scale
    SECTIONS.forEach(s => { if (s.midi != null) sing(s, midiOf(s, stepOf(s, s.midi))); });
  });

  /* ── demo: I – IV/I – V7/ii – I – Imaj7, built one section at a time ── */
  const DEMO = [
    [0,    0, 51], [650,  1, 55], [1300, 2, 70],   // E♭
    [3300, 1, 56], [3300, 2, 72],                  // A♭/E♭
    [5300, 0, 50], [5300, 2, 70],                  // B♭7/D
    [7300, 0, 51], [7300, 1, 55],                  // E♭
    [9100, 2, 74],                                 // E♭maj7
    [12400, -1, null],
  ];
  function batonTo(s, midi) {
    const mid = ((s.a0 + s.a1) / 2) * Math.PI / 180;
    const y = yAtStep(stepOf(s, midi));
    const rad = (cy - y) / -Math.sin(mid);
    baton.tx = clamp(cx + Math.cos(mid) * rad * kx, 16, W - 16);
    baton.ty = y;
    baton.on = true;
  }
  function runDemo() {
    if (!Lab.ensure()) return;
    cancelDemo(); hushAll();
    demoOn = true;
    setPlayBtn(demoBtn, true, 'Watch it done', 'Stop the demo');
    track('lab_play', { exp: 'choir_demo' });
    DEMO.forEach(([ms, si, midi]) => {
      demoTimers.push(setTimeout(() => {
        if (si < 0) { hushAll(); cancelDemo(); return; }
        const s = SECTIONS[si];
        batonTo(s, midi);
        sing(s, midi);
      }, ms));
    });
  }
  function cancelDemo() {
    demoTimers.forEach(clearTimeout); demoTimers = [];
    if (demoOn) { demoOn = false; setPlayBtn(demoBtn, false, 'Watch it done', 'Stop the demo'); }
  }
  demoBtn.addEventListener('click', () => (demoOn ? (cancelDemo(), hushAll()) : runDemo()));

  /* ── drawing ── */
  function wedgePath(s, r0, r1) {
    const a0 = s.a0 * Math.PI / 180, a1 = s.a1 * Math.PI / 180;
    g.beginPath();
    g.ellipse(cx, cy, r1 * kx, r1, 0, a0, a1);
    g.ellipse(cx, cy, r0 * kx, r0, 0, a1, a0, true);
    g.closePath();
  }
  function drawFrame(now) {
    const t = now / 1000;
    g.clearRect(0, 0, W, Hh);

    // stage glow (gradient is built once per layout)
    g.fillStyle = glowGrad; g.fillRect(0, 0, W, Hh);

    // hovered / focused wedge + pitch ladder
    const hs = hover ? hover.s : null;
    SECTIONS.forEach((s, i) => {
      s.level = lerp(s.level, s.voice ? 1 : 0, 0.08);
      const active = s === hs || (drag && drag.s === s);
      if (active || (i === focusSec && document.activeElement === cv)) {
        wedgePath(s, rMin * 0.82, rMax * 1.2);
        g.fillStyle = `rgba(${s.rgb},0.05)`; g.fill();
      }
    });
    if (hs) {
      g.save();
      wedgePath(hs, rMin * 0.82, rMax * 1.2); g.clip();
      g.strokeStyle = `rgba(${hs.rgb},0.22)`; g.lineWidth = 1; g.setLineDash([2, 6]);
      for (let k = 0; k < STEPS; k++) { const y = yAtStep(k); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      g.restore();
      const k = stepAtY(hover.y);
      g.font = '500 11px Acc, "JetBrains Mono", monospace';
      g.fillStyle = hs.hex; g.textAlign = 'left';
      g.fillText(H.midiName(midiOf(hs, k)), hover.x + 14, yAtStep(k) - 6);
    }

    // the crowd — a resting section is one pre-built path; a singing one is
    // batched into BUCKETS alpha levels, so it's a handful of fills, not thousands
    SECTIONS.forEach(s => {
      const lv = s.level;
      const rippling = !REDUCED && t - s.changeT < RIPPLE_S;
      if (lv <= 0.03 && !rippling) { g.fillStyle = IDLE_FILL; g.fill(s.idlePath); return; }
      const paths = new Array(BUCKETS);
      let rest = null;
      for (let i = 0; i < s.dots.length; i++) {
        const d = s.dots[i];
        const ripple = rippling ? Math.max(0, 1 - Math.abs((t - s.changeT) * 9 - d.row) / 1.6) : 0;
        if (lv <= 0.03 && ripple === 0) {
          (rest || (rest = new Path2D())).moveTo(d.x + d.r, d.y); rest.arc(d.x, d.y, d.r, 0, TAU);
          continue;
        }
        const bob = REDUCED ? 0 : (lv * 1.5 + ripple * 2) * Math.sin(t * 5.1 + d.phase);
        const mouth = REDUCED ? 1 : 1 + lv * 0.22 * (0.5 + 0.5 * Math.sin(t * 8 + d.phase * 3)) + ripple * 0.45;
        const alpha = 0.13 + lv * 0.55 + ripple * 0.3;
        const b = Math.min(BUCKETS - 1, Math.max(0, Math.floor((alpha - 0.13) / 0.85 * BUCKETS)));
        const p = paths[b] || (paths[b] = new Path2D());
        const r = d.r * mouth, y = d.y - bob;
        p.moveTo(d.x + r, y); p.arc(d.x, y, r, 0, TAU);
      }
      if (rest) { g.fillStyle = IDLE_FILL; g.fill(rest); }
      for (let b = 0; b < BUCKETS; b++) if (paths[b]) { g.fillStyle = s.fills[b]; g.fill(paths[b]); }
    });

    // held-note labels at the front of each singing wedge
    g.textAlign = 'center';
    SECTIONS.forEach(s => {
      if (s.midi == null || s.level < 0.05) return;
      const mid = ((s.a0 + s.a1) / 2) * Math.PI / 180;
      const x = clamp(cx + Math.cos(mid) * rMin * 0.9 * kx, 40, W - 40);
      const y = cy + Math.sin(mid) * rMin * 0.9 + 6;
      g.globalAlpha = s.level;
      g.font = `400 ${W < 480 ? 20 : 26}px Acc, Caprasimo, Georgia, serif`;
      g.fillStyle = s.hex;
      g.fillText(H.midiName(s.midi), x, y);
      g.globalAlpha = 1;
    });

    // the conductor + baton
    baton.x = lerp(baton.x || cx, baton.tx || cx, 0.14);
    baton.y = lerp(baton.y || Hh, baton.ty || Hh, 0.14);
    const bx = cx, by = Hh - 10;
    g.fillStyle = 'rgba(244,239,230,0.9)';
    g.beginPath(); g.arc(bx, by, 5, 0, 6.2832); g.fill();
    if (baton.on) {
      const grad = g.createLinearGradient(bx, by, baton.x, baton.y);
      grad.addColorStop(0, 'rgba(244,239,230,0.0)');
      grad.addColorStop(1, 'rgba(244,239,230,0.5)');
      g.strokeStyle = grad; g.lineWidth = 1.5; g.setLineDash([]);
      g.beginPath(); g.moveTo(bx, by); g.lineTo(baton.x, baton.y); g.stroke();
      g.fillStyle = 'rgba(244,239,230,0.95)';
      g.beginPath(); g.arc(baton.x, baton.y, 3, 0, 6.2832); g.fill();
    }
  }
  // Only animate while something is actually happening; a still crowd costs nothing
  function busy(now) {
    const t = now / 1000;
    if (demoOn || drag) return true;
    // the same target drawFrame eases toward (an untouched baton rests at cx, Hh)
    if (Math.abs(baton.x - (baton.tx || cx)) > 0.5 || Math.abs(baton.y - (baton.ty || Hh)) > 0.5) return true;
    return SECTIONS.some(s => REDUCED
      ? Math.abs(s.level - (s.voice ? 1 : 0)) > 0.01
      : s.voice || s.level > 0.01 || t - s.changeT < RIPPLE_S);
  }
  function loop(now) {
    raf = 0;
    drawFrame(now);
    if (visible && busy(now)) raf = requestAnimationFrame(loop);
  }
  function wake() { if (visible && !raf) raf = requestAnimationFrame(loop); }

  // Coalesce resize bursts (e.g. phone toolbars) and skip no-op resizes
  let resizeRaf = 0;
  function scheduleLayout() {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      const r = cv.getBoundingClientRect();
      if (Math.round(r.width) !== lastW || Math.round(r.height) !== lastH) layout();
    });
  }
  if ('ResizeObserver' in window) new ResizeObserver(scheduleLayout).observe(cv);
  else window.addEventListener('resize', scheduleLayout);
  layout();
  watchVisibility(section, v => {
    visible = v;
    if (v) wake();
    else { cancelDemo(); if (SECTIONS.some(s => s.voice)) hushAll(); }
  });
  updateReadout();
})();


/* ════════════════════════════════════════════════════════════════════
   04 — HARMONIZER
   Mic → YIN pitch detection → snap to the key → pick a diatonic chord
   that contains your note (with a little memory, so it doesn't flicker)
   → voice the rest of the chord below you. Drag on the roll = no-mic mode.
   ════════════════════════════════════════════════════════════════════ */
(function harmonizer() {
  const section = $('#harmonizer');
  const cv = $('#roll');
  if (!section || !cv) return;
  const g = cv.getContext('2d');

  const KEYS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const SC = H.SCALES.major;
  const GATE = 0.018;
  const VOICE_COLORS = ['#FFB84A', '#4DD7FF', '#FF4E26', '#B488FF', 'rgba(244,239,230,0.45)'];
  const HISTORY_S = 6;

  let tonicPc = 3, mode = 'jacob';
  let micOn = false, stream = null, srcNode = null, analyser = null, monitorGain = null, buf = null, yinBuf = null;
  let monitorOn = false;
  let voices = null, melodyVoice = null, bus = null;
  let dragging = false, dragMidi = null;
  let curSnap = null, curHarm = null, lastRoot = null, lastVoiced = 0, lastMel = null;
  const recent = [];
  let hist = [];
  let viewCenter = 60;
  let W = 0, Hh = 0, DPR = 1;
  let raf = 0, visible = false, lastSungAt = 0;
  let dec = null, frameNo = 0, micLvl = 0;

  const keySel = $('#hzKey'), micBtn = $('#hzMic'), monBtn = $('#hzMonitor');
  const errEl = $('#hzError'), stateEl = $('#hzState');
  const chordEl = $('#hzChord'), notesEl = $('#hzNotes');
  const meterBars = $$('#hzMeter i'), meterEl = $('#hzMeter');

  KEYS.forEach((k, i) => {
    const o = document.createElement('option'); o.value = i; o.textContent = k + ' major';
    if (i === tonicPc) o.selected = true;
    keySel.appendChild(o);
  });
  keySel.addEventListener('change', () => { tonicPc = +keySel.value; curSnap = null; lastRoot = null; });
  $('#hzMode').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#hzMode button').forEach(x => x.classList.toggle('on', x === b));
    mode = b.dataset.mode; curSnap = null;
  });

  /* ── states ── */
  let stateKey = '';
  function setState(kind, big, small) {
    const key = kind + '|' + (big || '') + '|' + (small || '');
    if (key === stateKey) return;
    stateKey = key;
    if (kind === 'hidden') { stateEl.classList.add('off'); return; }
    stateEl.classList.remove('off');
    const inner = kind === 'asking'
      ? `<div><div class="big">Waiting for the mic…</div><div class="small" style="margin-top:14px"><span class="skeleton"></span></div></div>`
      : `<div><div class="big">${big}</div><div class="small">${small || ''}</div></div>`;
    stateEl.innerHTML = inner;
  }
  function showError(msg) { errEl.textContent = msg; errEl.classList.add('on'); }
  function clearError() { errEl.classList.remove('on'); errEl.textContent = ''; }

  /* ── YIN pitch detector (cumulative-mean-normalised difference) ── */
  function yin(data, sr) {
    let rms = 0;
    for (let i = 0; i < data.length; i++) rms += data[i] * data[i];
    rms = Math.sqrt(rms / data.length);
    if (rms < GATE) return { f: -1, rms };
    const Wn = Math.floor(data.length / 2);
    const minLag = Math.floor(sr / 1100), maxLag = Math.min(Wn - 1, Math.floor(sr / 65));
    if (!yinBuf || yinBuf.length < maxLag + 2) yinBuf = new Float32Array(maxLag + 2);
    const d = yinBuf;
    d[0] = 1;
    let run = 0;
    for (let tau = 1; tau <= maxLag; tau++) {
      let s = 0;
      for (let j = 0; j < Wn; j++) { const x = data[j] - data[j + tau]; s += x * x; }
      run += s;
      d[tau] = run ? s * tau / run : 1;
    }
    let tau = -1;
    for (let t = minLag; t <= maxLag; t++) {
      if (d[t] < 0.14) { while (t + 1 <= maxLag && d[t + 1] < d[t]) t++; tau = t; break; }
    }
    if (tau < 2) return { f: -1, rms };
    const x0 = d[tau - 1], x1 = d[tau], x2 = tau + 1 <= maxLag ? d[tau + 1] : x1;
    const den = x0 + x2 - 2 * x1;
    const better = den ? tau + (x0 - x2) / (2 * den) : tau;
    return { f: sr / better, rms };
  }

  /* ── audio ── */
  function ensureVoices() {
    if (voices) return;
    if (!bus) bus = Lab.bus(0.45, 1);
    voices = [0, 1, 2, 3].map(i => Lab.choirVoice({ n: 2, spread: 7, vowel: 'oo', vibDepth: 10, pan: [-0.4, 0.4, -0.2, 0.2][i], dest: bus }));
    voices.push(Lab.choirVoice({ n: 2, spread: 5, vowel: 'oh', vibDepth: 6, pan: 0, dest: bus }));
  }
  function releaseVoices() {
    if (voices) { voices.forEach(v => v.stop(0.4)); voices = null; }
    if (melodyVoice) { melodyVoice.stop(0.3); melodyVoice = null; }
  }

  async function startMic() {
    clearError();
    if (!Lab.ensure()) { showError('This browser has no Web Audio support.'); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showError('This page can’t reach a microphone here (it needs https or localhost). Drag up and down on the roll instead.');
      return;
    }
    setState('asking');
    micBtn.disabled = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
    } catch (err) {
      micBtn.disabled = false;
      setState('shown', 'Drag here to sing with your finger.', 'The mic is off');
      const name = err && err.name;
      showError(name === 'NotAllowedError'
        ? 'Mic access was blocked. Allow it from the address bar, or drag up and down on the roll.'
        : name === 'NotFoundError'
          ? 'No microphone found. Drag up and down on the roll to play the tune yourself.'
          : 'Couldn’t open the microphone. Drag up and down on the roll instead.');
      return;
    }
    micBtn.disabled = false;
    if (!visible) {
      // The visitor scrolled away while the permission prompt was open: don't leave a mic running off-screen
      stream.getTracks().forEach(t => t.stop());
      stream = null;
      setState('shown', 'Start the mic, or drag here.', 'Your pitch draws white · harmony draws in colour');
      return;
    }
    const ctx = Lab.ctx;
    srcNode = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
    srcNode.connect(analyser);
    monitorGain = ctx.createGain(); monitorGain.gain.value = monitorOn ? 0.9 : 0;
    srcNode.connect(monitorGain); monitorGain.connect(bus || (bus = Lab.bus(0.45, 1)));
    buf = new Float32Array(analyser.fftSize);
    micOn = true; lastSungAt = performance.now();
    ensureVoices();
    micBtn.querySelector('.lbl').textContent = 'Stop the mic';
    meterEl.classList.add('live');
    setState('shown', 'Sing or hum anything.', 'Long notes work best');
    track('lab_play', { exp: 'harmonizer_mic' });
    wake();
  }
  function stopMic() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (srcNode) try { srcNode.disconnect(); } catch (e) {}
    if (monitorGain) try { monitorGain.disconnect(); } catch (e) {}
    stream = srcNode = analyser = monitorGain = null;
    micOn = false;
    releaseVoices();
    micBtn.querySelector('.lbl').textContent = 'Start the mic';
    meterEl.classList.remove('live');
    meterBars.forEach(b => (b.style.height = '4px'));
    if (!dragging) setState('shown', 'Start the mic, or drag here.', 'Your pitch draws white · harmony draws in colour');
  }
  micBtn.addEventListener('click', () => (micOn ? stopMic() : startMic()));
  monBtn.addEventListener('click', () => {
    monitorOn = !monitorOn;
    monBtn.setAttribute('aria-pressed', String(monitorOn));
    if (monitorGain) monitorGain.gain.setTargetAtTime(monitorOn ? 0.9 : 0, Lab.ctx.currentTime, 0.05);
  });

  /* ── drag = sing with your finger ── */
  function midiAtY(y) { return viewCenter + 11 - (y / Hh) * 22; }
  cv.addEventListener('pointerdown', e => {
    if (!Lab.ensure()) return;
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    dragging = true;
    const r = cv.getBoundingClientRect();
    dragMidi = midiAtY(e.clientY - r.top);
    ensureVoices();
    if (!melodyVoice) melodyVoice = Lab.choirVoice({ n: 3, spread: 8, vowel: 'ah', vibDepth: 12, pan: 0, dest: bus });
    track('lab_play', { exp: 'harmonizer_drag' });
    wake();
  });
  cv.addEventListener('pointermove', e => {
    if (!dragging) return;
    const r = cv.getBoundingClientRect();
    dragMidi = midiAtY(e.clientY - r.top);
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false; dragMidi = null;
    if (melodyVoice) { melodyVoice.stop(0.35); melodyVoice = null; }
    if (!micOn) { voices && voices.forEach(v => drive(v, null, 0)); setTimeout(() => { if (!micOn && !dragging) releaseVoices(); }, 900); }
  };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);

  /* ── main loop ── */
  function wake() { if (!raf && visible) raf = requestAnimationFrame(loop); }
  // hist.harm = [...upper voices, bass]; voice slot 4 is always the bass
  function noteAt(harm, v) {
    if (!harm) return null;
    if (v === 4) return harm[harm.length - 1];
    return v < harm.length - 1 ? harm[v] : null;
  }
  // Only touch the audio params when something actually changed
  function drive(voice, midi, gain, glide) {
    if (!voice) return;
    if (midi != null && voice._m !== midi) { voice.set(H.midiToFreq(midi), glide); voice._m = midi; }
    const gq = Math.round(gain * 50) / 50;
    if (voice._g !== gq) { voice.gain(gq, 0.06); voice._g = gq; }
  }
  // Pitch from the mic: average pairs of samples (half the rate, a quarter of the YIN work)
  function detectPitch() {
    analyser.getFloatTimeDomainData(buf);
    const n = buf.length >> 1;
    if (!dec || dec.length !== n) dec = new Float32Array(n);
    for (let i = 0; i < n; i++) dec[i] = 0.5 * (buf[2 * i] + buf[2 * i + 1]);
    return yin(dec, Lab.ctx.sampleRate / 2);
  }
  function median3(arr) { const s = arr.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }

  function loop(now) {
    raf = 0;
    let mel = null, lvl = 0;
    if (dragging && dragMidi != null) { mel = dragMidi; lvl = 0.7; }
    else if (micOn && analyser) {
      if ((frameNo++ & 1) === 0) {                       // ~30 detections a second is plenty for a voice
        const r = detectPitch();
        micLvl = clamp(r.rms * 9, 0, 1);
        if (r.f > 65 && r.f < 1100) {
          recent.push(H.freqToMidi(r.f)); if (recent.length > 3) recent.shift();
          lastMel = median3(recent); lastVoiced = now;
        } else if (now - lastVoiced >= 140) recent.length = 0;
        meterBars.forEach((b, i) => (b.style.height = (4 + Math.max(0, micLvl * 14 - i * 1.4)).toFixed(1) + 'px'));
      }
      lvl = micLvl;
      if (lastMel != null && now - lastVoiced < 140) mel = lastMel;
    }

    const tonicMidi = 48 + tonicPc;
    if (mel != null) {
      let snap = H.degreeToMidi(H.midiToDegree(mel, tonicMidi, SC), tonicMidi, SC);
      if (curSnap != null && snap !== curSnap && Math.abs(mel - curSnap) < 0.7) snap = curSnap;   // hysteresis
      if (snap !== curSnap || !curHarm) {
        curSnap = snap;
        curHarm = H.harmonize(snap, { tonicPc, mode, lastRoot });   // voicing rules + tests live in harmony.js
        lastRoot = curHarm.rootDeg;
        chordEl.textContent = curHarm.name ? curHarm.name.name : '—';
        const sp = m => H.spellMidi(m, tonicPc);                    // C♯ in D major, not D♭
        notesEl.textContent = 'you ' + sp(snap) + ' · choir ' + curHarm.notes.map(sp).join(' ')
          + (curHarm.bass != null ? ' · bass ' + sp(curHarm.bass) : ' · you’re the bass');
      }
      if (voices) {
        const amp = micOn && !dragging ? clamp(0.06 + lvl * 0.3, 0, 0.19) : 0.15;
        for (let i = 0; i < 4; i++) {
          if (i < curHarm.notes.length) drive(voices[i], curHarm.notes[i], amp, 0.04);
          else drive(voices[i], null, 0);
        }
        drive(voices[4], curHarm.bass, curHarm.bass != null ? amp * 1.3 : 0, 0.05);
      }
      drive(melodyVoice, curSnap, 0.2, 0.03);
      lastSungAt = now;
      setState('hidden');
    } else if (voices) {
      voices.forEach(v => drive(v, null, 0));
    }
    if (micOn && mel == null && now - lastSungAt > 2500) setState('shown', 'Sing or hum anything.', 'Long notes work best');

    hist.push({ t: now, raw: mel, snap: mel != null ? curSnap : null, harm: mel != null && curHarm ? curHarm.notes.concat([curHarm.bass]) : null });
    while (hist.length && now - hist[0].t > HISTORY_S * 1000) hist.shift();
    if (mel != null) viewCenter = lerp(viewCenter, clamp(mel - 3, 45, 76), 0.04);

    draw(now);
    const active = micOn || dragging || hist.some(h => h.raw != null);
    if (visible && active) raf = requestAnimationFrame(loop);
  }

  function layout() {
    const r = cv.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, r.width); Hh = Math.max(1, r.height);
    cv.width = Math.round(W * DPR); cv.height = Math.round(Hh * DPR);
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    draw(performance.now());
  }

  function draw(now) {
    g.clearRect(0, 0, W, Hh);
    const lo = viewCenter - 11, hi = viewCenter + 11;
    const yOf = m => Hh - ((m - lo) / (hi - lo)) * Hh;
    const scalePcs = SC.map(s => (s + tonicPc) % 12);
    g.font = '400 10px Acc, "JetBrains Mono", monospace';
    g.textAlign = 'left';
    for (let m = Math.ceil(lo); m <= Math.floor(hi); m++) {
      const pc = H.mod12(m), y = yOf(m);
      const inKey = scalePcs.includes(pc), tonic = pc === tonicPc;
      g.fillStyle = tonic ? 'rgba(244,239,230,0.10)' : inKey ? 'rgba(244,239,230,0.05)' : 'rgba(244,239,230,0.018)';
      g.fillRect(0, y - 0.5, W, 1);
      if (inKey) { g.fillStyle = tonic ? 'rgba(244,239,230,0.55)' : 'rgba(244,239,230,0.25)'; g.fillText(H.spellMidi(m, tonicPc), 10, y - 4); }
    }
    const pxPerMs = W / (HISTORY_S * 1000);
    const xOf = t => W - 70 - (now - t) * pxPerMs;

    // harmony lines (stepped)
    for (let v = 0; v < 5; v++) {
      g.strokeStyle = VOICE_COLORS[v]; g.lineWidth = v === 4 ? 2 : 3; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); let pen = false;
      for (const h of hist) {
        const m = noteAt(h.harm, v);
        if (m == null) { pen = false; continue; }
        const x = xOf(h.t), y = yOf(m);
        if (!pen) { g.moveTo(x, y); pen = true; } else g.lineTo(x, y);
      }
      g.globalAlpha = 0.85; g.stroke(); g.globalAlpha = 1;
    }
    // your raw pitch
    g.strokeStyle = 'rgba(244,239,230,0.95)'; g.lineWidth = 3.5;
    g.beginPath(); let pen = false;
    for (const h of hist) {
      if (h.raw == null) { pen = false; continue; }
      const x = xOf(h.t), y = yOf(h.raw);
      if (!pen) { g.moveTo(x, y); pen = true; } else g.lineTo(x, y);
    }
    g.stroke();

    // "now" line + current notes
    const nowX = W - 70;
    g.fillStyle = 'rgba(244,239,230,0.08)'; g.fillRect(nowX, 0, 1, Hh);
    const lastH = hist[hist.length - 1];
    if (lastH && lastH.raw != null && lastH.harm) {
      [0, 1, 2, 3, 4].forEach(v => {
        const m = noteAt(lastH.harm, v);
        if (m == null) return;
        g.fillStyle = VOICE_COLORS[v];
        g.beginPath(); g.arc(nowX, yOf(m), 5, 0, 6.2832); g.fill();
        g.fillText(H.spellMidi(m, tonicPc), nowX + 10, yOf(m) + 3);
      });
      g.fillStyle = '#F4EFE6';
      g.beginPath(); g.arc(nowX, yOf(lastH.raw), 6.5, 0, 6.2832); g.fill();
      g.font = '400 13px Acc, Caprasimo, Georgia, serif';
      g.fillText('you', nowX + 12, yOf(lastH.raw) + 4);
    }
  }

  if ('ResizeObserver' in window) new ResizeObserver(layout).observe(cv);
  else window.addEventListener('resize', layout);
  layout();
  watchVisibility(section, v => {
    visible = v;
    if (v) wake();
    else { if (micOn) stopMic(); if (dragging) endDrag(); }
  });
})();

})();

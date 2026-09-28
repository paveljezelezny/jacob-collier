/* ════════════════════════════════════════════════════════════════════
   KIT CORE — pure helpers shared by the Harmony Lab games (05–07).
   No audio, no DOM. The timeline maths behind Lab.clock lives here so it
   can be tested over the whole input range: node tests/kit-core.test.js
   Exposes window.LabCores.kit.
   ════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mod = (n, m) => ((n % m) + m) % m;

  function median(arr) {
    if (!arr || !arr.length) return null;
    const s = Array.from(arr).sort((a, b) => a - b), k = s.length >> 1;
    return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
  }

  // Tiny seeded PRNG: the same seed always gives the same stream, in [0, 1)
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ── base64url (RFC 4648 §5, no padding) ─────────────────────── */
  const B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const B64U_INV = new Int8Array(128).fill(-1);
  for (let i = 0; i < 64; i++) B64U_INV[B64U.charCodeAt(i)] = i;

  function b64uEncode(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || []);
    let out = '';
    for (let i = 0; i < b.length; i += 3) {
      const n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0);
      out += B64U[(n >> 18) & 63] + B64U[(n >> 12) & 63];
      if (i + 1 < b.length) out += B64U[(n >> 6) & 63];
      if (i + 2 < b.length) out += B64U[n & 63];
    }
    return out;
  }

  // Share links are untrusted input: never throw, and refuse anything oversized before decoding it
  function b64uDecode(str, maxBytes = 1024) {
    if (typeof str !== 'string') return null;
    const max = Number.isFinite(maxBytes) && maxBytes >= 0 ? Math.floor(maxBytes) : 1024;
    const len = str.length;
    if (len % 4 === 1 || len > Math.ceil(max * 4 / 3)) return null;
    const outLen = Math.floor(len * 3 / 4);
    if (outLen > max) return null;
    const out = new Uint8Array(outLen);
    let acc = 0, bits = 0, o = 0;
    for (let i = 0; i < len; i++) {
      const c = str.charCodeAt(i);
      const v = c < 128 ? B64U_INV[c] : -1;
      if (v < 0) return null;
      acc = ((acc << 6) | v) & 0xFFFF; bits += 6;
      if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 255; }
    }
    return out;
  }

  /* ── Timeline: steps ↔ AudioContext seconds ───────────────────────
     Piecewise linear through anchors [{ step, time, stepDur }], sorted by
     step. Anchor i rules steps [anchor i, anchor i+1). Anchor times never
     move backwards, so a re-anchor can only open a gap (a pause), never
     fold time over itself.                                             */
  const MAX_ANCHORS = 64;             // a tap-tempo game adds one per tap; old history is not needed
  const safeBpm = bpm => (bpm > 0 && bpm < Infinity ? bpm : 120);
  const isOdd = step => mod(step, 2) === 1;

  function makeTimeline({ bpm, stepsPerBeat = 2, t0, swing = 0 }) {
    return { anchors: [{ step: 0, time: t0, stepDur: 60 / safeBpm(bpm) / stepsPerBeat }], stepsPerBeat, swing };
  }

  function anchorFor(tl, step) {
    const a = tl.anchors;
    let i = a.length - 1;
    while (i > 0 && a[i].step > step) i--;
    return a[i];
  }
  function stepDurAt(tl, step) { return anchorFor(tl, step).stepDur; }
  function gridTime(tl, step) {
    const a = anchorFor(tl, step);
    return a.time + (step - a.step) * a.stepDur;
  }
  function timeOfStep(tl, step) {
    const a = anchorFor(tl, step);
    return a.time + (step - a.step) * a.stepDur + (isOdd(step) ? tl.swing * a.stepDur : 0);
  }
  function positionAt(tl, time) {
    const a = tl.anchors;
    let i = a.length - 1;
    while (i > 0 && a[i].time > time) i--;
    const p = a[i].step + (time - a[i].time) / a[i].stepDur;
    // Inside a re-anchor gap the music is paused on the next anchor's step
    return i + 1 < a.length ? Math.min(p, a[i + 1].step) : p;
  }

  function withAnchor(tl, anchor) {
    const anchors = tl.anchors.filter(a => a.step < anchor.step);
    anchors.push(anchor);
    return { anchors: anchors.length > MAX_ANCHORS ? anchors.slice(-MAX_ANCHORS) : anchors, stepsPerBeat: tl.stepsPerBeat, swing: tl.swing };
  }

  function withTempo(tl, fromStep, bpm) {
    const step = Math.round(fromStep);
    const stepDur = 60 / safeBpm(bpm) / tl.stepsPerBeat;
    let time = gridTime(tl, step);
    // A swung step sits swing·stepDur after its grid time. Speeding up shrinks that
    // offset, which would pull an already-promised step earlier (even into the past,
    // where it gets dropped). Keep it where it was instead.
    if (isOdd(step)) time = Math.max(time, timeOfStep(tl, step) - tl.swing * stepDur);
    return withAnchor(tl, { step, time, stepDur });
  }

  function quantizeAt(tl, time, loopSteps) {
    const abs = Math.round(positionAt(tl, time)) || 0;         // `|| 0` turns −0 into 0
    if (!(loopSteps > 0)) return { abs, step: abs, lap: 0 };
    return { abs, step: mod(abs, loopSteps), lap: Math.floor(abs / loopSteps) };
  }

  // One scheduler tick: which steps fall inside the lookahead window?
  function planTick(tl, nextStep, now, lookahead = 0.12, lateDrop = 0.05, reanchorAfter = 1.0) {
    if (timeOfStep(tl, nextStep) < now - reanchorAfter) {
      // Woke up after a long stall (background tab, debugger): carry on from here
      // instead of firing a burst of backlogged steps
      const stepDur = stepDurAt(tl, nextStep);
      tl = withAnchor(tl, { step: nextStep, time: now + 0.05 - (isOdd(nextStep) ? tl.swing * stepDur : 0), stepDur });
    }
    const due = [];
    let dropped = 0;
    for (let t = timeOfStep(tl, nextStep); t < now + lookahead; t = timeOfStep(tl, nextStep)) {
      if (t < now - lateDrop) dropped++;
      else due.push({ step: nextStep, when: t });
      nextStep++;
    }
    return { due, nextStep, dropped, tl };
  }

  const api = {
    clamp, mod, median, mulberry32, b64uEncode, b64uDecode,
    makeTimeline, withTempo, gridTime, timeOfStep, stepDurAt, positionAt, quantizeAt, planTick,
  };
  (global.LabCores = global.LabCores || {}).kit = api;
})(window);

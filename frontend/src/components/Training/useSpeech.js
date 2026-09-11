// ============================================================================
// useSpeech -- the pronunciation engine behind the Tool Kit.
//
// Free and local: the browser's own Web Speech voice, American voices only.
// No key, no quota, no network for the voices Windows ships.
//
// HOW THE HIGHLIGHT STAYS IN TIME -- and why the first two versions did not.
// This was rebuilt from measurements, not guesses (Chrome 152, Windows, the
// Microsoft David/Mark/Zira voices, ~250 names from the live catalog, timed
// silently from the engine's own events on 2026-09-11). Three facts drive it:
//
//   1. `onstart` is NOT when the voice starts. The first word began 120 ms to
//      2.5 s after it. Starting the highlight on onstart -- which the old code
//      did -- swept through the whole word in silence.
//   2. `onend` is NOT when the voice stops. It fired 700-900 ms after the last
//      sound. Holding the highlight until onend left the last syllable lit for
//      most of a second after the word was over.
//   3. The word-boundary event IS exact, and it fires for more than words:
//      "CX-90" fires one for CX and one for ninety; "RAM 3500" fires five. The
//      speechUnits model predicted the event count for 229 of 229 measured
//      names across three voices and five speeds.
//
// So every unit that STARTS with an event is pinned to that event, exactly.
// What no event reports is where inside a word one syllable ends and the next
// begins, and when the LAST word ends. Those come from a duration model that
// was fitted to the same measurements and then corrected, live, from every
// event gap this trainee's own voice produces -- per voice AND per speed,
// because SAPI's speed steps are not smooth (0.8x, 1x and 1.25x measured
// almost identical). A name spoken once is remembered exactly after that.
//
// Voices that report no boundaries at all (Chrome's network "Google" voices)
// fall back to the same timeline run from the clock. It is approximate, and
// the voice picker says so instead of pretending.
//
// PERFORMANCE: the clock ticks on requestAnimationFrame and publishes to a tiny
// external store. A card subscribes to ITS OWN cursor, so only the card being
// spoken re-renders -- not every card in a 300-name grid, every frame.
// ============================================================================
import { useEffect, useSyncExternalStore } from 'react';
import { segment } from './speechUnits';

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
const SUPPORTED = !!synth && typeof window !== 'undefined' && 'SpeechSynthesisUtterance' in window;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ── remembered measurements ──────────────────────────────────────────────────
const MEM_KEY = 'training.tts.v2';
const MAX_TOKENS = 3000;
let mem = { scale: {}, tok: {}, caps: {} };
try {
  const raw = JSON.parse(localStorage.getItem(MEM_KEY) || 'null');
  if (raw && typeof raw === 'object') mem = { scale: raw.scale || {}, tok: raw.tok || {}, caps: raw.caps || {} };
} catch { /* private window: learn per session only */ }
let saveTimer = null;
const saveMem = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const keys = Object.keys(mem.tok);
      if (keys.length > MAX_TOKENS) for (const k of keys.slice(0, keys.length - MAX_TOKENS)) delete mem.tok[k];
      localStorage.setItem(MEM_KEY, JSON.stringify(mem));
    } catch { /* quota or private window */ }
  }, 500);
};

// Duration vs speed, measured on SAPI (David): 0.6x -> 1.19, 0.8x -> 1.035,
// 1x -> 1, 1.25x -> ~1, 1.5x -> 0.86. Only a starting point -- the learned
// scale for a voice+speed replaces it after the first measured gap.
const RATE_PRIOR = [[0.5, 1.28], [0.6, 1.19], [0.8, 1.035], [1.0, 1.0], [1.25, 1.0], [1.5, 0.862], [2.0, 0.72]];
function ratePrior(r) {
  if (r <= RATE_PRIOR[0][0]) return RATE_PRIOR[0][1];
  for (let i = 1; i < RATE_PRIOR.length; i++) {
    const [r1, f1] = RATE_PRIOR[i];
    if (r <= r1) {
      const [r0, f0] = RATE_PRIOR[i - 1];
      return f0 + ((r - r0) / (r1 - r0)) * (f1 - f0);
    }
  }
  return RATE_PRIOR[RATE_PRIOR.length - 1][1];
}
const rateKey = (r) => (Math.round(r * 20) / 20).toFixed(2);
const scaleOf = (voiceKey, r) => {
  const own = mem.scale[`${voiceKey}|${rateKey(r)}`];
  if (own) return own;
  const base = mem.scale[`${voiceKey}|1.00`] || 1;
  return ratePrior(r) * base;
};
const tokKey = (voiceKey, r, text) => `${voiceKey}|${rateKey(r)}|${text.toLowerCase()}`;

// ── voices ───────────────────────────────────────────────────────────────────
const isUS = (v) => /^en[-_]US$/i.test(v.lang || '');
const isEn = (v) => /^en([-_]|$)/i.test(v.lang || '');
// Ranking: voices that REPORT word timing first (the highlight is exact on
// them), then by how human they sound. Edge's "Online (Natural)" voices do
// both; Chrome's network "Google" voices report nothing, so they go last.
const PREFERRED = ['aria', 'jenny', 'guy', 'ava', 'andrew', 'emma', 'brian', 'zira', 'david', 'mark', 'samantha', 'alex', 'allison'];
export const reportsTiming = (v) => {
  if (!v) return false;
  const known = mem.caps[v.voiceURI];
  if (known) return known.b;
  if (/^google/i.test(v.name)) return false;
  return v.localService || /natural|online/i.test(v.name);
};
function rankVoices(pool) {
  const pref = (v) => {
    const n = (v.name || '').toLowerCase();
    const i = PREFERRED.findIndex(p => n.includes(p));
    return i === -1 ? PREFERRED.length : i;
  };
  return [...pool].sort((a, b) =>
    (Number(reportsTiming(b)) - Number(reportsTiming(a)))
    || (Number(/natural/i.test(b.name)) - Number(/natural/i.test(a.name)))
    || pref(a) - pref(b)
    || a.name.localeCompare(b.name));
}

// ── the store: controls (rarely change) and cursor (every unit) ──────────────
const IDLE = Object.freeze({ id: null, phase: 'idle', token: -1, unit: -1 });
let cursor = IDLE;
let controls = {
  voices: [],
  voiceURI: (() => { try { return localStorage.getItem('training.voice') || ''; } catch { return ''; } })(),
  rate: (() => { try { return parseFloat(localStorage.getItem('training.rate')) || 1; } catch { return 1; } })(),
  speakingId: null,
};
const cursorSubs = new Set();
const controlSubs = new Set();
const setCursor = (next) => {
  if (next.id === cursor.id && next.phase === cursor.phase && next.token === cursor.token && next.unit === cursor.unit) return;
  cursor = next;
  cursorSubs.forEach(f => f());
};
const setControls = (patch) => {
  controls = { ...controls, ...patch };
  controlSubs.forEach(f => f());
};

function loadVoices() {
  const all = synth.getVoices() || [];
  const us = all.filter(isUS);
  setControls({ voices: rankVoices(us.length ? us : all.filter(isEn)) });
}
// getVoices() is empty until `voiceschanged` in Chrome -- read now AND later,
// or the picker stays empty forever.
if (SUPPORTED) {
  loadVoices();
  synth.addEventListener?.('voiceschanged', loadVoices);
}
const pickVoice = () => controls.voices.find(v => v.voiceURI === controls.voiceURI) || controls.voices[0] || null;

// ── the timeline for one utterance ───────────────────────────────────────────
// events[]: every boundary event we expect, in order, with the units it starts
// and its share of their time (a number word shares one unit with its
// siblings: "3500" is one unit, four events).
function buildPlan(text) {
  const { tokens } = segment(text);
  const events = [];
  tokens.forEach((tok, ti) => {
    const ub = tok.unitBoundary;
    const count = {};
    ub.forEach(u => { count[u] = (count[u] || 0) + 1; });
    ub.forEach((u0, k) => {
      const next = k + 1 < ub.length ? ub[k + 1] : tok.units.length;
      const shared = count[u0] > 1;
      events.push({ ti, k, u0, u1: shared ? u0 + 1 : Math.max(next, u0 + 1), frac: shared ? 1 / count[u0] : 1 });
    });
  });
  const firstEvent = [];          // token -> index of its first event
  const lastEvent = [];           // token -> index of its last event
  events.forEach((e, i) => { if (e.k === 0) firstEvent[e.ti] = i; lastEvent[e.ti] = i; });
  return { tokens, events, firstEvent, lastEvent };
}

// Raw (rate 1, unscaled) ms of one event's span.
const rawSpan = (plan, e) => {
  const units = plan.tokens[e.ti].units;
  let ms = 0;
  for (let u = e.u0; u < e.u1; u++) ms += units[u].ms;
  return ms * e.frac;
};

// Scaled ms of one unit for this run: the exact remembered length of the token
// when we have one, otherwise the model times the learned pace.
function unitMs(run, ti, u) {
  const tok = run.plan.tokens[ti];
  const exact = mem.tok[tokKey(run.voiceKey, run.rate, tok.text)];
  if (exact && tok.ms > 0) return tok.units[u].ms * (exact / tok.ms);
  return tok.units[u].ms * run.scale;
}
const spanMs = (run, e) => {
  let ms = 0;
  for (let u = e.u0; u < e.u1; u++) ms += unitMs(run, e.ti, u);
  return ms * e.frac;
};

// Where is the voice now? Walk forward from the last real event by predicted
// spans. While the NEXT event is still expected, hold on the current span's
// last unit (the model was short) -- but only for so long: if an event never
// comes (a different engine that skips one), carry on by the clock.
const HOLD = 1.6;
function locate(run, t) {
  const { events } = run.plan;
  let idx = Math.max(run.ev, 0);
  let rem = t - run.anchor;
  for (;;) {
    const e = events[idx];
    const span = spanMs(run, e);
    if (rem < span) {
      let acc = 0;
      for (let u = e.u0; u < e.u1; u++) {
        acc += unitMs(run, e.ti, u) * e.frac;
        if (rem < acc) return { ti: e.ti, ui: u };
      }
      return { ti: e.ti, ui: e.u1 - 1 };
    }
    if (idx === events.length - 1) return { done: true };
    const waitingForEvent = run.mode === 'events' && idx === run.ev;
    if (waitingForEvent && rem < span * HOLD) return { ti: e.ti, ui: e.u1 - 1 };
    rem -= span;
    idx += 1;
  }
}

// ── the engine ───────────────────────────────────────────────────────────────
let gen = 0;
let run = null;
let raf = 0;
let keepAlive = null;    // Chrome GCs an unreferenced utterance and drops its events
let sequence = null;
const LEAD_MS = 150;     // clock-only voices: a guess at the silence before speech

function tick() {
  raf = 0;
  const r = run;
  if (!r || r.gen !== gen) return;
  if (r.mode) {
    const t = now();
    // Clock-only voices anchor a little after onstart (the silence before the
    // first word). Until then nothing is being said, so nothing is lit.
    if (t < r.anchor) {
      setCursor({ id: r.id, phase: 'wait', token: -1, unit: -1 });
      raf = requestAnimationFrame(tick);
      return;
    }
    const pos = locate(r, t);
    if (pos.done) {
      // The voice has finished even though onend is most of a second away:
      // show the word as said, and stop drawing.
      setCursor({ id: r.id, phase: 'done', token: -1, unit: -1 });
      return;
    }
    setCursor({ id: r.id, phase: 'speak', token: pos.ti, unit: pos.ui });
  }
  raf = requestAnimationFrame(tick);
}
const startClock = () => { if (!raf) raf = requestAnimationFrame(tick); };
const stopClock = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };

function learn(r, measured, raw) {
  if (raw <= 0) return;
  const ratio = measured / raw;
  if (ratio < 0.45 || ratio > 2.4) return;          // a stall or a skipped event, not pace
  const key = `${r.voiceKey}|${rateKey(r.rate)}`;
  const prev = mem.scale[key] || r.scale;
  const next = prev * 0.7 + ratio * 0.3;
  mem.scale[key] = next;
  r.scale = next;                                    // the rest of THIS name uses it too
  saveMem();
}

function onEvent(r, charIndex, t) {
  // Events arriving after the clock fallback kicked in (a cold engine that took
  // longer than the fallback wait): the real timing wins. Start over from them.
  if (r.mode === 'time') { r.mode = null; r.ev = -1; }
  const { tokens, events, firstEvent, lastEvent } = r.plan;
  let ti = 0;
  for (let i = 0; i < tokens.length; i++) { if (tokens[i].start <= charIndex) ti = i; else break; }
  // The engine still says a token we cannot light ("&" -> "and"); that event
  // belongs to no unit, so it moves nothing.
  if (firstEvent[ti] == null) return;
  const k = (r.tokCount[ti] = (r.tokCount[ti] ?? -1) + 1);
  const idx = Math.min(firstEvent[ti] + k, lastEvent[ti]);
  if (idx <= r.ev) return;        // an extra event this engine fires; never jump back

  if (!mem.caps[r.voiceKey]?.b) { mem.caps[r.voiceKey] = { b: true }; saveMem(); }
  if (r.mode === 'events' && r.ev >= 0) {
    // The gap since the last event is a real measurement of what the model
    // predicted for everything in between.
    let raw = 0;
    for (let i = r.ev; i < idx; i++) raw += rawSpan(r.plan, events[i]);
    learn(r, t - r.anchor, raw);
  }
  if (k === 0 && ti > 0 && r.tokFirstAt[ti - 1] != null) {
    // The previous name ended exactly now: remember its true length.
    mem.tok[tokKey(r.voiceKey, r.rate, tokens[ti - 1].text)] = Math.round(t - r.tokFirstAt[ti - 1]);
    saveMem();
  }
  if (k === 0) r.tokFirstAt[ti] = t;
  r.mode = 'events';
  r.ev = idx;
  r.anchor = t;
  clearTimeout(r.fallback);
  startClock();
}

function beginClockOnly(r, anchor) {
  if (r.mode) return;
  r.mode = 'time';
  r.ev = 0;
  r.anchor = anchor;
  startClock();
}

function finish(r, natural) {
  clearTimeout(r.fallback);
  stopClock();
  if (natural && r.mode !== 'events' && now() - r.startAt > 500) {
    // A whole utterance and not one timing event: this voice does not report
    // them. Remember, so next time it goes straight to the clock.
    mem.caps[r.voiceKey] = { b: false };
    saveMem();
  }
  run = null;
  setCursor(IDLE);
  setControls({ speakingId: null });
  if (natural && r.onDone) setTimeout(r.onDone, 0);
}

function stop() {
  gen += 1;
  sequence = null;
  if (run) { clearTimeout(run.fallback); run = null; }
  stopClock();
  try { synth?.cancel(); } catch { /* nothing to cancel */ }
  setCursor(IDLE);
  if (controls.speakingId !== null) setControls({ speakingId: null });
}

/**
 * Say something, and drive the highlight for the card with this `id`.
 *   speak('Volkswagen Atlas', { id: 'model-42' })
 *   speak(term, { id, rate: 0.6 })          // the Slow button
 * Always replaces whatever was playing -- two voices at once is never what a
 * second click meant.
 */
function speak(text, { id = null, rate, onDone, fromSequence = false } = {}) {
  if (!SUPPORTED) return;
  const body = String(text || '').trim();
  if (!body) return;
  const keepSequence = fromSequence ? sequence : null;
  stop();
  sequence = keepSequence;
  const myGen = gen;

  const voice = pickVoice();
  const voiceKey = voice ? voice.voiceURI : 'default';
  const useRate = Math.min(2, Math.max(0.5, rate ?? controls.rate));
  const r = {
    gen: myGen, id, voiceKey, rate: useRate, plan: buildPlan(body),
    scale: scaleOf(voiceKey, useRate), mode: null, ev: -1, anchor: 0,
    tokCount: [], tokFirstAt: [], startAt: now(), fallback: 0, onDone,
  };
  if (!r.plan.events.length) return;
  run = r;
  setControls({ speakingId: id });
  // Before the first real sound: the card shows it is about to speak, and
  // lights nothing yet.
  setCursor({ id, phase: 'wait', token: -1, unit: -1 });

  const u = new SpeechSynthesisUtterance(body);
  if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-US';
  u.rate = useRate;

  // Decided up front, not after a wait: a voice known (or named) not to report
  // timing goes straight to the clock, or its FIRST play -- a name shorter than
  // any sensible wait -- would never light at all. If it turns out to report
  // events after all, onEvent takes over and the guess costs nothing.
  const expectsEvents = reportsTiming(voice);

  u.onstart = () => {
    if (myGen !== gen) return;
    r.startAt = now();
    if (!expectsEvents) { beginClockOnly(r, r.startAt + LEAD_MS); return; }
    // An event-reporting voice can still take 2.5 s to start from cold, so
    // wait generously before deciding it never will.
    r.fallback = setTimeout(() => {
      if (myGen === gen && !r.mode) beginClockOnly(r, now());
    }, mem.caps[voiceKey]?.b ? 4000 : 2500);
  };
  u.onboundary = (e) => {
    if (myGen !== gen) return;
    if (e.name && e.name !== 'word') return;
    onEvent(r, e.charIndex ?? 0, now());
  };
  u.onend = () => { if (myGen === gen) finish(r, true); };
  u.onerror = () => { if (myGen === gen) finish(r, false); };

  keepAlive = u;
  // A paused engine will not start a queued utterance.
  try { synth.resume(); } catch { /* not paused */ }
  synth.speak(u);
}

/**
 * Read a list one name at a time. Each name waits for the previous one's own
 * end event rather than a timer, because how long a name takes depends on the
 * voice and the speed. Any other speak() or stop() ends the sequence.
 */
function speakSequence(items, { rate, onDone } = {}) {
  if (!SUPPORTED || !items?.length) return () => {};
  const token = {};
  sequence = token;
  let i = 0;
  const next = () => {
    if (sequence !== token) return;
    if (i >= items.length) { sequence = null; onDone?.(); return; }
    const it = items[i++];
    speak(it.text, { id: it.id, rate, fromSequence: true, onDone: () => setTimeout(next, 120) });
  };
  next();
  return () => { if (sequence === token) stop(); };
}

function setVoice(uri) {
  setControls({ voiceURI: uri });
  try { localStorage.setItem('training.voice', uri); } catch { /* private window */ }
}
function setRate(r) {
  setControls({ rate: r });
  try { localStorage.setItem('training.rate', String(r)); } catch { /* private window */ }
}

// ── React bindings ───────────────────────────────────────────────────────────
const subscribeControls = (f) => { controlSubs.add(f); return () => controlSubs.delete(f); };
const subscribeCursor   = (f) => { cursorSubs.add(f);  return () => cursorSubs.delete(f); };
const getControls = () => controls;

/** The panel's view: voices, speed, and the verbs. Re-renders on start/stop only. */
export default function useSpeech() {
  const c = useSyncExternalStore(subscribeControls, getControls);
  // Stop talking when the panel goes away -- speechSynthesis outlives the
  // component, and a voice with no screen behind it cannot be stopped.
  useEffect(() => () => stop(), []);
  const voice = c.voices.find(v => v.voiceURI === c.voiceURI) || c.voices[0] || null;
  return {
    supported: SUPPORTED,
    voices: c.voices,
    voiceURI: voice?.voiceURI || '',
    voiceTimed: reportsTiming(voice),
    setVoice,
    rate: c.rate,
    setRate,
    speakingId: c.speakingId,
    speak,
    speakSequence,
    stop,
  };
}

/**
 * One card's view of the cursor. Every other card gets the same frozen IDLE
 * object back, so React skips re-rendering them entirely.
 */
export function useSpeechCursor(id) {
  return useSyncExternalStore(subscribeCursor, () => (cursor.id === id ? cursor : IDLE));
}

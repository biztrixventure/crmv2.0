// ============================================================================
// useSpeech -- pronunciation for the Tool Kit, using the browser's own voice.
//
// WHY THE BROWSER AND NOT AN API: the ask was for this to cost nothing. The Web
// Speech API ships in every browser this CRM already supports, runs on the
// agent's own machine, needs no key, no quota and no network round trip -- and
// it is the only free option that emits `onboundary`, which is what makes the
// text light up in time with the audio. A hosted TTS would return one audio
// blob with no timings, so the highlight would have to be faked.
//
// AMERICAN VOICES ONLY. These are US warranty calls; an en-GB voice teaching an
// agent to say "Nissan" or "Hyundai" teaches the wrong thing. The voice list is
// filtered to en-US and ranked by the local voices that are actually good,
// falling back to plain en-* only if a machine has no US voice at all -- an
// accented pronunciation beats silence.
//
// SYLLABLE TIMING -- the part that is not simply "read the event".
// `onboundary` fires once per WORD; no browser reports syllables. But a card
// showing "Volk-swa-gen" has to light Volk, then swa, then gen, so the syllables
// inside a word are STEPPED on a timer between two word boundaries. The step is
// self-calibrating: each boundary measures how long the previous word actually
// took and divides by its syllable count, so the pace follows the chosen voice
// and rate instead of a guess that drifts. The first word uses an estimate; by
// the second it is measuring the real thing. A word boundary always snaps the
// highlight back into sync, so an estimate can never accumulate error.
//
// TWO BROWSER QUIRKS ARE HANDLED HERE, NOT BY CALLERS:
//   1. getVoices() is empty on first call in Chrome until `voiceschanged`
//      fires. Reading it once at mount gives you an empty picker forever.
//   2. speechSynthesis keeps speaking after the component unmounts, and after
//      a route change you get a disembodied voice with no way to stop it. The
//      cleanup cancels.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;

// Voices that actually sound like a person, best first. Matched loosely on the
// name because the same voice is labelled differently across platforms.
const PREFERRED = [
  'google us english', 'samantha', 'aria', 'jenny', 'ava', 'allison',
  'microsoft zira', 'microsoft david', 'microsoft mark', 'alex', 'nicky',
];

const rank = (v) => {
  const n = (v.name || '').toLowerCase();
  const i = PREFERRED.findIndex(p => n.includes(p));
  return i === -1 ? PREFERRED.length : i;
};

const isUS = (v) => /^en[-_]US$/i.test(v.lang || '');
const isEn = (v) => /^en([-_]|$)/i.test(v.lang || '');

// A syllable may START with these; anything else in a consonant cluster belongs
// to the syllable before it. This is the single rule that turns "vol-kswa-gen"
// into "volk-swa-gen" and keeps "at-las" from becoming "a-tlas".
const ONSETS = new Set([
  'bl', 'br', 'ch', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr', 'ph', 'pl', 'pr',
  'qu', 'sc', 'sh', 'sk', 'sl', 'sm', 'sn', 'sp', 'st', 'sw', 'th', 'tr', 'tw',
  'wh', 'wr',
]);

/**
 * Split text into the words a boundary event can land on, keeping each word's
 * character offsets. `onboundary` reports a charIndex into the ORIGINAL string,
 * so the offsets are what turn that number back into "which word is it saying".
 */
export function tokenize(text) {
  const out = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    out.push({ word: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/**
 * Break a word into readable syllables: "Volkswagen" -> ["Volk","swa","gen"].
 *
 * A display aid, not a phonetic transcription -- English spelling does not
 * support one of those without a dictionary, and where a manager has typed a
 * real phonetic hint the card shows that instead and never calls this. What it
 * has to get right is chunking an unfamiliar name so an agent can say it, and
 * that comes down to two rules:
 *
 *   1. 'y' is a vowel EXCEPT straight after another vowel, where it opens the
 *      next syllable -- "toyota" is to-yo-ta, not toyo-ta.
 *   2. A consonant cluster between two vowels splits so the next syllable
 *      starts with at most a real English onset. One consonant moves on whole
 *      ("sa-turn"); "tl" is not an onset so it splits ("at-las"); "sw" is, so
 *      "volkswagen" breaks volk-swa-gen.
 */
export function syllabify(word) {
  const w = String(word || '').trim();
  if (!w) return [];
  const lower = w.toLowerCase();
  if (lower.length < 3) return [w];

  // Rule 1 -- vowel map, with 'y' demoted after a vowel.
  const isV = [];
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i];
    let v = 'aeiou'.includes(ch);
    if (!v && ch === 'y') v = !(i > 0 && 'aeiou'.includes(lower[i - 1]));
    isV.push(v);
  }

  // Vowel groups -- one nucleus each, so one syllable each.
  const groups = [];
  for (let i = 0; i < lower.length;) {
    if (!isV[i]) { i += 1; continue; }
    const start = i;
    while (i < lower.length && isV[i]) i += 1;
    groups.push([start, i - 1]);
  }
  if (groups.length <= 1) return [w];

  // Rule 2 -- one cut per gap between nuclei.
  const cuts = [];
  for (let g = 0; g < groups.length - 1; g++) {
    const from = groups[g][1] + 1;      // first consonant after this nucleus
    const to   = groups[g + 1][0];      // first letter of the next nucleus
    const n    = to - from;             // consonants between them
    let cut;
    if (n <= 0)       cut = to;                     // nuclei touch
    else if (n === 1) cut = from;                   // V-CV: consonant moves on
    else {
      const two = lower.slice(to - 2, to);
      cut = ONSETS.has(two) ? to - 2 : to - 1;
      if (cut < from) cut = from;
    }
    cuts.push(cut);
  }

  const parts = [];
  let start = 0;
  for (const c of cuts) {
    if (c > start) { parts.push(w.slice(start, c)); start = c; }
  }
  parts.push(w.slice(start));
  return parts.filter(Boolean);
}

/** Every word of a phrase with its syllables — what the card renders. */
export function syllableMap(text) {
  return tokenize(text).map(t => ({ ...t, syllables: syllabify(t.word) }));
}

// Starting guess for one syllable at rate 1.0, before any measurement. Roughly
// a natural speaking pace; the calibration below replaces it after one word.
const BASE_SYLLABLE_MS = 230;

export default function useSpeech() {
  const supported = !!synth && typeof window !== 'undefined' && 'SpeechSynthesisUtterance' in window;

  const [voices, setVoices] = useState([]);
  const [voiceURI, setVoiceURI] = useState(() => {
    try { return localStorage.getItem('training.voice') || ''; } catch { return ''; }
  });
  const [rate, setRateState] = useState(() => {
    try { return parseFloat(localStorage.getItem('training.rate')) || 1; } catch { return 1; }
  });

  // What is being said right now: which card, which word of it, which syllable
  // of that word.
  const [speakingId, setSpeakingId]       = useState(null);
  const [wordIndex, setWordIndex]         = useState(-1);
  const [syllableIndex, setSyllableIndex] = useState(-1);

  const tokensRef   = useRef([]);
  const utterRef    = useRef(null);
  const stepRef     = useRef(null);   // interval walking syllables inside a word
  const msPerSylRef = useRef(BASE_SYLLABLE_MS);
  const lastAtRef   = useRef(0);      // when the previous boundary fired
  const lastWordRef = useRef(-1);

  // Quirk 1: the list arrives asynchronously. Read it now AND on voiceschanged.
  useEffect(() => {
    if (!supported) return undefined;
    const load = () => {
      const all = synth.getVoices() || [];
      const us = all.filter(isUS);
      const pool = us.length ? us : all.filter(isEn);
      setVoices(pool.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)));
    };
    load();
    synth.addEventListener?.('voiceschanged', load);
    return () => synth.removeEventListener?.('voiceschanged', load);
  }, [supported]);

  const clearStep = () => {
    if (stepRef.current) { clearInterval(stepRef.current); stepRef.current = null; }
  };

  // Quirk 2: stop talking when the portal closes, and take the timer with it.
  useEffect(() => () => {
    clearStep();
    try { synth?.cancel(); } catch { /* nothing to cancel */ }
  }, []);

  const stop = useCallback(() => {
    clearStep();
    try { synth?.cancel(); } catch { /* already stopped */ }
    utterRef.current = null;
    setSpeakingId(null);
    setWordIndex(-1);
    setSyllableIndex(-1);
  }, []);

  const setVoice = useCallback((uri) => {
    setVoiceURI(uri);
    try { localStorage.setItem('training.voice', uri); } catch { /* private window */ }
  }, []);

  const setRate = useCallback((r) => {
    setRateState(r);
    try { localStorage.setItem('training.rate', String(r)); } catch { /* private window */ }
  }, []);

  /**
   * Say something.
   *   speak('Volkswagen Atlas', { id: 'model-42' })
   *   speak(term, { id, rate: 0.6 })       // the Slow button
   *
   * `id` is how a card knows the highlight belongs to it. Speaking always
   * cancels whatever was already playing -- two voices at once is never what
   * someone clicking a second card meant.
   */
  const speak = useCallback((text, { id = null, rate: rateOverride, onDone } = {}) => {
    if (!supported) return;
    const body = String(text || '').trim();
    if (!body) return;

    stop();
    const tokens = syllableMap(body);
    tokensRef.current = tokens;

    const u = new SpeechSynthesisUtterance(body);
    const picked = voices.find(v => v.voiceURI === voiceURI) || voices[0];
    if (picked) { u.voice = picked; u.lang = picked.lang; }
    else u.lang = 'en-US';
    const used = Math.min(2, Math.max(0.4, rateOverride ?? rate));
    u.rate = used;

    // Reset the pace model for this utterance -- a slow replay of the same word
    // must not inherit the fast run's measurement.
    msPerSylRef.current = BASE_SYLLABLE_MS / used;
    lastAtRef.current = 0;
    lastWordRef.current = -1;

    const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

    // Walk the syllables of one word until the next boundary snaps us straight.
    const stepThrough = (count) => {
      clearStep();
      if (count <= 1) return;
      let k = 0;
      stepRef.current = setInterval(() => {
        k += 1;
        if (k >= count) { clearStep(); return; }
        setSyllableIndex(k);
      }, Math.max(70, msPerSylRef.current));
    };

    u.onstart = () => {
      setSpeakingId(id);
      if (!tokens.length) return;
      setWordIndex(0);
      setSyllableIndex(0);
      lastAtRef.current = nowMs();
      lastWordRef.current = 0;
      stepThrough(tokens[0].syllables.length);
    };

    u.onboundary = (e) => {
      if (e.name && e.name !== 'word') return;
      const at = e.charIndex ?? 0;
      // The boundary lands ON or just before a word; take the last token that
      // has started, so a mid-word event does not skip the highlight ahead.
      let idx = -1;
      for (let i = 0; i < tokens.length; i++) { if (tokens[i].start <= at) idx = i; else break; }
      if (idx < 0) return;

      const now = nowMs();
      // Calibrate from the word we just finished: how long it really took,
      // divided by how many syllables it had. Bounded so one hiccup (a tab
      // going to the background, say) cannot poison the pace.
      const prev = lastWordRef.current;
      if (lastAtRef.current && prev >= 0 && prev !== idx) {
        const sylCount = tokens[prev]?.syllables.length || 1;
        const measured = (now - lastAtRef.current) / sylCount;
        if (measured > 60 && measured < 700) {
          msPerSylRef.current = msPerSylRef.current * 0.5 + measured * 0.5;
        }
      }
      lastAtRef.current = now;
      lastWordRef.current = idx;

      setWordIndex(idx);
      setSyllableIndex(0);
      stepThrough(tokens[idx].syllables.length);
    };

    const finish = () => {
      clearStep();
      setSpeakingId(null);
      setWordIndex(-1);
      setSyllableIndex(-1);
      utterRef.current = null;
      onDone?.();
    };
    u.onend = finish;
    u.onerror = finish;

    utterRef.current = u;
    // Chrome will not start a queued utterance while paused -- a stray pause
    // from a previous session otherwise leaves the portal permanently mute.
    try { synth.resume(); } catch { /* not paused */ }
    synth.speak(u);
  }, [supported, voices, voiceURI, rate, stop]);

  /**
   * Read a list one item at a time, so a trainee can drill without clicking.
   * Chains on each utterance's own `end` rather than a timer, because how long
   * a word takes depends on the voice and the rate.
   */
  const speakSequence = useCallback((items, { rate: rateOverride, onItem, onDone } = {}) => {
    if (!supported || !items?.length) return undefined;
    let i = 0;
    let cancelled = false;
    const next = () => {
      if (cancelled || i >= items.length) { onDone?.(); return; }
      const item = items[i++];
      onItem?.(item, i - 1);
      speak(item.text, { id: item.id, rate: rateOverride, onDone: next });
    };
    next();
    return () => { cancelled = true; stop(); };
  }, [supported, speak, stop]);

  const activeVoice = voices.find(v => v.voiceURI === voiceURI)?.voiceURI || voices[0]?.voiceURI || '';

  return {
    supported,
    voices,
    voiceURI: activeVoice,
    setVoice,
    rate,
    setRate,
    speak,
    speakSequence,
    stop,
    speakingId,
    wordIndex,
    syllableIndex,
    tokens: tokensRef.current,
  };
}

// ============================================================================
// useSpeech -- pronunciation for the Tool Kit, using the browser's own voice.
//
// WHY THE BROWSER AND NOT AN API: the ask was for this to cost nothing. The Web
// Speech API ships in every browser this CRM already supports, runs on the
// agent's own machine, needs no key, no quota and no network round trip -- and
// it is the only free option that emits `onboundary`, which is what makes the
// word light up in time with the audio. A hosted TTS would return one audio
// blob with no word timings, so the highlight would have to be faked.
//
// AMERICAN VOICES ONLY. These are US warranty calls; an en-GB voice teaching an
// agent to say "Nissan" or "Hyundai" teaches the wrong thing. The voice list is
// filtered to en-US and ranked by the local voices that are actually good,
// falling back to plain en-* only if a machine has no US voice at all -- an
// accented pronunciation beats silence.
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
 * A rough syllable split, for the dictionary-style line under a term.
 *
 * This is a display aid, not a phonetic transcription -- English spelling does
 * not support one without a dictionary. Where a manager has typed a real
 * phonetic hint, that is shown instead and this is never used. Splitting on
 * vowel groups gets "Chev-ro-let" and "Hy-un-dai" close enough to help someone
 * chunk an unfamiliar name, and anything it gets wrong is cosmetic.
 */
export function syllabify(word) {
  const w = String(word || '').trim();
  if (w.length < 4) return [w];
  const parts = w.match(/[^aeiouy]*[aeiouy]+(?:[^aeiouy]*$|[^aeiouy](?=[^aeiouy]))?/gi);
  return parts && parts.length > 1 ? parts : [w];
}

export default function useSpeech() {
  const supported = !!synth && typeof window !== 'undefined' && 'SpeechSynthesisUtterance' in window;

  const [voices, setVoices] = useState([]);
  const [voiceURI, setVoiceURI] = useState(() => {
    try { return localStorage.getItem('training.voice') || ''; } catch { return ''; }
  });
  const [rate, setRateState] = useState(() => {
    try { return parseFloat(localStorage.getItem('training.rate')) || 1; } catch { return 1; }
  });

  // What is being said right now: which card, and which word of it.
  const [speakingId, setSpeakingId] = useState(null);
  const [wordIndex, setWordIndex]   = useState(-1);
  const tokensRef = useRef([]);
  const utterRef  = useRef(null);

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

  // Quirk 2: stop talking when the portal closes.
  useEffect(() => () => { try { synth?.cancel(); } catch { /* nothing to cancel */ } }, []);

  const stop = useCallback(() => {
    try { synth?.cancel(); } catch { /* already stopped */ }
    utterRef.current = null;
    setSpeakingId(null);
    setWordIndex(-1);
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
   *   speak('Chevrolet Silverado', { id: 'model-42' })
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
    const tokens = tokenize(body);
    tokensRef.current = tokens;

    const u = new SpeechSynthesisUtterance(body);
    const picked = voices.find(v => v.voiceURI === voiceURI) || voices[0];
    if (picked) { u.voice = picked; u.lang = picked.lang; }
    else u.lang = 'en-US';
    u.rate = Math.min(2, Math.max(0.4, rateOverride ?? rate));

    u.onstart = () => { setSpeakingId(id); setWordIndex(tokens.length ? 0 : -1); };
    u.onboundary = (e) => {
      if (e.name && e.name !== 'word') return;
      const at = e.charIndex ?? 0;
      // The boundary lands ON or just before a word; take the last token that
      // has started, so a mid-word event does not skip the highlight ahead.
      let idx = -1;
      for (let i = 0; i < tokens.length; i++) { if (tokens[i].start <= at) idx = i; else break; }
      if (idx >= 0) setWordIndex(idx);
    };
    const finish = () => {
      setSpeakingId(null);
      setWordIndex(-1);
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
    tokens: tokensRef.current,
  };
}

// ============================================================================
// speechUnits -- how a name is actually SPOKEN, as highlightable pieces.
//
// Pure functions, no React. The engine uses them for timing and the card uses
// them for drawing, so the unit the engine lights is always the unit the
// viewer is looking at. Two copies of the split would drift, and a highlight
// one position off is exactly the bug this file exists to prevent.
//
// WHY THIS IS MORE THAN A SYLLABLE SPLIT. The vehicle catalog is full of names
// the voice does not read as spelled: "BMW" is bee-em-double-you, "CX-90" is
// see-ex-ninety, "F-450" is ef-four-fifty, "RAM 3500" is ram three-thousand-
// five-hundred. Splitting the SPELLING of those into syllables can never line
// up with the voice. So each token is classified first:
//
//   word     "Volkswagen"  -> syllables       Volks | wa | gen
//   spelled  "GMC"         -> letters         G | M | C
//   alnum    "CX-90"       -> letter + number runs  C | X | 90
//   number   "3500"        -> one number run
//
// EVERY CONSTANT BELOW WAS MEASURED, not chosen. Chrome on Windows, Microsoft
// David/Mark/Zira, 85 names from the live catalog, each spoken silently and
// timed from the engine's own word-boundary events (2026-09-11). They are the
// starting point only: the engine re-learns the pace of whatever voice and
// speed a trainee actually uses, so a different engine converges on its own
// numbers after a few plays.
// ============================================================================

// ── measured durations, ms at rate 1.0 ───────────────────────────────────────
// A word: 115 + 79 per spoken syllable + 31 per letter. Syllables alone were
// off by up to 170 ms ("Bonneville" is 10 letters in 3 quick syllables);
// letters alone missed short-vowel words. Together they track the measurements.
const WORD_BASE_MS   = 115;
const WORD_SYL_MS    = 79;
const WORD_LETTER_MS = 31;
// A spelled letter ("gee", "em", "ess"): GLS / SLK / SSR / GLC all measured
// 650 ms for three letters. W is "double-you" -- three syllables, twice as long.
const LETTER_MS = 230;
// Number words, as the engine says them. "RAM 3500" measured three 299 /
// thousand 500 / five 300 / hundred 500.
const NUM_MS = { unit: 300, tens: 380, hundred: 470, thousand: 500, and: 200 };

const VOWELS = 'aeiou';

// A syllable may START with these; anything else in a consonant cluster belongs
// to the syllable before it -- "at-las", not "a-tlas".
// No s-clusters: after a vowel an American speaker splits them ("Es-cape",
// "Mus-tang", "Volks-wa-gen"), even though "sc"/"st"/"sw" can start a word.
const ONSETS = new Set([
  'bl', 'br', 'ch', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr', 'ph', 'pl', 'pr',
  'qu', 'sh', 'th', 'tr', 'tw', 'wh', 'wr',
]);

// Vowel pairs that are two syllables, not one: Fi-at, Pon-ti-ac, Sci-on,
// Ro-me-o, Bu-ick. Without this "Fiat" and "Scion" render as a single
// unsplittable block while the voice says two beats.
const HIATUS = new Set(['ia', 'io', 'iu', 'eo', 'ua', 'ui', 'uo']);

// Brand names whose split the rules cannot reach. Stored as segment LENGTHS so
// the original casing survives ("PORSCHE" and "Porsche" both split 3|4).
// Kept deliberately short: this is for the names a trainee meets on day one,
// not a pronouncing dictionary.
const SPLIT_EXCEPTIONS = {
  volkswagen:  [5, 2, 3],    // Volks-wa-gen (the rules say volk-swa-gen)
  porsche:     [3, 4],       // Por-sche: the final e is spoken
  chevrolet:   [4, 2, 3],    // Chev-ro-let
  hyundai:     [4, 3],       // Hyun-dai
  peugeot:     [3, 4],
  lamborghini: [3, 3, 3, 2],
  mercedes:    [3, 2, 3],
  nissan:      [3, 3],
};

// ── words ────────────────────────────────────────────────────────────────────

const isDigit = (ch) => ch >= '0' && ch <= '9';

/**
 * Break one alphabetic word into the syllables a speaker says:
 * "Volkswagen" -> ["Volks","wa","gen"], "Escape" -> ["Es","cape"].
 *
 * Rules, in the order they bite:
 *   1. 'y' is a vowel except straight after another vowel (to-yo-ta).
 *   2. A final 'e' after a consonant is silent (Dodge, Es-cape, Pal-i-sade)
 *      unless it closes a syllabic "-Cle" (Bee-tle).
 *   3. A hiatus pair splits (Fi-at, Sci-on).
 *   4. A consonant cluster splits so the next syllable starts with at most one
 *      real English onset ("sw", "tr") -- otherwise one consonant moves on.
 */
export function syllabify(word) {
  const w = String(word || '');
  if (!w) return [];
  const lower = w.toLowerCase();

  const exc = SPLIT_EXCEPTIONS[lower];
  if (exc && exc.reduce((a, b) => a + b, 0) === w.length) {
    const out = []; let at = 0;
    for (const n of exc) { out.push(w.slice(at, at + n)); at += n; }
    return out;
  }
  if (lower.length < 3) return [w];

  // 1 -- vowel map
  const n = lower.length;
  const isV = [];
  for (let i = 0; i < n; i++) {
    const ch = lower[i];
    let v = VOWELS.includes(ch);
    if (!v && ch === 'y') v = !(i > 0 && VOWELS.includes(lower[i - 1]));
    isV.push(v);
  }
  // 2 -- silent final e
  if (lower[n - 1] === 'e' && !isV[n - 2]) {
    const syllabicLe = lower[n - 2] === 'l' && n >= 4 && !isV[n - 3] && lower[n - 3] !== 'l';
    const vowelBefore = isV.slice(0, n - 1).some(Boolean);
    if (!syllabicLe && vowelBefore) isV[n - 1] = false;
  }

  // nuclei -- a hiatus pair becomes two
  const groups = [];
  for (let i = 0; i < n;) {
    if (!isV[i]) { i += 1; continue; }
    let start = i;
    while (i < n && isV[i]) {
      const afterGQ = i > 0 && 'gq'.includes(lower[i - 1]);
      if (i + 1 < n && isV[i + 1] && HIATUS.has(lower.slice(i, i + 2)) && !afterGQ) {
        groups.push([start, i]);
        start = i + 1;
      }
      i += 1;
    }
    groups.push([start, i - 1]);
  }
  if (groups.length <= 1) return [w];

  // 4 -- one cut per gap between nuclei
  const cuts = [];
  for (let g = 0; g < groups.length - 1; g++) {
    const from = groups[g][1] + 1;
    const to   = groups[g + 1][0];
    const gap  = to - from;
    let cut;
    if (gap <= 0)       cut = to;
    else if (gap === 1) cut = from;
    else {
      cut = ONSETS.has(lower.slice(to - 2, to)) ? to - 2 : to - 1;
      if (cut < from) cut = from;
    }
    cuts.push(cut);
  }
  const parts = []; let start = 0;
  for (const c of cuts) { if (c > start) { parts.push(w.slice(start, c)); start = c; } }
  parts.push(w.slice(start));
  return parts.filter(Boolean);
}

// Capitalised names the voice says as a WORD. Everything else short and in
// capitals is spelled: "GLA" measured 650 ms (gee-el-ay), not a 290 ms "gla",
// even though it has a vowel -- a vowel test alone got it wrong.
const SAID_AS_WORD = new Set([
  'ram', 'kia', 'mini', 'jeep', 'ford', 'fiat', 'saab', 'audi', 'seat', 'volt',
  'jazz', 'kona', 'soul', 'rav',
]);

// Is this letter run something the voice says as a WORD, or spells out?
// Measured: KIA 301 ms and RAM 251 ms as words; GMC, SLK, GLA, EQS as letters.
function isSpelled(run) {
  if (run.length === 1) return true;
  if (run !== run.toUpperCase()) return false;                  // Volkswagen, Rav
  const lower = run.toLowerCase();
  if (SAID_AS_WORD.has(lower)) return false;                    // KIA, RAM
  if (run.length <= 4) return true;                             // GMC, GLA, EQS
  return !/[aeiouy]/.test(lower);                               // long vowelless runs
}

// ── numbers ──────────────────────────────────────────────────────────────────

function under100(n) {
  if (n === 0) return [];
  if (n < 10) return ['unit'];
  if (n < 20 || n % 10 === 0) return ['tens'];
  return ['tens', 'unit'];
}

function cardinal(n) {
  if (n === 0) return ['unit'];
  const out = [];
  if (n >= 1000) { out.push(...cardinal(Math.floor(n / 1000)), 'thousand'); n %= 1000; }
  if (n >= 100)  { out.push('unit', 'hundred'); n %= 100; if (n) out.push('and'); }
  out.push(...under100(n));
  return out;
}

/**
 * The number words the engine says for a digit run -- as a list of kinds, so
 * both their count (one boundary event each) and their length are known.
 *
 * Measured, and not what you would guess: a STANDALONE number is a full
 * cardinal with an "and" ("530" -> five hundred and thirty, four events), but a
 * number INSIDE a model name is read in pairs ("F-450" -> four fifty, "430I" ->
 * four thirty).
 */
export function numberWords(digits, embedded) {
  const s = String(digits);
  if (s.length > 4) return s.split('').map(() => 'unit');   // read digit by digit
  if (embedded && s.length === 3) {
    const rest = parseInt(s.slice(1), 10);
    if (rest === 0) return ['unit', 'hundred'];
    if (s[1] === '0') return ['unit', 'unit', 'unit'];       // six-oh-five
    return ['unit', ...under100(rest)];
  }
  return cardinal(parseInt(s, 10));
}

// ── tokens ───────────────────────────────────────────────────────────────────

function wordMs(text) {
  const letters = (text.match(/[a-z]/gi) || []).length;
  const syl = syllabify(text.replace(/[^a-z]/gi, '')).length || 1;
  return WORD_BASE_MS + WORD_SYL_MS * syl + WORD_LETTER_MS * letters;
}

/** Units for one letter run, offset to its position in the token. */
function letterRunUnits(run, offset, alone) {
  if (isSpelled(run)) {
    return run.split('').map((ch, i) => ({
      text: ch, start: offset + i, end: offset + i + 1, kind: 'letter',
      ms: ch.toLowerCase() === 'w' ? LETTER_MS * 2 : LETTER_MS,
    }));
  }
  // Said as a word. Inside an alphanumeric ("RAV" in RAV4) it is one beat; on
  // its own it gets the full syllable split. The word's time is shared across
  // its syllables by length, so "Volks" gets more of it than "wa".
  const syls = alone ? syllabify(run) : [run];
  const total = wordMs(run);
  const weights = syls.map(s => 1 + s.length);
  const sum = weights.reduce((a, b) => a + b, 0);
  let at = offset;
  return syls.map((s, i) => {
    const u = { text: s, start: at, end: at + s.length, kind: 'syllable', ms: (total * weights[i]) / sum };
    at += s.length;
    return u;
  });
}

/**
 * Split a phrase into tokens and each token into highlightable units.
 *
 *   segment("Volkswagen Atlas").tokens[0].units.map(u => u.text)
 *     -> ["Volks", "wa", "gen"]
 *
 * Every unit carries `start`/`end` offsets into its token, so the card draws
 * the ORIGINAL characters (hyphens and all) and colours only the part being
 * said. Every token carries `unitBoundary`: for the k-th word-boundary event
 * the engine fires inside this token, the unit that event starts. The engine
 * reports every sub-token event with the token's own charIndex and nothing
 * finer, so this map is the only way to tell "CX" from "ninety".
 */
export function segment(text) {
  const tokens = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const tok = m[0];
    const units = [];
    const groups = [];          // units sharing one boundary event, in order

    if (!/\d/.test(tok)) {
      // Hyphenated words ("Rolls-Royce", "E-Class") fire ONE event, but each
      // part is still split on its own. Letters only: an apostrophe splits
      // "O'Brien" into O + Brien and stays on screen between them. Stripping it
      // first shifted every offset after it by one, and the card drew "O-Brienn".
      const partRe = /[a-z]+/gi;
      let p;
      while ((p = partRe.exec(tok))) {
        units.push(...letterRunUnits(p[0], p.index, true));
      }
      // A token with nothing to light ("&", a stray "-" in an uploaded name)
      // gets no units and expects no events; the card still draws it, dimmed.
      if (units.length) groups.push({ size: units.length, events: 1 });
    } else {
      const alone = !/[a-z]/i.test(tok);          // "3500", "200"
      const runRe = /[a-z]+|\d+/gi;
      let r;
      while ((r = runRe.exec(tok))) {
        const run = r[0];
        if (isDigit(run[0])) {
          const words = numberWords(run, !alone);
          units.push({
            text: run, start: r.index, end: r.index + run.length, kind: 'number',
            ms: words.reduce((a, k) => a + NUM_MS[k], 0),
          });
          groups.push({ size: 1, events: words.length });
        } else {
          const lu = letterRunUnits(run, r.index, false);
          units.push(...lu);
          groups.push({ size: lu.length, events: 1 });
        }
      }
    }

    const unitBoundary = [];
    let ui = 0;
    for (const g of groups) {
      for (let k = 0; k < g.events; k++) unitBoundary.push(ui);
      ui += g.size;
    }

    tokens.push({
      text: tok,
      start: m.index,
      end: m.index + tok.length,
      units,
      unitBoundary,
      ms: units.reduce((a, u) => a + u.ms, 0),
    });
  }
  return { tokens };
}

// Ranked, synonym-aware search shared by the FAQ + Script panels and managers.
// Scores each item by weighted fields (title/question high, keywords high, body
// low), with exact-phrase, word-boundary, all-terms-present and synonym boosts.

const norm = (s) => (s ?? '').toString().toLowerCase();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const tokenize = (s) => norm(s).split(/[^a-z0-9]+/).filter((t) => t.length > 1);

// Build a bidirectional lookup from synonym rows [{ term, synonyms }]:
// every member of a group maps to all the others.
export function buildSynonymMap(rows) {
  const map = {};
  (rows || []).forEach((r) => {
    const group = [r.term, ...String(r.synonyms || '').split(',')]
      .map((t) => norm(t).trim()).filter((t) => t.length > 1);
    const uniq = [...new Set(group)];
    uniq.forEach((m) => {
      map[m] = map[m] || new Set();
      uniq.forEach((o) => { if (o !== m) map[m].add(o); });
    });
  });
  // Set → array
  Object.keys(map).forEach((k) => { map[k] = [...map[k]]; });
  return map;
}

/**
 * Rank `items` against `query`. `fields` = [{ get:(item)=>text, weight }].
 * Returns the matching items (highest score first). Empty query → items unchanged.
 */
export function rankItems(query, items, fields, synMap = {}) {
  const qNorm = norm(query).trim();
  if (!qNorm) return items;
  const baseTerms = tokenize(qNorm);
  if (!baseTerms.length) return items;

  const scored = [];
  for (const item of items) {
    let score = 0;
    const texts = fields.map((f) => norm(f.get(item)));

    fields.forEach((f, fi) => {
      const text = texts[fi];
      if (!text) return;
      if (text.includes(qNorm)) score += f.weight * 3;          // exact phrase
      for (const t of baseTerms) {
        if (text.includes(t)) {
          score += f.weight * (new RegExp(`\\b${escapeRe(t)}`).test(text) ? 1.2 : 0.8);
        } else if ((synMap[t] || []).some((s) => text.includes(s))) {
          score += f.weight * 0.6;                              // synonym hit
        }
      }
    });

    // Bonus when every query term is satisfied somewhere (directly or via synonym).
    const hay = texts.join(' ');
    if (baseTerms.every((t) => hay.includes(t) || (synMap[t] || []).some((s) => hay.includes(s)))) score += 2;

    if (score > 0) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.item);
}

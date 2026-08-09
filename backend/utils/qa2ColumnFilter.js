// ============================================================================
// qa2ColumnFilter.js — column sort/filter for QA v2's Pool/Queue, adapted for
// an EMBEDDED table. columnFilter.js's applySort()/applyColumnFilters()
// assume every catalog column lives on the query's own base table (true for
// sales/transfers/callbacks); Pool/Queue query FROM qa2_assignment with
// qa2_call EMBEDDED (!inner), so every QA2_CALL_COLUMNS entry actually lives
// one join away. Supabase JS supports this directly — order(col,
// {foreignTable}) and .eq('qa2_call.col', v) — so this is a thin adapter, not
// a parallel reimplementation: the WHITELIST CATALOG (the actual security
// boundary, per columnFilter.js's own header) and its parsing/operator
// validation (parseFilters, OPS_BY_TYPE) are reused unchanged.
//
// Scoped to the three types QA2_CALL_COLUMNS actually uses — uuid, enum,
// date — not the full text/number surface columnFilter.js covers, since
// there's no text or number column in scope today.
// ============================================================================

const { parseFilters, OPS_BY_TYPE } = require('./columnFilter');
const { etDateToUtcStart, etDateToUtcEnd } = require('./etUtils');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_IN = 100;
const asArray = (v) => (Array.isArray(v) ? v : [v]).filter(x => x !== null && x !== undefined && x !== '');

// fallbackCol lives on the BASE table (qa2_assignment), never the embed — so
// only the catalog-matched branch passes foreignTable. A secondary order on
// the base table's created_at keeps equal-valued rows from shuffling across
// requests, same tiebreaker reasoning as sortHelper.js's applySort.
function applyQa2Sort(query, sortBy, sortDir, sortMap, foreignTable, fallbackCol, fallbackAscending) {
  const col = sortMap[sortBy];
  const ascending = sortDir === 'asc';
  if (col) {
    return query
      .order(col, { ascending, nullsFirst: false, foreignTable })
      .order(fallbackCol, { ascending: fallbackAscending, nullsFirst: false });
  }
  return query.order(fallbackCol, { ascending: fallbackAscending, nullsFirst: false });
}

function applyQa2One(query, entry, spec, dottedCol) {
  const { type } = entry;
  const op = String(spec.op || '').toLowerCase();
  if (!(OPS_BY_TYPE[type] || []).includes(op)) return query;
  if (op === 'empty') return query.is(dottedCol, null);
  if (op === 'notempty') return query.not(dottedCol, 'is', null);

  const v = spec.v;
  if (v === undefined || v === null || v === '') return query;

  if (type === 'uuid') {
    if (op === 'in') {
      const list = asArray(v).filter(x => UUID_RE.test(String(x))).slice(0, MAX_IN);
      return list.length ? query.in(dottedCol, list) : query;
    }
    return UUID_RE.test(String(v)) ? query.eq(dottedCol, String(v)) : query;
  }
  if (type === 'enum') {
    const ok = entry.values ? (x => entry.values.includes(x)) : (() => true);
    if (op === 'in') {
      const list = asArray(v).map(String).filter(ok).slice(0, MAX_IN);
      return list.length ? query.in(dottedCol, list) : (entry.values ? query.in(dottedCol, []) : query);
    }
    const one = String(v);
    return ok(one) ? query.eq(dottedCol, one) : query.in(dottedCol, []);
  }
  if (type === 'date') {
    if (!DATE_RE.test(String(v))) return query;
    if (op === 'on') return query.gte(dottedCol, etDateToUtcStart(v)).lte(dottedCol, etDateToUtcEnd(v));
    if (op === 'gte') return query.gte(dottedCol, etDateToUtcStart(v));
    if (op === 'lte') return query.lte(dottedCol, etDateToUtcEnd(v));
    if (op === 'between') {
      const q = query.gte(dottedCol, etDateToUtcStart(v));
      return DATE_RE.test(String(spec.v2)) ? q.lte(dottedCol, etDateToUtcEnd(spec.v2)) : q;
    }
  }
  return query;
}

function applyQa2Filters(query, raw, catalog, blocked, embedTable) {
  const filters = parseFilters(raw);
  let q = query;
  for (const [key, spec] of Object.entries(filters)) {
    if (!spec || typeof spec !== 'object') continue;
    if (blocked && blocked.has(key)) continue;
    const entry = catalog[key];
    if (!entry || !entry.col || !entry.type) continue;
    q = applyQa2One(q, entry, spec, `${embedTable}.${entry.col}`);
  }
  return q;
}

module.exports = { applyQa2Sort, applyQa2Filters };

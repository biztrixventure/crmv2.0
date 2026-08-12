// ============================================================================
// columnFilter — server-side per-column filtering for list endpoints.
//
// The sibling of sortHelper.applySort, and deliberately the same shape: a user
// string never reaches PostgREST, it selects an entry in a WHITELIST CATALOG
// and the catalog supplies the real column. That catalog is the security
// boundary, exactly as the *_SORT maps are for ordering.
//
// WHY A CATALOG AND NOT TWO MAPS
// The sort maps ({ uiKey: 'db_column' }) and a filter map would carry the same
// uiKey→column facts and drift apart the first time somebody adds a column to
// one. So a catalog entry carries BOTH, and sortMapFrom() derives the exact
// map applySort already expects. applySort stays the one sorter; this file
// just feeds it from a richer source.
//
//   catalog = {
//     customer:  { col: 'customer_name', type: 'text', sort: true },
//     status:    { col: 'status',        type: 'enum', sort: true },
//     sale_date: { col: 'sale_date',     type: 'date', sort: true },
//   }
//
// WIRE FORMAT
//   ?filters={"customer":{"op":"contains","v":"john"},
//             "sale_date":{"op":"between","v":"2026-07-01","v2":"2026-07-31"}}
// A JSON object, one entry per active column filter. Unknown keys, unknown
// operators and type-inappropriate operators are DROPPED SILENTLY — the same
// fail-soft posture as applySort falling back to created_at. A filter the
// server refuses must never 500 a list that would otherwise render.
//
// EVERYTHING IS ADDITIVE. No `filters` param → the query is untouched and the
// endpoint behaves exactly as it did before, which is what keeps today's
// behaviour the default.
// ============================================================================
const { etDateToUtcStart, etDateToUtcEnd } = require('./etUtils');

// Hard caps. `in` lists ride in the request URL, and PostgREST overflows well
// before Postgres does — the same reason app_record_search caps its id list at
// 150 (mig 141). 100 keeps a multi-select comfortably inside that.
const MAX_IN = 100;
const MAX_TEXT = 200;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Which operators each column type may use. A `between` on a text column is not
// a typo to be coerced — it is a client that disagrees with the catalog, and
// range operators are precisely how a masked value gets binary-searched.
const OPS_BY_TYPE = {
  text:   ['contains', 'eq', 'in', 'starts', 'ends', 'empty', 'notempty'],
  enum:   ['in', 'eq', 'empty', 'notempty'],
  number: ['eq', 'gte', 'lte', 'between'],
  date:   ['on', 'gte', 'lte', 'between', 'empty', 'notempty'],
  bool:   ['eq'],
  uuid:   ['in', 'eq', 'empty', 'notempty'],
};

// ilike treats % and _ as wildcards; somebody literally searching for "50%"
// must not turn into a match-anything scan. Backslash-escape both, plus the
// escape character itself.
const escLike = (s) => String(s).slice(0, MAX_TEXT).replace(/[\\%_]/g, m => `\\${m}`);

const asArray = (v) => (Array.isArray(v) ? v : [v]).filter(x => x !== null && x !== undefined && x !== '');

/**
 * Parse the wire `filters` param into a plain object. Never throws: bad JSON is
 * an absent filter, not a 400, because a stale bookmarked URL should still open
 * the list.
 */
function parseFilters(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const v = JSON.parse(raw);
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  } catch { return {}; }
}

/**
 * Derive the { uiKey: 'db_column' } map applySort expects from a catalog.
 * Only entries flagged `sort: true` are included — a column can be filterable
 * without being sortable (an unindexed JSONB path on a large table is the
 * usual reason).
 *
 * `blocked` drops keys this caller may not touch. It must be applied HERE and
 * not at the call site: applySort falls back to created_at for an unknown key,
 * so removing a masked column from the map is what turns "sort by the redacted
 * phone" into "sort by created_at" instead of into a leak.
 */
function sortMapFrom(catalog, blocked) {
  const out = {};
  for (const [k, c] of Object.entries(catalog)) {
    if (!c || !c.sort) continue;
    if (blocked && blocked.has(k)) continue;
    out[k] = c.col;
  }
  return out;
}

/**
 * Apply one catalog entry's filter to the query. Returns the (possibly
 * unchanged) query — never mutates in place, matching the PostgREST builder's
 * own chaining contract.
 */
function applyOne(query, entry, spec) {
  const { col, type } = entry;
  const op = String(spec.op || '').toLowerCase();
  if (!(OPS_BY_TYPE[type] || []).includes(op)) return query;

  // Presence checks are type-independent and need no value.
  if (op === 'empty')    return query.is(col, null);
  if (op === 'notempty') return query.not(col, 'is', null);

  const v  = spec.v;
  const v2 = spec.v2;
  if (v === undefined || v === null || v === '') return query;

  switch (type) {
    case 'text':
      if (op === 'contains') return query.ilike(col, `%${escLike(v)}%`);
      if (op === 'starts')   return query.ilike(col, `${escLike(v)}%`);
      if (op === 'ends')     return query.ilike(col, `%${escLike(v)}`);
      if (op === 'in') {
        const list = asArray(v).map(x => String(x).slice(0, MAX_TEXT)).slice(0, MAX_IN);
        return list.length ? query.in(col, list) : query;
      }
      return query.eq(col, String(v).slice(0, MAX_TEXT));

    case 'enum': {
      // `values` present = the column is a real Postgres ENUM. Postgres rejects
      // an unknown label with a TYPE ERROR ("invalid input value for enum
      // sale_status"), which PostgREST returns as a 400 and the route turns
      // into a 500 — so a typo'd or stale filter value would blank the whole
      // tab instead of returning no rows. Validate against the vocabulary and
      // drop what can't exist; an all-invalid filter becomes a guaranteed-empty
      // result, which is the honest answer.
      const ok = entry.values ? (x => entry.values.includes(x)) : (() => true);
      if (op === 'in') {
        const list = asArray(v).map(x => String(x).slice(0, MAX_TEXT)).filter(ok).slice(0, MAX_IN);
        if (list.length) return query.in(col, list);
        return entry.values ? query.in(col, []) : query;
      }
      const one = String(v).slice(0, MAX_TEXT);
      if (!ok(one)) return query.in(col, []);
      return query.eq(col, one);
    }

    case 'uuid': {
      if (op === 'in') {
        const list = asArray(v).filter(x => UUID_RE.test(String(x))).slice(0, MAX_IN);
        return list.length ? query.in(col, list) : query;
      }
      return UUID_RE.test(String(v)) ? query.eq(col, String(v)) : query;
    }

    case 'number': {
      const n = Number(v);
      if (!Number.isFinite(n)) return query;
      if (op === 'gte') return query.gte(col, n);
      if (op === 'lte') return query.lte(col, n);
      if (op === 'between') {
        const n2 = Number(v2);
        const q = query.gte(col, n);
        return Number.isFinite(n2) ? q.lte(col, n2) : q;
      }
      return query.eq(col, n);
    }

    case 'date': {
      // The calendar always hands us a bare ET calendar day (YYYY-MM-DD). The
      // stored value may be a timestamptz, so a day has to become a [start,end]
      // UTC window — the same etUtils helpers the existing date_from/date_to
      // params already use, so a header filter and the toolbar date range can
      // never disagree about what "July 3rd" means.
      if (!DATE_RE.test(String(v))) return query;
      if (op === 'on')  return query.gte(col, etDateToUtcStart(v)).lte(col, etDateToUtcEnd(v));
      if (op === 'gte') return query.gte(col, etDateToUtcStart(v));
      if (op === 'lte') return query.lte(col, etDateToUtcEnd(v));
      if (op === 'between') {
        const q = query.gte(col, etDateToUtcStart(v));
        return DATE_RE.test(String(v2)) ? q.lte(col, etDateToUtcEnd(v2)) : q;
      }
      return query;
    }

    case 'bool':
      return query.eq(col, v === true || v === 'true');

    default:
      return query;
  }
}

/**
 * Apply every recognised column filter to a PostgREST query.
 *
 * @param query    supabase query builder
 * @param raw      the `filters` query param (JSON string or object)
 * @param catalog  whitelist catalog — THE security boundary
 * @param blocked  optional Set of uiKeys this caller may not filter on (used
 *                 for readonly_admin masking: a column whose value is redacted
 *                 in the response must not be filterable, or a range filter
 *                 becomes an oracle for the value the mask is hiding)
 */
function applyColumnFilters(query, raw, catalog, blocked) {
  const filters = parseFilters(raw);
  let q = query;
  for (const [key, spec] of Object.entries(filters)) {
    if (!spec || typeof spec !== 'object') continue;
    if (blocked && blocked.has(key)) continue;
    const entry = catalog[key];
    if (!entry || !entry.col || !entry.type) continue;
    if (entry.filter === false) continue;
    q = applyOne(q, entry, spec);
  }
  return q;
}

/**
 * The catalog a given caller may actually use, as plain JSON for the client.
 * Sent alongside a list response so the header menu renders exactly the columns
 * the server will honour — the client never decides what is filterable.
 */
function publicCatalog(catalog, blocked) {
  const out = {};
  for (const [k, c] of Object.entries(catalog)) {
    if (blocked && blocked.has(k)) continue;
    if (c.filter === false && !c.sort) continue;
    out[k] = {
      type: c.type,
      sortable: !!c.sort,
      filterable: c.filter !== false,
      ops: c.filter === false ? [] : (OPS_BY_TYPE[c.type] || []),
      ...(c.enumSource ? { enumSource: c.enumSource } : {}),
      // Enum vocabularies ride along so the dropdown renders with no extra
      // request and — critically — with no SELECT DISTINCT over the table.
      ...(c.values ? { values: c.values } : {}),
    };
  }
  return out;
}

/**
 * Resolve what THIS caller may sort and filter on, for one catalog.
 *
 *   { sortMap, blocked, catalog }
 *
 * sortMap  → hand straight to applySort in place of the old literal
 * blocked  → hand to applyColumnFilters (null for an unrestricted caller)
 * catalog  → ship in the list response so the header menu offers exactly what
 *            the server will honour; the client never decides this
 *
 * Only a readonly_admin can be restricted, and only when a superadmin has
 * turned off view_pii / view_financial_data for them. Everyone else takes the
 * zero-query path — this must not add a round-trip to every list request.
 *
 * Required lazily: readonlyGovernance pulls in the Supabase client and the
 * config cache, and utils/columnFilter is otherwise a pure function module.
 */
async function resolveColumnAccess(req, catalog) {
  const { isReadonly, resolveGovernance, hideFlagsFor } = require('./readonlyGovernance');
  if (!isReadonly(req)) {
    return { sortMap: sortMapFrom(catalog), blocked: null, catalog: publicCatalog(catalog) };
  }
  const { blockedForHide } = require('../config/recordColumns');
  const hide = hideFlagsFor(await resolveGovernance(req.user.id));
  const blocked = blockedForHide(catalog, hide);
  return {
    sortMap: sortMapFrom(catalog, blocked),
    blocked,
    catalog: publicCatalog(catalog, blocked),
  };
}

module.exports = {
  applyColumnFilters, sortMapFrom, publicCatalog, parseFilters,
  resolveColumnAccess, OPS_BY_TYPE,
};

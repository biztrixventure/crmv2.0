// ============================================================================
// clientColumns — build a useTableQuery catalog for a CLIENT-MODE table.
//
// Server-mode tables get their catalog from the API response (see
// backend/config/recordColumns.js + columnFilter.publicCatalog), because there
// the catalog is the SECURITY BOUNDARY: it decides what may reach .order() and
// a filter operator. Client mode has no such boundary to enforce — the rows are
// already in the browser — so the catalog there is purely "what should this
// header offer", and writing one by hand per table is how 15 tables drift into
// 15 dialects.
//
// So: one declaration, shortest form possible.
//
//   const COLUMNS = clientColumns({
//     name:    'text',
//     type:    { type: 'enum', values: ['fronter', 'closer'] },
//     status:  'bool',
//     created: 'date',
//     notes:   { type: 'text', sortable: false },
//   });
//
// The operator lists are copied from the server's OPS_BY_TYPE deliberately, so
// a text column offers the same contains / starts with / ends with / is exactly
// on a 6-row admin table as it does on the 80k-row transfers table. Somebody
// who learns the header menu once has learned all of them.
//
// A key omitted from the map renders as a plain, inert <th> — the same rule as
// server mode, so "no entry" always means "not clickable" everywhere.
// ============================================================================

// Mirrors OPS_BY_TYPE in backend/utils/columnFilter.js. Kept as a literal
// rather than imported: that copy is Node-only, and a divergence here shows up
// as a missing menu entry on a table the browser already holds in full — not as
// a hole in the server-side whitelist, which is a different file for a reason.
export const OPS_BY_TYPE = {
  text:   ['contains', 'eq', 'starts', 'ends', 'empty', 'notempty'],
  enum:   ['in', 'eq', 'empty', 'notempty'],
  number: ['eq', 'gte', 'lte', 'between'],
  date:   ['on', 'gte', 'lte', 'between', 'empty', 'notempty'],
  bool:   ['eq'],
  uuid:   ['in', 'eq', 'empty', 'notempty'],
};

/**
 * @param spec  { uiKey: 'text' } shorthand, or
 *              { uiKey: { type, sortable?, filterable?, values?, ops? } }
 * @returns the catalog shape useTableQuery + ColumnHeader already consume.
 */
export function clientColumns(spec = {}) {
  const out = {};
  for (const [key, raw] of Object.entries(spec)) {
    if (!raw) continue;
    const c = typeof raw === 'string' ? { type: raw } : raw;
    const type = c.type || 'text';
    const filterable = c.filterable !== false;
    out[key] = {
      type,
      sortable:   c.sortable !== false,
      filterable,
      ops:        filterable ? (c.ops || OPS_BY_TYPE[type] || OPS_BY_TYPE.text) : [],
      ...(c.values ? { values: c.values } : {}),
    };
  }
  return out;
}

export default clientColumns;

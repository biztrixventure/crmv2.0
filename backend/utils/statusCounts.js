// ============================================================================
// statusCounts — exact per-status totals for a filtered list, without fetching
// the rows.
//
// PostgREST caps a page at 1000 rows (and the compliance path at 5000), so the
// obvious implementation — select the set and tally it in JavaScript — silently
// undercounts the moment a company outgrows the cap. A `head: true` count query
// per status returns the true number and no rows at all.
//
// THE CONTRACT: `makeBase` must return a FRESH builder carrying every filter
// the list applies EXCEPT status. Supabase builders are single-use, so a shared
// object would be consumed by the first status and return nothing for the rest;
// and if the base carries different filters than the list, the count strip and
// the rows disagree, which is worse than having no strip at all.
//
// Extracted from compliance.js, where it was private, once /transfers and
// /sales needed the same strip. One implementation is the point: these numbers
// are what a manager clicks to filter by, so "the box said 26" has to mean the
// list shows 26, on every surface.
// ============================================================================

/**
 * @param makeBase  () => fresh Supabase builder with `head: true` +
 *                  count: 'exact', carrying the list's filters minus status.
 * @param statuses  status keys to count (from utils/statusCatalog).
 * @param opts.includeZero  keep zero-count entries. Default false — a filter
 *                  bar wants only statuses that exist. A DASHBOARD of boxes
 *                  wants a stable set that doesn't appear and disappear as the
 *                  date range moves, so those callers pass true.
 * @returns { [status]: count }. `{}` on total failure, so a caller can fall
 *          back to page-derived counts rather than render a broken strip.
 */
async function statusCountsExact(makeBase, statuses, opts = {}) {
  const { includeZero = false } = opts;
  const entries = await Promise.all((statuses || []).map(async (st) => {
    try {
      const { count, error } = await makeBase().eq('status', st);
      return error ? [st, 0] : [st, count || 0];
    } catch { return [st, 0]; }
  }));
  const out = {};
  for (const [st, c] of entries) if (includeZero || c > 0) out[st] = c;
  return out;
}

module.exports = { statusCountsExact };

/**
 * Apply user-controlled, dataset-wide sorting to a PostgREST query.
 *
 * Sorting is done in the database (ORDER BY) so it spans the entire result set,
 * not just the current page — pagination then slices the already-sorted data.
 *
 * @param query     supabase query builder
 * @param sortBy    requested sort key (from the client; validated against `allowed`)
 * @param sortDir   'asc' | 'desc'
 * @param allowed   map of client sort key -> real column / json path
 *                  (e.g. { customer: 'customer_name', fronter: 'created_by' })
 * @param fallback  { col, asc } default ordering when sortBy is missing/invalid
 *
 * A stable secondary sort on created_at keeps pagination deterministic when the
 * primary column has duplicate values (status, priority, name groups, …).
 */
function applySort(query, sortBy, sortDir, allowed, fallback) {
  const col = allowed[sortBy];
  let q;
  if (col) {
    q = query.order(col, { ascending: sortDir === 'asc', nullsFirst: false });
  } else {
    q = query.order(fallback.col, { ascending: fallback.asc, nullsFirst: false });
  }
  // Deterministic tiebreaker so equal-valued rows don't shuffle across pages.
  if (col !== 'created_at' && fallback.col !== 'created_at') {
    q = q.order('created_at', { ascending: false, nullsFirst: false });
  }
  return q;
}

module.exports = { applySort };

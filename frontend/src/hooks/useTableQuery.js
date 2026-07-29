// ============================================================================
// useTableQuery — the ONE place a table's sort + per-column filters live.
//
// Headless on purpose: it owns state and produces request params, and knows
// nothing about markup. <ColumnHeader> renders against it. Every table in the
// admin and compliance shells drives off this pair, so behaviour cannot drift
// from tab to tab the way 26 hand-wirings would.
//
// TWO MODES, ONE API — because the tables are not the same size.
//
//   mode: 'server'  the list endpoint filters and orders in the database.
//                   Use wherever the underlying table is big (transfers is
//                   80k rows) or already paginated. `params` goes on the
//                   request; the component re-fetches when `version` changes.
//
//   mode: 'client'  the component already holds every row (companies is 6
//                   rows, teams 4, scripts 2). `apply(rows)` filters and sorts
//                   in memory. A round-trip per keystroke against a 6-row
//                   table is the regression, not the fix.
//
// The caller picks the mode; the header UI is identical either way.
//
// WHY FILTERS ARE NOT IN THE URL
// useHistoryTab pushes a `?t=` entry per tab so an edge swipe on the installed
// PWA goes back instead of exiting the app. Pushing another entry per filter
// change would make Back walk the filter history rather than leave the tab.
// So filters persist in sessionStorage per (shell, tab) instead — they survive
// a tab switch and a reload, and they leave the history stack alone.
// ============================================================================
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';

// Debounce for text typing. Enum / date / boolean changes are discrete clicks
// and apply immediately — waiting 350ms after picking a date just feels broken.
const TEXT_DEBOUNCE_MS = 350;
const TEXT_OPS = new Set(['contains', 'starts', 'ends', 'eq']);

const storeKey = (scope) => (scope ? `biztrix.tq.${scope}` : null);

function readStored(scope) {
  const k = storeKey(scope);
  if (!k) return null;
  try {
    const raw = sessionStorage.getItem(k);
    const v = raw ? JSON.parse(raw) : null;
    return (v && typeof v === 'object') ? v : null;
  } catch { return null; }
}
function writeStored(scope, value) {
  const k = storeKey(scope);
  if (!k) return;
  try { sessionStorage.setItem(k, JSON.stringify(value)); } catch { /* private mode — filters just don't persist */ }
}

// A filter entry is live only if it carries a usable value (or is a presence
// check, which needs none). Half-typed state must not narrow the list.
const isLive = (f) =>
  !!f && (f.op === 'empty' || f.op === 'notempty'
    || (Array.isArray(f.v) ? f.v.length > 0 : (f.v !== undefined && f.v !== null && f.v !== '')));

/**
 * @param opts.scope     sessionStorage key suffix, e.g. 'compliance:sales'.
 *                       Omit to keep filters purely in memory.
 * @param opts.mode      'server' (default) | 'client'
 * @param opts.columns   catalog: { uiKey: { type, sortable, filterable, ops, values? } }
 *                       On server mode this is what the endpoint returned in
 *                       `columns` — the server decides what is filterable, the
 *                       client only renders it.
 * @param opts.defaultSort  { by, dir } — today's default for that table, so
 *                       nothing changes until somebody clicks a header.
 * @param opts.accessor  client mode only: (row, uiKey) => value
 */
export function useTableQuery({
  scope,
  mode = 'server',
  columns = {},
  defaultSort = {},
  accessor,
} = {}) {
  const restored = useRef(readStored(scope)).current;

  const [sort, setSort] = useState(() => ({
    by:  restored?.sort?.by  ?? defaultSort.by  ?? null,
    dir: restored?.sort?.dir ?? defaultSort.dir ?? 'desc',
  }));
  // `filters` is what the server/accessor sees (debounced); `draft` is what the
  // inputs show. Keeping them apart is what makes typing feel instant while
  // still firing one request per pause.
  const [filters, setFilters] = useState(() => restored?.filters || {});
  const [draft, setDraft]     = useState(() => restored?.filters || {});
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { writeStored(scope, { sort, filters }); }, [scope, sort, filters]);

  const commit = useCallback((next) => {
    clearTimeout(timer.current);
    setFilters(next);
  }, []);

  /** Set (or clear, with a null spec) one column's filter. */
  const setFilter = useCallback((key, spec) => {
    setDraft((prev) => {
      const next = { ...prev };
      if (!spec || !isLive(spec)) delete next[key]; else next[key] = spec;

      // Debounce ONLY free-text typing; discrete pickers apply at once.
      if (spec && TEXT_OPS.has(spec.op) && typeof spec.v === 'string') {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setFilters(next), TEXT_DEBOUNCE_MS);
      } else {
        commit(next);
      }
      return next;
    });
  }, [commit]);

  const clearFilter = useCallback((key) => setFilter(key, null), [setFilter]);
  const clearAll    = useCallback(() => { setDraft({}); commit({}); }, [commit]);

  /**
   * Click a header. First click on a new column takes the type's natural
   * direction — newest-first for dates and biggest-first for numbers is what
   * people mean; A-Z is what they mean for text. Clicking the active column
   * flips it.
   */
  const toggleSort = useCallback((key) => {
    setSort((s) => {
      if (s.by === key) return { by: key, dir: s.dir === 'asc' ? 'desc' : 'asc' };
      const t = columns[key]?.type;
      return { by: key, dir: (t === 'date' || t === 'number') ? 'desc' : 'asc' };
    });
  }, [columns]);

  const activeCount = useMemo(() => Object.keys(filters).length, [filters]);

  // Request params for server mode. `filters` is omitted entirely when empty so
  // an untouched table sends exactly the request it sends today.
  const params = useMemo(() => {
    const p = {};
    if (sort.by) { p.sort_by = sort.by; p.sort_dir = sort.dir; }
    if (activeCount) p.filters = JSON.stringify(filters);
    return p;
  }, [sort, filters, activeCount]);

  // Changes value whenever the caller needs to re-fetch — the whole point is
  // that a component can depend on ONE primitive instead of spreading an
  // object into a useCallback dep list.
  const version = useMemo(
    () => `${sort.by || ''}:${sort.dir}:${activeCount ? JSON.stringify(filters) : ''}`,
    [sort, filters, activeCount],
  );

  /** Client mode: filter + sort rows already in memory. */
  const apply = useCallback((rows) => {
    if (!Array.isArray(rows)) return [];
    const get = accessor || ((r, k) => r?.[k]);
    let out = rows;

    for (const [key, f] of Object.entries(filters)) {
      const type = columns[key]?.type || 'text';
      out = out.filter((row) => {
        const raw = get(row, key);
        if (f.op === 'empty')    return raw === null || raw === undefined || raw === '';
        if (f.op === 'notempty') return !(raw === null || raw === undefined || raw === '');
        if (raw === null || raw === undefined) return false;

        if (type === 'number') {
          const n = Number(raw);
          if (!Number.isFinite(n)) return false;
          if (f.op === 'gte')     return n >= Number(f.v);
          if (f.op === 'lte')     return n <= Number(f.v);
          if (f.op === 'between') return n >= Number(f.v) && (f.v2 === '' || f.v2 == null || n <= Number(f.v2));
          return n === Number(f.v);
        }
        if (type === 'date') {
          // Compare as ISO calendar days so a timestamp and a bare date agree.
          const d = String(raw).slice(0, 10);
          if (f.op === 'on')      return d === f.v;
          if (f.op === 'gte')     return d >= f.v;
          if (f.op === 'lte')     return d <= f.v;
          if (f.op === 'between') return d >= f.v && (!f.v2 || d <= f.v2);
          return true;
        }
        if (type === 'bool') return String(raw) === String(f.v);
        if (type === 'enum' || type === 'uuid') {
          const list = Array.isArray(f.v) ? f.v : [f.v];
          return list.map(String).includes(String(raw));
        }
        const s = String(raw).toLowerCase();
        const q = String(f.v).toLowerCase();
        if (f.op === 'starts') return s.startsWith(q);
        if (f.op === 'ends')   return s.endsWith(q);
        if (f.op === 'eq')     return s === q;
        return s.includes(q);
      });
    }

    if (sort.by) {
      const type = columns[sort.by]?.type;
      const mul  = sort.dir === 'asc' ? 1 : -1;
      // Copy before sorting — the caller's array is usually component state.
      out = [...out].sort((a, b) => {
        const av = get(a, sort.by), bv = get(b, sort.by);
        // Nulls sink to the bottom in BOTH directions; a column of blanks at
        // the top of a descending sort reads as broken.
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (type === 'number') return (Number(av) - Number(bv)) * mul;
        if (type === 'date')   return (String(av).localeCompare(String(bv))) * mul;
        return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * mul;
      });
    }
    return out;
  }, [filters, sort, columns, accessor]);

  return {
    sort, setSort, toggleSort,
    filters, draft, setFilter, clearFilter, clearAll, activeCount,
    params, version, apply, mode,
    // <ColumnHeader> reads this to decide what a header may offer. On a
    // server-backed table it is the catalog the API returned, so the client
    // never invents a filterable column.
    columns,
  };
}

/**
 * One AbortController per in-flight list request. Typing must not queue N
 * queries — each new load cancels the previous one, so only the latest answer
 * ever lands.
 *
 *   const abortable = useAbortable();
 *   const r = await client.get('compliance/sales', { params, signal: abortable() });
 *
 * Axios rejects a cancelled request with `code === 'ERR_CANCELED'`; treat that
 * as "superseded", never as an error toast.
 */
export function useAbortable() {
  const ref = useRef(null);
  useEffect(() => () => ref.current?.abort(), []);
  return useCallback(() => {
    ref.current?.abort();
    ref.current = new AbortController();
    return ref.current.signal;
  }, []);
}

export const isCanceled = (e) =>
  e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError' || e?.name === 'AbortError';

export default useTableQuery;

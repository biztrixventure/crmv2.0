// Click-to-sort column headers for the support desk grids.
//
// Two kinds of grid use the same header:
//   - the paged work lists sort on the SERVER (the list is longer than a page,
//     so sorting the 50 rows on screen would lie about the order) -- the parent
//     keeps { key, dir } and sends it with the request;
//   - the small in-memory tables (calls on a policy, report rows) sort in the
//     browser with useClientSort below.
import { useMemo, useState } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';

// First click = ascending, second = descending, third = back to the list's own order.
export const nextSort = (sort, key) => {
  if (!sort || sort.key !== key) return { key, dir: 'asc' };
  if (sort.dir === 'asc') return { key, dir: 'desc' };
  return null;
};

export function SortTh({ label, k, sort, onSort, num = false, title }) {
  const on = sort?.key === k;
  const Icon = !on ? ChevronsUpDown : sort.dir === 'asc' ? ChevronUp : ChevronDown;
  return (
    <th className={num ? 'num' : ''} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`sx-sort ${on ? 'on' : ''}`} onClick={() => onSort(nextSort(sort, k))}
        title={title || `Sort by ${label}`}>
        <span>{label}</span><Icon size={13} aria-hidden="true" />
      </button>
    </th>
  );
}

const blank = (v) => v === null || v === undefined || v === '';
const cmp = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
};

// getters: { columnKey: (row) => sortable value }. Blank values always sink to
// the bottom, whichever direction is chosen.
export function useClientSort(rows, getters) {
  const [sort, setSort] = useState(null);
  const sorted = useMemo(() => {
    const get = sort && getters[sort.key];
    if (!get) return rows;
    const sign = sort.dir === 'desc' ? -1 : 1;
    return [...rows].sort((x, y) => {
      const a = get(x), b = get(y);
      if (blank(a) && blank(b)) return 0;
      if (blank(a)) return 1;
      if (blank(b)) return -1;
      return sign * cmp(a, b);
    });
    // getters is a fresh object each render; the keys it holds do not change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);
  return { sorted, sort, setSort };
}

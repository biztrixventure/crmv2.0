// Reusable chip grid for fast multi-select against a known option list.
// Used by DataAnalyzer for US states, car makes, and any other field whose
// values come from a small enumerated set. Responsive columns: cramped on
// narrow screens collapses from `cols` to a smaller count via CSS clamp so
// the cells stay tappable on phones.
// `options` is what gets rendered (may be a search-filtered / display-capped
// subset). `allOptions` is the FULL list — "all" always selects every option,
// not just the visible chips. Falls back to options when not provided.
const ChipGrid = ({ value = [], onChange, options = [], allOptions, cols = 7 }) => {
  const all = allOptions || options;
  const sel = new Set(value);
  const toggle = (s) => onChange(sel.has(s) ? value.filter(v => v !== s) : [...value, s]);
  const selectAll = () => onChange([...all]);
  const clear     = () => onChange([]);

  // Responsive column count: phones get half the columns so chips stay legible.
  const gridStyle = {
    display: 'grid',
    gap: '4px',
    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
        <span>{value.length} of {all.length} selected</span>
        <div className="flex gap-2">
          <button type="button" onClick={selectAll} className="font-bold underline">all</button>
          <button type="button" onClick={clear} className="font-bold underline">none</button>
        </div>
      </div>
      <div className={`chip-grid chip-grid-cols-${cols}`} style={gridStyle}>
        {options.map(s => {
          const on = sel.has(s);
          return (
            <button key={s} type="button" onClick={() => toggle(s)}
              className="text-[11px] font-bold py-1.5 px-1 rounded-md transition-all truncate"
              title={String(s)}
              style={{
                backgroundColor: on ? 'var(--color-primary-600)' : 'var(--color-bg-secondary)',
                color:           on ? 'white' : 'var(--color-text-secondary)',
                border: `1px solid ${on ? 'var(--color-primary-600)' : 'var(--color-border)'}`,
              }}>
              {s}
            </button>
          );
        })}
      </div>
      {/* Responsive override for phones: halve the column count below 480px so
          tap targets stay >=44px wide. */}
      <style>{`
        @media (max-width: 480px) {
          .chip-grid-cols-7 { grid-template-columns: repeat(4, minmax(0, 1fr)) !important; }
          .chip-grid-cols-5 { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
        }
      `}</style>
    </div>
  );
};

// CollapsibleChipGrid — same multi-select chip grid, wrapped in a click-to-
// expand header with an internal search box. For car_model (and any future
// large-catalog field): a registry of 500+ models would otherwise take over
// the whole filter rail; collapsed default + search keeps the rail short
// while still letting the user grab a specific entry quickly.
//
// Default collapsed when options.length > collapseThreshold, expanded
// otherwise (preserves the inline experience for short lists). Expansion
// state is local — opening a filter shouldn't survive a page reload, since
// the user's interest pattern can change.
import { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, Search as SearchIcon } from 'lucide-react';

const CollapsibleChipGrid = ({ value = [], onChange, options = [], cols = 5, collapseThreshold = 24 }) => {
  const [open, setOpen] = useState(options.length <= collapseThreshold);
  const [q, setQ]       = useState('');

  // Prefix-first filter so typing "ca" surfaces "Camry" before "Maxima Camry".
  // Show the full list (no search) — a 500+ model registry renders fine as tiny
  // chips. A generous safety cap only guards a pathologically huge catalog; the
  // "Showing X of Y" note + search cover that rare case.
  const DISPLAY_CAP = 1500;
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options.slice(0, DISPLAY_CAP);
    const prefix = [], rest = [];
    options.forEach(o => {
      const lc = String(o).toLowerCase();
      if (lc.startsWith(needle)) prefix.push(o);
      else if (lc.includes(needle)) rest.push(o);
    });
    return [...prefix, ...rest].slice(0, DISPLAY_CAP);
  }, [q, options]);

  const selected = (value || []).length;

  return (
    <div className="space-y-2">
      {/* Header: counts + chevron toggle. Click anywhere on the bar opens it. */}
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md"
        style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
        <span className="flex items-center gap-1.5 text-[11px] font-semibold"
          style={{ color: 'var(--color-text-secondary)' }}>
          {selected > 0
            ? <><strong style={{ color: 'var(--color-primary-700)' }}>{selected}</strong> selected · {options.length} total</>
            : <>{options.length} options</>}
        </span>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      {open && (
        <>
          {options.length > 8 && (
            <div className="relative">
              <SearchIcon size={11} className="absolute left-2 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--color-text-tertiary)' }} />
              <input value={q} onChange={e => setQ(e.target.value)}
                placeholder="Search…" className="input text-xs pl-6 py-1 h-7" />
            </div>
          )}
          <ChipGrid value={value} onChange={onChange} options={filtered} allOptions={options} cols={cols} />
          {options.length > filtered.length && (
            <p className="text-[10px] italic text-center"
              style={{ color: 'var(--color-text-tertiary)' }}>
              Showing {filtered.length} of {options.length}. Refine the search to narrow.
            </p>
          )}
        </>
      )}
    </div>
  );
};

// Backwards-compat alias — kept so external callers (DataAnalyzer) and the
// re-export don't break. `states` prop maps to `options`, fixed at 7 cols.
const StateGrid = ({ value, onChange, states }) =>
  <ChipGrid value={value} onChange={onChange} options={states} cols={7} />;

export default StateGrid;
export { ChipGrid, CollapsibleChipGrid };

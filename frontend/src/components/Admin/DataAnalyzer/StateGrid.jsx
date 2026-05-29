// Reusable chip grid for fast multi-select against a known option list.
// Used by DataAnalyzer for US states, car makes, and any other field whose
// values come from a small enumerated set. Responsive columns: cramped on
// narrow screens collapses from `cols` to a smaller count via CSS clamp so
// the cells stay tappable on phones.
const ChipGrid = ({ value = [], onChange, options = [], cols = 7 }) => {
  const sel = new Set(value);
  const toggle = (s) => onChange(sel.has(s) ? value.filter(v => v !== s) : [...value, s]);
  const selectAll = () => onChange([...options]);
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
        <span>{value.length} of {options.length} selected</span>
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

// Backwards-compat alias — kept so external callers (DataAnalyzer) and the
// re-export don't break. `states` prop maps to `options`, fixed at 7 cols.
const StateGrid = ({ value, onChange, states }) =>
  <ChipGrid value={value} onChange={onChange} options={states} cols={7} />;

export default StateGrid;
export { ChipGrid };

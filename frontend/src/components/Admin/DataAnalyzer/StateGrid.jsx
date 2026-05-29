// 7-column state-initials grid for fast multi-select. 50 states + DC = 51 cells,
// so the grid runs 7 across × 8 down (last row partial). Spec asked for a 7x7
// matrix; honoring the column count exactly here since 50 won't fit in 49 cells.
// Click toggles. Header buttons handle all/none.
const StateGrid = ({ value = [], onChange, states }) => {
  const sel = new Set(value);
  const toggle = (s) => onChange(sel.has(s) ? value.filter(v => v !== s) : [...value, s]);
  const selectAll = () => onChange([...states]);
  const clear     = () => onChange([]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
        <span>{value.length} of {states.length} selected</span>
        <div className="flex gap-2">
          <button type="button" onClick={selectAll} className="font-bold underline">all</button>
          <button type="button" onClick={clear} className="font-bold underline">none</button>
        </div>
      </div>
      <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
        {states.map(s => {
          const on = sel.has(s);
          return (
            <button key={s} type="button" onClick={() => toggle(s)}
              className="text-xs font-bold py-1.5 rounded-md transition-all"
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
    </div>
  );
};

export default StateGrid;

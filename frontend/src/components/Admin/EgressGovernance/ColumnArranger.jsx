import { useRef, useState } from 'react';
import { GripVertical, X, Plus, ArrowUp, ArrowDown, Search } from 'lucide-react';

// ============================================================================
// ColumnArranger — pick AND order the columns of an exported file.
//
// The value is an ORDERED array of column keys, which is exactly what
// PUT /egress/columns already stores and resolveColumns already reads in order —
// so the order set here is the column order in the CSV, with no new contract.
//
// Two zones: "In the file" (ordered, drag to reorder) and "Available to add"
// (drag across to add). Drag uses native HTML5 events; the repo has no dnd
// dependency and this does not justify adding one.
//
// TOUCH: HTML5 drag does not fire on touch, so every drag action also has a
// button — up/down to move, + to add, x to remove. On a phone those buttons are
// the real interface, not a fallback, which is why they are always visible
// rather than revealed on hover.
// ============================================================================

const rowBase = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '7px 8px', borderRadius: 10, fontSize: 13,
  border: '1px solid var(--color-border)', background: 'var(--color-bg)',
};

// A tint of the accent, never a --color-*-50 step: those stay light under the
// dark theme while the text token flips to near-white (measured 1.15:1).
const tint = (pct) => `color-mix(in srgb, var(--color-primary-600) ${pct}%, transparent)`;

function IconBtn({ onClick, title, disabled, children, danger }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title} disabled={disabled}
      className="flex items-center justify-center rounded-md flex-shrink-0 disabled:opacity-30 transition-colors"
      style={{
        width: 26, height: 26,
        border: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        color: danger ? 'var(--color-error-600, #dc2626)' : 'var(--color-text-secondary)',
      }}>
      {children}
    </button>
  );
}

export default function ColumnArranger({ columns, value, onChange, sensitive }) {
  // columns: [{ key, label, group? }] — the full pool. value: ordered key[].
  const byKey = new Map(columns.map(c => [c.key, c]));
  const selected = value.map(k => byKey.get(k) || { key: k, label: k, missing: true });
  const available = columns.filter(c => !value.includes(c.key));

  const [q, setQ] = useState('');
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const drag = useRef(null);   // { from: 'sel' | 'avail', key, index }

  const filtered = q
    ? available.filter(c => `${c.label} ${c.key}`.toLowerCase().includes(q.toLowerCase()))
    : available;

  const move = (from, to) => {
    if (to < 0 || to >= value.length || from === to) return;
    const next = [...value];
    next.splice(to, 0, next.splice(from, 1)[0]);
    onChange(next);
  };
  const add = (key, at) => {
    if (value.includes(key)) return;
    const next = [...value];
    next.splice(at == null ? next.length : at, 0, key);
    onChange(next);
  };
  const remove = (key) => onChange(value.filter(k => k !== key));

  const onDragStart = (payload) => (e) => {
    drag.current = payload;
    setDragActive(true);
    e.dataTransfer.effectAllowed = 'move';
    // Firefox never starts a drag unless some data is set.
    try { e.dataTransfer.setData('text/plain', payload.key); } catch { /* ignore */ }
  };
  const endDrag = () => { drag.current = null; setDragActive(false); setDragOverIdx(null); };

  const dropOnSelected = (idx) => (e) => {
    e.preventDefault();
    const d = drag.current;
    setDragOverIdx(null);
    if (!d) return;
    if (d.from === 'avail') add(d.key, idx);
    else move(d.index, idx > d.index ? idx - 1 : idx);
    endDrag();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {/* ── in the file (ordered) ─────────────────────────────────────────── */}
      <div className="rounded-xl p-2.5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <span className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>In the file</span>
          <span className="text-[11px] leading-none" style={{ color: 'var(--color-text-tertiary)' }}>
            {selected.length} column{selected.length === 1 ? '' : 's'} · top = leftmost
          </span>
        </div>

        {selected.length === 0 ? (
          <p className="text-xs m-0 py-6 text-center" style={{ color: 'var(--color-error-600,#dc2626)' }}>
            No columns — the exported file would have no data. Add at least one.
          </p>
        ) : (
          <div className="flex flex-col gap-1 max-h-72 overflow-y-auto"
            onDragOver={e => e.preventDefault()}
            onDrop={dropOnSelected(selected.length)}>
            {selected.map((c, i) => (
              <div key={c.key}
                draggable
                onDragStart={onDragStart({ from: 'sel', key: c.key, index: i })}
                onDragEnd={endDrag}
                onDragOver={e => { e.preventDefault(); setDragOverIdx(i); }}
                onDrop={dropOnSelected(i)}
                style={{
                  ...rowBase,
                  cursor: 'grab',
                  background: dragOverIdx === i ? tint(22) : tint(10),
                  borderColor: dragOverIdx === i ? tint(60) : 'var(--color-border)',
                  opacity: c.missing ? 0.55 : 1,
                }}>
                <GripVertical size={14} className="flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
                <span className="text-[11px] leading-none w-4 flex-shrink-0 text-right" style={{ color: 'var(--color-text-tertiary)' }}>{i + 1}</span>
                <span className="flex-1 min-w-0 truncate leading-none" style={{ color: 'var(--color-text)' }}>
                  {c.label}
                  {sensitive?.(c.key) && <span title="Sensitive / PII — think before including in an export" style={{ color: '#d97706', marginLeft: 4 }}>•</span>}
                  {c.missing && <span className="text-[11px]" style={{ color: 'var(--color-error-600,#dc2626)' }}> · unknown</span>}
                </span>
                <code className="text-[11px] leading-none truncate max-w-[35%] flex-shrink-0 hidden sm:inline" style={{ color: 'var(--color-text-tertiary)' }}>{c.key}</code>
                <IconBtn title="Move up"   onClick={() => move(i, i - 1)} disabled={i === 0}><ArrowUp size={13} /></IconBtn>
                <IconBtn title="Move down" onClick={() => move(i, i + 1)} disabled={i === selected.length - 1}><ArrowDown size={13} /></IconBtn>
                <IconBtn title="Remove from the file" danger onClick={() => remove(c.key)}><X size={13} /></IconBtn>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── available to add ──────────────────────────────────────────────── */}
      <div className="rounded-xl p-2.5"
        style={{
          background: 'var(--color-surface)',
          border: `1px solid ${dragActive ? tint(50) : 'var(--color-border)'}`,
        }}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const d = drag.current; if (d?.from === 'sel') remove(d.key); endDrag(); }}>
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <span className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>Available to add</span>
          <span className="text-[11px] leading-none" style={{ color: 'var(--color-text-tertiary)' }}>{filtered.length}</span>
        </div>

        <div className="relative mb-2">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-text-tertiary)' }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search fields…"
            style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)', borderRadius: 8, padding: '6px 10px 6px 28px', fontSize: 13, width: '100%' }} />
        </div>

        {filtered.length === 0 ? (
          <p className="text-xs m-0 py-6 text-center" style={{ color: 'var(--color-text-tertiary)' }}>
            {available.length === 0 ? 'Every known field is already in the file.' : 'No field matches that search.'}
          </p>
        ) : (
          <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
            {filtered.map(c => (
              <div key={c.key}
                draggable
                onDragStart={onDragStart({ from: 'avail', key: c.key })}
                onDragEnd={endDrag}
                onDoubleClick={() => add(c.key)}
                style={{ ...rowBase, cursor: 'grab' }}>
                <GripVertical size={14} className="flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
                <span className="flex-1 min-w-0 truncate leading-none" style={{ color: 'var(--color-text)' }}>
                  {c.label}
                  {sensitive?.(c.key) && <span title="Sensitive / PII — think before including in an export" style={{ color: '#d97706', marginLeft: 4 }}>•</span>}
                  {c.group && <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}> · {c.group}</span>}
                </span>
                <code className="text-[11px] leading-none truncate max-w-[35%] flex-shrink-0 hidden sm:inline" style={{ color: 'var(--color-text-tertiary)' }}>{c.key}</code>
                <IconBtn title="Add to the file" onClick={() => add(c.key)}><Plus size={13} /></IconBtn>
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] leading-none m-0 mt-2" style={{ color: 'var(--color-text-tertiary)' }}>
          Drag across, double-click, or press +. Drag a row back here to remove it.
        </p>
      </div>
    </div>
  );
}

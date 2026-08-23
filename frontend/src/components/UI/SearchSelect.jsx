// ============================================================================
// SearchSelect -- a single-select you can actually type into.
//
// ThemedSelect wraps a native <select>, and a native select does NOT filter as
// you type: it only jumps on repeated first-letter presses, and only while
// focused. That is fine for six statuses and useless for fifty-one colleagues --
// the HR "link to a CRM user" picker had 51 options and read as broken, because
// typing a name did nothing visible.
//
// So: a button that opens a filtered list. Client-side filtering on an array the
// caller already has -- no endpoint, no request, no debounce to get wrong. Use
// it wherever the option count can grow with headcount; keep ThemedSelect for
// short fixed vocabularies (status, currency, method), where a native control is
// lighter and more familiar.
//
//   <SearchSelect
//     value={id} onChange={setId}
//     options={people.map(p => ({ value: p.id, label: p.name, hint: p.role }))}
//     emptyLabel="Nobody" />
//
// `emptyLabel` renders the explicit "none" choice. Omit it to force a pick.
// ============================================================================
import { useState, useRef, useEffect, useMemo } from 'react';
import { Search, ChevronDown, Check, X } from 'lucide-react';

export default function SearchSelect({
  value,
  onChange,
  options = [],
  placeholder = 'Search...',
  emptyLabel = null,
  disabled = false,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const selected = options.find(o => o.value === value) || null;

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return options;
    // Match the hint too (role, employee number) -- people search by whatever
    // they happen to remember, not only by the label.
    return options.filter(o =>
      String(o.label || '').toLowerCase().includes(term) ||
      String(o.hint || '').toLowerCase().includes(term));
  }, [options, q]);

  // Close on outside click and on Escape. Both, because a dropdown that traps
  // you inside a modal is worse than the native control it replaced.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  useEffect(() => { if (open) { setQ(''); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);

  const pick = (v) => { onChange?.(v); setOpen(false); };

  return (
    <div className={`relative ${className}`} ref={wrapRef}>
      <button type="button" disabled={disabled} onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 text-sm rounded-lg px-3 py-2 text-left"
        style={{
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          color: selected ? 'var(--color-text)' : 'var(--color-text-tertiary)',
          opacity: disabled ? 0.6 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}>
        <span className="flex-1 truncate">
          {selected ? selected.label : (emptyLabel || placeholder)}
          {selected?.hint && (
            <span className="ml-2 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{selected.hint}</span>
          )}
        </span>
        {selected && emptyLabel && (
          <span role="button" tabIndex={0} aria-label="Clear"
            onClick={e => { e.stopPropagation(); pick(''); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); pick(''); } }}>
            <X size={13} style={{ color: 'var(--color-text-tertiary)' }} />
          </span>
        )}
        <ChevronDown size={14} style={{ color: 'var(--color-text-tertiary)' }} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 mt-1 rounded-lg overflow-hidden"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.18))',
            zIndex: 60,
          }}>
          <div className="relative p-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--color-text-tertiary)' }} />
            <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
              placeholder={placeholder}
              onKeyDown={e => {
                // Enter picks the only sensible candidate rather than doing
                // nothing, and never submits the surrounding form.
                if (e.key === 'Enter') { e.preventDefault(); if (filtered.length) pick(filtered[0].value); }
              }}
              className="w-full text-sm rounded-md pl-7 pr-2 py-1.5"
              style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
          </div>

          <div className="max-h-56 overflow-y-auto py-1">
            {emptyLabel && (
              <Row label={emptyLabel} active={!value} onClick={() => pick('')} muted />
            )}
            {filtered.length === 0 ? (
              <p className="text-xs text-center py-3 m-0" style={{ color: 'var(--color-text-tertiary)' }}>
                {options.length === 0 ? 'Nothing to choose from' : `No match for "${q}"`}
              </p>
            ) : filtered.map(o => (
              <Row key={o.value} label={o.label} hint={o.hint}
                active={o.value === value} onClick={() => pick(o.value)} />
            ))}
          </div>

          {filtered.length > 0 && options.length > 12 && (
            <div className="px-3 py-1.5 text-[10px]" style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-text-tertiary)' }}>
              {filtered.length} of {options.length}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, hint, active, onClick, muted }) {
  return (
    <button type="button" onClick={onClick}
      className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm"
      style={{ background: active ? 'var(--color-bg)' : 'transparent', color: muted ? 'var(--color-text-secondary)' : 'var(--color-text)' }}>
      <span className="flex-1 truncate">
        {label}
        {hint && <span className="ml-2 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{hint}</span>}
      </span>
      {active && <Check size={14} style={{ color: 'var(--color-primary-600)' }} />}
    </button>
  );
}

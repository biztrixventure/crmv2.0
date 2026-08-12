import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, Filter as FilterIcon, ChevronDown, Check } from 'lucide-react';
import DateRangePicker, { getPresetRange } from './DateRangePicker';
import ThemedSelect from './Select';

/*
 * FilterBar — shared list-page filter chrome.
 *
 * One component used across Compliance / Manager / Staff / Admin list views
 * so search + date + status + reset behave identically everywhere. Slots
 * keep it flexible: pass pill rows, agent selects, or any custom filter
 * via the `extras` prop and they sit alongside the standard controls.
 *
 * Props:
 *   search          { value, onChange, placeholder, debounceMs=300 }
 *   dateRange       { value: {date_from, date_to}, onChange, defaultPreset }
 *   statusPills     ReactNode — rendered as a slot left of extras
 *   extras          ReactNode — slot right of the pills (agent select, etc)
 *   onClearAll      callback for the "Clear all" button. Defaults to:
 *                     search→'' , dateRange→getPresetRange(defaultPreset || 'all'),
 *                     and statusPills/extras owners hook into their own state.
 *   activeChips     [{ key, label, onRemove }] — renders below the row as
 *                     dismissable chips so the operator sees what's active.
 *   compact         boolean — drops vertical padding for embedded use.
 */
export default function FilterBar({
  search,
  dateRange,
  statusPills = null,
  extras = null,
  onClearAll,
  activeChips = null,
  compact = false,
}) {
  // Debounced search — internal local value so the input stays responsive
  // even when the parent's onChange triggers a network round-trip.
  const [localSearch, setLocalSearch] = useState(search?.value ?? '');
  const lastEmittedRef = useRef(search?.value ?? '');

  useEffect(() => {
    setLocalSearch(search?.value ?? '');
    lastEmittedRef.current = search?.value ?? '';
  }, [search?.value]);

  useEffect(() => {
    if (!search?.onChange) return;
    const t = setTimeout(() => {
      if (localSearch !== lastEmittedRef.current) {
        lastEmittedRef.current = localSearch;
        search.onChange(localSearch);
      }
    }, search?.debounceMs ?? 300);
    return () => clearTimeout(t);
  }, [localSearch, search?.onChange, search?.debounceMs]);

  const hasActiveSearch = !!(search?.value && search.value.length);
  const hasActiveDate   = !!(dateRange?.value?.date_from || dateRange?.value?.date_to);
  const anyActive       = hasActiveSearch || hasActiveDate || (activeChips?.length > 0);

  const handleClearAll = () => {
    setLocalSearch('');
    if (search?.onChange) search.onChange('');
    if (dateRange?.onChange) dateRange.onChange(getPresetRange(dateRange?.defaultPreset || 'all'));
    if (onClearAll) onClearAll();
  };

  const [focused, setFocused] = useState(false);

  return (
    <div className={`flex flex-col gap-2 ${compact ? '' : 'mb-4'}`}>
      <div className={`flex items-center gap-2.5 flex-wrap ${compact ? '' : 'rounded-2xl px-3 py-2.5'}`}
        style={compact ? undefined : { backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
        {/* Search */}
        {search && (
          <div className="relative flex-1 min-w-[220px] max-w-lg">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 transition-colors pointer-events-none"
              style={{ color: focused ? 'var(--color-primary)' : 'var(--color-text-tertiary)' }} />
            <input type="text"
              value={localSearch}
              onChange={e => setLocalSearch(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder={search?.placeholder || 'Search…'}
              className="text-sm w-full transition-all outline-none"
              style={{
                padding: '9px 34px 9px 36px', borderRadius: 999,
                backgroundColor: 'var(--color-bg-secondary)',
                border: `1px solid ${focused ? 'var(--color-primary)' : 'var(--color-border)'}`,
                boxShadow: focused ? '0 0 0 3px color-mix(in srgb, var(--color-primary) 16%, transparent)' : 'none',
                color: 'var(--color-text)',
              }}
              aria-label="Search" />
            {localSearch && (
              <button type="button" onClick={() => setLocalSearch('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-full transition-colors"
                style={{ color: 'var(--color-text-tertiary)', backgroundColor: 'var(--color-surface-hover, transparent)' }}>
                <X size={13} />
              </button>
            )}
          </div>
        )}

        {/* Status pill slot (per-page dynamic catalog) */}
        {statusPills}

        {/* Date range */}
        {dateRange && (
          <DateRangePicker
            value={dateRange.value}
            onChange={dateRange.onChange}
            defaultPreset={dateRange.defaultPreset || 'today'}
            onClear={dateRange.onClear}
          />
        )}

        {/* Extras slot (agent select etc) */}
        {extras}

        {/* Clear all — pushed to the far right */}
        {anyActive && (
          <button onClick={handleClearAll}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-semibold transition-colors ml-auto"
            style={{ color: 'var(--color-error-600, #dc2626)', border: '1px solid var(--color-error-200, #fecaca)', backgroundColor: 'color-mix(in srgb, var(--color-error-600, #dc2626) 6%, transparent)' }}>
            <X size={11} /> Clear all
          </button>
        )}
      </div>

      {/* Active-filter chip row */}
      {Array.isArray(activeChips) && activeChips.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <FilterIcon size={11} style={{ color: 'var(--color-text-tertiary)' }} />
          <span className="text-[11px] sm:text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-tertiary)' }}>
            Active
          </span>
          {activeChips.map(c => (
            <span key={c.key}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
              style={{
                backgroundColor: 'var(--color-primary-50, #eef2ff)',
                color: 'var(--color-primary-700, #4338ca)',
                border: '1px solid var(--color-primary-200, #c7d2fe)',
              }}>
              {c.label}
              {c.onRemove && (
                <button onClick={c.onRemove} aria-label={`Remove ${c.label}`}
                  className="hover:opacity-70">
                  <X size={10} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Compact pill dropdown for FilterBar `extras` — sizes to its content instead
// of the full-width `.input`, so a row of filters stays tidy. Now a fully themed
// DOM popup (ThemedSelect) so the option list + hover state follow the theme in
// dark/light/custom instead of the native OS box.
export function FilterSelect({ value, onChange, children, title, className = '', style, ...rest }) {
  return (
    <ThemedSelect
      variant="pill"
      value={value}
      onChange={onChange}
      title={title}
      className={className}
      style={{ maxWidth: 220, ...style }}
      {...rest}
    >
      {children}
    </ThemedSelect>
  );
}

// Same pill footprint as FilterSelect, but a portalled checkbox popover
// instead of a native <select> so more than one option can be active at
// once. Value is always an array (never a bare string) — [] means "all".
//   <MultiFilterSelect value={ids} onChange={setIds} options={opts}
//                       placeholder="All companies" />
export function MultiFilterSelect({
  value = [], onChange, options = [], placeholder = 'All', title, searchable, className = '', style,
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [rect, setRect] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const sel = useMemo(() => new Set(value), [value]);
  const showSearch = searchable ?? options.length > 8;

  const filtered = useMemo(() => {
    if (!q.trim()) return options;
    const s = q.trim().toLowerCase();
    return options.filter(o => String(o.label).toLowerCase().includes(s));
  }, [options, q]);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (el) setRect(el.getBoundingClientRect());
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    place();
    const onDown = (e) => {
      if (triggerRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  const toggle = (v) => onChange(sel.has(v) ? value.filter(x => x !== v) : [...value, v]);

  const triggerLabel = value.length === 0 ? placeholder
    : value.length === 1 ? (options.find(o => String(o.value) === String(value[0]))?.label ?? placeholder)
    : `${value.length} selected`;

  const menuStyle = useMemo(() => {
    if (!rect) return { display: 'none' };
    const gap = 4;
    const spaceBelow = window.innerHeight - rect.bottom;
    const above = spaceBelow < 260 && rect.top > spaceBelow;
    return {
      position: 'fixed', left: rect.left, minWidth: Math.max(rect.width, 200), maxWidth: 280,
      [above ? 'bottom' : 'top']: above ? window.innerHeight - rect.top + gap : rect.bottom + gap,
      maxHeight: Math.min(280, (above ? rect.top : spaceBelow) - 12),
    };
  }, [rect]);

  return (
    <>
      <button type="button" ref={triggerRef} title={title} className={className}
        aria-haspopup="listbox" aria-expanded={open}
        onClick={() => (open ? setOpen(false) : (place(), setOpen(true)))}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: 'auto', maxWidth: 220,
          padding: '8px 12px', borderRadius: 999, cursor: 'pointer', textAlign: 'left', outline: 'none',
          backgroundColor: value.length ? 'color-mix(in srgb, var(--color-primary) 12%, var(--color-bg-secondary))' : 'var(--color-bg-secondary)',
          border: `1px solid ${value.length ? 'var(--color-primary)' : 'var(--color-border)'}`,
          fontSize: 14, fontWeight: 500, color: 'var(--color-text)',
          ...style,
        }}>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: value.length ? 'var(--color-text)' : 'var(--color-placeholder)' }}>
          {triggerLabel}
        </span>
        <ChevronDown size={16} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0, transition: 'transform .15s', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>

      {open && createPortal(
        <div ref={menuRef} role="listbox" style={{
          ...menuStyle, zIndex: 10000, background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderRadius: 12, boxShadow: 'var(--shadow-lg)', overflowY: 'auto', padding: 4,
        }}>
          {value.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '2px 6px 6px' }}>
              <button type="button" onClick={() => onChange([])}
                style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>
                Clear
              </button>
            </div>
          )}
          {showSearch && (
            <div style={{ position: 'sticky', top: -4, background: 'var(--color-surface)', padding: '2px 2px 6px', margin: '-4px -4px 2px', borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ position: 'relative' }}>
                <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)', pointerEvents: 'none' }} />
                <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search…"
                  style={{ width: '100%', padding: '7px 10px 7px 28px', fontSize: 13, borderRadius: 8, outline: 'none',
                    background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
              </div>
            </div>
          )}
          {filtered.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--color-text-tertiary)' }}>No matches</div>
          )}
          {filtered.map((o) => {
            const on = sel.has(o.value);
            return (
              <div key={o.value} role="option" aria-selected={on}
                onMouseDown={(e) => { e.preventDefault(); toggle(o.value); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, fontSize: 14, cursor: 'pointer',
                  color: 'var(--color-text)', fontWeight: on ? 600 : 400,
                  background: on ? 'color-mix(in srgb, var(--color-primary) 9%, transparent)' : 'transparent',
                }}>
                <span style={{
                  width: 16, height: 16, borderRadius: 4, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  border: `1px solid ${on ? 'var(--color-primary)' : 'var(--color-border)'}`, background: on ? 'var(--color-primary)' : 'transparent',
                }}>
                  {on && <Check size={11} style={{ color: 'var(--color-surface)' }} />}
                </span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

import { useState, useEffect, useRef } from 'react';
import { Search, X, Filter as FilterIcon } from 'lucide-react';
import DateRangePicker, { getPresetRange } from './DateRangePicker';

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
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-tertiary)' }}>
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
// of the full-width `.input`, so a row of filters stays tidy. Themed via vars.
export function FilterSelect({ value, onChange, children, title, className = '', ...rest }) {
  return (
    <select
      value={value}
      onChange={onChange}
      title={title}
      className={`text-sm font-medium outline-none cursor-pointer transition-colors ${className}`}
      style={{
        padding: '8px 30px 8px 12px', borderRadius: 999,
        backgroundColor: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-text)',
        // custom chevron so it reads as a pill, not an OS box
        appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
        maxWidth: 200,
      }}
      {...rest}>
      {children}
    </select>
  );
}

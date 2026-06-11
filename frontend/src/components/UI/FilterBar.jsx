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

  return (
    <div className={`flex flex-col gap-2 ${compact ? '' : 'mb-3'}`}>
      <div className="flex items-center gap-2 flex-wrap">
        {/* Search */}
        {search && (
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--color-text-tertiary)' }} />
            <input type="text"
              value={localSearch}
              onChange={e => setLocalSearch(e.target.value)}
              placeholder={search?.placeholder || 'Search…'}
              className="input text-sm py-1.5 pl-8 pr-8 w-full"
              style={{ borderColor: 'var(--color-border)' }}
              aria-label="Search" />
            {localSearch && (
              <button type="button" onClick={() => setLocalSearch('')}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-bg-secondary"
                style={{ color: 'var(--color-text-tertiary)' }}>
                <X size={12} />
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

        {/* Clear all */}
        {anyActive && (
          <button onClick={handleClearAll}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors hover:bg-error-50"
            style={{ color: 'var(--color-error-600, #dc2626)', border: '1px solid var(--color-error-200, #fecaca)' }}>
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

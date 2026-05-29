import { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronDown, Check, AlertCircle } from 'lucide-react';

// VehicleSelect — typeahead with keyboard nav for car make / model. Free-text
// is allowed (Enter without a highlighted match commits the typed value) so
// fronters and closers can still enter cars the registry doesn't know about,
// without breaking the form. The dropdown filters live as the user types and
// arrow keys move highlight; Enter commits.
//
// Modes:
//   'make'  → options = makes
//   'model' → options = models of the active make (passed in via `models`)
//
// `value` is the currently committed string; the parent owns it. Empty model
// list is allowed; we render a friendly "pick a make first" hint instead of
// blocking input so backfill flows still work.
const VehicleSelect = ({ value = '', onChange, mode = 'make', makes = [], models = [], requireMake = false, placeholder, disabled = false }) => {
  const [q, setQ]       = useState(value || '');
  const [open, setOpen] = useState(false);
  const [hi, setHi]     = useState(0);     // highlighted index in filtered list
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  // Keep the input in sync if the parent resets/programmatically updates.
  useEffect(() => { setQ(value || ''); }, [value]);

  // Close on outside click — listen at the document level only while open so
  // we don't pay for handlers on every keystroke globally.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const baseOptions = mode === 'make' ? makes : models;
  // Filter is case-insensitive and matches on substring so "cam" hits both
  // "Camry" and "Maxima Camry". Limit to 50 to keep the DOM cheap on big lists.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = (baseOptions || []).map(o => typeof o === 'string' ? o : o.name);
    if (!needle) return base.slice(0, 50);
    return base.filter(n => n && n.toLowerCase().includes(needle)).slice(0, 50);
  }, [q, baseOptions]);

  // Clamp the highlight when the filtered list shrinks under it.
  useEffect(() => { if (hi >= filtered.length) setHi(0); }, [filtered.length, hi]);

  const commit = (val) => {
    const trimmed = (val || '').trim();
    setQ(trimmed);
    setOpen(false);
    if (onChange) onChange(trimmed);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi(i => Math.min(filtered.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setHi(i => Math.max(0, i - 1)); }
    else if (e.key === 'Enter')     {
      e.preventDefault();
      // Enter commits the highlighted match if there is one, else the typed
      // text as-is. Empty input falls through and clears the field.
      commit(filtered[hi] != null && filtered.length > 0 ? filtered[hi] : q);
    }
    else if (e.key === 'Escape')    { setOpen(false); }
  };

  const noMake = mode === 'model' && requireMake && (!models || models.length === 0);

  return (
    <div className="relative" ref={wrapRef}>
      <input
        ref={inputRef}
        type="text"
        value={q}
        disabled={disabled}
        onChange={e => { setQ(e.target.value); setOpen(true); setHi(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { /* commit on blur so the field reflects the typed value even without Enter */ setTimeout(() => onChange?.(q.trim()), 100); }}
        onKeyDown={onKeyDown}
        placeholder={placeholder || (mode === 'make' ? 'Type a make…' : noMake ? 'Pick a make first' : 'Type a model…')}
        className="input pr-8"
        autoComplete="off"
      />
      <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-text-tertiary)' }} />

      {open && !disabled && (
        <div className="absolute z-30 left-0 right-0 mt-1 rounded-lg overflow-hidden shadow-lg"
          style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', maxHeight: 240, overflowY: 'auto' }}>
          {noMake ? (
            <div className="px-3 py-2 text-xs flex items-center gap-1.5" style={{ color: 'var(--color-warning-700)' }}>
              <AlertCircle size={12} /> Pick a make before choosing a model.
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs italic" style={{ color: 'var(--color-text-tertiary)' }}>
              No matches. Press Enter to use “{q}” anyway.
            </div>
          ) : (
            filtered.map((opt, idx) => (
              <button key={opt} type="button"
                onMouseDown={(e) => { e.preventDefault(); commit(opt); }}
                onMouseEnter={() => setHi(idx)}
                className="w-full flex items-center justify-between text-left px-3 py-1.5 text-sm transition-colors"
                style={{
                  backgroundColor: idx === hi ? 'var(--color-primary-50)' : 'transparent',
                  color: 'var(--color-text)',
                }}>
                <span>{opt}</span>
                {opt === value && <Check size={12} style={{ color: 'var(--color-primary-600)' }} />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default VehicleSelect;

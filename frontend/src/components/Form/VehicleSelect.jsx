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
// `strict` enforces registry-only values: Enter without a highlighted match
// won't commit free text, on-blur won't propagate a typed value that doesn't
// resolve to a real option, and the "Press Enter to use …" hint flips to a
// red "no matches" warning. Use on customer-facing forms so reports group on
// clean values; leave off (default) anywhere a hand-typed fallback is needed.
const VehicleSelect = ({ value = '', onChange, mode = 'make', makes = [], models = [], requireMake = false, placeholder, disabled = false, strict = false }) => {
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
  // Filter is case-insensitive. Prefix matches show first ("H" → Honda,
  // Hyundai), then substring matches as a fallback ("amry" still finds
  // Camry) — gives the spec'd "starts with" behavior without trapping a
  // user who remembers a model by its tail. Cap at 50 so the DOM stays
  // light on big registries.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = (baseOptions || []).map(o => typeof o === 'string' ? o : o.name).filter(Boolean);
    if (!needle) return base.slice(0, 50);
    const prefix = [], rest = [];
    base.forEach(n => {
      const lc = n.toLowerCase();
      if (lc.startsWith(needle)) prefix.push(n);
      else if (lc.includes(needle)) rest.push(n);
    });
    return [...prefix, ...rest].slice(0, 50);
  }, [q, baseOptions]);

  // Clamp the highlight when the filtered list shrinks under it.
  useEffect(() => { if (hi >= filtered.length) setHi(0); }, [filtered.length, hi]);

  // Case-insensitive lookup against the registry — used by both the strict
  // commit path and the Check-mark match in the dropdown.
  const matchInRegistry = (val) => {
    const needle = String(val || '').trim().toLowerCase();
    if (!needle) return '';
    const base = (baseOptions || []).map(o => typeof o === 'string' ? o : o.name);
    const hit = base.find(n => n && n.toLowerCase() === needle);
    return hit || '';
  };

  const commit = (val) => {
    const trimmed = (val || '').trim();
    // Strict: only accept a value that resolves to a registry entry, otherwise
    // snap back to the last committed value (or clear). Prevents typos from
    // landing in the DB and breaking cascading scopes downstream.
    if (strict && trimmed) {
      const canonical = matchInRegistry(trimmed);
      if (!canonical) { setQ(value || ''); setOpen(false); return; }
      setQ(canonical);
      setOpen(false);
      if (onChange) onChange(canonical);
      return;
    }
    setQ(trimmed);
    setOpen(false);
    if (onChange) onChange(trimmed);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi(i => Math.min(filtered.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setHi(i => Math.max(0, i - 1)); }
    else if (e.key === 'Enter')     {
      e.preventDefault();
      // Strict: only the highlighted match counts; free text is rejected.
      // Loose: Enter commits highlight if present, else the typed text as-is.
      if (strict) {
        if (filtered[hi] != null && filtered.length > 0) commit(filtered[hi]);
        // else no-op — the dropdown's no-match warning tells the user why
      } else {
        commit(filtered[hi] != null && filtered.length > 0 ? filtered[hi] : q);
      }
    }
    else if (e.key === 'Escape')    { setOpen(false); }
  };

  const noMake = mode === 'model' && requireMake && (!models || models.length === 0);

  // Empty registry vs no-typed-match: separate cases so the message is
  // actually useful. baseOptions is what we'd show if the user cleared the
  // query — if it's empty, the registry itself is empty.
  const registryEmpty = (baseOptions || []).length === 0 && !noMake;

  return (
    <div className="relative" ref={wrapRef}>
      <input
        ref={inputRef}
        type="text"
        value={q}
        disabled={disabled}
        onChange={e => { setQ(e.target.value); setOpen(true); setHi(0); }}
        onFocus={() => setOpen(true)}
        // Mouse down on an already-focused input doesn't refire onFocus, so
        // click again wouldn't reopen the dropdown. Force-open on every click
        // so the field always behaves like a real dropdown trigger.
        onMouseDown={() => setOpen(true)}
        onBlur={() => {
          // Defer so a click on an option's onMouseDown can commit first.
          // Strict mode runs the typed value through matchInRegistry — bad
          // input snaps back to the last committed value via commit().
          setTimeout(() => {
            if (strict) commit(q);
            else onChange?.(q.trim());
          }, 100);
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder || (mode === 'make' ? 'Type a make…' : noMake ? 'Pick a make first' : 'Type a model…')}
        className="input pr-8"
        autoComplete="off"
        aria-haspopup="listbox"
        aria-expanded={open}
      />
      {/* Chevron is now a real click-target so users can toggle the dropdown
          without typing — matches the affordance of a native <select>. */}
      <button type="button" tabIndex={-1} disabled={disabled}
        onMouseDown={(e) => { e.preventDefault(); setOpen(o => !o); inputRef.current?.focus(); }}
        className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-bg-secondary"
        style={{ color: 'var(--color-text-tertiary)' }}>
        <ChevronDown size={14} />
      </button>

      {open && !disabled && (
        // z-[60] beats the z-50 modal backdrop so the dropdown isn't clipped
        // by a sibling field card or another control's stacking context.
        <div className="absolute z-[60] left-0 right-0 mt-1 rounded-lg overflow-hidden shadow-lg"
          style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', maxHeight: 240, overflowY: 'auto' }}>
          {noMake ? (
            <div className="px-3 py-2 text-xs flex items-center gap-1.5" style={{ color: 'var(--color-warning-700)' }}>
              <AlertCircle size={12} /> Pick a make before choosing a model.
            </div>
          ) : registryEmpty ? (
            <div className="px-3 py-2 text-xs flex items-center gap-1.5" style={{ color: 'var(--color-warning-700)' }}>
              <AlertCircle size={12} /> No {mode}s configured yet. Ask an admin to add them under Admin → Vehicles.
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs flex items-center gap-1.5"
              style={{ color: strict ? 'var(--color-error-600)' : 'var(--color-text-tertiary)' }}>
              {strict
                ? <><AlertCircle size={12} /> Not in the {mode} registry. Add it under Admin → Vehicles first.</>
                : <span className="italic">No matches. Press Enter to use “{q}” anyway.</span>}
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

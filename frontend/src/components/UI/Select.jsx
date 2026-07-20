import {
  useState, useRef, useEffect, useMemo, useCallback,
  Children, isValidElement,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';

// ============================================================================
// ThemedSelect — a fully theme-driven <select> replacement.
//
// Native <select> renders its option popup + hover highlight with OS chrome
// that ignores our CSS vars (white popup / blue highlight in dark mode). This
// draws the whole thing in the DOM so it follows the active theme (light, dark,
// and any Appearance preset) with a visible hover state in every mode.
//
// Drop-in for native <select>: it accepts the same `value`/`defaultValue`,
// `onChange` (called with an event-shaped { target: { value, name } } so
// existing `e.target.value` handlers keep working), `disabled`, `name`, and
// `<option>`/`<optgroup>` children. So `<select>` → `<ThemedSelect>` (+ import)
// is all a call site needs.
//
// Variants: 'input' (default — matches the .input field look) | 'pill'
// (compact rounded pill for filter bars) | 'bare'.
// ============================================================================

// Flatten children (arrays, fragments, conditionals) into option descriptors.
function collectOptions(children, out = []) {
  Children.toArray(children).forEach((child) => {
    if (!isValidElement(child)) return;
    if (child.type === 'option') {
      const hasVal = child.props.value !== undefined;
      const label = child.props.children;
      out.push({
        value: hasVal ? child.props.value : (typeof label === 'string' || typeof label === 'number' ? label : ''),
        label,
        disabled: !!child.props.disabled,
      });
    } else if (child.type === 'optgroup') {
      out.push({ group: child.props.label });
      collectOptions(child.props.children, out);
    }
  });
  return out;
}

const labelText = (label, value) => {
  if (typeof label === 'string' || typeof label === 'number') return String(label);
  return String(value ?? '');
};

const TRIGGER_BASE = {
  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
  cursor: 'pointer', textAlign: 'left', outline: 'none',
  color: 'var(--color-text)', transition: 'border-color .15s, box-shadow .15s',
};

const variantStyle = (variant) => {
  if (variant === 'pill') {
    return {
      ...TRIGGER_BASE, width: 'auto',
      padding: '8px 12px', borderRadius: 999,
      backgroundColor: 'var(--color-bg-secondary)',
      border: '1px solid var(--color-border)',
      fontSize: 14, fontWeight: 500,
    };
  }
  if (variant === 'bare') {
    return { ...TRIGGER_BASE, padding: '4px 6px', background: 'transparent', border: 'none' };
  }
  // input (default)
  return {
    ...TRIGGER_BASE,
    padding: '8px 12px', borderRadius: 12,
    backgroundColor: 'var(--color-bg)',
    border: '1px solid var(--color-border)',
    fontSize: 14,
  };
};

export default function ThemedSelect({
  value,
  defaultValue,
  onChange,
  children,
  options: optionsProp,
  placeholder = 'Select…',
  variant = 'input',
  disabled = false,
  name,
  title,
  searchable,               // force search box; auto when > 10 options
  className = '',
  style,
  menuMaxHeight = 280,
  'aria-label': ariaLabel,
  ...rest
}) {
  const options = useMemo(
    () => (Array.isArray(optionsProp) ? optionsProp : collectOptions(children)),
    [optionsProp, children],
  );
  const selectable = options.filter((o) => !o.group);

  // Uncontrolled fallback so `defaultValue`-style native selects keep working.
  const isControlled = value !== undefined;
  const [innerValue, setInnerValue] = useState(defaultValue);
  const current = isControlled ? value : innerValue;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(-1);
  const [rect, setRect] = useState(null);

  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const searchRef = useRef(null);

  const showSearch = searchable ?? selectable.length > 10;

  const selected = selectable.find((o) => String(o.value) === String(current));
  const triggerLabel = selected ? selected.label : placeholder;

  const filtered = useMemo(() => {
    if (!query) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.group || labelText(o.label, o.value).toLowerCase().includes(q));
  }, [options, query]);
  const filteredSelectable = filtered.filter((o) => !o.group);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    setRect(el.getBoundingClientRect());
  }, []);

  const openMenu = useCallback(() => {
    if (disabled) return;
    place();
    setOpen(true);
    setQuery('');
    const idx = filteredSelectable.findIndex((o) => String(o.value) === String(current));
    setActiveIdx(idx);
  }, [disabled, place, current, filteredSelectable]);

  const closeMenu = useCallback(() => { setOpen(false); setActiveIdx(-1); }, []);

  const commit = useCallback((opt) => {
    if (!opt || opt.disabled || opt.group) return;
    if (!isControlled) setInnerValue(opt.value);
    onChange?.({ target: { value: opt.value, name } });
    closeMenu();
    triggerRef.current?.focus();
  }, [isControlled, onChange, name, closeMenu]);

  // Reposition while open; close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onScroll = () => place();
    const onDown = (e) => {
      if (triggerRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      closeMenu();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    document.addEventListener('mousedown', onDown);
    if (showSearch) requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, place, closeMenu, showSearch]);

  const onKeyDown = (e) => {
    if (disabled) return;
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); openMenu(); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(); return; }
    if (e.key === 'Enter') { e.preventDefault(); commit(filteredSelectable[activeIdx]); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      let i = activeIdx;
      for (let n = 0; n < filteredSelectable.length; n++) {
        i = (i + dir + filteredSelectable.length) % filteredSelectable.length;
        if (!filteredSelectable[i].disabled) break;
      }
      setActiveIdx(i);
    }
  };

  // Menu geometry — fixed to the viewport so parent overflow never clips it.
  const menuStyle = useMemo(() => {
    if (!rect) return { display: 'none' };
    const gap = 4;
    const spaceBelow = window.innerHeight - rect.bottom;
    const above = spaceBelow < 240 && rect.top > spaceBelow;
    const maxH = Math.min(menuMaxHeight, (above ? rect.top : spaceBelow) - 12);
    return {
      position: 'fixed',
      left: rect.left,
      minWidth: rect.width,
      maxWidth: Math.max(rect.width, 320),
      [above ? 'bottom' : 'top']: above ? window.innerHeight - rect.top + gap : rect.bottom + gap,
      maxHeight: maxH,
    };
  }, [rect, menuMaxHeight]);

  let selIdx = -1; // running index into selectable items (for active highlight)

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        title={title}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={onKeyDown}
        className={className}
        style={{
          ...variantStyle(variant),
          opacity: disabled ? 0.6 : 1,
          ...(open ? { borderColor: 'var(--color-primary)', boxShadow: '0 0 0 3px color-mix(in srgb, var(--color-primary) 16%, transparent)' } : null),
          ...style,
        }}
        {...rest}
      >
        <span style={{
          flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          color: selected ? 'var(--color-text)' : 'var(--color-placeholder)',
        }}>
          {triggerLabel}
        </span>
        <ChevronDown size={16} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0, transition: 'transform .15s', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          style={{
            ...menuStyle,
            zIndex: 10000,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 12,
            boxShadow: 'var(--shadow-lg)',
            overflowY: 'auto',
            padding: 4,
          }}
        >
          {showSearch && (
            <div style={{ position: 'sticky', top: -4, background: 'var(--color-surface)', padding: '2px 2px 6px', margin: '-4px -4px 2px', borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ position: 'relative' }}>
                <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)', pointerEvents: 'none' }} />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
                  onKeyDown={onKeyDown}
                  placeholder="Search…"
                  style={{
                    width: '100%', padding: '7px 10px 7px 28px', fontSize: 13,
                    borderRadius: 8, outline: 'none',
                    background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                />
              </div>
            </div>
          )}

          {filtered.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--color-text-tertiary)' }}>No matches</div>
          )}

          {filtered.map((opt, i) => {
            if (opt.group) {
              return (
                <div key={`g${i}`} style={{ padding: '8px 10px 4px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--color-text-tertiary)' }}>
                  {opt.group}
                </div>
              );
            }
            selIdx += 1;
            const isSel = String(opt.value) === String(current);
            const isActive = selIdx === activeIdx;
            const idxForThis = selIdx;
            return (
              <div
                key={`o${i}`}
                role="option"
                aria-selected={isSel}
                onMouseEnter={() => setActiveIdx(idxForThis)}
                onMouseDown={(e) => { e.preventDefault(); commit(opt); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 10px', borderRadius: 8, fontSize: 14,
                  cursor: opt.disabled ? 'not-allowed' : 'pointer',
                  opacity: opt.disabled ? 0.5 : 1,
                  color: 'var(--color-text)',
                  fontWeight: isSel ? 600 : 400,
                  background: isActive
                    ? 'color-mix(in srgb, var(--color-primary) 16%, transparent)'
                    : isSel
                      ? 'color-mix(in srgb, var(--color-primary) 9%, transparent)'
                      : 'transparent',
                }}
              >
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt.label}</span>
                {isSel && <Check size={15} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />}
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

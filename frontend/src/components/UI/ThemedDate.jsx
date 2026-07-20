import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';

// ============================================================================
// ThemedDate — a fully theme-driven replacement for native <input type="date">
// and <input type="datetime-local">.
//
// The native date input opens the browser's OS calendar popup, which ignores
// our CSS vars (and never matches a custom Appearance theme). This draws a
// themed month grid in a portal instead — same rounded look as the rest of the
// CRM, in light / dark / custom.
//
// Drop-in: same value ("YYYY-MM-DD" or, with `withTime`, "YYYY-MM-DDTHH:mm"),
// onChange (called with an event-shaped { target: { value, name } } so existing
// `e.target.value` handlers keep working), min, max, disabled, name. Pass
// `withTime` for the datetime-local case (adds a time field to the popup).
// ============================================================================

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WEEKDAYS = ['S','M','T','W','T','F','S'];

function buildMonthMatrix(year, monthIdx) {
  const startDow = new Date(year, monthIdx, 1).getDay();
  const days = new Date(year, monthIdx + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
const isoOf = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

const fmt = (datePart, timePart, withTime) => {
  if (!datePart) return '';
  const [y, m, d] = datePart.split('-');
  const base = `${MON[parseInt(m, 10) - 1]} ${parseInt(d, 10)}, ${y}`;
  return withTime && timePart ? `${base} ${timePart}` : base;
};

export default function ThemedDate({
  value,
  onChange,
  withTime = false,
  min,
  max,
  disabled = false,
  name,
  placeholder,
  title,
  className = '',
  style,
  'aria-label': ariaLabel,
  ...rest
}) {
  const datePart = (value || '').slice(0, 10);
  const timePart = withTime ? ((value || '').slice(11, 16) || '') : '';
  const minDate = (min || '').slice(0, 10);
  const maxDate = (max || '').slice(0, 10);

  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const today = useMemo(() => { const n = new Date(); return isoOf(n.getFullYear(), n.getMonth(), n.getDate()); }, []);

  const [calY, setCalY] = useState(() => parseInt((datePart || today).slice(0, 4), 10));
  const [calM, setCalM] = useState(() => parseInt((datePart || today).slice(5, 7), 10) - 1);

  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (el) setRect(el.getBoundingClientRect());
  }, []);

  const openMenu = useCallback(() => {
    if (disabled) return;
    const anchor = datePart || today;
    setCalY(parseInt(anchor.slice(0, 4), 10));
    setCalM(parseInt(anchor.slice(5, 7), 10) - 1);
    place();
    setOpen(true);
  }, [disabled, datePart, today, place]);

  const closeMenu = useCallback(() => setOpen(false), []);

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
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, place, closeMenu]);

  const emit = (nextDate, nextTime) => {
    const v = withTime
      ? (nextDate ? `${nextDate}T${nextTime || '00:00'}` : '')
      : (nextDate || '');
    onChange?.({ target: { value: v, name } });
  };

  const pickDay = (iso) => {
    if (minDate && iso < minDate) return;
    if (maxDate && iso > maxDate) return;
    emit(iso, timePart);
    if (!withTime) closeMenu();
  };

  const goMonth = (delta) => {
    let m = calM + delta, y = calY;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setCalM(m); setCalY(y);
  };

  const menuStyle = useMemo(() => {
    if (!rect) return { display: 'none' };
    const gap = 4;
    const w = 268;
    const spaceBelow = window.innerHeight - rect.bottom;
    const above = spaceBelow < 360 && rect.top > spaceBelow;
    let left = rect.left;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    if (left < 8) left = 8;
    return {
      position: 'fixed', left, width: w,
      [above ? 'bottom' : 'top']: above ? window.innerHeight - rect.top + gap : rect.bottom + gap,
    };
  }, [rect]);

  const hasVal = !!datePart;

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        title={title}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? closeMenu() : openMenu())}
        className={className}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          cursor: 'pointer', textAlign: 'left', outline: 'none',
          padding: '8px 12px', borderRadius: 8, fontSize: 14,
          backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)',
          color: hasVal ? 'var(--color-text)' : 'var(--color-placeholder)',
          opacity: disabled ? 0.6 : 1,
          ...(open ? { borderColor: 'var(--color-primary)', boxShadow: '0 0 0 3px color-mix(in srgb, var(--color-primary) 16%, transparent)' } : null),
          ...style,
        }}
        {...rest}
      >
        <Calendar size={15} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {hasVal ? fmt(datePart, timePart, withTime) : (placeholder || (withTime ? 'Pick date & time' : 'Pick a date'))}
        </span>
        {hasVal && !disabled && (
          <X size={14} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }}
            onClick={(e) => { e.stopPropagation(); emit('', ''); }} />
        )}
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          role="dialog"
          style={{
            ...menuStyle, zIndex: 10000,
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: 16, boxShadow: 'var(--shadow-lg)', padding: 10,
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => goMonth(-1)}
              className="p-1 rounded-md" style={{ color: 'var(--color-text-secondary)' }}><ChevronLeft size={16} /></button>
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{MONTHS[calM]} {calY}</span>
            <button type="button" onClick={() => goMonth(1)}
              className="p-1 rounded-md" style={{ color: 'var(--color-text-secondary)' }}><ChevronRight size={16} /></button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 mb-0.5">
            {WEEKDAYS.map((w, i) => (
              <div key={i} className="text-center text-[10px] font-bold py-0.5" style={{ color: 'var(--color-text-tertiary)' }}>{w}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {buildMonthMatrix(calY, calM).map((d, i) => {
              if (d === null) return <div key={i} />;
              const iso = isoOf(calY, calM, d);
              const disabledDay = (minDate && iso < minDate) || (maxDate && iso > maxDate);
              const isSel = iso === datePart;
              const isToday = iso === today;
              return (
                <button key={i} type="button" disabled={disabledDay}
                  onClick={() => pickDay(iso)}
                  className="h-8 text-xs rounded-md transition-colors flex items-center justify-center"
                  style={{
                    backgroundColor: isSel ? 'var(--color-primary-600)' : 'transparent',
                    color: isSel ? '#fff' : 'var(--color-text)',
                    fontWeight: (isSel || isToday) ? 700 : 400,
                    opacity: disabledDay ? 0.3 : 1,
                    cursor: disabledDay ? 'not-allowed' : 'pointer',
                    border: (isToday && !isSel) ? '1px solid var(--color-primary-400)' : '1px solid transparent',
                  }}>
                  {d}
                </button>
              );
            })}
          </div>

          {withTime && (
            <div className="flex items-center gap-2 mt-2.5 pt-2.5" style={{ borderTop: '1px solid var(--color-border)' }}>
              <span className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Time</span>
              <input
                type="time"
                value={timePart}
                onChange={(e) => emit(datePart || today, e.target.value)}
                className="flex-1 px-2 py-1.5 text-sm rounded-lg outline-none"
                style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>
          )}

          <div className="flex items-center justify-between mt-2.5 pt-2 gap-2" style={{ borderTop: withTime ? 'none' : '1px solid var(--color-border)' }}>
            <button type="button" onClick={() => { emit(today, timePart || '00:00'); if (!withTime) closeMenu(); }}
              className="text-xs font-semibold px-2 py-1 rounded-md" style={{ color: 'var(--color-primary-600)' }}>Today</button>
            <button type="button" onClick={closeMenu}
              className="text-xs font-semibold px-2 py-1 rounded-md" style={{ color: 'var(--color-text-secondary)' }}>Done</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

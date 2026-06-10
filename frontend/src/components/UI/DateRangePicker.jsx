import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronDown, X } from 'lucide-react';
import { todayET } from '../../utils/timezone';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Calendar-month range [first day, last day] as YYYY-MM-DD strings. Honors
// February + leap years via Date(y, m+1, 0).getDate(). Never returns a future
// "to" beyond todayET so picking the current month doesn't reach into days
// that haven't happened yet.
export function monthRange(year, monthIdx /* 0-11 */) {
  const today = todayET();
  const last = new Date(year, monthIdx + 1, 0).getDate();
  const from = `${year}-${String(monthIdx + 1).padStart(2, '0')}-01`;
  const to   = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return { date_from: from, date_to: to > today ? today : to };
}

const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'week',  label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: '7d',    label: 'Last 7 days' },
  { key: '30d',   label: 'Last 30 days' },
  { key: '3m',    label: 'Last 3 months' },
  { key: 'year',  label: 'This year' },
  { key: 'all',   label: 'All time' },
];

export function getPresetRange(key = 'today') {
  const today = todayET();
  // Use noon UTC of today to avoid DST edge cases when subtracting days/months
  const base = new Date(today + 'T12:00:00Z');
  switch (key) {
    case 'today': return { date_from: today, date_to: today };
    case 'week': {
      // ISO week (Mon → today). Noon-UTC base keeps the day index stable across DST.
      const d = new Date(base);
      const dow = d.getUTCDay();         // 0 = Sun … 6 = Sat
      const back = dow === 0 ? 6 : dow - 1;
      d.setUTCDate(d.getUTCDate() - back);
      return { date_from: d.toISOString().split('T')[0], date_to: today };
    }
    case 'month': {
      // First day of this calendar month → today.
      return { date_from: `${today.slice(0, 7)}-01`, date_to: today };
    }
    case '7d': {
      const d = new Date(base); d.setUTCDate(d.getUTCDate() - 7);
      return { date_from: d.toISOString().split('T')[0], date_to: today };
    }
    case '30d': {
      const d = new Date(base); d.setUTCDate(d.getUTCDate() - 30);
      return { date_from: d.toISOString().split('T')[0], date_to: today };
    }
    case '3m': {
      const d = new Date(base); d.setUTCMonth(d.getUTCMonth() - 3);
      return { date_from: d.toISOString().split('T')[0], date_to: today };
    }
    case 'year':
      return { date_from: `${today.slice(0, 4)}-01-01`, date_to: today };
    case 'all':
    default:
      return { date_from: null, date_to: null };
  }
}

function fmtDate(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${mo[parseInt(m,10)-1]} ${parseInt(d,10)}`;
}

function matchPreset(range) {
  if (!range || (!range.date_from && !range.date_to)) return 'all';
  for (const p of PRESETS) {
    if (p.key === 'all') continue;
    const r = getPresetRange(p.key);
    if (r.date_from === range.date_from && r.date_to === range.date_to) return p.key;
  }
  return null;
}

// value prop (optional): { date_from, date_to } — when set externally, syncs the picker label
const DateRangePicker = ({ onChange, defaultPreset = 'today', value, onClear }) => {
  const [open, setOpen]             = useState(false);
  const [preset, setPreset]         = useState(defaultPreset);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo,   setCustomTo]   = useState('');
  const [isCustom,   setIsCustom]   = useState(false);
  // Month picker — defaults to current calendar month in ET.
  const _t = todayET();
  const [monthYear, setMonthYear] = useState(parseInt(_t.slice(0, 4), 10));
  const [monthIdx,  setMonthIdx]  = useState(parseInt(_t.slice(5, 7), 10) - 1);
  const ref      = useRef(null);
  const btnRef   = useRef(null);
  const popRef   = useRef(null);
  // Portal popover position — recomputed on open + resize + scroll so the
  // panel never gets clipped by an ancestor with overflow:hidden (shells
  // wrap header rows in Cards / overflow-x-auto strips). Flips above the
  // button when there's not enough room below the viewport.
  const [popPos, setPopPos] = useState({ top: 0, left: 0, maxH: 0, ready: false });

  const recalcPosition = () => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin   = 8;
    const popW     = 240;   // matches w-60
    const desiredH = popRef.current?.scrollHeight || 480;

    const spaceBelow = vh - r.bottom - margin;
    const spaceAbove = r.top - margin;
    const placeAbove = spaceBelow < Math.min(desiredH, 320) && spaceAbove > spaceBelow;
    const maxH       = Math.max(160, (placeAbove ? spaceAbove : spaceBelow));

    // Right-align to button right edge; clamp to viewport horizontally.
    let left = r.right - popW;
    if (left < margin) left = margin;
    if (left + popW > vw - margin) left = vw - popW - margin;

    const top = placeAbove ? Math.max(margin, r.top - margin - Math.min(desiredH, maxH)) : r.bottom + 4;
    setPopPos({ top, left, maxH, ready: true });
  };

  useLayoutEffect(() => {
    if (!open) { setPopPos(p => ({ ...p, ready: false })); return; }
    recalcPosition();
    const onResize = () => recalcPosition();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [open]);

  // Sync display when value changes externally (e.g. MiniCalendar click)
  useEffect(() => {
    if (value === undefined) return;
    const matched = matchPreset(value);
    if (matched) {
      setPreset(matched); setIsCustom(false);
    } else if (value?.date_from || value?.date_to) {
      setCustomFrom(value.date_from || '');
      setCustomTo(value.date_to || '');
      setIsCustom(true);
    }
  }, [value?.date_from, value?.date_to]); // eslint-disable-line

  useEffect(() => {
    const handler = e => {
      const inAnchor = ref.current && ref.current.contains(e.target);
      const inPopover = popRef.current && popRef.current.contains(e.target);
      if (!inAnchor && !inPopover) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectPreset = (key) => {
    setPreset(key); setIsCustom(false);
    onChange(getPresetRange(key));
    setOpen(false);
  };

  const applyCustom = () => {
    if (!customFrom && !customTo) return;
    setIsCustom(true);
    onChange({ date_from: customFrom || null, date_to: customTo || null });
    setOpen(false);
  };

  // Month select: range = whole calendar month (clamped to today for the
  // current month). Custom-from/custom-to inputs pre-fill to the month bounds
  // so the user can fine-tune within that month without leaving the popover.
  const selectMonth = (y, m) => {
    const r = monthRange(y, m);
    setCustomFrom(r.date_from);
    setCustomTo(r.date_to);
    setIsCustom(true);
    setPreset('');
    onChange(r);
    setOpen(false);
  };

  const handleClear = () => {
    setIsCustom(false);
    setCustomFrom(''); setCustomTo('');
    setPreset(defaultPreset);
    onChange(getPresetRange(defaultPreset));
    if (onClear) onClear();
    setOpen(false);
  };

  const label = isCustom
    ? (customFrom && customTo
        ? `${fmtDate(customFrom)} – ${fmtDate(customTo)}`
        : customFrom ? fmtDate(customFrom) : 'Custom range')
    : (PRESETS.find(p => p.key === preset)?.label ?? 'Today');

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors"
        style={{
          borderColor:     'var(--color-border)',
          backgroundColor: 'var(--color-surface)',
          color:           'var(--color-text)',
        }}
      >
        <Calendar size={14} style={{ color: 'var(--color-primary-500)', flexShrink: 0 }} />
        <span className="whitespace-nowrap">{label}</span>
        <ChevronDown size={13} style={{
          color: 'var(--color-text-tertiary)',
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.15s',
          flexShrink: 0,
        }} />
      </button>

      {open && createPortal((
        <div
          ref={popRef}
          className="fixed z-[9999] rounded-xl shadow-xl p-2 overflow-y-auto"
          style={{
            top:             popPos.top,
            left:            popPos.left,
            width:           240,
            maxHeight:       popPos.maxH ? `${popPos.maxH}px` : '60vh',
            visibility:      popPos.ready ? 'visible' : 'hidden',
            backgroundColor: 'var(--color-surface)',
            border:          '1px solid var(--color-border)',
          }}
        >
          <div className="space-y-0.5 mb-2">
            {PRESETS.map(p => (
              <button
                key={p.key}
                type="button"
                onClick={() => selectPreset(p.key)}
                className="w-full text-left px-3 py-2 rounded-lg text-sm transition-colors"
                style={{
                  backgroundColor: preset === p.key && !isCustom ? 'var(--color-primary-50)' : 'transparent',
                  color:           preset === p.key && !isCustom ? 'var(--color-primary-600)' : 'var(--color-text)',
                  fontWeight:      preset === p.key && !isCustom ? '600' : '400',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Month select — applies the full calendar month (clamped to today
              for the current month). Year selector covers last 4 + this year. */}
          <div style={{ borderTop: '1px solid var(--color-border)' }} className="pt-2 mb-2">
            <p className="text-xs font-semibold mb-2 px-1" style={{ color: 'var(--color-text-secondary)' }}>
              Pick a month
            </p>
            <div className="flex gap-1.5 mb-2">
              <select
                value={monthIdx}
                onChange={e => setMonthIdx(parseInt(e.target.value, 10))}
                className="input text-sm py-1.5 flex-1"
              >
                {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
              </select>
              <select
                value={monthYear}
                onChange={e => setMonthYear(parseInt(e.target.value, 10))}
                className="input text-sm py-1.5 w-20"
              >
                {Array.from({ length: 5 }, (_, i) => {
                  const y = parseInt(_t.slice(0, 4), 10) - i;
                  return <option key={y} value={y}>{y}</option>;
                })}
              </select>
            </div>
            <button
              type="button"
              onClick={() => selectMonth(monthYear, monthIdx)}
              className="w-full py-1.5 rounded-lg text-sm font-semibold text-white"
              style={{ background: 'var(--gradient-sidebar)' }}
            >
              Apply {MONTHS[monthIdx]} {monthYear}
            </button>
          </div>

          <div style={{ borderTop: '1px solid var(--color-border)' }} className="pt-2">
            <p className="text-xs font-semibold mb-2 px-1" style={{ color: 'var(--color-text-secondary)' }}>
              Custom range
            </p>
            <div className="space-y-1.5">
              {/* Keypress blocked — calendar-only selection per audit
                  requirement. The browser's native picker still opens on
                  click; only the typed-input path is disabled so users
                  can't paste an invalid string. */}
              <input
                type="date" value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                onKeyDown={e => e.preventDefault()}
                onPaste={e => e.preventDefault()}
                className="input text-sm py-1.5 w-full"
                title="Pick a date from the calendar — manual typing disabled"
              />
              <input
                type="date" value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                onKeyDown={e => e.preventDefault()}
                onPaste={e => e.preventDefault()}
                className="input text-sm py-1.5 w-full"
                title="Pick a date from the calendar — manual typing disabled"
              />
              <button
                type="button"
                onClick={applyCustom}
                disabled={!customFrom && !customTo}
                className="w-full py-1.5 rounded-lg text-sm font-semibold text-white transition-opacity"
                style={{
                  background: 'var(--gradient-sidebar)',
                  opacity: (!customFrom && !customTo) ? 0.4 : 1,
                  cursor: (!customFrom && !customTo) ? 'not-allowed' : 'pointer',
                }}
              >
                Apply
              </button>
            </div>
          </div>

          {/* Clear — resets the picker back to the default preset and lets the
              parent shell wipe status/agent/etc. via the onClear callback. */}
          <button
            type="button"
            onClick={handleClear}
            className="w-full mt-2 py-1.5 rounded-lg text-xs font-semibold border flex items-center justify-center gap-1.5 transition-colors hover:bg-bg-secondary"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
          >
            <X size={12} /> Clear all filters
          </button>
        </div>
      ), document.body)}
    </div>
  );
};

export default DateRangePicker;

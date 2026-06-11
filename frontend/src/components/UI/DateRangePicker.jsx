import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { todayET } from '../../utils/timezone';

const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAYS = ['S','M','T','W','T','F','S'];

// Calendar matrix for a month — leading nulls pad to the first weekday so the
// grid aligns to Sun-start columns. Trailing nulls pad the final week.
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
  // Calendar grid — defaults to current calendar month in ET.
  const _t = todayET();
  const [calY, setCalY] = useState(parseInt(_t.slice(0, 4), 10));
  const [calM, setCalM] = useState(parseInt(_t.slice(5, 7), 10) - 1);
  // Two-click range selection: first click sets pickStart (single, uncommitted),
  // second click commits the [min,max] range. hoverDay drives the live preview.
  const [pickStart, setPickStart] = useState(null);
  const [hoverDay,  setHoverDay]  = useState(null);
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
    setPickStart(null); setHoverDay(null);
    onChange(getPresetRange(key));
    setOpen(false);
  };

  // On open: jump the grid to the active range's month and reset the in-flight
  // first-click so each open starts a fresh selection.
  useEffect(() => {
    if (!open) return;
    setPickStart(null); setHoverDay(null);
    const anchor = customFrom || customTo;
    if (anchor) {
      setCalY(parseInt(anchor.slice(0, 4), 10));
      setCalM(parseInt(anchor.slice(5, 7), 10) - 1);
    }
  }, [open]); // eslint-disable-line

  const todayIso = _t;

  // Two-click range: first click arms pickStart (renders as a single selected
  // day); second click commits [min,max] and fires onChange. Future days are
  // disabled so a range never reaches past today.
  const pickDay = (iso) => {
    if (iso > todayIso) return;
    if (!pickStart) {
      setPickStart(iso);
      setCustomFrom(iso); setCustomTo('');
      setHoverDay(null);
      return;
    }
    const lo = iso < pickStart ? iso : pickStart;
    const hi = iso < pickStart ? pickStart : iso;
    setCustomFrom(lo); setCustomTo(hi);
    setIsCustom(true); setPreset('');
    setPickStart(null); setHoverDay(null);
    onChange({ date_from: lo, date_to: hi });
    setOpen(false);
  };

  const goMonth = (delta) => {
    let m = calM + delta, y = calY;
    if (m < 0)  { m = 11; y -= 1; }
    if (m > 11) { m = 0;  y += 1; }
    setCalM(m); setCalY(y);
  };

  // Cells between these two bounds render as "in range". During an active
  // first-click selection, hoverDay drives a live preview band.
  const selLo = pickStart ? (hoverDay && hoverDay < pickStart ? hoverDay : pickStart) : customFrom;
  const selHi = pickStart ? (hoverDay && hoverDay > pickStart ? hoverDay : (hoverDay && hoverDay < pickStart ? pickStart : null))
                          : customTo;
  // Next-month arrow stops at the real current month (no navigating into the future).
  const curY = parseInt(_t.slice(0, 4), 10);
  const curM = parseInt(_t.slice(5, 7), 10) - 1;
  const viewIsCurrentOrFuture = calY > curY || (calY === curY && calM >= curM);

  const handleClear = () => {
    setIsCustom(false);
    setCustomFrom(''); setCustomTo('');
    setPickStart(null); setHoverDay(null);
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
        title={label}
        className="relative flex items-center justify-center rounded-lg border transition-colors"
        style={{
          borderColor:     (isCustom || preset !== defaultPreset)
            ? 'var(--color-primary-400, #818cf8)'
            : open ? 'var(--color-primary-300, #a5b4fc)' : 'var(--color-border)',
          backgroundColor: open ? 'var(--color-bg-secondary)' : 'var(--color-surface)',
          width: 34,
          height: 34,
          flexShrink: 0,
        }}
      >
        <Calendar size={15} style={{
          color: (isCustom || preset !== defaultPreset)
            ? 'var(--color-primary-500)'
            : 'var(--color-text-secondary)',
          flexShrink: 0,
        }} />
        {(isCustom || preset !== defaultPreset) && (
          <span
            className="absolute"
            style={{
              top: 4, right: 4,
              width: 7, height: 7,
              borderRadius: '50%',
              backgroundColor: 'var(--color-primary-500)',
              border: '1.5px solid var(--color-surface)',
              pointerEvents: 'none',
            }}
          />
        )}
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

          {/* Calendar — click a start date, then an end date to set the range.
              Future days are disabled so a range never reaches past today. */}
          <div style={{ borderTop: '1px solid var(--color-border)' }} className="pt-2">
            <div className="flex items-center justify-between mb-1.5">
              <button type="button" onClick={() => goMonth(-1)}
                className="p-1 rounded-md hover:bg-bg-secondary" style={{ color: 'var(--color-text-secondary)' }}>
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                {MONTHS_FULL[calM]} {calY}
              </span>
              <button type="button" onClick={() => goMonth(1)}
                disabled={viewIsCurrentOrFuture}
                className="p-1 rounded-md hover:bg-bg-secondary disabled:opacity-30"
                style={{ color: 'var(--color-text-secondary)', cursor: viewIsCurrentOrFuture ? 'not-allowed' : 'pointer' }}>
                <ChevronRight size={16} />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-0.5 mb-0.5">
              {WEEKDAYS.map((w, i) => (
                <div key={i} className="text-center text-[10px] font-bold py-0.5" style={{ color: 'var(--color-text-tertiary)' }}>{w}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-0.5" onMouseLeave={() => pickStart && setHoverDay(null)}>
              {buildMonthMatrix(calY, calM).map((d, i) => {
                if (d === null) return <div key={i} />;
                const iso        = isoOf(calY, calM, d);
                const future     = iso > todayIso;
                const isEndpoint = (selLo && iso === selLo) || (selHi && iso === selHi);
                const inRange    = selLo && selHi && iso > selLo && iso < selHi;
                const isToday    = iso === todayIso;
                return (
                  <button key={i} type="button"
                    disabled={future}
                    onClick={() => pickDay(iso)}
                    onMouseEnter={() => pickStart && setHoverDay(iso)}
                    className="h-7 text-xs rounded-md transition-colors flex items-center justify-center"
                    style={{
                      backgroundColor: isEndpoint ? 'var(--color-primary-600)'
                                      : inRange   ? 'var(--color-primary-50, #eef2ff)'
                                      : 'transparent',
                      color:      isEndpoint ? '#fff' : 'var(--color-text)',
                      fontWeight: (isEndpoint || isToday) ? 700 : 400,
                      opacity:    future ? 0.3 : 1,
                      cursor:     future ? 'not-allowed' : 'pointer',
                      border:     (isToday && !isEndpoint) ? '1px solid var(--color-primary-400, #818cf8)' : '1px solid transparent',
                    }}>
                    {d}
                  </button>
                );
              })}
            </div>

            <p className="text-[11px] mt-1.5 px-0.5 font-medium" style={{ color: pickStart ? 'var(--color-primary-600)' : 'var(--color-text-tertiary)' }}>
              {pickStart ? 'Now click the end date →'
                : (customFrom && customTo) ? `${fmtDate(customFrom)} – ${fmtDate(customTo)}`
                : 'Click a start date'}
            </p>
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

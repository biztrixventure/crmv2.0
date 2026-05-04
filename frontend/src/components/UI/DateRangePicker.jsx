import { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';

const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: '7d',    label: 'Last 7 days' },
  { key: '30d',   label: 'Last 30 days' },
  { key: '3m',    label: 'Last 3 months' },
  { key: 'year',  label: 'This year' },
  { key: 'all',   label: 'All time' },
];

export function getPresetRange(key = '30d') {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  switch (key) {
    case 'today': return { date_from: today, date_to: today };
    case '7d': {
      const d = new Date(now); d.setDate(d.getDate() - 7);
      return { date_from: d.toISOString().split('T')[0], date_to: today };
    }
    case '30d': {
      const d = new Date(now); d.setDate(d.getDate() - 30);
      return { date_from: d.toISOString().split('T')[0], date_to: today };
    }
    case '3m': {
      const d = new Date(now); d.setMonth(d.getMonth() - 3);
      return { date_from: d.toISOString().split('T')[0], date_to: today };
    }
    case 'year':
      return { date_from: `${now.getFullYear()}-01-01`, date_to: today };
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
const DateRangePicker = ({ onChange, defaultPreset = '30d', value }) => {
  const [open, setOpen]             = useState(false);
  const [preset, setPreset]         = useState(defaultPreset);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo,   setCustomTo]   = useState('');
  const [isCustom,   setIsCustom]   = useState(false);
  const ref = useRef(null);

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
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
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

  const label = isCustom
    ? (customFrom && customTo
        ? `${fmtDate(customFrom)} – ${fmtDate(customTo)}`
        : customFrom ? fmtDate(customFrom) : 'Custom range')
    : (PRESETS.find(p => p.key === preset)?.label ?? 'Last 30 days');

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
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

      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 rounded-xl shadow-xl p-2 w-52"
          style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
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

          <div style={{ borderTop: '1px solid var(--color-border)' }} className="pt-2">
            <p className="text-xs font-semibold mb-2 px-1" style={{ color: 'var(--color-text-secondary)' }}>
              Custom range
            </p>
            <div className="space-y-1.5">
              <input
                type="date" value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                className="input text-sm py-1.5 w-full"
              />
              <input
                type="date" value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                className="input text-sm py-1.5 w-full"
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
        </div>
      )}
    </div>
  );
};

export default DateRangePicker;

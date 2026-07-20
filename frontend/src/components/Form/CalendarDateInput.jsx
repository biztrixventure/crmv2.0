import { useEffect, useRef } from 'react';
import { Calendar } from 'lucide-react';
import ThemedDate from '../UI/ThemedDate';

// Calendar-only date field used across the Sale + Transfer forms.
//
// Behavior (per compliance requirement — see Sale Date / Monthly Date):
//   • Defaults to TODAY when empty so the closer never has to pick a throwaway
//     date first. The default is written back through onChange so the value is
//     actually submitted, not just displayed.
//   • Clicking the field opens the native calendar immediately (showPicker).
//   • Manual typing is disabled — the only way to change the value is the
//     calendar, which kills MM/DD vs DD/MM transposition errors before they
//     ever reach Compliance.
//   • Native <ThemedDate> renders MM/DD/YYYY in en-US locale, which is
//     the format we already display everywhere.
const todayISO = () => new Date().toISOString().split('T')[0];

const CalendarDateInput = ({
  value,
  onChange,            // (isoString) => void
  className = '',
  required = false,
  defaultToday = true,
  id,
  max,                 // ISO yyyy-mm-dd — calendar can't pick a later date (block future)
  min,                 // ISO yyyy-mm-dd — calendar can't pick an earlier date
}) => {
  const ref = useRef(null);

  // Seed today's date once when the field mounts empty.
  useEffect(() => {
    if (defaultToday && !value) onChange(todayISO());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openPicker = () => {
    const el = ref.current;
    if (el && typeof el.showPicker === 'function') {
      try { el.showPicker(); } catch { /* showPicker throws if not user-activated — ignore */ }
    }
  };

  return (
    <div className="relative">
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <Calendar size={16} style={{ color: 'var(--color-text-tertiary)' }} />
      </div>
      <ThemedDate
        ref={ref}
        id={id}
        value={value || (defaultToday ? todayISO() : '')}
        required={required}
        max={max || undefined}
        min={min || undefined}
        onChange={(e) => onChange(e.target.value)}
        onClick={openPicker}
        onKeyDown={(e) => { if (e.key !== 'Tab') e.preventDefault(); }}
        onPaste={(e) => e.preventDefault()}
        title="Pick a date from the calendar — manual typing is disabled"
        className={`input pl-9 ${className}`}
        style={{ cursor: 'pointer' }}
      />
    </div>
  );
};

export default CalendarDateInput;

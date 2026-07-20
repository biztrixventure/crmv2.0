import { useEffect } from 'react';
import ThemedDate from '../UI/ThemedDate';

// Calendar-only date field used across the Sale + Transfer forms.
//
// Thin wrapper around <ThemedDate> (the themed calendar popup):
//   • Defaults to TODAY when empty so the closer never has to pick a throwaway
//     date first. The default is written back through onChange so the value is
//     actually submitted, not just displayed.
//   • The only way to change the value is the calendar popup — there is no
//     manual typing, which kills MM/DD vs DD/MM transposition errors before
//     they ever reach Compliance.
//
// NOTE: do NOT pass onClick/onKeyDown/ref here — ThemedDate spreads extra props
// onto its trigger button, so an onClick would override its own open handler and
// the calendar would never open (that was the "date field not clickable" bug).
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
  // Seed today's date once when the field mounts empty.
  useEffect(() => {
    if (defaultToday && !value) onChange(todayISO());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ThemedDate
      id={id}
      value={value || (defaultToday ? todayISO() : '')}
      required={required}
      max={max || undefined}
      min={min || undefined}
      onChange={(e) => onChange(e.target.value)}
      title="Pick a date from the calendar"
      className={`input ${className}`}
    />
  );
};

export default CalendarDateInput;

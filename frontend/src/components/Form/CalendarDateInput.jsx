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
  seedDate,            // ISO the field opens on; '' = blank. Undefined = today.
  id,
  max,                 // ISO yyyy-mm-dd — calendar can't pick a later date (block future)
  min,                 // ISO yyyy-mm-dd — calendar can't pick an earlier date
}) => {
  // WHAT THE FIELD OPENS ON. `seedDate` lets the form answer from the field's
  // own config (a monthly payment opens next month, not today). It is checked
  // against undefined, not truthiness: '' is a real answer — "leave it blank"
  // — and `|| todayISO()` would overrule it with today, which is the whole
  // behaviour being made configurable. No seedDate at all keeps the historical
  // today, so every existing caller is untouched.
  const seed = seedDate !== undefined ? seedDate : (defaultToday ? todayISO() : '');

  // Seed once when the field mounts empty. Written back through onChange so
  // the value is actually submitted, not just shown.
  useEffect(() => {
    if (seed && !value) onChange(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ThemedDate
      id={id}
      value={value || seed}
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

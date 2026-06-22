// Vehicle-field sanity guard, shared by the transfer (fronter) form, the sale
// (closer) form, and the bulk uploaders. Catches the classic "columns shifted"
// symptom: a Year field that isn't a real year, or a Make field that's numeric
// (e.g. the year landed in the make column).

const YEAR_RE  = /year/i;            // CarYear, Car Year, year…
const MAKE_RE  = /make/i;            // CarMake, Make…
const MILES_RE = /mile|mileage|odomet/i;  // Miles, Mileage, Odometer…

// Mileage must be 3–6 digits (e.g. 100 … 999999). Blocks a 2-digit typo and an
// over-long junk value before the form can be submitted.
const MILES_MIN_DIGITS = 3;
const MILES_MAX_DIGITS = 6;

// Returns { [prefix+fieldName]: message } for any implausible vehicle value.
export function vehicleFieldIssues(fields, values, prefix = '') {
  const issues = {};
  (fields || []).forEach((f) => {
    const v = String(values?.[f.name] ?? '').trim();
    if (!v) return;
    const name = f.name || '';
    if (YEAR_RE.test(name) && f.field_type !== 'sale_date') {
      const digits = v.replace(/\D/g, '');
      const n = parseInt(digits, 10);
      if (digits.length !== 4 || n < 1900 || n > 2100) {
        issues[`${prefix}${f.name}`] = `"${v}" isn't a valid year (1900–2100) — check the column alignment.`;
      }
    } else if (MAKE_RE.test(name) && /^\d+(\.\d+)?$/.test(v)) {
      issues[`${prefix}${f.name}`] = `Car make can't be a number ("${v}") — columns may be shifted.`;
    } else if (MILES_RE.test(name) || MILES_RE.test(f.label || '')) {
      const digits = v.replace(/\D/g, '');
      if (digits.length < MILES_MIN_DIGITS || digits.length > MILES_MAX_DIGITS) {
        issues[`${prefix}${f.name}`] = `Mileage must be ${MILES_MIN_DIGITS}–${MILES_MAX_DIGITS} digits — "${v}" has ${digits.length}.`;
      }
    }
  });
  return issues;
}

// Plain-value version for the bulk uploader (works off canonical car_year/car_make).
export function carRowWarning(row) {
  const year = String(row?.car_year ?? '').trim();
  const make = String(row?.car_make ?? '').trim();
  if (year) {
    const digits = year.replace(/\D/g, '');
    const n = parseInt(digits, 10);
    if (digits.length !== 4 || n < 1900 || n > 2100) return `Car Year "${year}" isn't a valid year — the car columns may be shifted.`;
  }
  if (make && /^\d+(\.\d+)?$/.test(make)) return `Car Make "${make}" is a number — the car columns may be shifted.`;
  return null;
}

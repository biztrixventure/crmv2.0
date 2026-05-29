// ============================================================================
// formFieldNorm — central rules for how form_fields values are normalized AND
// length-capped as the user types. Applied by SaleForm and TransferFormModal
// so the same input behaves the same everywhere a closer or fronter touches
// it. New rules go HERE so adding/changing a rule never means hunting through
// half a dozen render branches.
//
// Detection is by field.field_type when set, then by case-insensitive name /
// label pattern matching — so a hand-rolled `text` field called "Customer Name"
// still strips digits, and a `select` named "Phone" still digit-clamps.
// ============================================================================

const matches = (field, re) =>
  re.test(String(field.name  || '').toLowerCase()) ||
  re.test(String(field.label || '').toLowerCase());

// VIN excludes I, O, Q (avoid confusion with 1/0/0). Length is fixed at 17 for
// every modern road vehicle, so anything past that is operator error and we
// clip silently.
const VIN_VALID = /[A-HJ-NPR-Z0-9]/i;

// Classify a field once so the renderer can branch consistently. Order matters:
// explicit field_type sentinels (sale_*, phone, etc.) beat name heuristics.
export const classify = (field) => {
  const t = String(field.field_type || '').toLowerCase();
  if (t === 'zip')                      return 'zip';
  if (t === 'phone' || t === 'tel')     return 'phone';
  if (t === 'email')                    return 'email';
  if (matches(field, /\bzip|postal\b/)) return 'zip';
  if (matches(field, /\b(vin)\b/))      return 'vin';
  if (matches(field, /\b(phone|mobile|cell|cli[_ ]?number)\b/)) return 'phone';
  // Name detection is intentionally conservative — only first/last/full name
  // patterns. "Plan name" or "company name" shouldn't strip digits.
  if (matches(field, /\b(first|last|full|customer|client|fronter|closer)?[_ ]?name$/)) return 'name';
  if (matches(field, /\b(make)\b/))     return 'car_make';
  if (matches(field, /\b(model)\b/))    return 'car_model';
  return 'generic';
};

// Returns the normalized value the field should display + store. Caller still
// owns the state — this is a pure transform.
export const normalize = (field, raw) => {
  const kind = classify(field);
  const s = raw == null ? '' : String(raw);
  switch (kind) {
    case 'zip':
      // Strict 5 digits. Spec: zip should not exceed 5 characters and must be
      // numeric so the city/state lookup always has a clean key to send.
      return s.replace(/\D/g, '').slice(0, 5);
    case 'phone':
      // Normalize parens, dashes, dots, spaces away → digits only, US 10-digit
      // length cap. International prefixes are intentionally truncated.
      return s.replace(/\D/g, '').slice(0, 10);
    case 'vin':
      return s.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '').slice(0, 17);
    case 'name': {
      // Strip digits, collapse runs of whitespace, and title-case while typing.
      // Trailing space is preserved so the next word can start mid-keystroke
      // without the cursor "hopping" back. Empty input passes through clean.
      const cleaned = s.replace(/\d+/g, '').replace(/\s+/g, ' ');
      if (!cleaned) return cleaned;
      const trailing = cleaned.endsWith(' ') ? ' ' : '';
      return cleaned
        .split(' ')
        .filter(Boolean)
        .map(w => w[0].toUpperCase() + w.slice(1).toLowerCase())
        .join(' ') + trailing;
    }
    default:
      return s;
  }
};

// Per-field maxLength to pass through to the <input>. Acts as a belt-and-
// suspenders alongside `normalize`, so even paste events that bypass the
// JS keystroke handler are clipped at the HTML level.
export const maxLengthFor = (field) => {
  const kind = classify(field);
  if (kind === 'zip')   return 5;
  if (kind === 'phone') return 10;
  if (kind === 'vin')   return 17;
  return undefined;
};

// Final-submit validity. Returns a human-readable error or null. Forms should
// run this on submit for fields that don't have native HTML validation cover.
export const validate = (field, value) => {
  const kind = classify(field);
  const v = String(value || '');
  if (!v) return null;                  // emptiness is the required-check's job
  if (kind === 'zip'   && v.length !== 5)  return 'ZIP must be exactly 5 digits';
  if (kind === 'phone' && v.length !== 10) return 'Phone must be exactly 10 digits';
  if (kind === 'vin'   && v.length !== 17) return 'VIN must be exactly 17 characters';
  if (kind === 'name'  && /\d/.test(v))    return 'Name cannot contain digits';
  return null;
};

// Format a normalized 10-digit phone back to a readable "(555) 123-4567" for
// display only (storage stays digits). Optional helper if a renderer wants it.
export const formatPhoneDisplay = (digits) => {
  const d = String(digits || '').replace(/\D/g, '');
  if (d.length !== 10) return d;
  return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
};

// Convenience predicates the renderers use to switch input behavior.
export const isZip   = (f) => classify(f) === 'zip';
export const isPhone = (f) => classify(f) === 'phone';
export const isVin   = (f) => classify(f) === 'vin';
export const isName  = (f) => classify(f) === 'name';
export const isCarMake  = (f) => classify(f) === 'car_make';
export const isCarModel = (f) => classify(f) === 'car_model';

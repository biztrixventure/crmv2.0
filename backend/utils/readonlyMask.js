// ============================================================================
// readonlyMask — server-side PII / financial redaction for read-only admins.
//
// When a superadmin turns OFF `view_pii` or `view_financial_data` for a given
// readonly_admin, the sensitive fields must never reach the browser (frontend
// hiding is cosmetic — the raw JSON would still be in the Network tab). This
// util strips those fields from API rows BEFORE res.json.
//
// Field inventory sourced from the sale/transfer/callback/customer-profile
// schema audit (denormalized typed columns + the many form_data aliases the
// CRM/dialer/manual paths produce). form_data keys are non-canonical, so we
// mask by BOTH an explicit alias set AND case-insensitive patterns to survive
// alias drift. Masked value: null for numbers, '***' for strings (structure
// preserved so the UI renders a redacted cell, not a crash).
// ============================================================================

// Typed columns (exact key match on the row object).
const PII_COLUMNS = new Set([
  'customer_name', 'customer_phone', 'customer_phone_2', 'customer_email',
  'customer_address', 'customer_city', 'customer_state', 'customer_timezone',
  'normalized_phone', 'reference_no', 'policy_number', 'notes',
  // vehicle identity (denormalized typed columns) — customer-identifying.
  'car_vin', 'car_make', 'car_model', 'car_year', 'car_miles', 'miles_num',
]);
const FINANCIAL_COLUMNS = new Set([
  'down_payment', 'monthly_payment', 'payment_due_note',
  'chargeback_amount', 'charge_at',
]);

// form_data key patterns (case-insensitive). Catch aliases without listing all.
const PII_KEY_RE = /(^|_)(name|firstname|lastname|fullname)$|phone|mobile|cell|email|address|^city$|^state$|^zip$|cli_number|^vin$|carvin|car_vin/i;
const FINANCIAL_KEY_RE = /down.?payment|monthly.?payment|payment.?due|^monthly$|^down$/i;

// Vehicle facets are customer-identifying alongside VIN. Treated as PII-optional:
// masked together with PII (car_vin is the strongly-sensitive one, always masked).
const VEHICLE_KEY_RE = /^(car_)?(year|make|model|miles|mileage)$|carmake|carmodel|caryear|carmiles/i;

// customer-profile response paths (dot notation) — masked by walking the object.
const PROFILE_PII_PATHS = [
  'identity.name', 'identity.phone', 'identity.phone_2', 'identity.email', 'identity.address',
];
const PROFILE_FIN_PATHS = [
  'financials.total_down_payment', 'financials.monthly_recurring',
];

function maskScalar(v) {
  if (v === null || v === undefined) return v;
  return typeof v === 'number' ? null : '***';
}

// Redact a flat record's typed columns + its form_data JSONB (+ nested transfer
// form_data). Mutates a shallow clone; returns the clone.
function maskRecord(row, { pii, financial }) {
  if (!row || typeof row !== 'object') return row;
  const out = Array.isArray(row) ? [...row] : { ...row };

  for (const k of Object.keys(out)) {
    // typed columns by exact set OR the vehicle-facet regex (survives alias drift
    // on denormalized columns like CarMake vs car_make).
    if (pii && (PII_COLUMNS.has(k) || VEHICLE_KEY_RE.test(k))) out[k] = maskScalar(out[k]);
    else if (financial && FINANCIAL_COLUMNS.has(k)) out[k] = maskScalar(out[k]);
  }

  if (out.form_data && typeof out.form_data === 'object') {
    out.form_data = maskFormData(out.form_data, { pii, financial });
  }
  // Nested transfer(s) on a sale row (GET /sales/:id embeds transfers.form_data).
  if (out.transfers && typeof out.transfers === 'object') {
    out.transfers = Array.isArray(out.transfers)
      ? out.transfers.map(t => maskRecord(t, { pii, financial }))
      : maskRecord(out.transfers, { pii, financial });
  }
  return out;
}

function maskFormData(fd, { pii, financial }) {
  const out = { ...fd };
  for (const k of Object.keys(out)) {
    if (pii && (PII_KEY_RE.test(k) || VEHICLE_KEY_RE.test(k))) out[k] = maskScalar(out[k]);
    else if (financial && FINANCIAL_KEY_RE.test(k)) out[k] = maskScalar(out[k]);
  }
  return out;
}

// customer-profile toProfile() object — mask by known response paths + vehicle/
// sale sub-arrays.
function maskProfile(profile, { pii, financial }) {
  if (!profile || typeof profile !== 'object') return profile;
  const out = JSON.parse(JSON.stringify(profile)); // deep clone (nested arrays)
  const setPath = (obj, path) => {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) { cur = cur?.[parts[i]]; if (!cur) return; }
    const last = parts[parts.length - 1];
    if (cur && last in cur) cur[last] = maskScalar(cur[last]);
  };
  if (pii) {
    PROFILE_PII_PATHS.forEach(p => setPath(out, p));
    (out.vehicles || []).forEach(v => { ['vin', 'year', 'make', 'model', 'miles', 'label'].forEach(f => { if (f in v) v[f] = maskScalar(v[f]); }); });
    (out.sales || []).forEach(s => { ['vin', 'vehicle'].forEach(f => { if (f in s) s[f] = maskScalar(s[f]); }); });
    (out.transfers || []).forEach(t => { if ('vehicle' in t) t.vehicle = maskScalar(t.vehicle); });
    (out.results || []).forEach(r => { ['name', 'phone'].forEach(f => { if (f in r) r[f] = maskScalar(r[f]); }); });
  }
  if (financial) {
    PROFILE_FIN_PATHS.forEach(p => setPath(out, p));
    (out.plans || []).forEach(p => { ['down_payment', 'monthly_payment'].forEach(f => { if (f in p) p[f] = maskScalar(p[f]); }); });
    (out.sales || []).forEach(s => { ['down_payment', 'monthly_payment'].forEach(f => { if (f in s) s[f] = maskScalar(s[f]); }); });
  }
  return out;
}

// Mask an array (or single) of flat records for the given hide-flags.
// `hide` = { pii:boolean, financial:boolean } — true means REDACT that class.
// No-op when both false (RO may see everything → nothing to strip).
function maskRows(data, hide) {
  if (!hide || (!hide.pii && !hide.financial)) return data;
  if (Array.isArray(data)) return data.map(r => maskRecord(r, hide));
  return maskRecord(data, hide);
}

module.exports = { maskRows, maskRecord, maskProfile, PII_COLUMNS, FINANCIAL_COLUMNS };

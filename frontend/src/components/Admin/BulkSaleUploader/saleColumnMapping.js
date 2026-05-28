// Upload-level control fields (which fronter/company/closer the sale belongs to,
// plus optional status + compliance note). Everything else is a form-config field.
export const CONTROL_FIELDS = [
  { key: 'fronter_name', label: 'Fronter Name',  required: true,  control: true, desc: 'Matches the transfer fronter (full name).' },
  { key: 'company_name', label: 'Company Name',  required: true,  control: true, desc: 'Matches the transfer company exactly.' },
  { key: 'closer_name',  label: 'Closer Name',   required: false, control: true, desc: 'Closer who closed the sale (full name). Leave blank if unknown.' },
  { key: 'status',       label: 'Sale / Approval Status', required: false, control: true, desc: 'Defaults to "pending_review" (compliance queue) if blank.' },
  { key: 'compliance_note', label: 'Compliance Note', required: false, control: true, desc: 'Optional compliance reviewer note.' },
];

const norm = (s) => String(s || '').trim().toLowerCase().replace(/[\s_-]+/g, '');

// All form-config fields are mappable for a sale (a sale = fronter + closer
// fields). Includes sale_* deal fields. New form fields appear automatically.
export function dynamicFields(formFields) {
  return (formFields || []).map(f => ({
    key: f.name, label: f.label || f.name, required: !!f.is_required, control: false,
    field_type: f.field_type, show_to_fronter: f.show_to_fronter,
  }));
}

// True for a field that lives ONLY on the closer/sale form (a sale_* deal field,
// OR a non-sale field hidden from the fronter, e.g. Age / Monthly_Date / Plan_Duration).
export const isCloserOnlyField = (f) =>
  String(f.field_type || '').startsWith('sale_') || f.show_to_fronter === false;

export function detectPhoneKey(formFields) {
  const list = dynamicFields(formFields);
  const byType = list.find(f => ['phone', 'tel'].includes(f.field_type));
  if (byType) return byType.key;
  const byName = list.find(f => /(phone|cli|mobile|cell|number)/i.test(f.key) || /(phone|cli|mobile|cell)/i.test(f.label));
  return byName?.key || null;
}

export function buildFields(formFields, phoneKey) {
  const dyn = dynamicFields(formFields).map(f => f.key === phoneKey ? { ...f, required: true, isPhone: true } : f);
  return [...CONTROL_FIELDS, ...dyn];
}

const SYNONYMS = {
  fronter_name: ['fronter', 'frontername', 'agent'],
  company_name: ['company', 'companyname', 'business', 'account'],
  closer_name:  ['closer', 'closername', 'salesrep', 'rep'],
  status:       ['status', 'salestatus', 'approval', 'approvalstatus', 'dispo', 'disposition'],
  compliance_note: ['compliancenote', 'compliancenotes', 'compliance'],
};

export function autoMap(headers, fields) {
  const mapping = {}; const used = new Set();
  fields.forEach(f => {
    const cand = headers.find(h => {
      if (used.has(h)) return false;
      const n = norm(h);
      if (n === norm(f.key) || n === norm(f.label)) return true;
      return (SYNONYMS[f.key] || []).some(s => n === s || n.includes(s));
    });
    if (cand) { mapping[f.key] = cand; used.add(cand); }
  });
  return mapping;
}

// Port of SaleForm.mapToSaleColumns so bulk rows derive the same sale columns
// from form_data that a manual closer submission would.
function mapToSaleColumns(fd) {
  const firstName = (fd.FirstName || fd.first_name || '').toString().trim();
  const lastName  = (fd.LastName  || fd.last_name  || '').toString().trim();
  const fullName  = [firstName, lastName].filter(Boolean).join(' ')
    || fd.customer_name || fd.Name || fd.name || fd.FullName || fd.fullname || '';
  const phone  = fd.Phone || fd.phone || fd.customer_phone || fd.PhoneNumber || fd.phone_number || fd.Mobile || fd.CellPhone || '';
  const phone2 = fd.Phone2 || fd.phone2 || fd.customer_phone_2 || '';
  const email  = fd.Email || fd.email || fd.customer_email || fd.EmailAddress || '';
  return {
    customer_name:    fullName,
    customer_phone:   phone,
    customer_phone_2: phone2,
    customer_email:   email,
    customer_address: [fd.Address, fd.City, fd.State, fd.Zip].filter(Boolean).join(', ') || fd.customer_address || '',
    car_year:  fd.CarYear || fd.car_year || fd.Year || '',
    car_make:  fd.CarMake || fd.car_make || fd.Make || '',
    car_model: fd.CarModel || fd.car_model || fd.Model || '',
    car_miles: fd.CarMiles || fd.car_miles || fd.Mileage || '',
    car_vin:   fd.CarVin || fd.car_vin || fd.VIN || '',
  };
}

// Is this a date-bearing field? (sale_date hits a real DATE column server-side.)
const isDateField = (f) => f.field_type === 'date' || f.field_type === 'sale_date';

// Decide a date column's orientation from the values that make it unambiguous:
// any first-part > 12 ⇒ day-first (DD/MM); any second-part > 12 ⇒ month-first.
function detectDayFirst(values) {
  let dmy = 0, mdy = 0;
  for (const v of values) {
    const m = String(v ?? '').match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-]\d{2,4}/);
    if (!m) continue;
    const a = +m[1], b = +m[2];
    if (a > 12 && b <= 12) dmy++; else if (b > 12 && a <= 12) mdy++;
  }
  return dmy > mdy;
}

// Convert a spreadsheet date to ISO 'YYYY-MM-DD' using the detected orientation.
// Leaves anything it can't parse untouched (the server sanitizes as a backstop).
function toIsoDate(value, dayFirst) {
  const s = String(value ?? '').trim();
  if (!s || s === '-') return s;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/);
  if (m) {
    const a = +m[1], b = +m[2]; let y = +m[3]; if (y < 100) y += 2000;
    let day, mon;
    if (a > 12 && b <= 12)      { day = a; mon = b; }
    else if (b > 12 && a <= 12) { mon = a; day = b; }
    else if (dayFirst)          { day = a; mon = b; }
    else                        { mon = a; day = b; }
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
      return `${y}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return s;
}

export function applyMapping(rows, mapping, formFields, phoneKey) {
  const dyn = dynamicFields(formFields);
  const mappedHeaders = new Set([
    ...CONTROL_FIELDS.map(f => mapping[f.key]).filter(Boolean),
    ...dyn.map(f => mapping[f.key]).filter(Boolean),
  ]);
  const fieldByType = (t) => formFields.find(f => f.field_type === t);

  // Detect each mapped date column's orientation once, across all rows.
  const dayFirstByKey = {};
  dyn.filter(isDateField).forEach(f => {
    const h = mapping[f.key];
    if (h) dayFirstByKey[f.key] = detectDayFirst(rows.map(r => r[h]));
  });

  return rows.map(r => {
    const form_data = {};
    dyn.forEach(f => {
      const h = mapping[f.key];
      let v = h ? String(r[h] ?? '').trim() : '';
      if (v && isDateField(f)) v = toIsoDate(v, dayFirstByKey[f.key]);
      if (v !== '') form_data[f.key] = v;
    });
    Object.keys(r).forEach(h => { if (mappedHeaders.has(h)) return; const v = r[h]; if (v !== '' && v != null) form_data[h] = v; });

    const dynVal = (type) => { const f = fieldByType(type); return f ? (form_data[f.name] || '') : ''; };
    const cols = mapToSaleColumns(form_data);
    const ctrl = (k) => { const h = mapping[k]; return h ? String(r[h] ?? '').trim() : ''; };

    return {
      fronter_name:  ctrl('fronter_name'),
      company_name:  ctrl('company_name'),
      closer_name:   ctrl('closer_name'),
      status:        ctrl('status'),
      compliance_note: ctrl('compliance_note'),
      cli_number:    phoneKey ? (form_data[phoneKey] || cols.customer_phone || '') : (cols.customer_phone || ''),
      ...cols,
      plan:             dynVal('sale_plan'),
      down_payment:     dynVal('sale_down_payment'),
      monthly_payment:  dynVal('sale_monthly_payment'),
      payment_due_note: dynVal('sale_payment_due_note'),
      reference_no:     dynVal('sale_reference_no'),
      client_name:      dynVal('sale_client'),
      sale_date:        dynVal('sale_date'),
      closer_disposition: dynVal('sale_disposition') || dynVal('sale_status'),
      form_data,
    };
  });
}

export const normPhone = (p) => String(p || '').replace(/\D/g, '').slice(-10);

// Canonical sale export schema — drives BOTH the template CSV and the actual
// sales export so an exported file can be re-uploaded without any header
// remapping. SUPERSET of the transfer template: shared columns (company,
// fronter, then customer/car form fields) come first in the same order as a
// transfer file; sale-only columns (deal fields, closer, compliance note,
// status) are appended.
//
// Returns ordered columns: [{ key, source, field_type? }].
//   source: 'control' (a control field like fronter_name)
//         | 'form_dyn' (a form_fields-defined field, value lives in form_data)
//
// `key` is the snake_case header used both in the export and as the auto-map
// target on re-upload, so the round-trip is byte-for-byte 1:1.
export function saleExportColumns(formFields) {
  const dyn = dynamicFields(formFields);
  const fronterDyn = dyn.filter(f => !isCloserOnlyField(f)).map(f => ({ key: f.key, source: 'form_dyn', field_type: f.field_type }));
  const closerDyn  = dyn.filter(f =>  isCloserOnlyField(f)).map(f => ({ key: f.key, source: 'form_dyn', field_type: f.field_type }));
  return [
    { key: 'fronter_name',    source: 'control' },
    { key: 'company_name',    source: 'control' },
    ...fronterDyn,
    ...closerDyn,
    { key: 'closer_name',     source: 'control' },
    { key: 'compliance_note', source: 'control' },
    { key: 'status',          source: 'control' },
  ];
}

// Reverse map: form_fields `field_type` → the canonical sales TABLE column the
// bulk uploader writes that field into. Used as a fallback so a sale created
// manually (no form_data persisted) still exports a sensible value.
const SALE_TYPED_COL_BY_FIELD_TYPE = {
  sale_plan: 'plan',
  sale_down_payment: 'down_payment',
  sale_monthly_payment: 'monthly_payment',
  sale_payment_due_note: 'payment_due_note',
  sale_reference_no: 'reference_no',
  sale_client: 'client_name',
  sale_date: 'sale_date',
  sale_disposition: 'closer_disposition',
  sale_status: 'closer_disposition',
  phone: 'customer_phone',
  tel: 'customer_phone',
  email: 'customer_email',
};

// Pull the value for one export column from a `/sales` API record.
// Prefers form_data (where bulk-uploaded sales store everything), falls back to
// the typed column when the field_type maps to one, then a same-named typed col
// (covers customer_name / customer_phone / car_*), then blank.
export function saleToValue(sale, col) {
  if (col.source === 'control') {
    switch (col.key) {
      case 'fronter_name':    return sale.fronter_name || '';
      case 'company_name':    return sale.companies?.name || sale.company_name || '';
      case 'closer_name':     return sale.closer_name || '';
      case 'compliance_note': return sale.compliance_note || '';
      case 'status':          return sale.status || '';
      default: return '';
    }
  }
  // form_dyn: try form_data first, then typed column fallbacks.
  const fd = sale.form_data || {};
  if (fd[col.key] != null && fd[col.key] !== '') return fd[col.key];
  const typed = SALE_TYPED_COL_BY_FIELD_TYPE[col.field_type];
  if (typed && sale[typed] != null && sale[typed] !== '') return sale[typed];
  if (sale[col.key] != null && sale[col.key] !== '') return sale[col.key];
  return '';
}

// Convert one sale → row values aligned with the given column schema.
export function saleToRow(sale, columns) {
  return columns.map(col => saleToValue(sale, col));
}

const SAMPLE_BY_TYPE = {
  date: '2026-05-20', sale_date: '2026-05-20', email: 'customer@example.com',
  sale_down_payment: '500', sale_monthly_payment: '150', sale_reference_no: 'MBH4220SBN',
};
const SAMPLE_BY_CONTROL = {
  fronter_name: 'John Smith', company_name: 'Acme Auto Warranty',
  closer_name: 'Mike Closer', status: 'pending_review', compliance_note: '',
};

// Demo/template CSV — shape identical to the live export so a downloaded
// template + a downloaded export are interchangeable.
export function sampleTemplateCsv(formFields, phoneKey) {
  const cols = saleExportColumns(formFields);
  const sampleFor = (c) => {
    if (c.source === 'control') return SAMPLE_BY_CONTROL[c.key] ?? '';
    if (c.key === phoneKey || ['phone', 'tel'].includes(c.field_type)) return '5551234567';
    if (SAMPLE_BY_TYPE[c.field_type]) return SAMPLE_BY_TYPE[c.field_type];
    return `Sample ${c.key}`;
  };
  const headers = cols.map(c => c.key);
  return [headers, cols.map(sampleFor)].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}

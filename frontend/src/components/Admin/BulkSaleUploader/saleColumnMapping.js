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

// Demo/template CSV — built as a SUPERSET of the transfer template: the shared
// columns (company, fronter, then the customer/car form fields) come first in the
// same order a transfer file uses, and the sale-only columns (deal fields, closer,
// compliance note, status) are appended. So the common columns line up across both
// uploaders and a single source export can feed either one.
export function sampleTemplateCsv(formFields, phoneKey) {
  const dyn = dynamicFields(formFields);
  // Shared block = the SAME fields the fronter/transfer form uses (visible to
  // fronter AND not a sale field) so these columns line up byte-for-byte with the
  // transfer template. Everything closer-only (sale_* + fronter-hidden) is appended.
  const fronterDyn = dyn.filter(f => !isCloserOnlyField(f));
  const closerDyn  = dyn.filter(f => isCloserOnlyField(f));

  const ordered = [
    { key: 'fronter_name',    label: 'Fronter Name' },
    { key: 'company_name',    label: 'Company Name' },
    ...fronterDyn,
    ...closerDyn,
    { key: 'closer_name',     label: 'Closer Name' },
    { key: 'compliance_note', label: 'Compliance Note' },
    { key: 'status',          label: 'Sale / Approval Status' },
  ];

  const sampleFor = (f) => {
    if (f.key === phoneKey || ['phone', 'tel'].includes(f.field_type)) return '5551234567';
    if (f.key === 'fronter_name') return 'John Smith';
    if (f.key === 'company_name') return 'Acme Auto Warranty';
    if (f.key === 'closer_name') return 'Mike Closer';
    if (f.key === 'status') return 'pending_review';
    if (f.key === 'compliance_note') return '';
    if (f.field_type === 'date' || f.field_type === 'sale_date') return '2026-05-20';
    if (f.field_type === 'email') return 'customer@example.com';
    if (f.field_type === 'sale_down_payment') return '500';
    if (f.field_type === 'sale_monthly_payment') return '150';
    if (f.field_type === 'sale_reference_no') return 'MBH4220SBN';
    return `Sample ${f.label}`;
  };

  const headers = ordered.map(f => f.key);
  return [headers, ordered.map(sampleFor)].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}

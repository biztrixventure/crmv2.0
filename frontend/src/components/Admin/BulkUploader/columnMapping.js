// Upload-level control fields (NOT part of the dynamic form config). These say
// which fronter/company a transfer belongs to and its transfer-level metadata.
export const CONTROL_FIELDS = [
  { key: 'fronter_name', label: 'Fronter Name',     required: true,  control: true, desc: 'Full name of the fronter — must match an existing fronter in the company.' },
  { key: 'company_name', label: 'Company Name',     required: true,  control: true, desc: 'Must match an existing company name exactly.' },
  { key: 'transfer_date', label: 'Transfer Date',   required: false, control: true, desc: 'Date of the transfer (e.g. 2026-05-20).' },
  { key: 'status',       label: 'Status',           required: false, control: true, desc: 'Transfer status. Defaults to "pending" if blank.' },
  { key: 'created_at',   label: 'Created Date/Time', required: false, control: true, desc: 'When the transfer was created (e.g. 2026-05-20 14:30). Defaults to now if blank.' },
];

const norm = (s) => String(s || '').trim().toLowerCase().replace(/[\s_-]+/g, '');

// Form-builder field types that belong to the closer/sale form, not the fronter
// transfer form — excluded from the uploader.
const isSaleField = (ft) => String(ft || '').startsWith('sale_');

// Dynamic fronter form fields from the form config (form_fields table):
// fronter-visible, non-sale fields. These become form_data on the transfer,
// keyed by the exact field name a manual transfer would use.
export function dynamicFields(formFields) {
  return (formFields || [])
    .filter(f => f.show_to_fronter !== false && !isSaleField(f.field_type))
    .map(f => ({ key: f.name, label: f.label || f.name, required: !!f.is_required, control: false, field_type: f.field_type }));
}

// The phone field is the CLI used for duplicate detection. Detect it by type
// (phone/tel) or by name. Returns the field key (form_data key) or null.
export function detectPhoneKey(formFields) {
  const list = dynamicFields(formFields);
  const byType = list.find(f => ['phone', 'tel'].includes(f.field_type));
  if (byType) return byType.key;
  const byName = list.find(f => /(phone|cli|mobile|cell|contact.?no|number)/i.test(f.key) || /(phone|cli|mobile|cell)/i.test(f.label));
  return byName?.key || null;
}

// Full mappable target list = control fields + dynamic form fields. The phone
// field is forced required (dedup needs the CLI).
export function buildFields(formFields, phoneKey) {
  const dyn = dynamicFields(formFields).map(f => f.key === phoneKey ? { ...f, required: true, isPhone: true } : f);
  return [...CONTROL_FIELDS, ...dyn];
}

// Header-name synonyms for the control fields + phone, for best-guess auto-map.
const SYNONYMS = {
  fronter_name: ['fronter', 'frontername', 'agent', 'agentname'],
  company_name: ['company', 'companyname', 'business', 'account'],
  transfer_date: ['transferdate', 'date', 'dateoftransfer'],
  status:       ['status', 'state', 'dispo', 'disposition'],
  created_at:   ['createdat', 'created', 'createddate', 'createddatetime', 'datetime', 'timestamp'],
};

// Best-guess mapping: match each target field to a file header by exact key,
// label, or synonym.
export function autoMap(headers, fields) {
  const mapping = {};
  const used = new Set();
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

// Apply a mapping to parsed rows. Control fields stay top-level; every dynamic
// field goes into form_data under its field name; unmapped-but-present headers
// are preserved in form_data too. cli_number = the phone field's value.
export function applyMapping(rows, mapping, formFields, phoneKey) {
  const dyn = dynamicFields(formFields);
  const dynByHeader = new Set(dyn.map(f => mapping[f.key]).filter(Boolean));
  const controlByHeader = new Set(CONTROL_FIELDS.map(f => mapping[f.key]).filter(Boolean));
  const mappedHeaders = new Set([...dynByHeader, ...controlByHeader]);

  return rows.map(r => {
    const out = { form_data: {} };
    CONTROL_FIELDS.forEach(f => { const h = mapping[f.key]; out[f.key] = h ? String(r[h] ?? '').trim() : ''; });
    dyn.forEach(f => {
      const h = mapping[f.key];
      const v = h ? String(r[h] ?? '').trim() : '';
      if (v !== '') out.form_data[f.key] = v;
    });
    // Preserve any extra columns the user didn't map (future-proof).
    Object.keys(r).forEach(h => {
      if (mappedHeaders.has(h)) return;
      const v = r[h];
      if (v !== '' && v != null) out.form_data[h] = v;
    });
    out.cli_number = phoneKey ? (out.form_data[phoneKey] || '') : '';
    return out;
  });
}

export const normPhone = (p) => String(p || '').replace(/\D/g, '').slice(-10);

// ── Batch export ─────────────────────────────────────────────────────────────
// One resolved transfer (the export endpoint adds fronter_name + company_name)
// → a value for one export column. Columns are { key, control } where control
// fields map to top-level transfer attributes and the rest read from form_data.
export function transferToValue(transfer, col) {
  const fd = transfer.form_data || {};
  if (col.control) {
    switch (col.key) {
      case 'fronter_name':  return transfer.fronter_name || '';
      case 'company_name':  return transfer.company_name || '';
      case 'transfer_date': return fd.transfer_date || '';
      case 'status':        return transfer.status || '';
      case 'created_at':    return transfer.created_at || '';
      default:              return '';
    }
  }
  return fd[col.key] != null ? fd[col.key] : '';
}

export function transferToRow(transfer, columns) {
  return columns.map(col => transferToValue(transfer, col));
}

// Sample CSV built from the CURRENT form config so the template always matches.
export function sampleTemplateCsv(formFields, phoneKey) {
  const fields = buildFields(formFields, phoneKey);
  const headers = fields.map(f => f.key);
  const sampleFor = (f) => {
    if (f.key === phoneKey || ['phone', 'tel'].includes(f.field_type)) return '5551234567';
    if (f.key === 'fronter_name') return 'John Smith';
    if (f.key === 'company_name') return 'Acme Auto Warranty';
    if (f.key === 'transfer_date') return '2026-05-20';
    if (f.key === 'created_at') return '2026-05-20 14:30';
    if (f.key === 'status') return 'pending';
    if (f.field_type === 'date') return '2026-05-20';
    if (f.field_type === 'email') return 'customer@example.com';
    if (f.field_type === 'number') return '0';
    return `Sample ${f.label}`;
  };
  const row = fields.map(sampleFor);
  return [headers, row].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}

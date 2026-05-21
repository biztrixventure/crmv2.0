// System fields the uploader recognizes. Everything else in the file becomes a
// custom field stored inside the transfer's form_data.
export const SYSTEM_FIELDS = [
  { key: 'cli_number',   label: 'CLI / Phone Number', required: true,  desc: 'The customer phone number (CLI). Used to detect duplicates.' },
  { key: 'fronter_name', label: 'Fronter Name',       required: true,  desc: 'Full name of the fronter — must match an existing fronter in the company.' },
  { key: 'company_name', label: 'Company Name',        required: true,  desc: 'Must match an existing company name exactly.' },
  { key: 'transfer_date', label: 'Transfer Date',      required: false, desc: 'The date of the transfer (e.g. 2026-05-20).' },
  { key: 'status',       label: 'Status',              required: false, desc: 'Transfer status. Defaults to "pending" if blank.' },
  { key: 'created_at',   label: 'Created Date/Time',   required: false, desc: 'When the transfer was created (e.g. 2026-05-20 14:30). Defaults to now if blank.' },
];

export const REQUIRED_FIELDS = SYSTEM_FIELDS.filter(f => f.required).map(f => f.key);

const norm = (s) => String(s || '').trim().toLowerCase().replace(/[\s_-]+/g, '');

// Guess a mapping from file headers by fuzzy-matching header names to field keys.
const SYNONYMS = {
  cli_number:   ['cli', 'clinumber', 'phone', 'phonenumber', 'number', 'mobile', 'cell', 'customerphone'],
  fronter_name: ['fronter', 'frontername', 'agent', 'agentname', 'fronteragent'],
  company_name: ['company', 'companyname', 'business', 'account'],
  transfer_date: ['transferdate', 'date', 'dateoftransfer'],
  status:       ['status', 'state', 'dispo', 'disposition'],
  created_at:   ['createdat', 'created', 'createddate', 'createddatetime', 'datetime', 'timestamp'],
};

export function autoMap(headers) {
  const mapping = {};
  const used = new Set();
  SYSTEM_FIELDS.forEach(f => {
    const cand = headers.find(h => {
      if (used.has(h)) return false;
      const n = norm(h);
      return n === norm(f.key) || (SYNONYMS[f.key] || []).some(s => n === s || n.includes(s));
    });
    if (cand) { mapping[f.key] = cand; used.add(cand); }
  });
  return mapping;
}

// Apply a mapping to parsed rows → normalized rows the backend expects.
// Unmapped headers (with a value) go into custom_fields.
export function applyMapping(rows, mapping) {
  const sysHeaders = new Set(Object.values(mapping).filter(Boolean));
  return rows.map(r => {
    const out = { custom_fields: {} };
    SYSTEM_FIELDS.forEach(f => {
      const h = mapping[f.key];
      out[f.key] = h ? String(r[h] ?? '').trim() : '';
    });
    Object.keys(r).forEach(h => {
      if (sysHeaders.has(h)) return;
      const v = r[h];
      if (v !== '' && v != null) out.custom_fields[h] = v;
    });
    return out;
  });
}

// Normalize a phone to last-10-digits (mirrors the backend) for in-file dedup.
export const normPhone = (p) => String(p || '').replace(/\D/g, '').slice(-10);

// Downloadable sample CSV: correct headers + a couple of example rows.
export function sampleTemplateCsv() {
  const headers = ['cli_number', 'fronter_name', 'company_name', 'transfer_date', 'status', 'created_at', 'notes'];
  const rows = [
    ['5551234567', 'John Smith',  'Acme Auto Warranty', '2026-05-20', 'pending', '2026-05-20 14:30', 'Interested in extended plan'],
    ['5559876543', 'Jane Doe',    'Acme Auto Warranty', '2026-05-20', 'pending', '2026-05-20 15:05', 'Callback requested'],
  ];
  return [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}

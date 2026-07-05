// ============================================================================
// saleCopyFields.js — the catalog of copyable sale fields + the builder that
// turns a copy PRESET into a clipboard string. Shared by the drawer's copy
// buttons and the preset editor, so "what can be copied" has ONE source.
//
// A preset = { id, name, sep, fields:[fieldKey,...] }. Clicking its button emits
// each field's value in order, joined by the chosen separator (default TAB, so a
// paste into one spreadsheet cell spreads across columns).
// ============================================================================

const SALE_LABEL = {
  open: 'Pending', sold: 'Sold', cancelled: 'Cancelled', follow_up: 'Follow Up',
  closed_won: 'Approved', closed_lost: 'Lost', pending_review: 'In Review', needs_revision: 'Needs Revision',
};

// form_data getter: first non-empty of the given keys.
const gd = (fd, ...keys) => { for (const k of keys) { const v = fd?.[k]; if (v != null && String(v).trim() !== '') return String(v).trim(); } return ''; };
const asDate = (v) => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? '' : d.toISOString().slice(0, 10); };
const planYearsOf = (fd) => { const m = String(gd(fd, 'PlanDuration')).match(/(\d+)/); return m ? parseInt(m[1], 10) : null; };
const maturityOf = (sale, fd) => {
  const yrs = planYearsOf(fd);
  if (!sale.sale_date || !yrs) return '';
  const d = new Date(String(sale.sale_date).slice(0, 10) + 'T00:00:00');
  if (isNaN(d)) return '';
  d.setFullYear(d.getFullYear() + yrs);
  return d.toISOString().slice(0, 10);
};
const nameOf = (sale, fd) => sale.customer_name || [gd(fd, 'FirstName'), gd(fd, 'LastName')].filter(Boolean).join(' ');

// ── the catalog. `fin: true` = only emitted when the viewer has financial access.
// `get(sale, formData) → value`. Keep keys STABLE — presets store these keys.
export const SALE_COPY_FIELDS = [
  { key: 'sale_date',     label: 'Sale Date',        get: (s, fd) => String(s.sale_date || gd(fd, 'SaleDate') || '').slice(0, 10) },
  { key: 'cli',           label: 'CLI / Phone',      get: (s, fd) => s.customer_phone || gd(fd, 'Phone', 'cli_number', 'customer_phone') },
  { key: 'phone2',        label: 'Phone 2',          get: (s, fd) => s.customer_phone_2 || gd(fd, 'Phone2') },
  { key: 'client',        label: 'Client / Project', get: (s, fd) => s.client_name || gd(fd, 'SaleClient') },
  { key: 'status',        label: 'Status',           get: (s) => SALE_LABEL[s.status] || s.status || '' },
  { key: 'post_date',     label: 'Post Date',        get: (s) => asDate(s.charge_at) },
  { key: 'maturity',      label: 'Maturity Date',    get: (s, fd) => maturityOf(s, fd) },
  { key: 'name',          label: 'Customer Name',    get: (s, fd) => nameOf(s, fd) },
  { key: 'zip',           label: 'ZIP',              get: (s, fd) => gd(fd, 'Zip') },
  { key: 'city',          label: 'City',             get: (s, fd) => gd(fd, 'City') },
  { key: 'state',         label: 'State',            get: (s, fd) => gd(fd, 'State') },
  { key: 'address',       label: 'Address',          get: (s, fd) => s.customer_address || gd(fd, 'Address') },
  { key: 'email',         label: 'Email',            get: (s, fd) => s.customer_email || gd(fd, 'Email') },
  { key: 'year',          label: 'Vehicle Year',     get: (s, fd) => s.car_year || gd(fd, 'CarYear') },
  { key: 'make',          label: 'Vehicle Make',     get: (s, fd) => s.car_make || gd(fd, 'CarMake') },
  { key: 'model',         label: 'Vehicle Model',    get: (s, fd) => s.car_model || gd(fd, 'CarModel') },
  { key: 'miles',         label: 'Miles',            get: (s, fd) => s.car_miles || gd(fd, 'Miles') },
  { key: 'vin',           label: 'VIN',              get: (s, fd) => s.car_vin || gd(fd, 'VIN') },
  { key: 'plan',          label: 'Plan',             get: (s) => s.plan || '' },
  { key: 'plan_duration', label: 'Plan Duration',    get: (s, fd) => gd(fd, 'PlanDuration') },
  { key: 'monthly',       label: 'Monthly Amount',   fin: true, get: (s, fd) => s.monthly_payment || gd(fd, 'SaleMonthlyPayment') },
  { key: 'down',          label: 'Down Payment',     fin: true, get: (s, fd) => s.down_payment || gd(fd, 'SaleDownPayment') },
  { key: 'closer',        label: 'Closer Name',      get: (s) => s.closer_name || '' },
  { key: 'fronter',       label: 'Fronter / Employee', get: (s) => s.fronter_name || '' },
  { key: 'ref',           label: 'Policy / Ref #',   get: (s, fd) => s.policy_number || s.reference_no || gd(fd, 'SaleReferenceNo') },
  { key: 'comments',      label: 'Comments',         get: (s) => s.compliance_note || '' },
  { key: 'created',       label: 'Created At',       get: (s) => asDate(s.created_at) },
  { key: 'blank',         label: '(blank column)',   get: () => '' },
];

export const FIELD_BY_KEY = Object.fromEntries(SALE_COPY_FIELDS.map(f => [f.key, f]));

export const COPY_SEPARATORS = [
  { key: 'tab',     label: 'Tab (spreadsheet row →)', ch: '\t' },
  { key: 'newline', label: 'New line (column ↓)',      ch: '\n' },
  { key: 'comma',   label: 'Comma',                    ch: ', ' },
  { key: 'pipe',    label: 'Pipe |',                   ch: ' | ' },
  { key: 'space',   label: 'Space',                    ch: ' ' },
];
const SEP_CH = Object.fromEntries(COPY_SEPARATORS.map(s => [s.key, s.ch]));

// The built-in "Silverton" format = the exact 29-column sheet layout that used to
// be hardcoded, so behaviour is unchanged until a manager makes their own presets.
export const DEFAULT_PRESET = {
  id: 'silverton', name: 'Silverton', sep: 'tab',
  fields: [
    'sale_date', 'cli', 'client', 'status', 'post_date', 'maturity', 'blank', // Payment Status (not stored)
    'name', 'zip', 'year', 'make', 'model', 'miles', 'plan_duration', 'monthly', 'down', 'vin',
    'closer', 'fronter', 'address', 'city', 'state',
    'blank', 'blank', 'blank', 'blank',                                       // Payment Method, Card #, CVV, Expiry (not stored)
    'email', 'ref', 'comments',
  ],
};

// Build the clipboard string for a preset. `canFinancial` blanks $ fields when off.
export function buildCopyString(preset, sale, formData, canFinancial) {
  const fd = formData || {};
  const sep = SEP_CH[preset?.sep] ?? '\t';
  return (preset?.fields || []).map(k => {
    const f = FIELD_BY_KEY[k];
    if (!f) return '';
    if (f.fin && !canFinancial) return '';
    let v = '';
    try { v = f.get(sale, fd); } catch { v = ''; }
    return String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();
  }).join(sep);
}

// Normalize whatever is stored in config into a clean preset array.
export function readPresets(config) {
  const raw = config?.['copy_presets.sale'];
  if (!Array.isArray(raw) || !raw.length) return [DEFAULT_PRESET];
  return raw
    .filter(p => p && typeof p === 'object' && Array.isArray(p.fields))
    .map((p, i) => ({ id: p.id || `preset_${i}`, name: p.name || `Copy ${i + 1}`, sep: p.sep || 'tab', fields: p.fields.filter(k => FIELD_BY_KEY[k]) }));
}

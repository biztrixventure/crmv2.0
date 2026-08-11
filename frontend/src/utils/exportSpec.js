// ============================================================================
// exportSpec — the single catalog of EXPORT columns, shared by every shell.
//
// WHY THIS EXISTS
// export.columns has been storable since migration 167, but nothing obeyed it:
// each export hardcoded its own header array and built rows by position, so
// unchecking a field only blanked the cell and left the column in the file.
// Worse, the admin checkbox list was a separate literal that had drifted — it
// offered nine sale fields no export has ever written.
//
// So the checkbox list and the row accessor are now THE SAME ARRAY. A column
// exists here or it does not exist at all; the admin UI renders from `columns`
// and the exporter reads values through the same `get()`. That makes "a control
// the code doesn't honour" unrepresentable rather than merely discouraged.
//
// SHAPE
//   columns:  [{ key, label, headerKey?, get(row, ctx, index) }]
//   surfaces: { <surfaceId>: { columns: [key…], header?: 'label' | 'key' } }
//
// A SURFACE is one export button (compliance_sales, manager_transfers, …). Its
// `columns` list is the DEFAULT file for that button — which is how today's
// files stay unchanged until a superadmin configures something. When a config
// exists for the caller's role/user it replaces the default list, which is what
// lets a manager's transfer export become the compliance one.
//
// `header: 'key'` emits the raw column key as the header instead of the label.
// Only exports whose headers are consumed as field names use it (the Manager
// sales round-trip, Numbers Intelligence).
// ============================================================================
import client from '../api/client';
import {
  STATUS_LABEL, fmtDate, fmtDateTime, customerName, closerName, downloadCSV,
} from './recordFormat';
import { fmtSaleDate } from './timezone';
import { transferPhone } from './phone';
import { salePaidTenure } from './saleTenure';

export { downloadCSV };

// Cancel date + paid tenure belong ONLY to a cancelled sale — a live sale can
// carry a stale cancellation_date, so those cells stay blank for it.
const CANCELLED = new Set(['cancelled', 'compliance_cancelled', 'closed_lost', 'chargeback', 'dispute']);

// Why a transfer is flagged duplicate (transfer_dedup_events.event_type).
export const DUP_REASON_LABEL = {
  refresh:      'Re-transferred within the dedup window — it updated the existing lead in place, so no separate transfer row was created. Shown here so the count reconciles with VICIDIAL.',
  reengage:     'Re-engaged after the dedup window (a fresh transfer was created)',
  sale_overlap: 'A completed sale already existed on the prior lead',
};

// Compliance drives its status labels off the configurable workflow (labelOf);
// every other surface falls back to the static map. Threading ctx.labelOf
// through is what keeps the compliance file identical to today's.
const statusLabel = (v, ctx) =>
  (ctx?.labelOf ? ctx.labelOf(v) : null) || STATUS_LABEL[v] || v || '';

// DP Status (mig 243, column payout_status) — a separate lifecycle from
// `status` above, so it gets its own small label map rather than sharing
// statusLabel/STATUS_LABEL. Payout Status (mig 244, column payout_confirmed)
// is a second, independent field — a manual tri-state (pending/yes/no).
const PAYOUT_STATUS_LABEL = { pending: 'Pending', paid: 'Paid', reverted: 'Reverted' };
const PAYOUT_CONFIRMED_LABEL = { pending: 'Pending', yes: 'Yes', no: 'No' };

// ── datasets ─────────────────────────────────────────────────────────────────
export const DATASETS = {
  sales: {
    label: 'Sales',
    rowsKey: 'sales',
    columns: [
      { key: 'customer_name',   label: 'Customer',  get: s => s.customer_name || '' },
      { key: 'customer_phone',  label: 'Phone',     get: s => s.customer_phone || '' },
      { key: 'customer_email',  label: 'Email',     get: s => s.customer_email || '' },
      { key: 'reference_no',    label: 'Reference', get: s => s.reference_no || '' },
      { key: 'status',          label: 'Status',    get: (s, ctx) => statusLabel(s.status, ctx) },
      { key: 'fronter_name',    label: 'Fronter',   get: s => s.fronter_name || '' },
      { key: 'closer_name',     label: 'Closer',    get: s => closerName(s) },
      { key: 'company_name',    label: 'Company',   get: s => s.companies?.name || s.company_name || '' },
      { key: 'sale_date',       label: 'Sale Date', get: s => (s.sale_date ? fmtSaleDate(s.sale_date) : fmtDate(s.created_at)) },
      { key: 'cancellation_date', label: 'Cancellation Date',
        get: s => ((CANCELLED.has(s.status) && s.cancellation_date) ? fmtSaleDate(s.cancellation_date) : '') },
      { key: 'paid_days',   label: 'Paid Days',
        get: s => { const t = CANCELLED.has(s.status) ? salePaidTenure(s) : null; return t ? t.days : ''; } },
      { key: 'paid_tenure', label: 'Paid Tenure',
        get: s => { const t = CANCELLED.has(s.status) ? salePaidTenure(s) : null; return t ? t.label : ''; } },
      { key: 'created_at',      label: 'Created',   get: s => fmtDate(s.created_at) },
      { key: 'plan',            label: 'Plan',      get: s => s.plan || '' },
      { key: 'client_name',     label: 'Client',    get: s => s.client_name || '' },
      { key: 'monthly_payment', label: 'Monthly',   get: s => (s.monthly_payment ? `$${s.monthly_payment}` : '') },
      { key: 'down_payment',    label: 'Down Payment', get: s => (s.down_payment ? `$${s.down_payment}` : '') },
      { key: 'compliance_note', label: 'Compliance Note', get: s => s.compliance_note || '' },
      { key: 'customer_uuid',   label: 'Customer UUID',   get: s => s.customer_uuid || '' },
      // DP Status (mig 243, payout_status) — pending/paid/reverted, tracked
      // independently of the sale's own compliance `status` above.
      { key: 'payout_status',   label: 'DP Status',       get: s => PAYOUT_STATUS_LABEL[s.payout_status] || s.payout_status || '' },
      // Payout Status (mig 244, payout_confirmed) — manual tri-state.
      { key: 'payout_confirmed', label: 'Payout Status',  get: s => PAYOUT_CONFIRMED_LABEL[s.payout_confirmed] || s.payout_confirmed || 'Pending' },
    ],
    surfaces: {
      // The reference export — every other sales surface converges on this list
      // once a superadmin configures the role.
      compliance_sales: { columns: ['customer_name', 'customer_phone', 'customer_email', 'reference_no', 'status', 'fronter_name', 'closer_name', 'company_name', 'sale_date', 'cancellation_date', 'paid_days', 'paid_tenure'] },
      compliance_queue: { columns: ['customer_name', 'customer_phone', 'reference_no', 'closer_name', 'company_name', 'created_at'] },
      company_sales:    { columns: ['customer_name', 'customer_phone', 'reference_no', 'fronter_name', 'closer_name', 'status', 'plan', 'monthly_payment', 'created_at'] },
      staff_sales:      { columns: ['customer_name', 'customer_phone', 'reference_no', 'status', 'sale_date', 'plan', 'monthly_payment', 'down_payment'] },
      // SuperAdmin payout report — exact column order requested: sale date,
      // phone, customer, client, down payment, plan, compliance status,
      // DP Status, Payout Status.
      payout_sales:     { columns: ['sale_date', 'customer_phone', 'customer_name', 'client_name', 'down_payment', 'plan', 'status', 'payout_status', 'payout_confirmed'] },
      // manager_sales is DYNAMIC: its default columns come from form_fields at
      // runtime (saleExportColumns), which is why `columns` is empty — an empty
      // surface list means "use the caller's extraColumns". Its headers are
      // bulk-uploader field keys, so an exported file re-uploads without any
      // header re-mapping, hence header: 'key'.
      manager_sales:    { header: 'key', columns: [] },
    },
  },

  transfers: {
    label: 'Transfers',
    rowsKey: 'transfers',
    columns: [
      { key: 'customer_name',        label: 'Customer',    get: t => customerName(t) },
      { key: 'customer_phone',       label: 'Phone',       get: t => transferPhone(t) },
      { key: 'created_by_name',      label: 'Fronter',     get: t => t.created_by_name || t.fronter_name || '' },
      { key: 'assigned_closer_name', label: 'Closer',
        get: t => t.assigned_closer_name || (t.closer ? `${t.closer.first_name || ''} ${t.closer.last_name || ''}`.trim() : '') || '' },
      { key: 'latest_disposition',   label: 'Disposition', get: t => t.latest_disposition?.disposition_name || '' },
      { key: 'company_name',         label: 'Company',     get: t => t.company_name || '' },
      { key: 'status',               label: 'Status',      get: (t, ctx) => statusLabel(t.status, ctx) },
      { key: 'created_at',           label: 'Transfer Date', get: t => fmtDate(t.created_at) },
      { key: 'is_duplicate',         label: 'Is Duplicate',  get: t => (t.is_duplicate ? 'Yes' : 'No') },
      { key: 'duplicate_reason',     label: 'Duplicate Reason',
        get: t => (t.is_duplicate ? (DUP_REASON_LABEL[t.duplicate_reason] || t.duplicate_reason || '') : '') },
      { key: 'sale_reference_no',    label: 'Sale Ref',      get: t => t.sale_reference_no || '' },
      { key: 'customer_uuid',        label: 'Customer UUID', get: t => t.customer_uuid || '' },
    ],
    surfaces: {
      compliance_transfers: { columns: ['customer_name', 'customer_phone', 'created_by_name', 'assigned_closer_name', 'latest_disposition', 'company_name', 'status', 'created_at', 'is_duplicate', 'duplicate_reason'] },
      manager_transfers:    { columns: ['customer_name', 'customer_phone', 'status', 'created_by_name', 'assigned_closer_name', 'sale_reference_no', 'created_at'] },
      company_transfers:    { columns: ['customer_name', 'customer_phone', 'created_by_name', 'assigned_closer_name', 'status', 'created_at'] },
      staff_transfers:      { columns: ['customer_name', 'customer_phone', 'status', 'assigned_closer_name', 'created_at'] },
    },
  },

  callbacks: {
    label: 'Callbacks',
    rowsKey: 'callbacks',
    columns: [
      { key: 'customer_name',  label: 'Customer',     get: c => c.customer_name || '' },
      { key: 'customer_phone', label: 'Phone',        get: c => c.customer_phone || '' },
      { key: 'callback_at',    label: 'Scheduled At', get: c => fmtDateTime(c.callback_at) },
      { key: 'status',         label: 'Status',       get: (c, ctx) => statusLabel(c.status, ctx) },
      { key: 'priority',       label: 'Priority',     get: c => c.priority || 'Medium' },
      { key: 'notes',          label: 'Notes',        get: c => c.notes || '' },
      // Fronter/Closer are ONE source column (user_name) split by company_type,
      // which is why both list company_type as a dependency server-side.
      { key: 'fronter_name',   label: 'Fronter',
        get: (c, ctx) => (((c.company_type || ctx?.companyType) === 'fronter') ? (c.user_name || '') : '') },
      { key: 'closer_name',    label: 'Closer',
        get: (c, ctx) => (((c.company_type || ctx?.companyType) === 'closer') ? (c.user_name || '') : '') },
      { key: 'agent_name',     label: 'Agent',        get: c => c.user_name || '' },
      { key: 'company_name',   label: 'Company',      get: c => c.company_name || '' },
      { key: 'created_at',     label: 'Created',      get: c => fmtDate(c.created_at) },
    ],
    surfaces: {
      compliance_callbacks:   { columns: ['customer_name', 'customer_phone', 'callback_at', 'status', 'priority', 'notes', 'fronter_name', 'closer_name', 'company_name'] },
      manager_team_callbacks: { columns: ['customer_name', 'customer_phone', 'callback_at', 'status', 'priority', 'notes', 'fronter_name', 'closer_name'] },
      manager_callbacks:      { columns: ['customer_name', 'customer_phone', 'callback_at', 'status', 'priority', 'notes', 'agent_name', 'created_at'] },
      company_callbacks:      { columns: ['customer_name', 'customer_phone', 'priority', 'fronter_name', 'closer_name', 'status', 'callback_at'] },
      staff_callbacks:        { columns: ['customer_name', 'customer_phone', 'callback_at', 'status', 'priority', 'notes'] },
    },
  },

  callback_audit: {
    label: 'Callback Audit Log',
    rowsKey: 'entries',
    columns: [
      { key: 'created_at',       label: 'Timestamp',        get: e => fmtDateTime(e.created_at) },
      { key: 'actor_name',       label: 'Actor',            get: e => e.actor_name || e.actor_id || '—' },
      { key: 'customer_name',    label: 'Customer',         get: e => e.customer_name_snapshot || '—' },
      { key: 'customer_phone',   label: 'Phone',            get: e => e.customer_phone_snapshot || '—' },
      { key: 'old_status',       label: 'From Status',      get: (e, ctx) => statusLabel(e.old_status, ctx) || '—' },
      { key: 'new_status',       label: 'To Status',        get: (e, ctx) => statusLabel(e.new_status, ctx) || '—' },
      { key: 'notes',            label: 'Notes',            get: e => e.notes || '' },
      { key: 'callback_deleted', label: 'Callback Deleted', get: e => (e.callback_deleted ? 'Yes' : 'No') },
    ],
    surfaces: {
      compliance_callback_audit: { columns: ['created_at', 'actor_name', 'customer_name', 'customer_phone', 'old_status', 'new_status', 'notes', 'callback_deleted'] },
    },
  },

  reviews: {
    label: 'Call Reviews',
    rowsKey: 'reviews',
    columns: [
      { key: 'customer_name', label: 'Customer', get: r => customerName(r.transfers) || '' },
      { key: 'company_name',  label: 'Company',  get: (r, ctx) => ctx?.companyName?.(r.company_id) || '' },
      { key: 'reviewer_name', label: 'Closer',
        get: r => (r.user_profiles ? `${r.user_profiles.first_name || ''} ${r.user_profiles.last_name || ''}`.trim() : '') },
      { key: 'rating',        label: 'Rating',   get: r => r.rating || '' },
      { key: 'notes',         label: 'Notes',    get: r => r.notes || '' },
      { key: 'created_at',    label: 'Date',     get: r => fmtDate(r.created_at) },
    ],
    surfaces: {
      compliance_reviews: { columns: ['customer_name', 'company_name', 'reviewer_name', 'rating', 'notes', 'created_at'] },
    },
  },

  users: {
    label: 'Users',
    rowsKey: 'users',
    columns: [
      { key: 'name',       label: 'Name',   get: u => `${u.first_name || ''} ${u.last_name || ''}`.trim() },
      { key: 'email',      label: 'Email',  get: u => u.email || '' },
      { key: 'role',       label: 'Role',   get: u => u.role || '' },
      { key: 'is_active',  label: 'Status', get: u => (u.is_active ? 'Active' : 'Inactive') },
      { key: 'created_at', label: 'Joined', get: u => fmtDate(u.created_at) },
    ],
    surfaces: {
      manager_users: { columns: ['name', 'email', 'role', 'is_active', 'created_at'] },
    },
  },

  // The company Members CSV inside CompanyDetail. Rows are already loaded into
  // the panel, so like reports it carries the soft client-log audit rather than
  // the __egress marker.
  company_members: {
    label: 'Company Members',
    aggregate: true,
    columns: [
      { key: 'name',      label: 'Name',   get: u => [u.first_name, u.last_name].filter(Boolean).join(' ') || '' },
      { key: 'email',     label: 'Email',  get: u => u.email || '' },
      { key: 'role',      label: 'Role',   get: u => u.role || '' },
      { key: 'level',     label: 'Level',  get: u => u.role_level?.replace(/_/g, ' ') || '' },
      { key: 'is_active', label: 'Status', get: u => (u.is_active ? 'Active' : 'Inactive') },
    ],
    surfaces: {
      company_members: { columns: ['name', 'email', 'role', 'level', 'is_active'] },
    },
  },

  numbers: {
    label: 'Numbers Intelligence',
    rowsKey: 'numbers',
    columns: [
      { key: 'phone_number',   label: 'Phone Number',   get: n => n.phone_number || '' },
      { key: 'customer_name',  label: 'Customer Name',  get: n => n.customer_name || '' },
      { key: 'status',         label: 'Status',         get: n => n.status || '' },
      { key: 'list_name',      label: 'List Name',      get: n => n.list_name || '' },
      { key: 'assignment_day', label: 'Assignment Day', get: n => n.assignment_day || '' },
      { key: 'fronter_name',   label: 'Fronter',        get: n => n.fronter_name || '' },
      { key: 'company_name',   label: 'Company',        get: n => n.company_name || '' },
      { key: 'transferred_at', label: 'Transferred At', get: n => n.transferred_at || '' },
    ],
    surfaces: {
      // Headers here have always been the raw keys and downstream sheets are
      // keyed on them, so this surface stays in key mode.
      numbers_intelligence: { header: 'key', columns: ['phone_number', 'customer_name', 'status', 'list_name', 'assignment_day', 'fronter_name', 'company_name', 'transferred_at'] },
    },
  },

  // Reports are CLIENT-SIDE aggregates (leaderboard rows built in the browser
  // from already-fetched records), so the server-side value strip has nothing
  // left to intercept — the column filter here is the only enforcement point,
  // and the audit row comes from logClientExport rather than the __egress
  // marker. Configurable, but honestly weaker than a record export.
  reports_fronters: {
    label: 'Reports — Fronters',
    aggregate: true,
    columns: [
      { key: 'rank',      label: 'Rank',      get: (r, ctx, i) => i + 1 },
      { key: 'name',      label: 'Name',      get: r => r.name || '' },
      { key: 'total',     label: 'Leads',     get: r => r.total },
      { key: 'completed', label: 'Connected', get: r => r.completed },
      { key: 'converted', label: 'Converted', get: r => r.converted },
      { key: 'rejected',  label: 'Rejected',  get: r => r.rejected },
      { key: 'conv_pct',  label: 'Conv %',    get: r => (r.total > 0 ? `${Math.round((r.converted / r.total) * 100)}%` : '0%') },
    ],
    surfaces: {
      reports_fronters: { columns: ['rank', 'name', 'total', 'completed', 'converted', 'rejected', 'conv_pct'] },
    },
  },

  reports_closers: {
    label: 'Reports — Closers',
    aggregate: true,
    columns: [
      { key: 'rank',     label: 'Rank',             get: (r, ctx, i) => i + 1 },
      { key: 'name',     label: 'Name',             get: r => r.name || '' },
      { key: 'total',    label: 'Sales',            get: r => r.total },
      { key: 'won',      label: 'Won',              get: r => r.won },
      { key: 'win_rate', label: 'Win Rate',         get: r => (r.total > 0 ? `${Math.round((r.won / r.total) * 100)}%` : '0%') },
      { key: 'revenue',  label: 'Down Payment Rev', get: r => `$${Number(r.revenue || 0).toLocaleString()}` },
    ],
    surfaces: {
      reports_closers: { columns: ['rank', 'name', 'total', 'won', 'win_rate', 'revenue'] },
    },
  },
};

// Every dataset here has a fixed column list, so every one of them is safe to
// render checkboxes for. (Manager sales is deliberately NOT a dataset: its
// columns come from form_fields at runtime, so a static checkbox list could not
// honour them — the same mistake the old EXPORT_DATASETS literal made.)
export const CONFIGURABLE_DATASETS = Object.keys(DATASETS);

// ── form-field columns ───────────────────────────────────────────────────────
// A column the admin added from the live form_fields catalog, stored as
// `fd:<field name>`. These are SYNTHESIZED at export time, so a surface does not
// have to fetch the form catalog for an added field to produce a value — which
// is what makes the "add a field that isn't part of this role" control real
// rather than a checkbox that quietly does nothing.
//
// The header is the raw field name, matching how form-field keys already travel
// through the bulk uploader.
export const FORM_FIELD_PREFIX = 'fd:';
export const isFormFieldKey = (k) => typeof k === 'string' && k.startsWith(FORM_FIELD_PREFIX);
export function formFieldColumn(key, label) {
  const name = key.slice(FORM_FIELD_PREFIX.length);
  return {
    key, label: label || name, headerKey: name, formField: true,
    get: (row) => {
      const v = (row?.form_data || {})[name];
      if (v == null) return '';
      return typeof v === 'object' ? JSON.stringify(v) : v;
    },
  };
}

// Datasets whose rows carry form_data, so form-field columns can resolve.
export const FORM_DATA_DATASETS = ['sales', 'transfers'];

export const datasetColumns = (dataset) => DATASETS[dataset]?.columns || [];
export const columnLabel = (dataset, key) =>
  datasetColumns(dataset).find(c => c.key === key)?.label || key;

// Which surface a role's export button uses for a dataset — the admin UI needs
// this to show that role's real current defaults next to the checkboxes.
const ROLE_SURFACE = {
  sales:     { compliance_manager: 'compliance_sales', superadmin: 'compliance_sales', readonly_admin: 'compliance_sales', closer: 'staff_sales', fronter: 'staff_sales' },
  transfers: { compliance_manager: 'compliance_transfers', superadmin: 'compliance_transfers', readonly_admin: 'compliance_transfers', closer: 'staff_transfers', fronter: 'staff_transfers' },
  callbacks: { compliance_manager: 'compliance_callbacks', superadmin: 'compliance_callbacks', readonly_admin: 'compliance_callbacks', closer: 'staff_callbacks', fronter: 'staff_callbacks' },
};
const DEFAULT_SURFACE = {
  sales: 'company_sales', transfers: 'manager_transfers', callbacks: 'manager_callbacks',
  callback_audit: 'compliance_callback_audit', reviews: 'compliance_reviews', users: 'manager_users',
  numbers: 'numbers_intelligence', reports_fronters: 'reports_fronters', reports_closers: 'reports_closers',
  company_members: 'company_members',
};
export function defaultColumnsForRole(dataset, role) {
  const ds = DATASETS[dataset];
  if (!ds) return [];
  const surface = ds.surfaces[ROLE_SURFACE[dataset]?.[role] || DEFAULT_SURFACE[dataset]];
  if (surface) return surface.columns;
  const first = Object.values(ds.surfaces)[0];   // never show an empty list
  return first ? first.columns : ds.columns.map(c => c.key);
}

// ── column resolution ────────────────────────────────────────────────────────
// allowed == null → unconfigured → the surface's own default list (today's file)
// allowed != null → the configured list, in configured order, minus any key this
//                   dataset doesn't actually have, so a stale config can never
//                   widen the file to columns nothing can produce.
export function resolveColumns(dataset, surfaceId, allowed, extraColumns) {
  const ds = DATASETS[dataset];
  const extra = extraColumns || [];
  if (!ds) {
    // Dynamic surface (manager sales): the caller supplies the whole column set.
    const byKey = new Map(extra.map(c => [c.key, c]));
    const keys = (Array.isArray(allowed) && allowed.length) ? allowed : extra.map(c => c.key);
    return { columns: keys.map(k => byKey.get(k)).filter(Boolean), header: 'key' };
  }
  const surface = ds.surfaces[surfaceId] || { columns: ds.columns.map(c => c.key) };
  const byKey = new Map([...ds.columns, ...extra].map(c => [c.key, c]));
  // An empty surface list means the surface is dynamic — its default IS whatever
  // columns the caller supplied (Manager sales, built from form_fields).
  const base = surface.columns.length ? surface.columns : extra.map(c => c.key);
  const keys = (Array.isArray(allowed) && allowed.length) ? allowed : base;
  return {
    // A configured key the catalog doesn't know is a form field if it carries
    // the fd: prefix — synthesize it. Anything else is stale config and is
    // dropped, so a rename can never widen the file to a column nothing writes.
    columns: keys.map(k => byKey.get(k) || (isFormFieldKey(k) ? formFieldColumn(k) : null)).filter(Boolean),
    header: surface.header === 'key' ? 'key' : 'label',
  };
}

export const headerFor = (col, mode) => (mode === 'key' ? (col.headerKey || col.key) : col.label);

// ── paged fetch with the egress markers ──────────────────────────────────────
// Fetch EVERY page of a paginated list for export — no 5,000-row cap. Loops
// 5,000-row pages until the server's `total` is reached (or a short page ends
// it). `onProgress(loaded, total)` is optional.
//
// EGRESS GOVERNANCE: the page-1 request carries the __egress + __dataset markers
// so the server's egressAudit middleware enforces the limits and WRITES THE
// AUDIT ROW (the row cap is checked against `total` before the drain). A blocked
// export returns 429 on page 1 → surfaced as a typed EgressBlockedError.
// `opts.pageSize` matters: the drain stops on a SHORT page, so asking for more
// rows than an endpoint will return truncates the export silently. The
// compliance endpoints serve 5,000; the manager /sales and /transfers lists cap
// near 1,000 and /callbacks at 200, so those callers pass their real page size.
export async function fetchAllForExport(endpoint, params = {}, dataKey, onProgress, dataset, opts = {}) {
  const PAGE = opts.pageSize || 5000;
  const out = [];
  const egressMarker = { __egress: 'csv_export', __dataset: dataset || dataKey };
  try {
    for (let page = 1; page <= 4000; page++) {   // safety cap (~20M rows)
      const res = await client.get(endpoint, { params: { ...params, ...egressMarker, limit: PAGE, page } });
      const rows = res.data?.[dataKey] || [];
      out.push(...rows);
      const total = res.data?.total;
      if (onProgress) onProgress(out.length, typeof total === 'number' ? total : out.length);
      if (rows.length < PAGE) break;                        // last (short) page
      if (typeof total === 'number' && out.length >= total) break;
    }
  } catch (err) {
    if (err?.response?.status === 429 && err.response.data?.code === 'EGRESS_LIMIT') {
      const e = new Error(err.response.data.error || 'Export blocked by your limit.');
      e.egressBlocked = true;
      throw e;
    }
    throw err;
  }
  return out;
}

// ── the one export runner ────────────────────────────────────────────────────
// Rows + a resolved column list → the downloaded file. `footer` receives the
// resolved columns so a summary row (compliance transfers carries one) places
// its cells by column KEY, not by a positional index a configured column list
// would silently shift.
export function writeExport({ dataset, surface, allowed, rows, filename, ctx, footer, extraColumns }) {
  const { columns, header } = resolveColumns(dataset, surface, allowed, extraColumns);
  if (!columns.length) return { count: 0, columns: [] };
  const headers = columns.map(c => headerFor(c, header));
  const body = rows.map((row, i) => columns.map(c => c.get(row, ctx, i)));
  for (const f of (footer ? (footer(columns, rows) || []) : [])) {
    body.push(columns.map(c => (f[c.key] != null ? f[c.key] : '')));
  }
  downloadCSV(body, headers, filename);
  return { count: rows.length, columns: columns.map(c => c.key) };
}

// Soft audit for exports with no list request left to intercept (client-side
// aggregates, already-loaded in-memory tables). row_count is client-supplied so
// this is an audit record + daily-cap check, not a hard gate — but it means no
// export path is unlogged. Returns false when the daily cap blocks it.
export async function logClientExport(dataset, rowCount, filters) {
  try {
    await client.post('egress/client-log', { dataset, row_count: rowCount, filters: filters || null });
    return true;
  } catch (err) {
    if (err?.response?.data?.code === 'EGRESS_LIMIT') return false;
    return true;   // a logging outage must not block the user's export
  }
}

// ============================================================================
// KPI catalog — the single source of truth the SuperAdmin KPI builder and the
// shells share.
//
//   KPI_METRICS[shell]  — the menu of data points (numbers) an admin can drop
//                         into a card's value slots. Each shell builds a
//                         matching { metricKey: { value, onClick, title } } map
//                         at runtime (see *Shell.jsx), so the keys here MUST
//                         match the keys the shell produces.
//
//   KPI_CARDS[shell][k] — a card's shipped defaults: label, description, and an
//                         ordered list of up to 3 segments (which metric each
//                         number shows + its sub-label). The admin can override
//                         any of these per shell AND per role; absence falls
//                         back to these defaults so a fresh install looks
//                         exactly like before.
//
// `conversion` is intentionally NOT segment-configurable — it's a single % tile
// rendered specially by the staff shell. It still honors show/hide per role.
// ============================================================================

export const KPI_METRICS = {
  staff: [
    { key: 'sales_today',     label: 'My Sales · Today' },
    { key: 'sales_month',     label: 'My Sales · This Month' },
    { key: 'sales_total',     label: 'My Sales · Total' },
    { key: 'approved_today',  label: 'Approved · Today' },
    { key: 'approved_month',  label: 'Approved · This Month' },
    { key: 'approved_total',  label: 'Approved · Total' },
    { key: 'cancelled_today', label: 'Cancelled · Today' },
    { key: 'cancelled_month', label: 'Cancelled · This Month' },
    { key: 'cancelled_total', label: 'Cancelled · Total' },
    { key: 'awaiting',        label: 'Awaiting Compliance (sales)' },
    { key: 'awaiting_inflight', label: 'In-flight With Closer (leads)' },
    { key: 'returned',        label: 'Returned from Compliance (live)' },
    { key: 'resells_month',   label: 'Resells · This Month' },
    { key: 'resells_total',   label: 'Resells · Total' },
    { key: 'leads_today',     label: 'Leads · Today' },
    { key: 'leads_month',     label: 'Leads · This Month' },
    { key: 'leads_total',     label: 'Leads · Total' },
    { key: 'completed_today', label: 'Completed Leads · Today' },
    { key: 'completed_month', label: 'Completed Leads · This Month' },
    { key: 'completed_total', label: 'Completed Leads · Total' },
  ],
  manager: [
    { key: 'transfers_today', label: 'Transfers · Today' },
    { key: 'transfers_month', label: 'Transfers · This Month' },
    { key: 'transfers_total', label: 'Transfers · Total' },
    { key: 'sales_today',     label: 'Sales · Today' },
    { key: 'sales_month',     label: 'Sales · This Month' },
    { key: 'sales_total',     label: 'Sales · Total' },
    { key: 'approved_today',  label: 'Approved · Today' },
    { key: 'approved_month',  label: 'Approved · This Month' },
    { key: 'approved_total',  label: 'Approved · Total' },
    { key: 'pending_total',   label: 'Awaiting Review · Total' },
    { key: 'returned',        label: 'Returned from Compliance (live)' },
    { key: 'cancelled_today', label: 'Cancelled · Today' },
    { key: 'cancelled_month', label: 'Cancelled · This Month' },
    { key: 'cancelled_total', label: 'Cancelled · Total' },
    { key: 'resells_month',   label: 'Resells · This Month' },
    { key: 'resells_total',   label: 'Resells · Total' },
    { key: 'dup_today',       label: 'Duplicate Attempts · Today' },
    { key: 'dup_month',       label: 'Duplicate Attempts · This Month' },
    { key: 'dup_total',       label: 'Duplicate Attempts · Total' },
  ],
};

const seg = (metric, label, primary = false) => ({ metric, label, primary });

export const KPI_CARDS = {
  staff: {
    my_sales: {
      label: 'My Sales', description: '',
      segments: [seg('sales_today', 'Today', true), seg('sales_month', 'Current Month'), seg('sales_total', 'Total')],
    },
    approved: {
      label: 'Approved', description: '',
      segments: [seg('approved_today', 'Today', true), seg('approved_month', 'Current Month'), seg('approved_total', 'Total')],
    },
    cancelled: {
      label: 'Cancelled', description: '',
      segments: [seg('cancelled_today', 'Today', true), seg('cancelled_month', 'Current Month'), seg('cancelled_total', 'Total')],
    },
    awaiting_review: {
      label: 'Awaiting Review', description: 'Pending compliance check',
      segments: [seg('awaiting', 'Total', true)],
    },
    returned: {
      label: 'Returned from Compliance', description: 'Sent back for revision — clears when resolved',
      segments: [seg('returned', 'Open', true)],
    },
    resells: {
      label: 'Resells', description: '',
      segments: [seg('resells_month', 'Current Month', true), seg('resells_total', 'Total')],
    },
    total_leads: {
      label: 'Total Leads', description: '',
      segments: [seg('leads_today', 'Today', true), seg('leads_month', 'Current Month'), seg('leads_total', 'Total')],
    },
    fronter_approved: {
      label: 'Approved', description: '',
      segments: [seg('completed_today', 'Today', true), seg('completed_month', 'Current Month'), seg('completed_total', 'Total')],
    },
    fronter_awaiting_review: {
      label: 'Awaiting Review', description: 'In-flight with closer',
      segments: [seg('awaiting_inflight', 'Total', true)],
    },
  },
  manager: {
    transfers: {
      label: 'Total Transfers', description: '',
      segments: [seg('transfers_today', 'Today', true), seg('transfers_month', 'Current Month'), seg('transfers_total', 'Total')],
    },
    sales: {
      label: 'Total Sales', description: '',
      segments: [seg('sales_today', 'Today', true), seg('sales_month', 'Current Month'), seg('sales_total', 'Total')],
    },
    approved: {
      label: 'Approved', description: '',
      segments: [seg('approved_today', 'Today', true), seg('approved_month', 'Current Month'), seg('approved_total', 'Total')],
    },
    awaiting_review: {
      label: 'Awaiting Review', description: '',
      segments: [seg('pending_total', 'Total', true)],
    },
    returned: {
      label: 'Returned from Compliance', description: 'Sent back for revision — clears when resolved',
      segments: [seg('returned', 'Open', true)],
    },
    cancelled: {
      label: 'Cancelled', description: '',
      segments: [seg('cancelled_today', 'Today', true), seg('cancelled_month', 'Current Month'), seg('cancelled_total', 'Total')],
    },
    resells: {
      label: 'Resells', description: '',
      segments: [seg('resells_month', 'Current Month', true), seg('resells_total', 'Total')],
    },
    dup_attempts: {
      label: 'Dup Attempts', description: 'refresh · reengage · overlap',
      segments: [seg('dup_today', 'Today', true), seg('dup_month', 'Current Month'), seg('dup_total', 'Total')],
    },
  },
};

// Resolve a card's effective config from the stored shell.layout overrides.
// Precedence: per-role override → shell-wide override → catalog default.
// `stored` is shell.layout.<shell> (may be null). `role` is the viewer's level.
export function resolveCardConfig(shell, cardKey, stored, role) {
  const def = KPI_CARDS[shell]?.[cardKey] || { label: cardKey, description: '', segments: [] };
  const shellCard = (stored?.stat_cards || []).find(c => c?.key === cardKey) || {};
  const roleCard  = (stored?.role_overrides?.[role]?.stat_cards || []).find(c => c?.key === cardKey) || {};

  const pick = (field) => (roleCard[field] !== undefined ? roleCard[field]
                         : shellCard[field] !== undefined ? shellCard[field]
                         : undefined);

  const label       = (pick('label') || '').toString().trim() || def.label;
  const description = pick('description') !== undefined ? pick('description') : def.description;
  const segs = pick('segments');
  const segments = (Array.isArray(segs) && segs.length) ? segs : def.segments;

  return { label, description, segments };
}

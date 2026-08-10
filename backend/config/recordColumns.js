// ============================================================================
// recordColumns — the server-side whitelist catalogs for sortable / filterable
// list columns. One catalog per (resource, surface).
//
// THIS IS THE SECURITY BOUNDARY. A client sends a uiKey; the catalog decides
// whether that key may reach .order() (sort: true) and/or a filter operator,
// and supplies the real column. Anything not listed here does not exist.
//
// The *_SORT maps the routes used to declare inline are now DERIVED from these
// via sortMapFrom(), so the sortable set and the filterable set cannot drift.
// The derived maps reproduce the previous literals key-for-key, with one
// deliberate correction called out at TRANSFER_COLUMNS.customer below.
//
// PER-TABLE POSTURE (measured 2026-07-29 against the live database)
//   transfers  80,139 rows — every added sort/filter is a real cost. Only the
//                            columns with an index (existing, or added by
//                            migration 219) are marked sort:true.
//   sales       7,044 rows — ORDER BY customer_name over the whole table is a
//                            7.1ms top-N heapsort. Sorting is cheap here; the
//                            constraint is write amplification, so sales gets
//                            NO new indexes and every real column is sortable.
//   callbacks   4,504 rows — same, plus the (company, status, callback_at)
//                            composite from 219 for the filtered sort.
//
// JSONB RULE
//   sales  — every form_data key has a denormalized typed twin (VIN→car_vin,
//            Miles→miles_num, CarMake→car_make, SalePlan→plan …), so the
//            catalog ALWAYS points at the twin. No sale entry is a JSONB path.
//   transfers — has no customer columns at all; FirstName/LastName/Phone live
//            only in form_data. Those two names get expression indexes (219);
//            every other JSONB key stays reachable through the existing
//            `search` box (app_record_search + the form_data trigram GIN) and
//            is NOT a per-column filter.
//
// `mask` tags the class a readonly_admin may have redacted. When that class is
// hidden for the caller, blockedForHide() removes the column from BOTH the
// filter path and the advertised catalog — otherwise a >= / <= filter is an
// oracle for the value the mask exists to hide.
//
// `values` marks a column backed by a real Postgres ENUM. Postgres rejects an
// unknown label with a type error, which surfaces as a 500 and blanks the tab —
// so those two columns carry their vocabulary and columnFilter drops anything
// outside it. Columns whose status is plain text (callbacks.status) carry no
// `values` and accept anything.
// ============================================================================

// The sale_status / transfer_status enum labels, verified against pg_enum.
// Keep in step with the SALE_STATUSES / TRANSFER_STATUSES lists in
// routes/compliance.js, which drive the stats strip off the same vocabulary.
const SALE_STATUS_VALUES = [
  'open', 'closed_won', 'closed_lost', 'sold', 'cancelled', 'follow_up',
  'compliance_cancelled', 'dispute', 'chargeback', 'pending_review', 'needs_revision',
];
const TRANSFER_STATUS_VALUES = ['pending', 'assigned', 'completed', 'cancelled', 'rejected'];

// ── sales ───────────────────────────────────────────────────────────────────
// `enumSource` names a catalog the client already fetches once per shell, so a
// dropdown never costs a SELECT DISTINCT over the table.
const SALE_COLUMNS = {
  customer:        { col: 'customer_name',      type: 'text',   sort: true, mask: 'pii' },
  customer_phone:  { col: 'customer_phone',     type: 'text',   sort: true, mask: 'pii' },
  customer_email:  { col: 'customer_email',     type: 'text',   sort: true, mask: 'pii' },
  status:          { col: 'status',             type: 'enum',   sort: true, enumSource: 'sale_status', values: SALE_STATUS_VALUES },
  created_at:      { col: 'created_at',         type: 'date',   sort: true },
  sale_date:       { col: 'sale_date',          type: 'date',   sort: true },
  reference:       { col: 'reference_no',       type: 'text',   sort: true, mask: 'pii' },
  monthly_payment: { col: 'monthly_payment',    type: 'number', sort: true, mask: 'financial' },
  down_payment:    { col: 'down_payment',       type: 'number', sort: true, mask: 'financial' },
  fronter:         { col: 'fronter_id',         type: 'uuid',   sort: true, enumSource: 'users' },
  closer:          { col: 'closer_id',          type: 'uuid',   sort: true, enumSource: 'users' },
  plan:            { col: 'plan',               type: 'text',   sort: true, enumSource: 'sale_plan' },
  client_name:     { col: 'client_name',        type: 'text',   sort: true, enumSource: 'sale_client' },
  company:         { col: 'company_id',         type: 'uuid',   sort: true, enumSource: 'companies' },
  disposition:     { col: 'closer_disposition', type: 'enum',   sort: true, enumSource: 'dispositions' },
  cancellation_date: { col: 'cancellation_date', type: 'date',  sort: true },
  is_resell:       { col: 'is_resell',          type: 'bool',   sort: true },
  // Vehicle facets — the denormalized twins, never form_data->>'VIN'.
  vin:             { col: 'car_vin',            type: 'text',   sort: true, mask: 'pii' },
  car_make:        { col: 'car_make',           type: 'text',   sort: true, mask: 'pii' },
  car_model:       { col: 'car_model',          type: 'text',   sort: true, mask: 'pii' },
  car_year:        { col: 'car_year',           type: 'text',   sort: true, mask: 'pii' },
  miles:           { col: 'miles_num',          type: 'number', sort: true, mask: 'pii' },
};

// The compliance surface additionally exposes the "Status Updated" header.
// Both keys map to updated_at, exactly as the previous literal did.
const COMPLIANCE_SALE_COLUMNS = {
  ...SALE_COLUMNS,
  status_updated: { col: 'updated_at', type: 'date', sort: true },
  updated_at:     { col: 'updated_at', type: 'date', sort: true },
};

// The SuperAdmin Payout tab (mig 243) — same sales columns, plus the payout
// lifecycle field. payout_status is a CHECK-constrained text column, not a
// real Postgres ENUM, so — same posture as CALLBACK_COLUMNS.status — it
// carries enumSource but no `values`: an unrecognized filter value just
// matches zero rows instead of erroring.
const PAYOUT_COLUMNS = {
  ...SALE_COLUMNS,
  payout_status: { col: 'payout_status', type: 'enum', sort: true, enumSource: 'payout_status' },
};

// ── transfers ───────────────────────────────────────────────────────────────
const TRANSFER_COLUMNS = {
  // ⚠ CORRECTION. This was `form_data->>customer_name` in both transfers.js and
  // compliance.js. Measured on the live database: 0 of 80,139 transfer rows
  // carry a `customer_name` key in form_data — the real keys are FirstName and
  // LastName. So the Customer header has always ordered by an all-NULL
  // expression, i.e. a full 80k scan returning arbitrary order.
  //
  // FirstName (not LastName) because customerName() in recordFormat.js renders
  // "FirstName LastName" — sorting by the leading token displayed is the only
  // ordering that looks sorted to the person who clicked. Backed by
  // idx_transfers_fd_firstname (mig 219).
  customer:    { col: 'form_data->>FirstName',  type: 'text', sort: true, mask: 'pii' },
  last_name:   { col: 'form_data->>LastName',   type: 'text', sort: true, mask: 'pii' },
  // The real column, not form_data->>'Phone' — see memory transfer_phone_display:
  // VICIDIAL-sourced leads keep the phone in normalized_phone, not form_data.
  // Backed by idx_transfers_phone_trgm (mig 219) for the contains-filter.
  phone:       { col: 'normalized_phone',       type: 'text', sort: true, mask: 'pii' },
  status:      { col: 'status',                 type: 'enum', sort: true, enumSource: 'transfer_status', values: TRANSFER_STATUS_VALUES },
  created_at:  { col: 'created_at',             type: 'date', sort: true },
  fronter:     { col: 'created_by',             type: 'uuid', sort: true, enumSource: 'users' },
  closer:      { col: 'assigned_closer_id',     type: 'uuid', sort: true, enumSource: 'users' },
  company:     { col: 'company_id',             type: 'uuid', sort: true, enumSource: 'companies' },
  disposition: { col: 'latest_disposition',     type: 'enum', sort: true, enumSource: 'dispositions' },
  // FILTER-ONLY (sort:false). An 80k parallel seq-scan sort for a column nobody
  // orders by is not worth an index; equality/contains still uses the existing
  // idx_transfers_cli / btree.
  cli_number:  { col: 'form_data->>cli_number', type: 'text', sort: false, mask: 'pii' },
  vendor_code: { col: 'vicidial_vendor_code',   type: 'text', sort: false },
};

// ── callbacks ───────────────────────────────────────────────────────────────
const CALLBACK_COLUMNS = {
  customer:       { col: 'customer_name',  type: 'text',   sort: true, mask: 'pii' },
  customer_phone: { col: 'customer_phone', type: 'text',   sort: true, mask: 'pii' },
  priority:       { col: 'priority_rank',  type: 'number', sort: true },
  priority_label: { col: 'priority',       type: 'enum',   sort: false, enumSource: 'callback_priority' },
  callback_at:    { col: 'callback_at',    type: 'date',   sort: true },
  created_at:     { col: 'created_at',     type: 'date',   sort: true },
  status:         { col: 'status',         type: 'enum',   sort: true, enumSource: 'callback_status' },
  company:        { col: 'company_id',     type: 'uuid',   sort: true, enumSource: 'companies' },
  notes:          { col: 'notes',          type: 'text',   sort: false, mask: 'pii' },
  // Both fronter and closer resolve to user_id — a callback belongs to one
  // agent and the shell decides which label to show it under. Preserved from
  // the previous CALLBACK_SORT literal.
  fronter:        { col: 'user_id',        type: 'uuid',   sort: true, enumSource: 'users' },
  closer:         { col: 'user_id',        type: 'uuid',   sort: true, enumSource: 'users' },
};

/**
 * uiKeys this caller must not filter or sort on, given the readonly_admin
 * hide-flags from hideFlagsFor(). Empty set for everybody else.
 *
 * Sorting is blocked too, not just filtering: ORDER BY on a masked column
 * leaks its ordering, and paging through an ordered list of redacted values
 * recovers the ranking the mask was meant to withhold.
 */
function blockedForHide(catalog, hide) {
  const out = new Set();
  if (!hide || (!hide.pii && !hide.financial)) return out;
  for (const [k, c] of Object.entries(catalog)) {
    if (hide.pii && c.mask === 'pii') out.add(k);
    if (hide.financial && c.mask === 'financial') out.add(k);
  }
  return out;
}

// ── QA v2 — qa2_call (Pool/Queue) ───────────────────────────────────────────
// No `mask` entries here — QA v2's security boundary is scope (company/method
// grants via companyInScope/operationalCompanyIds), not readonly_admin PII
// masking, which is a different admin tier entirely. Text search intentionally
// left out (no contains/starts/ends columns) — Pool/Queue run at ~80
// calls/day/company, nowhere near the row counts that motivated this system
// for transfers/sales, so the useful set is company/method/leg/recording
// state/date, not a general search box.
const QA2_CALL_COLUMNS = {
  company:         { col: 'company_id',      type: 'uuid', sort: true, enumSource: 'companies' },
  method:          { col: 'method_id',       type: 'uuid', sort: true, enumSource: 'qa2_methods' },
  leg:             { col: 'leg',             type: 'enum', sort: true, values: ['fronter', 'closer'] },
  recording_state: { col: 'recording_state', type: 'enum', sort: true, values: ['pending', 'found', 'missing', 'error'] },
  call_at:         { col: 'call_at',         type: 'date', sort: true },
};

module.exports = {
  SALE_COLUMNS, COMPLIANCE_SALE_COLUMNS, PAYOUT_COLUMNS, TRANSFER_COLUMNS, CALLBACK_COLUMNS, QA2_CALL_COLUMNS,
  blockedForHide,
};

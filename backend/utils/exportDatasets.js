// ============================================================================
// exportDatasets — server-side knowledge of the EXPORT column catalog.
//
// The authoritative catalog (key → label → row accessor) lives in the frontend
// (frontend/src/utils/exportSpec.js) because only the client can hold the row
// accessor functions, and keeping the checkbox list next to the accessor is what
// makes it impossible to offer a control the exporter doesn't honour.
//
// The server needs ONE thing the frontend can't give it: for each export COLUMN,
// which raw response ROW KEYS must survive so that column can still be computed.
// A column like `paid_tenure` is derived from four other fields — stripping the
// row down to literally `paid_tenure` would blank it.
//
// FAIL-OPEN BY DESIGN: a column with no entry here keeps the whole row. The
// client is the authoritative column filter (it builds both the headers and the
// values); this map only powers the additional server-side value strip, so an
// unknown column costs defense-in-depth, never a wrong CSV.
// ============================================================================

// Keys every row keeps regardless of column selection — identity/joins the
// client needs to render or de-duplicate, never exported as a column itself.
const ALWAYS_KEEP = ['id'];

// dataset → column key → raw row keys that column reads.
const COLUMN_DEPS = {
  sales: {
    customer_name:     ['customer_name'],
    customer_phone:    ['customer_phone'],
    customer_email:    ['customer_email'],
    reference_no:      ['reference_no'],
    status:            ['status'],
    fronter_name:      ['fronter_name'],
    closer_name:       ['closer_name', 'user_profiles'],
    company_name:      ['companies', 'company_name'],
    sale_date:         ['sale_date', 'created_at'],
    created_at:        ['created_at'],
    cancellation_date: ['status', 'cancellation_date'],
    // salePaidTenure() reads the whole payment shape off the sale.
    paid_days:         ['status', 'sale_date', 'cancellation_date', 'down_payment', 'monthly_payment', 'payment_due_note', 'created_at', 'form_data'],
    paid_tenure:       ['status', 'sale_date', 'cancellation_date', 'down_payment', 'monthly_payment', 'payment_due_note', 'created_at', 'form_data'],
    plan:              ['plan', 'form_data'],
    client_name:       ['client_name', 'form_data'],
    monthly_payment:   ['monthly_payment', 'form_data'],
    down_payment:      ['down_payment', 'form_data'],
    payment_due_note:  ['payment_due_note', 'form_data'],
    closer_disposition:['closer_disposition', 'form_data'],
    compliance_note:   ['compliance_note'],
    customer_uuid:     ['customer_uuid'],
    customer_phone_2:  ['customer_phone_2', 'form_data'],
    customer_address:  ['customer_address', 'form_data'],
    car_year:          ['car_year', 'form_data'],
    car_make:          ['car_make', 'form_data'],
    car_model:         ['car_model', 'form_data'],
    car_miles:         ['car_miles', 'form_data'],
    car_vin:           ['car_vin', 'form_data'],
  },
  transfers: {
    // customerName()/transferPhone() both read form_data (+ normalized_phone).
    customer_name:        ['form_data', 'customer_name'],
    customer_phone:       ['form_data', 'normalized_phone', 'customer_phone'],
    created_by_name:      ['created_by_name', 'fronter_name'],
    assigned_closer_name: ['assigned_closer_name', 'closer'],
    latest_disposition:   ['latest_disposition'],
    company_name:         ['company_name', 'companies'],
    status:               ['status'],
    created_at:           ['created_at'],
    is_duplicate:         ['is_duplicate'],
    duplicate_reason:     ['is_duplicate', 'duplicate_reason'],
    sale_reference_no:    ['sale_reference_no'],
    customer_uuid:        ['customer_uuid'],
  },
  callbacks: {
    customer_name:  ['customer_name'],
    customer_phone: ['customer_phone'],
    callback_at:    ['callback_at'],
    status:         ['status'],
    priority:       ['priority'],
    notes:          ['notes'],
    // fronter/closer are the SAME source column split by company_type;
    // agent_name is that column unsplit (the Manager modal's "Agent").
    fronter_name:   ['company_type', 'user_name'],
    closer_name:    ['company_type', 'user_name'],
    agent_name:     ['user_name'],
    company_name:   ['company_name'],
    created_at:     ['created_at'],
    customer_uuid:  ['customer_uuid'],
  },
  callback_audit: {
    created_at:       ['created_at'],
    actor_name:       ['actor_name', 'actor_id'],
    customer_name:    ['customer_name_snapshot'],
    customer_phone:   ['customer_phone_snapshot'],
    old_status:       ['old_status'],
    new_status:       ['new_status'],
    notes:            ['notes'],
    callback_deleted: ['callback_deleted'],
  },
  reviews: {
    customer_name: ['transfers'],
    company_name:  ['company_id'],
    reviewer_name: ['user_profiles'],
    rating:        ['rating'],
    notes:         ['notes'],
    created_at:    ['created_at'],
  },
  users: {
    name:       ['first_name', 'last_name'],
    email:      ['email'],
    role:       ['role'],
    is_active:  ['is_active'],
    created_at: ['created_at'],
  },
};

// Given a dataset + the allowed COLUMN keys, return the Set of raw ROW keys to
// keep — or null meaning "keep everything" (fail-open: unknown dataset, or any
// allowed column we have no dependency entry for, e.g. a dynamic form field).
function rowKeysForColumns(dataset, allowedColumns) {
  const deps = COLUMN_DEPS[dataset];
  if (!deps || !Array.isArray(allowedColumns) || !allowedColumns.length) return null;
  const keep = new Set(ALWAYS_KEEP);
  for (const col of allowedColumns) {
    const d = deps[col];
    if (!d) return null;                 // unknown column → never risk a blank cell
    for (const k of d) keep.add(k);
  }
  return keep;
}

module.exports = { COLUMN_DEPS, ALWAYS_KEEP, rowKeysForColumns };

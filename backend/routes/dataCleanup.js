/**
 * Data Cleanup — superadmin batch find/replace for dirty field values.
 * Mounted at /api/data-cleanup. Superadmin only.
 *
 *   POST /preview  { field, field_type, old_value }            → affected counts
 *   POST /execute  { field, field_type, old_value, new_value } → run the replace
 *
 * A form field's value lives in form_data[field] on BOTH transfers and sales,
 * and (for a handful of fields) is also denormalized onto a typed sales column
 * the lists/drawers read directly — so we clean all of them together.
 */
const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');

const router = express.Router();

router.use(asyncHandler(async (req, res, next) => {
  if (!(await isSuperAdmin(req.user.id))) return res.status(403).json({ error: 'Superadmin access required' });
  next();
}));

// Form-field → denormalized sales column. These columns are copies the sale
// list/drawer render directly, so cleaning form_data alone would leave the sale
// side still showing the bad value. Keyed by field NAME and by field_type.
const SALE_COL_BY_FIELD = {
  Phone: 'customer_phone', Phone2: 'customer_phone_2', Email: 'customer_email',
  CarMake: 'car_make', CarModel: 'car_model', CarVin: 'car_vin',
};
const SALE_COL_BY_TYPE = {
  sale_plan: 'plan', sale_client: 'client_name',
  sale_reference_no: 'reference_no', sale_payment_due_note: 'payment_due_note',
};
const saleColumnFor = (field, fieldType) => SALE_COL_BY_FIELD[field] || SALE_COL_BY_TYPE[fieldType] || null;

async function countJsonb(table, field, value) {
  const { count, error } = await supabaseAdmin
    .from(table).select('id', { count: 'exact', head: true })
    .filter(`form_data->>${field}`, 'eq', value);
  if (error) throw new Error(`${table}.form_data->>${field}: ${error.message}`);
  return count || 0;
}
async function countColumn(table, col, value) {
  const { count, error } = await supabaseAdmin
    .from(table).select('id', { count: 'exact', head: true }).eq(col, value);
  if (error) throw new Error(`${table}.${col}: ${error.message}`);
  return count || 0;
}

const parseBody = (b) => ({
  field:     String(b.field || '').trim(),
  fieldType: String(b.field_type || '').trim(),
  oldValue:  b.old_value == null ? '' : String(b.old_value),
  newValue:  b.new_value == null ? '' : String(b.new_value),
});

// ── POST /preview — how many rows would change ───────────────────────────────
router.post('/preview', asyncHandler(async (req, res) => {
  const { field, fieldType, oldValue } = parseBody(req.body);
  if (!field || oldValue === '') return res.status(400).json({ error: 'field and old_value are required' });

  const col = saleColumnFor(field, fieldType);
  const [transfers_form_data, sales_form_data, sales_column] = await Promise.all([
    countJsonb('transfers', field, oldValue),
    countJsonb('sales', field, oldValue),
    col ? countColumn('sales', col, oldValue) : Promise.resolve(0),
  ]);
  res.json({
    field, old_value: oldValue, column: col,
    counts: { transfers_form_data, sales_form_data, sales_column },
    total: transfers_form_data + sales_form_data + sales_column,
  });
}));

// ── POST /execute — perform the batch replace ────────────────────────────────
router.post('/execute', asyncHandler(async (req, res) => {
  const { field, fieldType, oldValue, newValue } = parseBody(req.body);
  if (!field || oldValue === '' || newValue === '') {
    return res.status(400).json({ error: 'field, old_value and new_value are required' });
  }
  if (oldValue === newValue) return res.status(400).json({ error: 'Old and new values are identical' });

  const col = saleColumnFor(field, fieldType);
  const detail = { transfers_form_data: 0, sales_form_data: 0, sales_column: 0 };

  // JSONB form_data (one efficient UPDATE per table via the SQL function).
  for (const table of ['transfers', 'sales']) {
    const { data, error } = await supabaseAdmin.rpc('app_data_cleanup_jsonb', {
      p_table: table, p_field: field, p_old: oldValue, p_new: newValue,
    });
    if (error) {
      const hint = /function .* does not exist/i.test(error.message)
        ? ' — apply migration 093_data_cleanup_fn.sql first.' : '';
      return res.status(500).json({ error: `Cleanup failed on ${table}: ${error.message}${hint}` });
    }
    detail[table === 'transfers' ? 'transfers_form_data' : 'sales_form_data'] = Number(data) || 0;
  }

  // Denormalized sales column copy.
  if (col) {
    const { data, error } = await supabaseAdmin
      .from('sales').update({ [col]: newValue }).eq(col, oldValue).select('id');
    if (error) return res.status(500).json({ error: `Cleanup failed on sales.${col}: ${error.message}` });
    detail.sales_column = (data || []).length;
  }

  res.json({
    updated: detail.transfers_form_data + detail.sales_form_data + detail.sales_column,
    detail, column: col,
  });
}));

module.exports = router;

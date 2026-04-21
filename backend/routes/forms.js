const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

const ALLOWED_TYPES = [
  'text', 'email', 'number', 'textarea', 'select', 'date', 'phone', 'tel', 'zip', 'checkbox',
  'sale_client', 'sale_plan',
  'sale_down_payment', 'sale_monthly_payment', 'sale_payment_due_note', 'sale_reference_no',
  'sale_fronter', 'sale_date', 'sale_status',
];

const superadminOnly = (req, res, next) => {
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Only SuperAdmin can manage form fields' });
  }
  next();
};

// ============================================================================
// GET /forms  (alias → same as /forms/fields)
// ============================================================================
router.get('/', asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('form_fields')
    .select('*')
    .order('order');

  if (error) return res.status(400).json({ error: error.message });
  res.json({ total: data.length, fields: data || [] });
}));

// ============================================================================
// GET /forms/fields
// ============================================================================
router.get('/fields', asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('form_fields')
    .select('*')
    .order('order');

  if (error) return res.status(400).json({ error: error.message });
  res.json({ total: data.length, fields: data || [] });
}));

// ============================================================================
// POST /forms/fields — create single field (SuperAdmin)
// ============================================================================
router.post('/fields', superadminOnly, [
  body('name').trim().notEmpty(),
  body('label').trim().notEmpty(),
  body('field_type').isIn(ALLOWED_TYPES),
  body('is_required').isBoolean().optional(),
  body('column_span').isInt({ min: 1, max: 3 }).optional(),
  body('placeholder').optional().isString(),
  body('options').isArray().optional(),
  body('order').isInt().optional(),
  body('section').optional().isString(),
  body('show_to_fronter').isBoolean().optional(),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errs.array() });

  const { name, label, field_type, is_required, options, order, column_span, placeholder, section, show_to_fronter } = req.body;

  let finalOrder = order;
  if (finalOrder === undefined) {
    const { data: last } = await supabaseAdmin
      .from('form_fields').select('order').order('order', { ascending: false }).limit(1);
    finalOrder = (last?.[0]?.order || 0) + 1;
  }

  const { data, error } = await supabaseAdmin
    .from('form_fields')
    .insert({
      name, label, field_type,
      is_required:     is_required     || false,
      options:         options         || null,
      order:           finalOrder,
      column_span:     column_span     || 1,
      placeholder:     placeholder     || null,
      section:         section         || 'default',
      show_to_fronter: show_to_fronter !== false,
    })
    .select()
    .single();

  if (error) {
    if (error.message.includes('duplicate')) return res.status(400).json({ error: 'Field name already exists' });
    return res.status(400).json({ error: error.message });
  }

  res.status(201).json({ field: data });
}));

// ============================================================================
// PUT /forms/fields/:id — update single field (SuperAdmin)
// ============================================================================
router.put('/fields/:id', superadminOnly, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { label, is_required, options, column_span, placeholder, section, order, field_type, name, show_to_fronter } = req.body;

  const updates = {};
  if (label           !== undefined) updates.label           = label;
  if (is_required     !== undefined) updates.is_required     = is_required;
  if (options         !== undefined) updates.options         = options;
  if (column_span     !== undefined) updates.column_span     = column_span;
  if (placeholder     !== undefined) updates.placeholder     = placeholder;
  if (section         !== undefined) updates.section         = section;
  if (order           !== undefined) updates.order           = order;
  if (field_type      !== undefined) updates.field_type      = field_type;
  if (name            !== undefined) updates.name            = name;
  if (show_to_fronter !== undefined) updates.show_to_fronter = show_to_fronter;

  const { data, error } = await supabaseAdmin
    .from('form_fields').update(updates).eq('id', id).select().single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ field: data });
}));

// ============================================================================
// POST /forms/fields/bulk-save — replace entire form layout (SuperAdmin)
// Accepts array of field objects; replaces all existing fields.
// ============================================================================
router.post('/fields/bulk-save', superadminOnly, [
  body('fields').isArray({ min: 1 }),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'fields array required' });

  const { fields } = req.body;

  // Delete all current fields, then re-insert in one shot
  const { error: delErr } = await supabaseAdmin.from('form_fields').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (delErr) return res.status(500).json({ error: delErr.message });

  const rows = fields.map((f, i) => ({
    name:            f.name,
    label:           f.label,
    field_type:      ALLOWED_TYPES.includes(f.field_type) ? f.field_type : 'text',
    is_required:     f.is_required     || false,
    options:         f.options         || null,
    order:           i,
    column_span:     Math.min(Math.max(parseInt(f.column_span) || 1, 1), 3),
    placeholder:     f.placeholder     || null,
    section:         f.section         || 'default',
    default_value:   f.default_value   || null,
    show_to_fronter: f.show_to_fronter !== false,
  }));

  const { data, error: insertErr } = await supabaseAdmin
    .from('form_fields').insert(rows).select();

  if (insertErr) return res.status(500).json({ error: insertErr.message });

  res.json({ saved: data.length, fields: data });
}));

// ============================================================================
// DELETE /forms/fields/:id (SuperAdmin)
// ============================================================================
router.delete('/fields/:id', superadminOnly, asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from('form_fields').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Deleted' });
}));

// ============================================================================
// POST /forms/fields/reorder (SuperAdmin) — legacy, keep for compat
// ============================================================================
router.post('/fields/reorder', superadminOnly, [body('fields').isArray()], asyncHandler(async (req, res) => {
  const { fields } = req.body;
  for (let i = 0; i < fields.length; i++) {
    await supabaseAdmin.from('form_fields').update({ order: i + 1 }).eq('id', fields[i]);
  }
  res.json({ message: 'Reordered' });
}));

module.exports = router;

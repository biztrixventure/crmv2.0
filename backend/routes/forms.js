const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

const ALLOWED_TYPES = [
  'text', 'email', 'number', 'textarea', 'select', 'date', 'phone', 'tel', 'zip', 'checkbox',
  'sale_client', 'sale_plan',
  'sale_down_payment', 'sale_monthly_payment', 'sale_payment_due_note', 'sale_reference_no',
  'sale_fronter', 'sale_date', 'sale_status', 'sale_disposition',
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
  body('column_span').isInt({ min: 1, max: 5 }).optional(),
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
// POST /forms/fields/bulk-save — safe incremental save (SuperAdmin)
// Order: validate → UPDATE existing → INSERT new → DELETE removed (last).
// Never deletes before confirming new data landed — no data loss on failure.
// ============================================================================
router.post('/fields/bulk-save', superadminOnly, [
  body('fields').isArray({ min: 1 }),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'fields array required' });

  const { fields } = req.body;

  // Validate ALL before touching DB
  for (const f of fields) {
    if (!f.name?.toString().trim() || !f.label?.toString().trim()) {
      return res.status(400).json({ error: 'Every field must have a name and label' });
    }
    if (!ALLOWED_TYPES.includes(f.field_type)) {
      return res.status(400).json({ error: `Invalid field_type: ${f.field_type}` });
    }
  }

  const buildRow = (f, i) => ({
    name:            f.name.toString().trim(),
    label:           f.label.toString().trim(),
    field_type:      ALLOWED_TYPES.includes(f.field_type) ? f.field_type : 'text',
    is_required:     f.is_required     || false,
    options:         f.options         || null,
    order:           i,
    column_span:     Math.min(Math.max(parseInt(f.column_span) || 1, 1), 5),
    placeholder:     f.placeholder     || null,
    section:         f.section         || 'default',
    default_value:   f.default_value   || null,
    show_to_fronter: f.show_to_fronter !== false,
  });

  // Fetch current DB state — need name for accurate DELETE calculation
  const { data: current, error: fetchErr } = await supabaseAdmin
    .from('form_fields').select('id, name');
  if (fetchErr) return res.status(500).json({ error: fetchErr.message });

  const keepNames   = new Set(fields.map(f => f.name.toString().trim()));
  const toDeleteIds = (current || []).filter(r => !keepNames.has(r.name)).map(r => r.id);

  // Safety guard: refuse if all existing fields would be deleted with nothing coming in
  if ((current || []).length > 0 && toDeleteIds.length === (current || []).length && fields.length === 0) {
    return res.status(400).json({ error: 'Safety guard: payload would delete all fields with no replacements. No changes made.' });
  }

  // UPSERT all fields by name — handles stale IDs, duplicate names, and new fields in one shot.
  // If name already exists → UPDATE that row. If not → INSERT.
  const allRows = fields.map((f, i) => buildRow(f, i));
  const { error: upsertErr } = await supabaseAdmin
    .from('form_fields')
    .upsert(allRows, { onConflict: 'name', ignoreDuplicates: false });
  if (upsertErr) return res.status(500).json({ error: upsertErr.message });

  // DELETE fields whose names are no longer in the payload — runs AFTER upsert succeeds
  if (toDeleteIds.length) {
    const { error: delErr } = await supabaseAdmin
      .from('form_fields').delete().in('id', toDeleteIds);
    if (delErr) return res.status(500).json({ error: delErr.message });
  }

  const { data: finalFields, error: finalErr } = await supabaseAdmin
    .from('form_fields').select('*').order('order');
  if (finalErr) return res.status(500).json({ error: finalErr.message });

  res.json({ saved: finalFields.length, fields: finalFields });
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

// ============================================================================
// TEMPLATES — named canvas snapshots stored in DB (cross-device)
// ============================================================================

// GET /forms/templates — list all templates (SuperAdmin)
router.get('/templates', superadminOnly, asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('form_templates')
    .select('id, name, description, fields, created_by, created_at, updated_at')
    .order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ templates: data || [] });
}));

// POST /forms/templates — create template (SuperAdmin)
router.post('/templates', superadminOnly, [
  body('name').trim().notEmpty().withMessage('name required'),
  body('fields').isArray({ min: 1 }).withMessage('fields array required'),
  body('description').optional().isString(),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

  const { name, fields, description } = req.body;
  const { data, error } = await supabaseAdmin
    .from('form_templates')
    .insert({ name: name.trim(), fields, description: description || null, created_by: req.user.id })
    .select()
    .single();

  if (error) {
    if (error.message.includes('duplicate') || error.code === '23505')
      return res.status(400).json({ error: `Template "${name}" already exists` });
    return res.status(400).json({ error: error.message });
  }
  res.status(201).json({ template: data });
}));

// PUT /forms/templates/:id — update name / description / fields (SuperAdmin)
router.put('/templates/:id', superadminOnly, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = { updated_at: new Date().toISOString() };
  if (req.body.name        !== undefined) updates.name        = req.body.name.trim();
  if (req.body.description !== undefined) updates.description = req.body.description;
  if (req.body.fields      !== undefined) updates.fields      = req.body.fields;

  const { data, error } = await supabaseAdmin
    .from('form_templates')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    if (error.message.includes('duplicate') || error.code === '23505')
      return res.status(400).json({ error: 'Template name already exists' });
    return res.status(400).json({ error: error.message });
  }
  res.json({ template: data });
}));

// DELETE /forms/templates/:id (SuperAdmin)
router.delete('/templates/:id', superadminOnly, asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from('form_templates').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Deleted' });
}));

module.exports = router;

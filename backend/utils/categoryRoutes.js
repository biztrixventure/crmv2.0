const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');

// Build a CRUD sub-router for a categories table (faq_categories /
// script_categories). Reads are open to any authenticated user (they power the
// end-user category filter); writes are gated by canManage(req).
function makeCategoryRouter(table, canManage) {
  const router = express.Router();

  router.get('/', asyncHandler(async (req, res) => {
    const { data, error } = await supabaseAdmin.from(table)
      .select('id, name, sort_order')
      .order('sort_order', { ascending: true }).order('name', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ categories: data || [] });
  }));

  router.post('/', [body('name').trim().notEmpty()], asyncHandler(async (req, res) => {
    if (!(await canManage(req))) return res.status(403).json({ error: 'Not allowed' });
    if (!validationResult(req).isEmpty()) return res.status(400).json({ error: 'Name is required' });
    const { data, error } = await supabaseAdmin.from(table)
      .insert({ name: req.body.name.trim(), sort_order: Number(req.body.sort_order) || 0, created_by: req.user.id })
      .select('id, name, sort_order').single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ category: data });
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    if (!(await canManage(req))) return res.status(403).json({ error: 'Not allowed' });
    const updates = {};
    if (req.body.name !== undefined) {
      const n = String(req.body.name).trim();
      if (!n) return res.status(400).json({ error: 'Name is required' });
      updates.name = n;
    }
    if (req.body.sort_order !== undefined) updates.sort_order = Number(req.body.sort_order) || 0;
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });
    const { data, error } = await supabaseAdmin.from(table).update(updates)
      .eq('id', req.params.id).select('id, name, sort_order').single();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Category not found' });
    res.json({ category: data });
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    if (!(await canManage(req))) return res.status(403).json({ error: 'Not allowed' });
    const { error } = await supabaseAdmin.from(table).delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Category deleted' });
  }));

  return router;
}

// Normalize a client category_ids value → clean uuid[] (undefined = field not
// provided, so the caller leaves it unchanged).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function cleanCategoryIds(input) {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter(x => typeof x === 'string' && UUID_RE.test(x)))];
}

module.exports = { makeCategoryRouter, cleanCategoryIds };

/**
 * Search tools — synonyms (query expansion) + lightweight search analytics.
 *
 *   GET    /search/synonyms          — all synonym groups (any authenticated user;
 *                                       agents need them to expand their queries)
 *   POST   /search/synonyms          — create   (SuperAdmin)
 *   PUT    /search/synonyms/:id      — update    (SuperAdmin)
 *   DELETE /search/synonyms/:id      — delete    (SuperAdmin)
 *   POST   /search/log               — log a query (any authenticated)
 *   GET    /search/analytics         — top + zero-result queries (SuperAdmin)
 *
 * Every handler degrades gracefully if the 055 tables aren't migrated yet, so the
 * agent search keeps working (just without synonyms / analytics).
 */
const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();
const isSA = (req) => req.user.role === 'superadmin';
const superadminOnly = (req, res, next) => (isSA(req) ? next() : res.status(403).json({ error: 'Superadmin only' }));

// ── Synonyms ────────────────────────────────────────────────────────────────
router.get('/synonyms', asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('search_synonyms').select('id, term, synonyms').order('term');
  if (error) return res.json({ synonyms: [] });          // table not migrated → no synonyms
  res.json({ synonyms: data || [] });
}));

router.post('/synonyms', superadminOnly, [
  body('term').trim().notEmpty(),
  body('synonyms').optional().isString(),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'term is required' });
  const { data, error } = await supabaseAdmin
    .from('search_synonyms')
    .insert({ term: req.body.term.trim(), synonyms: req.body.synonyms || '', created_by: req.user.id })
    .select().single();
  if (error) {
    if (error.message?.includes('duplicate')) return res.status(400).json({ error: 'That term already has a synonym group' });
    return res.status(400).json({ error: error.message });
  }
  res.status(201).json({ synonym: data });
}));

router.put('/synonyms/:id', superadminOnly, asyncHandler(async (req, res) => {
  const updates = { updated_at: new Date().toISOString() };
  if (req.body.term      !== undefined) updates.term     = String(req.body.term).trim();
  if (req.body.synonyms  !== undefined) updates.synonyms = String(req.body.synonyms);
  const { data, error } = await supabaseAdmin
    .from('search_synonyms').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ synonym: data });
}));

router.delete('/synonyms/:id', superadminOnly, asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from('search_synonyms').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Deleted' });
}));

// ── Analytics log ─────────────────────────────────────────────────────────────
router.post('/log', [
  body('query').isString().trim().isLength({ min: 2, max: 200 }),
  body('section').isIn(['faq', 'script']),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.json({ ok: false });   // ignore junk, never error the UI
  try {
    await supabaseAdmin.from('search_queries').insert({
      query: req.body.query.trim().slice(0, 200),
      section: req.body.section,
      result_count: Number(req.body.result_count) || 0,
      user_id: req.user.id,
      role: req.user.role || null,
    });
  } catch { /* table not migrated — ignore */ }
  res.json({ ok: true });
}));

// ── Analytics report (SuperAdmin) ─────────────────────────────────────────────
router.get('/analytics', superadminOnly, asyncHandler(async (req, res) => {
  const days = Math.min(parseInt(req.query.days, 10) || 30, 365);
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const { data, error } = await supabaseAdmin
    .from('search_queries').select('query, section, result_count, created_at')
    .gte('created_at', since).order('created_at', { ascending: false }).limit(5000);
  if (error) return res.json({ total: 0, top: [], zeroResult: [], bySection: {} });

  const rows = data || [];
  const agg = new Map();   // key: section|query → { query, section, count, zero }
  const bySection = { faq: 0, script: 0 };
  for (const r of rows) {
    bySection[r.section] = (bySection[r.section] || 0) + 1;
    const key = `${r.section}|${r.query.toLowerCase()}`;
    const e = agg.get(key) || { query: r.query, section: r.section, count: 0, zero: 0 };
    e.count += 1;
    if ((r.result_count || 0) === 0) e.zero += 1;
    agg.set(key, e);
  }
  const all = [...agg.values()];
  const top = [...all].sort((a, b) => b.count - a.count).slice(0, 25);
  const zeroResult = all.filter(e => e.zero > 0).sort((a, b) => b.zero - a.zero).slice(0, 25);
  res.json({ total: rows.length, days, bySection, top, zeroResult });
}));

module.exports = router;

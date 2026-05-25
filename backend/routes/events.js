/**
 * Events — company calendar.
 *
 *   GET    /events            — list events (all authenticated users; read-only)
 *   POST   /events            — create an event            (SuperAdmin)
 *   PUT    /events/:id        — update an event / drag-resize (SuperAdmin)
 *   DELETE /events/:id        — delete an event            (SuperAdmin)
 *
 * Mounted behind authMiddleware in server.js. Writes are SuperAdmin-only; reads
 * are open to every authenticated user so the calendar is visible company-wide.
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

const superadminOnly = (req, res, next) => {
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Only SuperAdmin can manage events' });
  }
  next();
};

// Whitelist + coerce the writable fields from a request body into a DB row.
function buildRow(body) {
  const row = {};
  if (body.title       !== undefined) row.title       = String(body.title).trim();
  if (body.description !== undefined) row.description = body.description ? String(body.description) : null;
  if (body.location    !== undefined) row.location    = body.location ? String(body.location).trim() : null;
  if (body.starts_at   !== undefined) row.starts_at   = body.starts_at;
  if (body.ends_at     !== undefined) row.ends_at     = body.ends_at || null;
  if (body.all_day     !== undefined) row.all_day     = body.all_day === true;
  if (body.color       !== undefined) row.color       = body.color || '#a8885c';
  return row;
}

// ── GET /events — list (optionally bounded by ?start & ?end ISO range) ─────────
router.get('/', asyncHandler(async (req, res) => {
  let q = supabaseAdmin.from('events').select('*').order('starts_at', { ascending: true });

  // FullCalendar passes the visible window; widen the filter so multi-day events
  // overlapping either edge still show.
  if (req.query.end)   q = q.lte('starts_at', req.query.end);
  if (req.query.start) q = q.or(`ends_at.gte.${req.query.start},and(ends_at.is.null,starts_at.gte.${req.query.start})`);

  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json({ total: data.length, events: data || [] });
}));

// ── POST /events — create (SuperAdmin) ─────────────────────────────────────────
router.post('/', superadminOnly, [
  body('title').trim().notEmpty().withMessage('title required'),
  body('starts_at').notEmpty().withMessage('starts_at required'),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: errs.array()[0].msg });

  const row = buildRow(req.body);
  row.created_by = req.user.id;

  const { data, error } = await supabaseAdmin.from('events').insert(row).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ event: data });
}));

// ── PUT /events/:id — update / drag-resize (SuperAdmin) ────────────────────────
router.put('/:id', superadminOnly, asyncHandler(async (req, res) => {
  const updates = buildRow(req.body);
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'No fields to update' });
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('events').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ event: data });
}));

// ── DELETE /events/:id (SuperAdmin) ────────────────────────────────────────────
router.delete('/:id', superadminOnly, asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from('events').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Deleted' });
}));

module.exports = router;

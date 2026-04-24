const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');

const router = express.Router();

const RATINGS      = ['excellent', 'good', 'average', 'below_average', 'bad'];
const DISPOSITIONS = ['sale', 'no_sale', 'callback', 'not_interested', 'hung_up', 'voicemail', 'other'];

// ============================================================================
// POST /reviews/transfer/:id/review — closer submits rating for a transfer
// ============================================================================
router.post('/transfer/:id/review', [
  body('rating').isIn(RATINGS),
  body('notes').optional().isString().isLength({ max: 1000 }),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errs.array() });

  const { id: transferId } = req.params;
  const { rating, notes }  = req.body;
  const closerId           = req.user.id;

  // Verify transfer exists + get company_id (fronter's company)
  const { data: transfer, error: tErr } = await supabaseAdmin
    .from('transfers').select('id, company_id, assigned_closer_id').eq('id', transferId).single();

  if (tErr || !transfer) return res.status(404).json({ error: 'Transfer not found' });
  if (transfer.assigned_closer_id !== closerId) return res.status(403).json({ error: 'Only the assigned closer can review this transfer' });

  // Upsert — one review per transfer per closer
  const { data: existing } = await supabaseAdmin
    .from('call_reviews').select('id').eq('transfer_id', transferId).eq('closer_id', closerId).single();

  let result;
  if (existing) {
    const { data, error } = await supabaseAdmin
      .from('call_reviews').update({ rating, notes, created_at: new Date().toISOString() })
      .eq('id', existing.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    result = data;
  } else {
    const { data, error } = await supabaseAdmin
      .from('call_reviews').insert({
        transfer_id: transferId,
        closer_id:   closerId,
        company_id:  transfer.company_id,
        rating,
        notes: notes || null,
      }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    result = data;
  }

  res.status(201).json({ review: result });
}));

// ============================================================================
// POST /reviews/transfer/:id/dispo — closer sets disposition for a transfer
// ============================================================================
router.post('/transfer/:id/dispo', [
  body('disposition').isIn(DISPOSITIONS),
  body('notes').optional().isString().isLength({ max: 1000 }),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errs.array() });

  const { id: transferId }  = req.params;
  const { disposition, notes } = req.body;
  const closerId              = req.user.id;

  const { data: transfer, error: tErr } = await supabaseAdmin
    .from('transfers').select('id, company_id, assigned_closer_id').eq('id', transferId).single();

  if (tErr || !transfer) return res.status(404).json({ error: 'Transfer not found' });
  if (transfer.assigned_closer_id !== closerId) return res.status(403).json({ error: 'Only the assigned closer can set disposition' });

  const { data: existing } = await supabaseAdmin
    .from('call_dispositions').select('id').eq('transfer_id', transferId).eq('closer_id', closerId).single();

  let result;
  if (existing) {
    const { data, error } = await supabaseAdmin
      .from('call_dispositions').update({ disposition, notes, created_at: new Date().toISOString() })
      .eq('id', existing.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    result = data;
  } else {
    const { data, error } = await supabaseAdmin
      .from('call_dispositions').insert({
        transfer_id: transferId,
        closer_id:   closerId,
        company_id:  transfer.company_id,
        disposition,
        notes: notes || null,
      }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    result = data;
  }

  res.status(201).json({ disposition: result });
}));

// ============================================================================
// GET /reviews — list reviews scoped to company
//   - compliance/superadmin: all companies (or filter by ?company_id=)
//   - others: own company only
// ============================================================================
router.get('/', asyncHandler(async (req, res) => {
  const userId    = req.user.id;
  const userRole  = req.user.role;
  const { company_id, rating, page = 1, limit = 50, date_from, date_to } = req.query;

  const isSA      = await isSuperAdmin(userId);
  const isQA      = ['compliance_manager', 'superadmin'].includes(userRole);
  const scopeAll  = isSA || isQA;

  const targetCompany = company_id || req.user.company_id || null;

  let query = supabaseAdmin
    .from('call_reviews')
    .select('id, rating, notes, created_at, transfer_id, company_id, closer_id', { count: 'exact' })
    .order('created_at', { ascending: false });

  // Closer-side roles (closer_manager, compliance_manager) live in a closer company.
  // Reviews are tagged with the FRONTER's company_id (from the transfer), so filtering
  // by company_id would return 0 results. Scope by closer_id for their company's users instead.
  const isCloserSide = ['closer_manager', 'compliance_manager'].includes(userRole) && !scopeAll;
  if (isCloserSide && targetCompany) {
    const { data: coUsers } = await supabaseAdmin
      .from('user_company_roles').select('user_id')
      .eq('company_id', targetCompany).eq('is_active', true);
    const closerIds = (coUsers || []).map(u => u.user_id);
    if (closerIds.length === 0) {
      return res.json({ reviews: [], total: 0, page: parseInt(page), limit: parseInt(limit) });
    }
    query = query.in('closer_id', closerIds);
  } else if (!scopeAll && targetCompany) {
    query = query.eq('company_id', targetCompany);
  }

  if (rating)    query = query.eq('rating', rating);
  if (date_from) query = query.gte('created_at', date_from);
  if (date_to)   query = query.lte('created_at', date_to + 'T23:59:59Z');

  const offset = (parseInt(page) - 1) * parseInt(limit);
  query = query.range(offset, offset + parseInt(limit) - 1);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const reviews     = data || [];
  const closerIds   = [...new Set(reviews.map(r => r.closer_id).filter(Boolean))];
  const transferIds = [...new Set(reviews.map(r => r.transfer_id).filter(Boolean))];

  const [profileResult, transferResult] = await Promise.all([
    closerIds.length   > 0 ? supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', closerIds)   : { data: [] },
    transferIds.length > 0 ? supabaseAdmin.from('transfers').select('id, form_data, status, company_id').in('id', transferIds) : { data: [] },
  ]);

  const profileMap  = {};
  (profileResult.data  || []).forEach(p => { profileMap[p.user_id] = p; });
  const transferMap = {};
  (transferResult.data || []).forEach(t => { transferMap[t.id]     = t; });

  const enriched = reviews.map(r => ({
    ...r,
    user_profiles: profileMap[r.closer_id]    || null,
    transfers:     transferMap[r.transfer_id] || null,
  }));

  res.json({ reviews: enriched, total: count || 0, page: parseInt(page), limit: parseInt(limit) });
}));

// ============================================================================
// GET /reviews/dispositions — list dispositions scoped to company
// ============================================================================
router.get('/dispositions', asyncHandler(async (req, res) => {
  const userId    = req.user.id;
  const userRole  = req.user.role;
  const { company_id, disposition, page = 1, limit = 50 } = req.query;

  const isSA     = await isSuperAdmin(userId);
  const isQA     = ['compliance_manager', 'superadmin'].includes(userRole);
  const scopeAll = isSA || isQA;

  const targetCompany = company_id || req.user.company_id || null;

  let query = supabaseAdmin
    .from('call_dispositions')
    .select('id, disposition, notes, created_at, transfer_id, company_id, closer_id', { count: 'exact' })
    .order('created_at', { ascending: false });

  // Same scoping fix as /reviews: closer-side roles scope by closer_id not company_id
  const isCloserSide = ['closer_manager', 'compliance_manager'].includes(userRole) && !scopeAll;
  if (isCloserSide && targetCompany) {
    const { data: coUsers } = await supabaseAdmin
      .from('user_company_roles').select('user_id')
      .eq('company_id', targetCompany).eq('is_active', true);
    const closerIds = (coUsers || []).map(u => u.user_id);
    if (closerIds.length === 0) {
      return res.json({ dispositions: [], total: 0, page: parseInt(page), limit: parseInt(limit) });
    }
    query = query.in('closer_id', closerIds);
  } else if (!scopeAll && targetCompany) {
    query = query.eq('company_id', targetCompany);
  }

  if (disposition) query = query.eq('disposition', disposition);

  const offset = (parseInt(page) - 1) * parseInt(limit);
  query = query.range(offset, offset + parseInt(limit) - 1);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const dispos      = data || [];
  const closerIds   = [...new Set(dispos.map(d => d.closer_id).filter(Boolean))];
  const transferIds = [...new Set(dispos.map(d => d.transfer_id).filter(Boolean))];

  const [profileResult, transferResult] = await Promise.all([
    closerIds.length   > 0 ? supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', closerIds)   : { data: [] },
    transferIds.length > 0 ? supabaseAdmin.from('transfers').select('id, form_data, status').in('id', transferIds)                   : { data: [] },
  ]);

  const profileMap  = {};
  (profileResult.data  || []).forEach(p => { profileMap[p.user_id] = p; });
  const transferMap = {};
  (transferResult.data || []).forEach(t => { transferMap[t.id]     = t; });

  const enriched = dispos.map(d => ({
    ...d,
    user_profiles: profileMap[d.closer_id]    || null,
    transfers:     transferMap[d.transfer_id] || null,
  }));

  res.json({ dispositions: enriched, total: count || 0, page: parseInt(page), limit: parseInt(limit) });
}));

module.exports = router;

const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');
const { arrayTargetMatches, getAudienceReference } = require('../utils/audienceTargeting');

const router = express.Router();
const VALID_STATUS = ['draft', 'active', 'ended'];

const superadminOnly = asyncHandler(async (req, res, next) => {
  if (!(await isSuperAdmin(req.user.id))) return res.status(403).json({ error: 'Superadmin access required' });
  next();
});

// Enrich entries with participant names + sort into a leaderboard.
async function leaderboard(campaignId, limit = null) {
  let q = supabaseAdmin.from('spiff_entries').select('*').eq('campaign_id', campaignId).order('value', { ascending: false });
  if (limit) q = q.limit(limit);
  const { data: entries } = await q;
  const ids = [...new Set((entries || []).map(e => e.user_id))];
  const names = {};
  if (ids.length) {
    const { data } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', ids);
    (data || []).forEach(p => { names[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown'; });
  }
  return (entries || []).map((e, i) => ({ ...e, rank: i + 1, name: names[e.user_id] || 'Unknown' }));
}

router.get('/reference', superadminOnly, asyncHandler(async (req, res) => res.json(await getAudienceReference())));

// All campaigns + participant counts (superadmin)
router.get('/manage', superadminOnly, asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin.from('spiff_campaigns').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const ids = (data || []).map(c => c.id);
  const counts = {};
  if (ids.length) {
    const { data: entries } = await supabaseAdmin.from('spiff_entries').select('campaign_id').in('campaign_id', ids);
    (entries || []).forEach(e => { counts[e.campaign_id] = (counts[e.campaign_id] || 0) + 1; });
  }
  res.json({ campaigns: (data || []).map(c => ({ ...c, participant_count: counts[c.id] || 0 })) });
}));

// Active campaigns targeted to the caller + their progress + top-5 leaderboard
router.get('/', asyncHandler(async (req, res) => {
  const viewer = { id: req.user.id, role: req.user.role, company_id: req.user.company_id };
  const { data, error } = await supabaseAdmin
    .from('spiff_campaigns').select('*').eq('status', 'active').order('ends_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  const campaigns = (data || []).filter(c => arrayTargetMatches(c, viewer));
  const out = [];
  for (const c of campaigns) {
    const top = await leaderboard(c.id, 5);
    const { data: mine } = await supabaseAdmin.from('spiff_entries').select('value').eq('campaign_id', c.id).eq('user_id', viewer.id).maybeSingle();
    out.push({ ...c, leaderboard: top, my_value: mine?.value || 0 });
  }
  res.json({ campaigns: out });
}));

// Campaign detail + full leaderboard (superadmin)
router.get('/:id', superadminOnly, asyncHandler(async (req, res) => {
  const { data: campaign, error } = await supabaseAdmin.from('spiff_campaigns').select('*').eq('id', req.params.id).single();
  if (error || !campaign) return res.status(404).json({ error: 'Not found' });
  res.json({ campaign, leaderboard: await leaderboard(req.params.id) });
}));

router.post('/', superadminOnly, [
  body('title').trim().notEmpty(),
  body('metric').trim().notEmpty(),
  body('target_value').isNumeric(),
  body('starts_at').notEmpty(),
  body('ends_at').notEmpty(),
  body('status').optional().isIn(VALID_STATUS),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errs.array() });
  const b = req.body;
  const { data, error } = await supabaseAdmin.from('spiff_campaigns').insert({
    title: b.title.trim(),
    description: b.description || null,
    metric: b.metric.trim(),
    target_value: b.target_value,
    reward_amount: b.reward_amount ?? null,
    reward_description: b.reward_description || null,
    target_company_ids: b.target_company_ids?.length ? b.target_company_ids : null,
    target_roles: b.target_roles?.length ? b.target_roles : null,
    target_user_ids: b.target_user_ids?.length ? b.target_user_ids : null,
    status: VALID_STATUS.includes(b.status) ? b.status : 'active',
    starts_at: b.starts_at,
    ends_at: b.ends_at,
    created_by: req.user.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ campaign: data });
}));

router.put('/:id', superadminOnly, asyncHandler(async (req, res) => {
  const b = req.body;
  const updates = {};
  ['title', 'description', 'metric', 'target_value', 'reward_amount', 'reward_description', 'status', 'starts_at', 'ends_at'].forEach(k => { if (b[k] !== undefined) updates[k] = b[k]; });
  ['target_company_ids', 'target_roles', 'target_user_ids'].forEach(k => { if (b[k] !== undefined) updates[k] = b[k]?.length ? b[k] : null; });
  const { data, error } = await supabaseAdmin.from('spiff_campaigns').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Not found' });
  res.json({ campaign: data });
}));

router.delete('/:id', superadminOnly, asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from('spiff_campaigns').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Deleted' });
}));

// Manually set a participant's score (superadmin data entry)
router.post('/:id/entry', superadminOnly, [
  body('user_id').isUUID(),
  body('value').isNumeric(),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errs.array() });
  const { data, error } = await supabaseAdmin.from('spiff_entries').upsert(
    { campaign_id: req.params.id, user_id: req.body.user_id, value: req.body.value, updated_at: new Date().toISOString() },
    { onConflict: 'campaign_id,user_id' }
  ).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ entry: data });
}));

module.exports = router;

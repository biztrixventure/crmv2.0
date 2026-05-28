const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');
const { arrayTargetMatches, getAudienceReference } = require('../utils/audienceTargeting');
const { getProgress, invalidate } = require('../utils/spiffMetrics');

const router = express.Router();
const VALID_STATUS = ['draft', 'active', 'ended'];
const VALID_METRIC_SOURCE = ['manual', 'transfers', 'sales', 'revenue'];

// Managerial roles allowed to create/manage SPIFFs scoped to their own company.
// Superadmin (handled separately) gets unrestricted access.
const MANAGER_ROLES = ['company_admin', 'operations_manager', 'closer_manager', 'fronter_manager', 'manager'];

const superadminOnly = asyncHandler(async (req, res, next) => {
  if (!(await isSuperAdmin(req.user.id))) return res.status(403).json({ error: 'Superadmin access required' });
  next();
});

// Anyone allowed to manage SPIFFs (superadmin OR a managerial role). The
// per-resource company-scope check still runs inside each handler.
const manageAccess = asyncHandler(async (req, res, next) => {
  if (await isSuperAdmin(req.user.id)) { req._isSuperadmin = true; return next(); }
  if (MANAGER_ROLES.includes(req.user.role)) return next();
  return res.status(403).json({ error: 'Manager access required' });
});

// Validate that a non-superadmin's targeting fields stay inside their own
// company. Returns null on success, or a string error to send back as 400.
async function validateScopedTargeting(req, body) {
  if (req._isSuperadmin) return null;
  const userCompanyId = req.user.company_id;
  if (!userCompanyId) return 'Your account has no company assigned';

  // target_company_ids must be exactly [userCompanyId] — non-superadmin can't
  // target all-companies (null/empty) and can't target someone else's.
  const cos = body.target_company_ids || [];
  if (!cos.length) return 'You must target your own company explicitly';
  if (cos.some(c => c !== userCompanyId)) return 'You can only target your own company';

  if (body.target_user_ids?.length) {
    const { data } = await supabaseAdmin
      .from('user_company_roles')
      .select('user_id')
      .eq('company_id', userCompanyId)
      .eq('is_active', true)
      .in('user_id', body.target_user_ids);
    const inCompany = new Set((data || []).map(r => r.user_id));
    const stray = body.target_user_ids.filter(u => !inCompany.has(u));
    if (stray.length) return 'Some selected users are not in your company';
  }
  return null;
}

// Company-scope check for editing/deleting an existing campaign.
function canTouch(req, campaign) {
  if (req._isSuperadmin) return true;
  const cos = campaign.target_company_ids || [];
  return cos.length === 1 && cos[0] === req.user.company_id;
}

// Leaderboard for a MANUAL campaign — keeps reading from spiff_entries exactly
// like the original implementation. Auto campaigns go through spiffMetrics.
async function manualLeaderboard(campaignId, limit = null) {
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

// Unified leaderboard accessor: route by metric_source.
async function leaderboardFor(campaign, limit = null) {
  if (campaign.metric_source && campaign.metric_source !== 'manual') {
    const p = await getProgress(campaign);
    return limit ? (p.entries || []).slice(0, limit) : (p.entries || []);
  }
  return manualLeaderboard(campaign.id, limit);
}

async function myValueFor(campaign, userId) {
  if (campaign.metric_source && campaign.metric_source !== 'manual') {
    const p = await getProgress(campaign);
    return p.valueByUser?.[userId] || 0;
  }
  const { data: mine } = await supabaseAdmin
    .from('spiff_entries').select('value')
    .eq('campaign_id', campaign.id).eq('user_id', userId).maybeSingle();
  return mine?.value || 0;
}

router.get('/reference', manageAccess, asyncHandler(async (req, res) => res.json(await getAudienceReference())));

// All manageable campaigns + participant counts. Superadmin sees everything;
// scoped managers see only campaigns targeting their company.
router.get('/manage', manageAccess, asyncHandler(async (req, res) => {
  let q = supabaseAdmin.from('spiff_campaigns').select('*').order('created_at', { ascending: false });
  // Non-superadmin: restrict to campaigns whose target_company_ids includes
  // their company (PostgREST's `cs` = array contains).
  if (!req._isSuperadmin) q = q.contains('target_company_ids', [req.user.company_id]);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const out = [];
  for (const c of (data || [])) {
    let participant_count = 0;
    if (c.metric_source && c.metric_source !== 'manual') {
      const p = await getProgress(c);
      participant_count = p?.participantCount || 0;
    } else {
      const { count } = await supabaseAdmin
        .from('spiff_entries').select('id', { count: 'exact', head: true }).eq('campaign_id', c.id);
      participant_count = count || 0;
    }
    out.push({ ...c, participant_count });
  }
  res.json({ campaigns: out });
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
    const [top, mine] = await Promise.all([
      leaderboardFor(c, 5),
      myValueFor(c, viewer.id),
    ]);
    out.push({ ...c, leaderboard: top, my_value: mine });
  }
  res.json({ campaigns: out });
}));

// Campaign detail + full leaderboard (managers limited to their company)
router.get('/:id', manageAccess, asyncHandler(async (req, res) => {
  const { data: campaign, error } = await supabaseAdmin.from('spiff_campaigns').select('*').eq('id', req.params.id).single();
  if (error || !campaign) return res.status(404).json({ error: 'Not found' });
  if (!canTouch(req, campaign)) return res.status(403).json({ error: 'Out of scope' });
  res.json({ campaign, leaderboard: await leaderboardFor(campaign) });
}));

router.post('/', manageAccess, [
  body('title').trim().notEmpty(),
  body('metric').trim().notEmpty(),
  body('metric_source').optional().isIn(VALID_METRIC_SOURCE),
  body('target_value').isNumeric(),
  body('starts_at').notEmpty(),
  body('ends_at').notEmpty(),
  body('status').optional().isIn(VALID_STATUS),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errs.array() });
  const b = req.body;

  const scopeErr = await validateScopedTargeting(req, b);
  if (scopeErr) return res.status(403).json({ error: scopeErr });

  const { data, error } = await supabaseAdmin.from('spiff_campaigns').insert({
    title: b.title.trim(),
    description: b.description || null,
    metric: b.metric.trim(),
    metric_source: VALID_METRIC_SOURCE.includes(b.metric_source) ? b.metric_source : 'manual',
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

router.put('/:id', manageAccess, asyncHandler(async (req, res) => {
  const { data: existing } = await supabaseAdmin.from('spiff_campaigns').select('*').eq('id', req.params.id).single();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!canTouch(req, existing)) return res.status(403).json({ error: 'Out of scope' });

  // If targeting is being changed, re-validate scope against the NEW values.
  const b = req.body;
  const probe = {
    target_company_ids: b.target_company_ids ?? existing.target_company_ids,
    target_user_ids:    b.target_user_ids    ?? existing.target_user_ids,
  };
  const scopeErr = await validateScopedTargeting(req, probe);
  if (scopeErr) return res.status(403).json({ error: scopeErr });

  if (b.metric_source !== undefined && !VALID_METRIC_SOURCE.includes(b.metric_source)) {
    return res.status(400).json({ error: 'Invalid metric_source' });
  }

  const updates = {};
  ['title', 'description', 'metric', 'metric_source', 'target_value', 'reward_amount', 'reward_description', 'status', 'starts_at', 'ends_at'].forEach(k => { if (b[k] !== undefined) updates[k] = b[k]; });
  ['target_company_ids', 'target_roles', 'target_user_ids'].forEach(k => { if (b[k] !== undefined) updates[k] = b[k]?.length ? b[k] : null; });

  const { data, error } = await supabaseAdmin.from('spiff_campaigns').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Not found' });

  invalidate(req.params.id);
  res.json({ campaign: data });
}));

router.delete('/:id', manageAccess, asyncHandler(async (req, res) => {
  const { data: existing } = await supabaseAdmin.from('spiff_campaigns').select('*').eq('id', req.params.id).single();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!canTouch(req, existing)) return res.status(403).json({ error: 'Out of scope' });

  const { error } = await supabaseAdmin.from('spiff_campaigns').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  invalidate(req.params.id);
  res.json({ message: 'Deleted' });
}));

// Manual data-entry — only meaningful for manual campaigns. Auto campaigns
// derive their scores from real activity and reject any attempt to overwrite,
// so a stale UI button can't silently put fake numbers on the leaderboard.
router.post('/:id/entry', superadminOnly, [
  body('user_id').isUUID(),
  body('value').isNumeric(),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errs.array() });

  const { data: campaign } = await supabaseAdmin.from('spiff_campaigns').select('metric_source').eq('id', req.params.id).single();
  if (!campaign) return res.status(404).json({ error: 'Not found' });
  if (campaign.metric_source && campaign.metric_source !== 'manual') {
    return res.status(409).json({ error: 'This campaign is auto-computed from system activity; manual values are not accepted.' });
  }

  const { data, error } = await supabaseAdmin.from('spiff_entries').upsert(
    { campaign_id: req.params.id, user_id: req.body.user_id, value: req.body.value, updated_at: new Date().toISOString() },
    { onConflict: 'campaign_id,user_id' }
  ).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ entry: data });
}));

module.exports = router;

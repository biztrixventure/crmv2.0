// ============================================================================
// /api/module-designations -- who ALSO works as the accountant or the HR
// manager, and FOR WHICH COMPANIES.
//
// SUPERADMIN ONLY, and that is the point. The Accounting and HR modules ship
// with real role levels (accountant, hr_manager, employee -- mig 290), but in
// practice nobody will be given them: the people who do these jobs already hold
// compliance_manager, company_admin or operations_manager, and changing their
// role would change their shell and their whole permission set.
//
// The company list (mig 293) is what makes this useful rather than decorative.
// The job is routinely cross-tenant -- a compliance manager who belongs to
// 1-Vertex may be the person who runs HR and the books for Wavetech Infomatics.
// An empty list keeps the mig 290 meaning: they act in the companies they
// already belong to.
//
// Turning a designation OFF keeps its company rows, so flicking it back on does
// not silently lose the operator's choices -- the same reasoning mig 227 used
// for the quality-manager designation.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const { isSuperAdmin } = require('../models/helpers');
const { MODULES, setDesignation, designatedModules, designatedCompanies } = require('../utils/moduleAccess');

const router = express.Router();

// Roles a designation makes sense for. Anyone senior enough to be trusted with
// the books or with payroll; the list is generous because the superadmin is the
// one deciding, and an empty picker is the failure mode that killed the QA org
// chart before mig 227. superadmin is included deliberately: a second
// superadmin can be pointed at named companies too.
const CANDIDATE_LEVELS = [
  'superadmin', 'company_admin', 'operations_manager', 'compliance_manager',
  'closer_manager', 'fronter_manager', 'manager',
  'accountant', 'hr_manager',
];

const profName = (p) => [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim();

// Everything the User Control Center needs for ONE user: which modules they
// hold, the companies each is scoped to, and the companies available to pick.
router.get('/user/:userId', asyncHandler(async (req, res) => {
  if (!(await isSuperAdmin(req.user.id))) return res.status(403).json({ error: 'Superadmin only' });
  const userId = req.params.userId;

  const modules = await designatedModules(userId);
  const scope = {};
  for (const m of MODULES) scope[m] = await designatedCompanies(userId, m);

  const [{ data: companies }, { data: memberships }] = await Promise.all([
    supabaseAdmin.from('companies').select('id, name').eq('is_active', true).order('name'),
    supabaseAdmin.from('user_company_roles').select('company_id').eq('user_id', userId).eq('is_active', true),
  ]);

  res.json({
    user_id: userId,
    modules,
    companies: scope,
    all_companies: companies || [],
    // Their own companies, so the UI can say which picks are already implied by
    // membership rather than making the operator guess.
    member_company_ids: [...new Set((memberships || []).map(r => r.company_id))],
  });
}));

// GET / -- every candidate, flagged with what they hold. Drives a future
// overview; the per-user endpoint above is what the UCC section calls.
router.get('/', asyncHandler(async (req, res) => {
  if (!(await isSuperAdmin(req.user.id))) return res.status(403).json({ error: 'Superadmin only' });

  const { data: ucr } = await supabaseAdmin
    .from('user_company_roles').select('user_id, company_id, custom_roles(name, level)').eq('is_active', true);

  const byUid = {};
  for (const r of (ucr || [])) {
    const lvl = Array.isArray(r.custom_roles) ? r.custom_roles[0]?.level : r.custom_roles?.level;
    if (!CANDIDATE_LEVELS.includes(lvl)) continue;
    (byUid[r.user_id] ||= { levels: new Set(), companies: new Set() });
    byUid[r.user_id].levels.add(lvl);
    if (r.company_id) byUid[r.user_id].companies.add(r.company_id);
  }

  // Anyone already designated stays listed even if their role later moved off
  // the candidate list -- otherwise the toggle that granted it becomes
  // unreachable and the access is stuck on.
  const { data: desig } = await supabaseAdmin.from('module_designations').select('user_id, module');
  const { data: desigCo } = await supabaseAdmin
    .from('module_designation_companies').select('user_id, module, company_id');

  const heldBy = {};
  for (const d of (desig || [])) {
    (heldBy[d.user_id] ||= []).push(d.module);
    byUid[d.user_id] ||= { levels: new Set(), companies: new Set() };
  }
  const scopeCount = {};
  for (const d of (desigCo || [])) {
    scopeCount[d.user_id] = (scopeCount[d.user_id] || 0) + 1;
  }

  const uids = Object.keys(byUid);
  let names = {};
  if (uids.length) {
    // NOTE: user_profiles has no email column -- selecting one 400s the request.
    const { data: profs } = await supabaseAdmin
      .from('user_profiles').select('user_id, first_name, last_name').in('user_id', uids);
    names = Object.fromEntries((profs || []).map(p => [p.user_id, profName(p) || p.user_id]));
  }

  res.json({
    modules: MODULES,
    candidates: uids.map(uid => ({
      user_id: uid,
      name: names[uid] || uid,
      levels: [...byUid[uid].levels],
      company_count: byUid[uid].companies.size,
      designated: heldBy[uid] || [],
      scoped_company_count: scopeCount[uid] || 0,
    })).sort((a, b) =>
      (b.designated.length - a.designated.length) || a.name.localeCompare(b.name)),
  });
}));

// PUT / { user_id, module, enabled, company_ids? }
//
// company_ids omitted  -> plain on/off, existing scope untouched.
// company_ids: [...]   -> replaces the scope. [] means "unscoped": the
//                         designation falls back to their own companies.
router.put('/', asyncHandler(async (req, res) => {
  if (!(await isSuperAdmin(req.user.id))) return res.status(403).json({ error: 'Superadmin only' });

  const userId = req.body?.user_id;
  const mod = req.body?.module;
  const enabled = !!req.body?.enabled;
  const companyIds = Array.isArray(req.body?.company_ids) ? req.body.company_ids : null;

  if (!userId) return res.status(400).json({ error: 'user_id required' });
  if (!MODULES.includes(mod)) return res.status(400).json({ error: 'module must be one of: ' + MODULES.join(', ') });

  // Refuse a company that does not exist or is archived, rather than storing a
  // pointer to nothing and letting the picker look broken later.
  if (companyIds?.length) {
    const { data: valid } = await supabaseAdmin
      .from('companies').select('id').eq('is_active', true).in('id', companyIds);
    const ok = new Set((valid || []).map(c => c.id));
    const bad = companyIds.filter(id => !ok.has(id));
    if (bad.length) return res.status(400).json({ error: 'Unknown or inactive company', company_ids: bad });
  }

  try {
    await setDesignation(userId, mod, enabled, req.user.id, companyIds);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  logger.info('MODULES', (enabled ? 'designated' : 'removed') + ' ' + mod + ' for ' + userId
    + (companyIds ? ' scoped to ' + (companyIds.length || 'own') + ' company(ies)' : '')
    + ' by ' + req.user.id);

  res.json({
    ok: true,
    user_id: userId,
    module: mod,
    enabled,
    modules: await designatedModules(userId),
    companies: await designatedCompanies(userId, mod),
  });
}));

module.exports = router;

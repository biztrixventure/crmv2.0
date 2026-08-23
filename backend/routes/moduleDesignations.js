// ============================================================================
// /api/module-designations -- who ALSO works as the accountant or HR manager.
//
// SUPERADMIN ONLY, and that is the point. The Accounting and HR modules ship
// with real role levels (accountant, hr_manager, employee -- mig 290), but in
// practice nobody will be given them: the people who do these jobs already hold
// compliance_manager, company_admin or operations_manager, and changing their
// role would change their shell and their whole permission set.
//
// So the superadmin toggles it per user from the User Control Center, exactly
// the way the quality-manager designation works (mig 227, /qa/admin/
// manager-designation). One user can hold accounting, HR, both, or neither.
//
// Turning a designation OFF does not delete anything that person created. It
// only stops the module opening for them.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const { isSuperAdmin } = require('../models/helpers');
const { MODULES, setDesignation, designatedModules } = require('../utils/moduleAccess');

const router = express.Router();

// Roles a designation makes sense for. Anyone senior enough to be trusted with
// the books or with payroll; the list is generous because the superadmin is the
// one deciding, and an empty picker is the failure mode that killed the QA org
// chart before mig 227.
const CANDIDATE_LEVELS = [
  'company_admin', 'operations_manager', 'compliance_manager',
  'closer_manager', 'fronter_manager', 'manager',
  'accountant', 'hr_manager',
];

const profName = (p) => [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim();

// GET /api/module-designations/:userId -- what this one user holds today.
// Used by the User Control Center section.
router.get('/user/:userId', asyncHandler(async (req, res) => {
  if (!(await isSuperAdmin(req.user.id))) return res.status(403).json({ error: 'Superadmin only' });
  res.json({ user_id: req.params.userId, modules: await designatedModules(req.params.userId) });
}));

// GET /api/module-designations -- every candidate, flagged with what they hold.
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
  const heldBy = {};
  for (const d of (desig || [])) {
    (heldBy[d.user_id] ||= []).push(d.module);
    byUid[d.user_id] ||= { levels: new Set(), companies: new Set() };
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
    })).sort((a, b) =>
      (b.designated.length - a.designated.length) || a.name.localeCompare(b.name)),
  });
}));

// PUT /api/module-designations { user_id, module, enabled }
router.put('/', asyncHandler(async (req, res) => {
  if (!(await isSuperAdmin(req.user.id))) return res.status(403).json({ error: 'Superadmin only' });

  const userId = req.body?.user_id;
  const mod = req.body?.module;
  const enabled = !!req.body?.enabled;
  if (!userId) return res.status(400).json({ error: 'user_id required' });
  if (!MODULES.includes(mod)) return res.status(400).json({ error: 'module must be one of: ' + MODULES.join(', ') });

  try {
    await setDesignation(userId, mod, enabled, req.user.id);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  logger.info('MODULES', (enabled ? 'designated' : 'removed') + ' ' + mod + ' for ' + userId + ' by ' + req.user.id);
  res.json({ ok: true, user_id: userId, module: mod, enabled, modules: await designatedModules(userId) });
}));

module.exports = router;

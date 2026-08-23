// ============================================================================
// /api/hr -- module router. Mounted once in server.js.
//
// GET /my-scope is the tab gate, and it exists for the same reason QA v2 needs
// /qa2/my-scope: a DESIGNATION (mig 290, module_designations) is a runtime fact,
// not a role grant, so the permissions array from /auth/me will never mention
// it. It also reports whether the caller has an hr_employees record, because
// every self-service tab is dead without one and the UI should say so plainly
// rather than render four empty panels.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../../config/database');
const { asyncHandler } = require('../../middleware/errorHandler');
const { isSuperAdmin } = require('../../models/helpers');
const { can, isDesignated, readCompanyId, selfEmployee } = require('../../utils/moduleAccess');

const router = express.Router();

router.get('/my-scope', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  const superadmin = await isSuperAdmin(req.user.id);
  const designated = await isDesignated(req.user.id, 'hr');

  let companyName = null;
  if (companyId) {
    const { data } = await supabaseAdmin.from('companies').select('name').eq('id', companyId).maybeSingle();
    companyName = data?.name || null;
  }

  const keys = [
    'hr.employees.view', 'hr.employees.manage',
    'hr.attendance.view_own', 'hr.attendance.view_team', 'hr.attendance.manage',
    'hr.leave.request', 'hr.leave.view_team', 'hr.leave.approve', 'hr.leave.manage',
    'hr.payroll.view_own', 'hr.payroll.view', 'hr.payroll.manage',
    'hr.reviews.participate', 'hr.reviews.view_team', 'hr.reviews.manage',
  ];
  const entries = await Promise.all(keys.map(async k => [k, await can(req, companyId, k)]));
  const perms = Object.fromEntries(entries);

  const employee = await selfEmployee(companyId, req.user.id);

  res.json({
    company_id: companyId,
    company_name: companyName,
    superadmin,
    designated,
    permissions: perms,
    employee,                                   // null = no HR record yet
    has_any: Object.values(perms).some(Boolean),
  });
}));

router.use('/employees',  require('./employees'));
router.use('/attendance', require('./attendance'));
router.use('/leave',      require('./leave'));
router.use('/payroll',    require('./payroll'));
router.use('/reviews',    require('./reviews'));

module.exports = router;

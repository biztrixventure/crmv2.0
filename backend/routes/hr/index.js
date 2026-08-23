// ============================================================================
// /api/hr -- module router. Mounted once in server.js.
//
// GET /my-scope is the tab gate, and it exists for the same reason QA v2 needs
// /qa2/my-scope: a DESIGNATION (mig 290, module_designations) is a runtime fact,
// not a role grant, so the permissions array from /auth/me will never mention
// it. It also reports whether the caller has an hr_employees record, because
// every self-service tab is dead without one and the UI should say so plainly
// rather than render four empty panels.
//
// And it answers the CROSS-COMPANY case: a superadmin has no company of their
// own (authMiddleware sets company_id = null), so without an explicit company
// every list is correctly but uselessly empty. my-scope hands them the company
// list; the shell picks one and passes ?company_id= from then on.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../../config/database');
const { asyncHandler } = require('../../middleware/errorHandler');
const { isSuperAdmin } = require('../../models/helpers');
const { can, isDesignated, readCompanyId, selfEmployee, moduleCompanies } = require('../../utils/moduleAccess');

const router = express.Router();

// Stamp the module on every request into it. utils/moduleAccess.js reads
// this to resolve a designation's COMPANY SCOPE (mig 293) without 119 call
// sites having to thread an extra argument through.
router.use((req, _res, next) => { req.moduleKey = 'hr'; next(); });

// Same rule as the accounting module -- see routes/accounting/index.js.
async function selectableCompanies(req) {
  if (['superadmin', 'readonly_admin'].includes(req.user?.role) || await isSuperAdmin(req.user.id)) {
    const { data } = await supabaseAdmin
      .from('companies').select('id, name').eq('is_active', true).order('name');
    return { companies: data || [], cross_company: true };
  }
  // Member companies PLUS any a designation named (mig 293). Only worth a
  // picker when there is more than one to choose between.
  const reachable = await moduleCompanies(req);
  return { companies: reachable.length > 1 ? reachable : [], cross_company: false };
}
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
  const { companies, cross_company } = await selectableCompanies(req);

  res.json({
    company_id: companyId,
    company_name: companyName,
    superadmin,
    designated,
    permissions: perms,
    employee,                                   // null = no HR record here
    companies,
    cross_company,
    needs_company: !companyId && companies.length > 0,
    has_any: Object.values(perms).some(Boolean),
  });
}));

router.use('/employees',  require('./employees'));
router.use('/attendance', require('./attendance'));
router.use('/leave',      require('./leave'));
router.use('/payroll',    require('./payroll'));
router.use('/reviews',    require('./reviews'));

module.exports = router;

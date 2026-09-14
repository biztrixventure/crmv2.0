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
const { isSuperAdmin, getCompanyCurrency } = require('../../models/helpers');
const { can, isDesignated, readCompanyId, selfEmployee, moduleCompanies } = require('../../utils/moduleAccess');
const { setChangeReason } = require('../../utils/requestContext');
const { historyRouter } = require('../moduleHistory');

const router = express.Router();

// Stamp the module on every request into it. utils/moduleAccess.js reads
// this to resolve a designation's COMPANY SCOPE (mig 293) without 119 call
// sites having to thread an extra argument through.
router.use((req, _res, next) => { req.moduleKey = 'hr'; next(); });

// A "why" typed next to any change travels with every write this request
// makes; the mig 313 change record stores it beside the change. Routes read
// their fields from explicit allowlists, so change_reason never lands in a
// business column.
router.use((req, _res, next) => {
  const why = req.body?.change_reason ?? req.query?.change_reason;
  if (why) setChangeReason(why);
  next();
});

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

  // Name AND currency: every page below formats money, and a page that guesses
  // the currency is what printed US$ on a rupee balance sheet (mig 295).
  let companyName = null;
  let currency = 'PKR';
  if (companyId) {
    const { data } = await supabaseAdmin
      .from('companies').select('name, currency').eq('id', companyId).maybeSingle();
    companyName = data?.name || null;
    currency = data?.currency || 'PKR';
  }

  const keys = [
    'hr.employees.view', 'hr.employees.manage',
    'hr.attendance.view_own', 'hr.attendance.view_team', 'hr.attendance.manage',
    'hr.leave.request', 'hr.leave.view_team', 'hr.leave.approve', 'hr.leave.manage',
    'hr.payroll.view_own', 'hr.payroll.view', 'hr.payroll.manage',
    'hr.reviews.participate', 'hr.reviews.view_team', 'hr.reviews.manage',
    'hr.history.view',
  ];
  const entries = await Promise.all(keys.map(async k => [k, await can(req, companyId, k)]));
  const perms = Object.fromEntries(entries);

  const employee = await selfEmployee(companyId, req.user.id);
  const { companies, cross_company } = await selectableCompanies(req);

  res.json({
    company_id: companyId,
    company_name: companyName,
    currency,
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

// GET /api/hr/overview -- every company the caller can reach, one row each
// (stage 7). The superadmin landing view, and the "all your companies" panel
// on Home for anyone in more than one. Only companies where the caller may see
// employees are listed; attendance / pay columns only where they may see those.
router.get('/overview', asyncHandler(async (req, res) => {
  const { companies } = await selectableCompanies(req);
  const { lastShift, inProgressDay } = require('../../utils/hrSnapshot');
  const rows = [];
  for (const c of companies) {
    if (!(await can(req, c.id, 'hr.employees.view'))) continue;
    const [emp, exits, leave, seeTeam, seePay] = await Promise.all([
      supabaseAdmin.from('hr_employees').select('id', { count: 'exact', head: true }).eq('company_id', c.id).eq('status', 'active'),
      supabaseAdmin.from('hr_exit_cases').select('id', { count: 'exact', head: true }).eq('company_id', c.id).eq('status', 'open'),
      supabaseAdmin.from('hr_leave_requests').select('id', { count: 'exact', head: true }).eq('company_id', c.id).eq('status', 'pending'),
      can(req, c.id, 'hr.attendance.view_team'), can(req, c.id, 'hr.payroll.view'),
    ]);
    const row = { company_id: c.id, name: c.name, active: emp.count || 0, open_exits: exits.count || 0, pending_leave: leave.count || 0 };
    if (seeTeam) row.last_shift = await lastShift(c.id, await inProgressDay(c.id));
    if (seePay) {
      const { data: runs } = await supabaseAdmin.from('hr_payroll_runs').select('status, paid_at').eq('company_id', c.id)
        .in('status', ['draft', 'processing', 'finalized']);
      row.payroll_open = (runs || []).filter(r => r.status !== 'finalized').length;
      row.payroll_unpaid = (runs || []).filter(r => r.status === 'finalized' && !r.paid_at).length;
    }
    rows.push(row);
  }
  res.json({ companies: rows });
}));

router.use('/history',    historyRouter('hr'));
router.use('/people',     require('./people'));
router.use('/employees',  require('./employees'));
router.use('/attendance', require('./attendance'));
router.use('/leave',      require('./leave'));
router.use('/payroll',    require('./payroll'));
router.use('/commissions', require('./commissions'));
router.use('/reviews',    require('./reviews'));

module.exports = router;

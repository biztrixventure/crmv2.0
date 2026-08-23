// ============================================================================
// /api/accounting -- module router. Mounted once in server.js; the sub-routers
// hang off it so the module reads as one unit rather than five app.use lines.
//
// GET /my-scope is the tab gate. The frontend cannot work out on its own
// whether someone is an ACCOUNTANT, because a designation (mig 290,
// module_designations) is a runtime fact rather than a role grant -- the
// permissions array from /auth/me will not mention it. Same reason QA v2 has to
// ask for /qa2/my-scope instead of trusting hasPermission alone.
//
// It also answers the CROSS-COMPANY case. A superadmin has no company of their
// own (authMiddleware sets company_id = null), so without an explicit company
// every list below is correctly but uselessly empty. my-scope hands them the
// company list; the shell picks one and passes ?company_id= from then on, which
// resolveScopedCompanyId already honours for superadmin / readonly_admin.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../../config/database');
const { asyncHandler } = require('../../middleware/errorHandler');
const { isSuperAdmin, getUserCompanies } = require('../../models/helpers');
const { can, isDesignated, readCompanyId } = require('../../utils/moduleAccess');

const router = express.Router();

// Companies this caller may point the module at.
//   superadmin / readonly_admin -> every active company (they have none of
//                                  their own, so this is the only way in)
//   everyone else               -> the companies they actually belong to, and
//                                  only when there is more than one, so a
//                                  single-company user never sees a pointless
//                                  picker.
async function selectableCompanies(req) {
  const crossCompany = ['superadmin', 'readonly_admin'].includes(req.user?.role)
    || await isSuperAdmin(req.user.id);
  if (crossCompany) {
    const { data } = await supabaseAdmin
      .from('companies').select('id, name').eq('is_active', true).order('name');
    return { companies: data || [], cross_company: true };
  }
  const mine = (await getUserCompanies(req.user.id)).filter(c => c.is_active !== false);
  return { companies: mine.length > 1 ? mine.map(c => ({ id: c.id, name: c.name })) : [], cross_company: false };
}

router.get('/my-scope', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  const superadmin = await isSuperAdmin(req.user.id);
  const designated = await isDesignated(req.user.id, 'accounting');

  let companyName = null;
  if (companyId) {
    const { data } = await supabaseAdmin.from('companies').select('name').eq('id', companyId).maybeSingle();
    companyName = data?.name || null;
  }

  const keys = [
    'accounting.accounts.view', 'accounting.accounts.manage',
    'accounting.journal.view', 'accounting.journal.manage',
    'accounting.invoices.view', 'accounting.invoices.manage',
    'accounting.expenses.view', 'accounting.expenses.submit', 'accounting.expenses.approve',
    'accounting.reports.view',
  ];
  const entries = await Promise.all(keys.map(async k => [k, await can(req, companyId, k)]));
  const perms = Object.fromEntries(entries);

  const { companies, cross_company } = await selectableCompanies(req);

  res.json({
    company_id: companyId,
    company_name: companyName,
    superadmin,
    designated,
    permissions: perms,
    companies,
    cross_company,
    // A cross-company admin with no company chosen yet is NOT "no access" --
    // the shell has to tell those two states apart or it shows the wrong
    // empty screen.
    needs_company: !companyId && companies.length > 0,
    // One flag the shell can check before rendering anything at all.
    has_any: Object.values(perms).some(Boolean),
  });
}));

router.use('/accounts', require('./chartOfAccounts'));
router.use('/journal',  require('./journal'));
router.use('/invoices', require('./invoices'));
router.use('/expenses', require('./expenses'));
router.use('/reports',  require('./reports'));

module.exports = router;

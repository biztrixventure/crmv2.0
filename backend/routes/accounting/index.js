// ============================================================================
// /api/accounting -- module router. Mounted once in server.js; the sub-routers
// hang off it so the module reads as one unit rather than five app.use lines.
//
// GET /my-scope is the tab gate. The frontend cannot work out on its own
// whether someone is an ACCOUNTANT, because a designation (mig 290,
// module_designations) is a runtime fact rather than a role grant -- the
// permissions array from /auth/me will not mention it. Same reason QA v2 has to
// ask for /qa2/my-scope instead of trusting hasPermission alone.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../../config/database');
const { asyncHandler } = require('../../middleware/errorHandler');
const { isSuperAdmin } = require('../../models/helpers');
const { can, isDesignated, readCompanyId } = require('../../utils/moduleAccess');

const router = express.Router();

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

  res.json({
    company_id: companyId,
    company_name: companyName,
    superadmin,
    designated,
    permissions: perms,
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

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
const { isSuperAdmin, getCompanyCurrency } = require('../../models/helpers');
const { can, isDesignated, readCompanyId, moduleCompanies } = require('../../utils/moduleAccess');
const { setChangeReason } = require('../../utils/requestContext');
const { historyRouter } = require('../moduleHistory');

const router = express.Router();

// Stamp the module on every request into it. utils/moduleAccess.js reads
// this to resolve a designation's COMPANY SCOPE (mig 293) without 119 call
// sites having to thread an extra argument through.
router.use((req, _res, next) => { req.moduleKey = 'accounting'; next(); });

// A "why" typed next to any change travels with every write this request
// makes (mig 313 change record). Same rule as routes/hr/index.js.
router.use((req, _res, next) => {
  const why = req.body?.change_reason ?? req.query?.change_reason;
  if (why) setChangeReason(why);
  next();
});

// Companies this caller may point the module at.
//   superadmin / readonly_admin -> every active company (they have none of
//                                  their own, so this is the only way in)
//   everyone else               -> the companies they actually belong to, and
//                                  only when there is more than one, so a
//                                  single-company user never sees a pointless
//                                  picker.
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
  const designated = await isDesignated(req.user.id, 'accounting');

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
    'accounting.accounts.view', 'accounting.accounts.manage',
    'accounting.journal.view', 'accounting.journal.manage',
    'accounting.invoices.view', 'accounting.invoices.manage',
    'accounting.expenses.view', 'accounting.expenses.submit', 'accounting.expenses.approve',
    'accounting.reports.view',
    'accounting.history.view',
    'accounting.settings.manage',
  ];
  const entries = await Promise.all(keys.map(async k => [k, await can(req, companyId, k)]));
  const perms = Object.fromEntries(entries);

  const { companies, cross_company } = await selectableCompanies(req);

  res.json({
    company_id: companyId,
    company_name: companyName,
    currency,
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

// GET /api/accounting/overview -- every company the caller can reach, one row
// each (stage 7): this month's money in / out / profit and what the books
// hold today, in each company's own currency (never added across companies --
// rupees and dollars do not sum). Only companies whose reports the caller may see.
router.get('/overview', asyncHandler(async (req, res) => {
  const { companies } = await selectableCompanies(req);
  const { foldLines } = require('./reports');
  const { money } = require('../../utils/ledger');
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + '01';
  const rows = [];
  for (const c of companies) {
    if (!(await can(req, c.id, 'accounting.reports.view'))) continue;
    const [{ data: co }, { count: accounts }] = await Promise.all([
      supabaseAdmin.from('companies').select('currency').eq('id', c.id).maybeSingle(),
      supabaseAdmin.from('chart_of_accounts').select('id', { count: 'exact', head: true }).eq('company_id', c.id),
    ]);
    const row = { company_id: c.id, name: c.name, currency: co?.currency || 'PKR', has_books: !!accounts };
    if (accounts) {
      const [mtd, toDate] = await Promise.all([foldLines(c.id, { from: monthStart, to: today }), foldLines(c.id, { to: today })]);
      let rev = 0; let exp = 0; let cash = 0; let owed = 0; let owe = 0;
      for (const { account, cents: v } of mtd.values()) {
        if (account.account_type === 'revenue') rev += v;
        if (account.account_type === 'expense') exp += v;
      }
      for (const { account, cents: v } of toDate.values()) {
        if (account.code === '1000') cash += v;
        if (account.code === '1100') owed += v;
        if (account.account_type === 'liability') owe += v;
      }
      Object.assign(row, { revenue_mtd: money(rev), expenses_mtd: money(exp), profit_mtd: money(rev - exp), cash: money(cash), owed_to_us: money(owed), we_owe: money(owe) });
    }
    const [{ count: claims }, { count: overdue }] = await Promise.all([
      supabaseAdmin.from('expenses').select('id', { count: 'exact', head: true }).eq('company_id', c.id).eq('status', 'submitted'),
      supabaseAdmin.from('invoices').select('id', { count: 'exact', head: true }).eq('company_id', c.id).eq('status', 'overdue'),
    ]);
    row.claims_waiting = claims || 0;
    row.invoices_overdue = overdue || 0;
    rows.push(row);
  }
  res.json({ companies: rows });
}));

router.use('/history',  historyRouter('accounting'));
router.use('/settings', require('./settings'));
router.use('/revenue',  require('./revenue'));
router.use('/accounts', require('./chartOfAccounts'));
router.use('/opening-balances', require('./openingBalances'));
router.use('/journal',  require('./journal'));
router.use('/invoices', require('./invoices'));
router.use('/expenses', require('./expenses'));
router.use('/reports',  require('./reports'));

module.exports = router;

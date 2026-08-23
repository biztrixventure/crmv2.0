// ============================================================================
// /api/accounting/reports -- P&L and balance sheet, computed from
// journal_entry_lines grouped by chart_of_accounts.account_type (mig 283).
//
// Two rules decide every number here:
//
//   1. POSTED ONLY. A draft entry is somebody typing, not a fact. Voided
//      entries are excluded too -- their reversal already cancelled them, so
//      counting both would double-count the correction.
//
//   2. NORMAL BALANCE. Assets and expenses are debit-normal (debit - credit);
//      liabilities, equity and revenue are credit-normal (credit - debit).
//      Getting this backwards is the classic way a balance sheet comes out
//      exactly negative.
//
// The P&L is a PERIOD report (date_from..date_to). The balance sheet is a
// POINT-IN-TIME report (everything up to as_of) -- so it takes as_of, not a
// range, and retained earnings is the cumulative revenue-minus-expense to that
// date. Handing a balance sheet a date range is the single most common way to
// make it not balance.
//
// Everything is summed in integer cents and only converted at the edge.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../../config/database');
const { asyncHandler } = require('../../middleware/errorHandler');
const { deny, readCompanyId } = require('../../utils/moduleAccess');
const { cents, money } = require('../../utils/ledger');

const router = express.Router();

const DEBIT_NORMAL = new Set(['asset', 'expense']);

// Pull every POSTED line for a company, optionally bounded by date, and fold it
// into per-account totals. Paginated past the 1000-row PostgREST ceiling.
async function foldLines(companyId, { from = null, to = null } = {}) {
  const perAccount = new Map();   // accountId -> { account, cents }
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    let q = supabaseAdmin
      .from('journal_entry_lines')
      .select('debit, credit, account_id, chart_of_accounts!inner(id, code, name, account_type, account_subtype), journal_entries!inner(entry_date, status)')
      .eq('company_id', companyId)
      .eq('journal_entries.status', 'posted')
      .range(offset, offset + pageSize - 1);
    if (from) q = q.gte('journal_entries.entry_date', from);
    if (to)   q = q.lte('journal_entries.entry_date', to);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    for (const l of (data || [])) {
      const acct = l.chart_of_accounts;
      if (!acct) continue;
      const delta = DEBIT_NORMAL.has(acct.account_type)
        ? cents(l.debit) - cents(l.credit)
        : cents(l.credit) - cents(l.debit);
      const hit = perAccount.get(acct.id) || { account: acct, cents: 0 };
      hit.cents += delta;
      perAccount.set(acct.id, hit);
    }
    if ((data || []).length < pageSize) break;
  }
  return perAccount;
}

// Group folded totals into { type: { accounts[], total } }.
function groupByType(perAccount, types) {
  const out = {};
  for (const t of types) out[t] = { accounts: [], total: 0 };
  for (const { account, cents: c } of perAccount.values()) {
    if (!out[account.account_type]) continue;
    if (c === 0) continue;                       // an untouched account is noise
    out[account.account_type].accounts.push({
      id: account.id, code: account.code, name: account.name,
      account_subtype: account.account_subtype, amount: money(c),
    });
    out[account.account_type].total += c;
  }
  for (const t of types) {
    out[t].accounts.sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
    out[t].total = money(out[t].total);
  }
  return out;
}

// GET /api/accounting/reports/profit-loss?date_from&date_to
router.get('/profit-loss', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ revenue: null, expenses: null, net_income: 0 });
  if (await deny(req, res, companyId, 'accounting.reports.view')) return;

  const today = new Date().toISOString().slice(0, 10);
  const from = req.query.date_from || today.slice(0, 4) + '-01-01';
  const to   = req.query.date_to   || today;

  const folded = await foldLines(companyId, { from, to });
  const grouped = groupByType(folded, ['revenue', 'expense']);

  const revenue = grouped.revenue.total;
  const expenses = grouped.expense.total;
  const net = money(cents(revenue) - cents(expenses));

  res.json({
    period: { date_from: from, date_to: to },
    revenue:  { accounts: grouped.revenue.accounts, total: revenue },
    expenses: { accounts: grouped.expense.accounts, total: expenses },
    net_income: net,
    margin_pct: revenue > 0 ? Number(((net / revenue) * 100).toFixed(1)) : null,
  });
}));

// GET /api/accounting/reports/balance-sheet?as_of=YYYY-MM-DD
router.get('/balance-sheet', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ assets: null, liabilities: null, equity: null });
  if (await deny(req, res, companyId, 'accounting.reports.view')) return;

  const asOf = req.query.as_of || new Date().toISOString().slice(0, 10);
  const folded = await foldLines(companyId, { to: asOf });
  const grouped = groupByType(folded, ['asset', 'liability', 'equity', 'revenue', 'expense']);

  // Retained earnings: cumulative profit to date. It is NOT a ledger account
  // here -- closing entries are out of scope for this phase -- so it is derived
  // and shown as its own equity line. Without it the sheet cannot balance.
  const retained = money(cents(grouped.revenue.total) - cents(grouped.expense.total));

  const assets = grouped.asset.total;
  const liabilities = grouped.liability.total;
  const equityPosted = grouped.equity.total;
  const equityTotal = money(cents(equityPosted) + cents(retained));
  const difference = money(cents(assets) - cents(liabilities) - cents(equityTotal));

  res.json({
    as_of: asOf,
    assets:      { accounts: grouped.asset.accounts,     total: assets },
    liabilities: { accounts: grouped.liability.accounts, total: liabilities },
    equity: {
      accounts: [
        ...grouped.equity.accounts,
        { id: null, code: '', name: 'Retained earnings (current)', amount: retained, derived: true },
      ],
      total: equityTotal,
    },
    // Stated, not hidden. If this is ever non-zero something upstream is wrong
    // and the report should say so rather than quietly present a tidy sheet.
    balanced: difference === 0,
    difference,
  });
}));

// GET /api/accounting/reports/trial-balance?as_of=
// The raw debit/credit columns, which is what you actually reconcile against
// when the balance sheet says balanced:false.
router.get('/trial-balance', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ rows: [], total_debit: 0, total_credit: 0 });
  if (await deny(req, res, companyId, 'accounting.reports.view')) return;

  const asOf = req.query.as_of || new Date().toISOString().slice(0, 10);
  const byAccount = new Map();
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabaseAdmin
      .from('journal_entry_lines')
      .select('debit, credit, chart_of_accounts!inner(id, code, name, account_type), journal_entries!inner(entry_date, status)')
      .eq('company_id', companyId)
      .eq('journal_entries.status', 'posted')
      .lte('journal_entries.entry_date', asOf)
      .range(offset, offset + pageSize - 1);
    if (error) return res.status(500).json({ error: error.message });

    for (const l of (data || [])) {
      const a = l.chart_of_accounts;
      if (!a) continue;
      const hit = byAccount.get(a.id) || { id: a.id, code: a.code, name: a.name, account_type: a.account_type, debit: 0, credit: 0 };
      hit.debit += cents(l.debit);
      hit.credit += cents(l.credit);
      byAccount.set(a.id, hit);
    }
    if ((data || []).length < pageSize) break;
  }

  const rows = [...byAccount.values()]
    .map(r => ({ ...r, debit: money(r.debit), credit: money(r.credit) }))
    .sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
  const totalDebit  = money([...byAccount.values()].reduce((s, r) => s + r.debit, 0));
  const totalCredit = money([...byAccount.values()].reduce((s, r) => s + r.credit, 0));

  res.json({ as_of: asOf, rows, total_debit: totalDebit, total_credit: totalCredit, balanced: totalDebit === totalCredit });
}));

// GET /api/accounting/reports/summary -- the accounting dashboard in one call.
router.get('/summary', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ ready: false });
  if (await deny(req, res, companyId, 'accounting.reports.view')) return;

  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const monthStart = iso(new Date(today.getFullYear(), today.getMonth(), 1));
  const yearStart  = today.getFullYear() + '-01-01';

  const [mtd, ytd, invoiceAgg, expenseAgg, accountCount] = await Promise.all([
    foldLines(companyId, { from: monthStart, to: iso(today) }),
    foldLines(companyId, { from: yearStart,  to: iso(today) }),
    supabaseAdmin.from('invoices').select('status, total, amount_paid, balance_due').eq('company_id', companyId).neq('status', 'void'),
    supabaseAdmin.from('expenses').select('status, amount').eq('company_id', companyId),
    supabaseAdmin.from('chart_of_accounts').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
  ]);

  const pl = (folded) => {
    const g = groupByType(folded, ['revenue', 'expense']);
    return { revenue: g.revenue.total, expenses: g.expense.total, net_income: money(cents(g.revenue.total) - cents(g.expense.total)) };
  };

  const invoices = (invoiceAgg.data || []).reduce((a, r) => {
    a.count += 1;
    a.invoiced += Number(r.total || 0);
    a.collected += Number(r.amount_paid || 0);
    a.outstanding += Number(r.balance_due || 0);
    if (r.status === 'overdue') { a.overdue_count += 1; a.overdue_amount += Number(r.balance_due || 0); }
    return a;
  }, { count: 0, invoiced: 0, collected: 0, outstanding: 0, overdue_count: 0, overdue_amount: 0 });

  const expenses = (expenseAgg.data || []).reduce((a, r) => {
    a.total += Number(r.amount || 0);
    if (r.status === 'submitted') { a.pending_count += 1; a.pending_amount += Number(r.amount || 0); }
    return a;
  }, { total: 0, pending_count: 0, pending_amount: 0 });

  res.json({
    ready: (accountCount.count || 0) > 0,
    account_count: accountCount.count || 0,
    month_to_date: { ...pl(mtd), from: monthStart },
    year_to_date:  { ...pl(ytd), from: yearStart },
    invoices,
    expenses,
  });
}));

module.exports = router;

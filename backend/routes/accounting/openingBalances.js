// ============================================================================
// /api/accounting/opening-balances -- what the company already had, and
// already owed, on the day it started keeping its books here.
//
// It is ONE posted journal entry per company (source_type 'opening_balance',
// source_id = the company id, source_event 'opening'). Assets go in as debits,
// liabilities and equity as credits, and whatever does not balance lands on ONE
// equity account the accountant picks (the "balancing figure" -- 3900 Opening
// Balance Equity by default, else 3000 Owner Equity).
//
// Changing the numbers never edits the posted entry (mig 315 forbids it). The
// old entry is reversed ON ITS OWN DATE and the new one posted, in one
// transaction (fn_reverse_journal), and a reason is required -- so the journal
// and the change log show both versions and why.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../../config/database');
const { asyncHandler } = require('../../middleware/errorHandler');
const logger = require('../../utils/logger');
const { can, deny, readCompanyId, writeCompanyId } = require('../../utils/moduleAccess');
const { needReason, getContext } = require('../../utils/requestContext');
const { cents, money, createPostedEntry, reverseEntry, liveEntryFor, companyCurrency } = require('../../utils/ledger');

const router = express.Router();

const SHEET_TYPES = ['asset', 'liability', 'equity'];
const PLUG = 'Balancing figure (opening balance equity)';
const KEY = { sourceType: 'opening_balance', sourceEvent: 'opening' };

// Balance-sheet accounts only: revenue and expense start every period at nil.
async function sheetAccounts(companyId) {
  const { data, error } = await supabaseAdmin.from('chart_of_accounts')
    .select('id, code, name, account_type, is_active')
    .eq('company_id', companyId).in('account_type', SHEET_TYPES)
    .order('code', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

async function currentEntry(companyId) {
  const live = await liveEntryFor(companyId, KEY.sourceType, companyId, KEY.sourceEvent);
  if (!live) return null;
  const { data } = await supabaseAdmin.from('journal_entries')
    .select('id, entry_no, entry_date, journal_entry_lines(account_id, debit, credit, description)')
    .eq('id', live.id).single();
  return data || null;
}

// A signed amount in the account's own direction: +100 on an asset = we have
// 100; +100 on a liability = we owe 100. Negative is allowed (an overdrawn bank).
const signedCents = (type, debit, credit) => (type === 'asset'
  ? cents(debit) - cents(credit)
  : cents(credit) - cents(debit));

function defaultPlug(accounts) {
  const equity = accounts.filter(a => a.account_type === 'equity' && a.is_active !== false);
  return (equity.find(a => a.code === '3900') || equity.find(a => a.code === '3000') || equity[0] || null)?.id || null;
}

// GET /api/accounting/opening-balances
router.get('/', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ accounts: [], balances: [], entry: null });
  if (await deny(req, res, companyId, 'accounting.journal.view')) return;

  const [accounts, entry, currency] = await Promise.all([
    sheetAccounts(companyId), currentEntry(companyId), companyCurrency(companyId),
  ]);
  const byId = new Map(accounts.map(a => [a.id, a]));

  const balances = new Map();
  let plugId = null;
  let plugCents = 0;
  for (const l of entry?.journal_entry_lines || []) {
    const acct = byId.get(l.account_id);
    if (!acct) continue;
    const c = signedCents(acct.account_type, l.debit, l.credit);
    if (l.description === PLUG) { plugId = l.account_id; plugCents += c; continue; }
    balances.set(l.account_id, (balances.get(l.account_id) || 0) + c);
  }

  res.json({
    currency,
    entry: entry ? { id: entry.id, entry_no: entry.entry_no, entry_date: entry.entry_date } : null,
    accounts,
    balances: [...balances.entries()].map(([account_id, c]) => ({ account_id, amount: money(c) })),
    balancing_account_id: plugId || defaultPlug(accounts),
    balancing_amount: money(plugCents),
    can_manage: await can(req, companyId, 'accounting.journal.manage'),
  });
}));

// PUT /api/accounting/opening-balances
// { as_of: 'YYYY-MM-DD', balancing_account_id, balances: [{ account_id, amount }], change_reason? }
// A reason is required only when there are already opening balances to replace.
router.put('/', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });
  if (await deny(req, res, companyId, 'accounting.journal.manage')) return;

  const asOf = String(req.body?.as_of || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return res.status(400).json({ error: 'Pick the date these balances are as of' });

  const accounts = await sheetAccounts(companyId);
  const byId = new Map(accounts.map(a => [a.id, a]));

  const plug = byId.get(req.body?.balancing_account_id);
  if (!plug || plug.account_type !== 'equity') {
    return res.status(400).json({ error: 'Pick an equity account for the balancing figure' });
  }

  const lines = [];
  for (const row of Array.isArray(req.body?.balances) ? req.body.balances : []) {
    const c = cents(row?.amount);
    if (!c) continue;
    const acct = byId.get(row.account_id);
    if (!acct) return res.status(400).json({ error: 'One of the accounts is not a balance-sheet account of this company' });
    if (acct.id === plug.id) {
      return res.status(400).json({ error: acct.code + ' ' + acct.name + ' is the balancing account -- it fills itself in. Leave it blank or pick another balancing account.' });
    }
    // Positive on an asset = debit; positive on a liability/equity = credit.
    const debitSide = (acct.account_type === 'asset') === (c > 0);
    lines.push({
      account_id: acct.id,
      debit: debitSide ? money(Math.abs(c)) : 0,
      credit: debitSide ? 0 : money(Math.abs(c)),
      description: 'Opening balance',
    });
  }

  const diff = lines.reduce((s, l) => s + cents(l.debit) - cents(l.credit), 0);
  if (diff !== 0) {
    lines.push({
      account_id: plug.id,
      debit: diff < 0 ? money(-diff) : 0,
      credit: diff > 0 ? money(diff) : 0,
      description: PLUG,
    });
  }

  const existing = await currentEntry(companyId);
  if (!existing && lines.length === 0) return res.status(400).json({ error: 'Enter at least one balance' });

  const memo = 'Opening balances as of ' + asOf;
  if (!existing) {
    const posted = await createPostedEntry({
      companyId, userId: req.user.id, entryDate: asOf, memo,
      sourceType: KEY.sourceType, sourceId: companyId, sourceEvent: KEY.sourceEvent, lines,
    });
    if (posted.error) return res.status(422).json({ error: posted.error });
    logger.info('ACCOUNTING', 'opening balances ' + posted.entry.entry_no + ' posted in ' + companyId + ' by ' + req.user.id);
    return res.json({ entry_no: posted.entry.entry_no, reversal_no: null });
  }

  // Replacing what is there: say why (kept on the reversal and in the change log).
  if (needReason(req, res, 'changing the opening balances')) return;
  const reason = getContext()?.reason || String(req.body.change_reason).trim();
  const r = await reverseEntry({
    entryId: existing.id, reason, date: existing.entry_date, companyId,
    replacement: lines.length ? {
      entryDate: asOf, memo, sourceType: KEY.sourceType, sourceId: companyId, sourceEvent: KEY.sourceEvent, lines,
    } : null,
  });
  if (r.error) return res.status(422).json({ error: r.error });
  logger.info('ACCOUNTING', 'opening balances ' + existing.entry_no + ' replaced in ' + companyId + ' by ' + req.user.id);
  res.json({ entry_no: r.replacement?.entry_no || null, reversal_no: r.reversal?.entry_no || null });
}));

module.exports = router;

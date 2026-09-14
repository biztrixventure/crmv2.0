// ============================================================================
// utils/ledger.js -- the shared double-entry primitives.
//
// Lives outside routes/ because several modules write journal entries: the
// journal itself, invoices/expenses (accounting), payroll (HR), and the CRM
// postings of later stages. Duplicating the balance rule in each of them is
// how one of them ends up posting a crooked entry.
//
// Since mig 315 the database does the posting:
//   fn_post_journal(p)       validate + number + insert + post, ONE transaction,
//                            and never twice for the same business moment
//                            (company, source_type, source_id, source_event)
//   fn_reverse_journal(...)  mirror entry + link, optionally a corrected
//                            re-post, ONE transaction
// This file prepares what they need: which accounts (the editable money rules,
// accounting_posting_rules, falling back to the default codes below), and the
// company-currency amounts (fx_rates -- a foreign amount is converted at the
// accountant's rate, never guessed).
//
// Everything here works in integer CENTS where it adds. Summing floats and
// comparing them is exactly how a balanced entry ends up a penny out.
// ============================================================================
const { supabaseAdmin } = require('../config/database');

const cents = (v) => Math.round(Number(v || 0) * 100);
const money = (c) => Number((c / 100).toFixed(2));

// The automatic postings, the words a manager sees for each, and the account
// code each side uses until a company picks its own (Accounts -> Settings).
const POSTING_EVENTS = {
  'invoice.issued': {
    label: 'An invoice is sent',
    debit:  { code: '1100', words: 'Customer owes us' },
    credit: { code: '4000', words: 'Sales (used when an invoice line has no account of its own)' },
  },
  'invoice.tax': {
    label: 'Tax charged on an invoice',
    credit: { code: '2200', words: 'Tax we owe' },
  },
  'invoice.payment': {
    label: 'A customer pays an invoice',
    debit:  { code: '1000', words: 'Money received into' },
    credit: { code: '1100', words: 'Customer owes us' },
  },
  'expense.approved': {
    label: 'An expense claim is approved',
    debit:  { code: '5900', words: 'Expense (used when the category has no account of its own)' },
    credit: { code: '2000', words: 'We owe the person who paid' },
  },
  'expense.reimbursed': {
    label: 'An expense claim is paid back',
    debit:  { code: '2000', words: 'We owe the person who paid' },
    credit: { code: '1000', words: 'Money paid out of' },
  },
  'payroll.finalized': {
    label: 'A payroll run is finalized',
    debit:  { code: '5000', words: 'Salaries' },
    credit: { code: '2100', words: 'Salaries we owe staff' },
  },
  'payroll.deductions': {
    label: 'Deductions held back from pay',
    credit: { code: '2200', words: 'Deductions we hold (tax, loans...)' },
  },
  'payroll.paid': {
    label: 'Salaries are paid out',
    debit:  { code: '2100', words: 'Salaries we owe staff' },
    credit: { code: '1000', words: 'Money paid out of' },
  },
  // A foreign-currency invoice is booked at the rate on the day it was sent
  // and paid at the rate on the day the money arrived. The gap is real money
  // won or lost on the rate, and it gets its own line instead of leaving the
  // customer's balance a few rupees off for ever.
  'fx.difference': {
    label: 'Exchange-rate difference when a foreign invoice is paid',
    credit: { code: '4900', words: 'Exchange-rate gains and losses' },
  },
  // CRM sales (mig 317, utils/revenueSync.js). Closer company's books first:
  // the client pays us for the sale; we owe the fronter company its cut.
  'sale.earned': {
    label: 'A CRM sale is approved (the client owes us for it)',
    debit:  { code: '1100', words: 'The client owes us' },
    credit: { code: '4000', words: 'Sales revenue' },
  },
  'sale.collected': {
    label: 'The client pays for a sale (DP Status: paid)',
    debit:  { code: '1000', words: 'Money received into' },
    credit: { code: '1100', words: 'The client owes us' },
  },
  'partner.cost': {
    label: "A partner company earns its cut of a sale we closed",
    debit:  { code: '5100', words: 'Partner fees and commissions' },
    credit: { code: '2000', words: 'We owe the partner company' },
  },
  'partner.paid': {
    label: 'We pay a partner company (Paid to Partner)',
    debit:  { code: '2000', words: 'We owe the partner company' },
    credit: { code: '1000', words: 'Money paid out of' },
  },
  // ...and the fronter company's books: its fee from the closer company.
  'partner.income': {
    label: 'We earn our partner fee on a sale (fronter company)',
    debit:  { code: '1100', words: 'The closer company owes us' },
    credit: { code: '4100', words: 'Partner-fee revenue' },
  },
  'partner.received': {
    label: 'The closer company pays our partner fee',
    debit:  { code: '1000', words: 'Money received into' },
    credit: { code: '1100', words: 'The closer company owes us' },
  },
};

// -- Numbers --------------------------------------------------------------------
// Drafts still need a number before they are posted. Serialised in SQL
// (fn_next_entry_no takes a per-company advisory lock) -- the old "read the
// newest row and add one" collided under concurrency.
async function nextEntryNo(companyId) {
  const { data, error } = await supabaseAdmin.rpc('fn_next_entry_no', { p_company: companyId });
  if (error) throw new Error(error.message);
  return data;
}

// null when balanced, otherwise a caller-facing message naming the gap.
function balanceError(lines) {
  const debit  = (lines || []).reduce((s, l) => s + cents(l.debit), 0);
  const credit = (lines || []).reduce((s, l) => s + cents(l.credit), 0);
  if (!lines || lines.length === 0) return 'Entry has no lines';
  if (debit !== credit) {
    return 'Entry is out of balance: money in ' + money(debit) + ', money out ' + money(credit)
         + ' (difference ' + money(Math.abs(debit - credit)) + ')';
  }
  if (debit === 0) return 'Entry totals zero -- nothing to post';
  return null;
}

// Validate a lines payload against one company chart of accounts.
// Returns { lines } or { error }.
async function prepareLines(rawLines, companyId) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    return { error: 'At least one line is required' };
  }
  if (rawLines.some(l => !l || !l.account_id)) {
    return { error: 'Every line needs an account' };
  }
  const accountIds = [...new Set(rawLines.map(l => l.account_id))];
  const { data: accounts } = await supabaseAdmin
    .from('chart_of_accounts').select('id')
    .eq('company_id', companyId).in('id', accountIds);
  const valid = new Set((accounts || []).map(a => a.id));
  for (const id of accountIds) {
    if (!valid.has(id)) return { error: 'Account ' + id + ' does not belong to this company' };
  }

  const lines = [];
  for (let i = 0; i < rawLines.length; i++) {
    const l = rawLines[i];
    const d = cents(l.debit);
    const c = cents(l.credit);
    if (d < 0 || c < 0)     return { error: 'Line ' + (i + 1) + ': amounts cannot be negative' };
    if (d > 0 && c > 0)     return { error: 'Line ' + (i + 1) + ': a line is either money in (debit) or money out (credit), not both' };
    if (d === 0 && c === 0) return { error: 'Line ' + (i + 1) + ': needs an amount' };
    lines.push({
      company_id: companyId,
      account_id: l.account_id,
      debit: money(d),
      credit: money(c),
      description: l.description || null,
      line_no: l.line_no ?? i + 1,
      orig_currency: l.orig_currency || null,
      orig_amount: l.orig_amount ?? null,
      fx_rate: l.fx_rate ?? null,
    });
  }
  return { lines };
}

// -- Accounts and rules ------------------------------------------------------------
async function accountByCode(companyId, code) {
  const { data } = await supabaseAdmin
    .from('chart_of_accounts').select('id, code, name, account_type')
    .eq('company_id', companyId).eq('code', code).maybeSingle();
  return data || null;
}

// The accounts each event posts to in this company. A rule row wins; with no
// row (or an empty side) the default code is used. { [event]: { debit, credit,
// enabled, customised } } where debit/credit are account rows or null.
async function postingRules(companyId, eventKeys = Object.keys(POSTING_EVENTS)) {
  const [{ data: rows }, { data: accounts }] = await Promise.all([
    supabaseAdmin.from('accounting_posting_rules').select('*').eq('company_id', companyId).in('event_key', eventKeys),
    supabaseAdmin.from('chart_of_accounts').select('id, code, name, account_type, is_active').eq('company_id', companyId),
  ]);
  const byId = Object.fromEntries((accounts || []).map(a => [a.id, a]));
  const byCode = Object.fromEntries((accounts || []).map(a => [a.code, a]));
  const out = {};
  for (const key of eventKeys) {
    const spec = POSTING_EVENTS[key];
    if (!spec) continue;
    const row = (rows || []).find(r => r.event_key === key);
    out[key] = {
      debit:  spec.debit  ? (byId[row?.debit_account_id]  || byCode[spec.debit.code]  || null) : null,
      credit: spec.credit ? (byId[row?.credit_account_id] || byCode[spec.credit.code] || null) : null,
      enabled: row ? row.is_enabled !== false : true,
      customised: !!row,
    };
  }
  return out;
}

async function postingRule(companyId, eventKey) {
  return (await postingRules(companyId, [eventKey]))[eventKey] || { debit: null, credit: null, enabled: true };
}

// -- Currency ------------------------------------------------------------------------
async function companyCurrency(companyId) {
  const { data } = await supabaseAdmin.from('companies').select('currency').eq('id', companyId).maybeSingle();
  return data?.currency || 'PKR';
}

// The rate in force on a date: company-currency units per 1 unit of `currency`.
async function fxRate(companyId, currency, onDate) {
  const { data } = await supabaseAdmin
    .from('fx_rates').select('rate, effective_from')
    .eq('company_id', companyId).eq('currency', currency)
    .lte('effective_from', onDate || new Date().toISOString().slice(0, 10))
    .order('effective_from', { ascending: false }).limit(1);
  return data?.[0] ? { rate: Number(data[0].rate), effective_from: data[0].effective_from } : null;
}

// Convert a set of lines typed in `currency` into the company currency, keeping
// the original amount on every line and keeping the entry BALANCED -- rounding
// each line separately can leave a paisa over, which is added to the largest
// line on the short side. Returns { lines, rate, bookCurrency } or { error }.
async function toBookLines(companyId, currency, lines, onDate) {
  const book = await companyCurrency(companyId);
  if (!currency || currency === book) return { lines, rate: null, bookCurrency: book };
  const fx = await fxRate(companyId, currency, onDate);
  if (!fx) return { error: noRateMessage(currency, book, onDate) };
  return { lines: convertLines(lines, currency, fx.rate), rate: fx.rate, bookCurrency: book };
}

const noRateMessage = (currency, book, onDate) => 'There is no ' + currency + ' to ' + book
  + ' exchange rate on or before ' + (onDate || 'today') + '. Add one in Accounts -> Settings -> Exchange rates, then try again.';

// The one conversion rule, shared by toBookLines and fxConverter.
function convertLines(lines, currency, rate) {
  const converted = lines.map(l => {
    const d = cents(l.debit), c = cents(l.credit);
    return {
      ...l,
      debit:  d ? money(Math.round(d * rate)) : 0,
      credit: c ? money(Math.round(c * rate)) : 0,
      orig_currency: currency,
      orig_amount: money(d || c),
      fx_rate: rate,
    };
  });
  const dr = converted.reduce((s, l) => s + cents(l.debit), 0);
  const cr = converted.reduce((s, l) => s + cents(l.credit), 0);
  if (dr !== cr) {
    const side = dr < cr ? 'debit' : 'credit';
    const target = converted.filter(l => cents(l[side]) > 0).sort((a, b) => cents(b[side]) - cents(a[side]))[0];
    if (target) target[side] = money(cents(target[side]) + Math.abs(dr - cr));
  }
  return converted;
}

// For batch posting (utils/revenueSync.js): load a company's rates for one
// currency ONCE, then convert synchronously. Same rule as toBookLines -- the
// rate in force on the day, never a guess.
async function fxConverter(companyId, currency) {
  const book = await companyCurrency(companyId);
  if (!currency || currency === book) return { book, convert: (lines) => ({ lines }) };
  const { data } = await supabaseAdmin.from('fx_rates').select('rate, effective_from')
    .eq('company_id', companyId).eq('currency', currency).order('effective_from', { ascending: false });
  const rates = (data || []).map(r => ({ rate: Number(r.rate), from: r.effective_from }));
  return {
    book,
    convert: (lines, onDate) => {
      const day = onDate || new Date().toISOString().slice(0, 10);
      const fx = rates.find(r => r.from <= day);
      if (!fx) return { error: noRateMessage(currency, book, day), missing_rate: day };
      return { lines: convertLines(lines, currency, fx.rate), rate: fx.rate };
    },
  };
}

// -- Posting -----------------------------------------------------------------------
// Create AND post one balanced entry. Returns { entry, existing } or { error };
// never throws, and never leaves a half-written entry (the RPC is one
// transaction). `existing: true` = this business moment was already posted.
async function createPostedEntry({ companyId, userId, entryDate, memo, sourceType, sourceId, sourceEvent, lines }) {
  const prepared = await prepareLines(lines, companyId);
  if (prepared.error) return { error: prepared.error };
  const bad = balanceError(prepared.lines);
  if (bad) return { error: bad };

  const { data, error } = await supabaseAdmin.rpc('fn_post_journal', {
    p: {
      company_id: companyId,
      entry_date: entryDate || new Date().toISOString().slice(0, 10),
      memo: memo || null,
      source_type: sourceType || 'manual',
      source_id: sourceId || null,
      source_event: sourceEvent || null,
      actor: userId || null,
      lines: prepared.lines.map(l => ({
        account_id: l.account_id, debit: l.debit, credit: l.credit, description: l.description,
        orig_currency: l.orig_currency, orig_amount: l.orig_amount, fx_rate: l.fx_rate,
      })),
    },
  });
  if (error) return { error: error.message };
  return { entry: { id: data.id, entry_no: data.entry_no, status: 'posted' }, existing: !!data.existing };
}

// Reverse a posted entry (and optionally post its correction) in one go.
// replacement = the same shape createPostedEntry takes, minus companyId.
async function reverseEntry({ entryId, reason, date, replacement, companyId }) {
  let repl = null;
  if (replacement) {
    const prepared = await prepareLines(replacement.lines, companyId);
    if (prepared.error) return { error: prepared.error };
    const bad = balanceError(prepared.lines);
    if (bad) return { error: bad };
    repl = {
      entry_date: replacement.entryDate || new Date().toISOString().slice(0, 10),
      memo: replacement.memo || null,
      source_type: replacement.sourceType || 'manual',
      source_id: replacement.sourceId || null,
      source_event: replacement.sourceEvent || null,
      lines: prepared.lines.map(l => ({
        account_id: l.account_id, debit: l.debit, credit: l.credit, description: l.description,
        orig_currency: l.orig_currency, orig_amount: l.orig_amount, fx_rate: l.fx_rate,
      })),
    };
  }
  const { data, error } = await supabaseAdmin.rpc('fn_reverse_journal', {
    p_entry: entryId, p_reason: reason || null, p_date: date || null, p_replacement: repl,
  });
  if (error) return { error: error.message };
  return {
    reversal: data.reversal_id ? { id: data.reversal_id, entry_no: data.reversal_no || null } : null,
    replacement: data.replacement ? { id: data.replacement.id, entry_no: data.replacement.entry_no } : null,
    existing: !!data.existing,
  };
}

// The live (posted, not reversed) entry for one business moment, if any.
async function liveEntryFor(companyId, sourceType, sourceId, sourceEvent) {
  let q = supabaseAdmin.from('journal_entries').select('id, entry_no')
    .eq('company_id', companyId).eq('source_type', sourceType).eq('source_id', sourceId)
    .eq('status', 'posted').is('reversal_of', null).is('reversed_by', null);
  q = sourceEvent ? q.eq('source_event', sourceEvent) : q.is('source_event', null);
  const { data } = await q.limit(1);
  return data?.[0] || null;
}

module.exports = {
  cents, money, nextEntryNo, balanceError, prepareLines, createPostedEntry, reverseEntry,
  accountByCode, postingRules, postingRule, POSTING_EVENTS, companyCurrency, fxRate, toBookLines,
  fxConverter, liveEntryFor,
};

// ============================================================================
// utils/ledger.js -- the shared double-entry primitives.
//
// Lives outside routes/ because three different modules need to write journal
// entries: the journal itself, invoices/expenses (accounting), and payroll (HR).
// Duplicating the balance rule in each of them is how one of them ends up
// posting a crooked entry.
//
// Everything here works in integer CENTS. Summing floats and comparing them is
// exactly how a balanced entry ends up a penny out.
// ============================================================================
const { supabaseAdmin } = require('../config/database');

const cents = (v) => Math.round(Number(v || 0) * 100);
const money = (c) => Number((c / 100).toFixed(2));

// Next entry number for a company: JE-000001, JE-000002, ...
// Read-then-write, so a genuine race can collide; UNIQUE(company_id, entry_no)
// catches it and the caller retries. Cheaper and clearer than a sequence per
// company.
async function nextEntryNo(companyId) {
  const { data } = await supabaseAdmin
    .from('journal_entries').select('entry_no')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false }).limit(1);
  const last = data?.[0]?.entry_no || '';
  const n = /^JE-(\d+)$/.exec(last);
  return 'JE-' + String(n ? Number(n[1]) + 1 : 1).padStart(6, '0');
}

// null when balanced, otherwise a caller-facing message naming the gap.
function balanceError(lines) {
  const debit  = (lines || []).reduce((s, l) => s + cents(l.debit), 0);
  const credit = (lines || []).reduce((s, l) => s + cents(l.credit), 0);
  if (!lines || lines.length === 0) return 'Entry has no lines';
  if (debit !== credit) {
    return 'Entry is out of balance: debits ' + money(debit) + ', credits ' + money(credit)
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
    return { error: 'Every line needs an account_id' };
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
    if (d > 0 && c > 0)     return { error: 'Line ' + (i + 1) + ': a line is either a debit or a credit, not both' };
    if (d === 0 && c === 0) return { error: 'Line ' + (i + 1) + ': needs a debit or a credit amount' };
    lines.push({
      company_id: companyId,
      account_id: l.account_id,
      debit: money(d),
      credit: money(c),
      description: l.description || null,
      line_no: l.line_no ?? i + 1,
    });
  }
  return { lines };
}

// Create AND post one balanced entry in a single call. Used by payroll, invoice
// and expense posting. Returns { entry } or { error } -- it never throws, and it
// never leaves a headless entry behind.
async function createPostedEntry({ companyId, userId, entryDate, memo, sourceType, sourceId, lines }) {
  const prepared = await prepareLines(lines, companyId);
  if (prepared.error) return { error: prepared.error };
  const bad = balanceError(prepared.lines);
  if (bad) return { error: bad };

  const { data: entry, error } = await supabaseAdmin.from('journal_entries').insert({
    company_id:  companyId,
    entry_no:    await nextEntryNo(companyId),
    entry_date:  entryDate || new Date().toISOString().slice(0, 10),
    memo:        memo || null,
    status:      'draft',
    source_type: sourceType || 'manual',
    source_id:   sourceId || null,
    created_by:  userId || null,
  }).select().single();
  if (error) return { error: error.message };

  const { error: lineErr } = await supabaseAdmin
    .from('journal_entry_lines')
    .insert(prepared.lines.map(l => ({ ...l, entry_id: entry.id })));
  if (lineErr) {
    await supabaseAdmin.from('journal_entries').delete().eq('id', entry.id);
    return { error: lineErr.message };
  }

  const { error: postErr } = await supabaseAdmin.from('journal_entries')
    .update({ status: 'posted', posted_at: new Date().toISOString(), posted_by: userId || null })
    .eq('id', entry.id);
  if (postErr) return { error: postErr.message };

  return { entry: { ...entry, status: 'posted' } };
}

// Find one account by code in a company. Returns null rather than throwing --
// callers decide whether a missing account is fatal or just means "skip the
// journal side of this action".
async function accountByCode(companyId, code) {
  const { data } = await supabaseAdmin
    .from('chart_of_accounts').select('id, code, name, account_type')
    .eq('company_id', companyId).eq('code', code).maybeSingle();
  return data || null;
}

module.exports = { cents, money, nextEntryNo, balanceError, prepareLines, createPostedEntry, accountByCode };

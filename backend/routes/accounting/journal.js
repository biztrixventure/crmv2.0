// ============================================================================
// /api/accounting/journal -- journal entries and their lines (mig 283, 315).
//
// The one rule this file exists to enforce: an entry cannot be POSTED unless
// its money in (debits) equals its money out (credits), to the cent, over at
// least one line. Checked here (a 422 that names the gap), again in
// fn_post_journal, and again by the mig 283 trigger.
//
// Posted entries are IMMUTABLE (mig 315 enforces it in the database too).
// Changing one means:
//   Reverse  -> a mirror-image entry is posted, pointing back at the original.
//               Both stay posted and net to zero, so every report stays right
//               for every period and the history still reads cleanly.
//   Correct  -> reverse + post the corrected version, in one transaction --
//               the "edit" button a manager expects, without editing history.
// 'void' now applies to DRAFTS only (typing that never became a fact).
//
// Entries that belong to a document -- an invoice, a payment, an expense, a
// payroll run -- are changed from THAT screen, never from here: reversing an
// invoice's entry here would leave the invoice saying "sent" with nothing
// owed in the books. Only manual entries (and adjustments) are reversed or
// corrected directly; opening balances have their own screen.
//
// Money is handled as integer cents; the primitives live in utils/ledger.js.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../../config/database');
const { asyncHandler } = require('../../middleware/errorHandler');
const logger = require('../../utils/logger');
const { deny, readCompanyId, writeCompanyId } = require('../../utils/moduleAccess');
const { cents, money, nextEntryNo, balanceError, prepareLines, createPostedEntry, reverseEntry } = require('../../utils/ledger');
const { setChangeReason } = require('../../utils/requestContext');

const router = express.Router();

const withLines = 'id, company_id, entry_no, entry_date, memo, status, source_type, source_id, source_event, '
  + 'reversal_of, reversed_by, reversed_at, reversal_reason, '
  + 'posted_at, posted_by, voided_at, voided_by, void_reason, created_by, created_at, updated_at, '
  + 'journal_entry_lines(id, account_id, debit, credit, description, line_no, orig_currency, orig_amount, fx_rate)';

// Entries a person may reverse / correct from the journal itself. Opening
// balances are NOT here: Books -> Opening balances owns that entry, and a
// correction from the journal would re-key it as an 'adjustment' the opening
// balances screen can no longer find.
const DIRECTLY_EDITABLE = new Set(['manual', 'adjustment']);

const SOURCE_WORDS = {
  invoice: 'an invoice', payment: 'an invoice payment', expense: 'an expense claim',
  payroll: 'a payroll run', sale: 'a CRM sale', partner_fee: 'a partner fee', commission: 'a commission',
  opening_balance: 'the opening balances (Books -> Opening balances)',
};

// Draft insert with a serialised number. The number is taken in one
// transaction and used in the next, so a genuine race can still collide on
// UNIQUE(company_id, entry_no) -- retry once with a fresh number.
async function insertDraft(companyId, userId, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabaseAdmin.from('journal_entries').insert({
      company_id:  companyId,
      entry_no:    await nextEntryNo(companyId),
      entry_date:  body.entry_date || new Date().toISOString().slice(0, 10),
      memo:        body.memo || null,
      status:      'draft',
      source_type: 'manual',
      created_by:  userId,
    }).select().single();
    if (!error) return { entry: data };
    if (error.code !== '23505' || attempt === 1) return { error: error.message };
  }
  return { error: 'Could not number the entry' };
}

// GET /api/accounting/journal
router.get('/', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ entries: [], total: 0 });
  if (await deny(req, res, companyId, 'accounting.journal.view')) return;

  const page  = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const from  = (page - 1) * limit;

  let q = supabaseAdmin
    .from('journal_entries')
    .select(withLines, { count: 'exact' })
    .eq('company_id', companyId)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);

  if (req.query.status)      q = q.eq('status', req.query.status);
  if (req.query.source_type) q = q.eq('source_type', req.query.source_type);
  if (req.query.date_from)   q = q.gte('entry_date', req.query.date_from);
  if (req.query.date_to)     q = q.lte('entry_date', req.query.date_to);
  if (req.query.search) {
    // PostgREST filter syntax treats , ( ) as structure -- strip them rather
    // than let a search box rewrite the query.
    const s = String(req.query.search).replace(/[,()*]/g, ' ').trim();
    if (s) q = q.or('entry_no.ilike.%' + s + '%,memo.ilike.%' + s + '%');
  }

  const { data, error, count } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Name each reversal link, so the list can say "Reversed by JE-000014".
  const linkIds = [...new Set((data || []).flatMap(e => [e.reversal_of, e.reversed_by]).filter(Boolean))];
  let numbers = {};
  if (linkIds.length) {
    const { data: linked } = await supabaseAdmin.from('journal_entries').select('id, entry_no').in('id', linkIds);
    numbers = Object.fromEntries((linked || []).map(r => [r.id, r.entry_no]));
  }
  res.json({
    entries: (data || []).map(e => ({
      ...e,
      reversal_of_no: e.reversal_of ? numbers[e.reversal_of] || null : null,
      reversed_by_no: e.reversed_by ? numbers[e.reversed_by] || null : null,
      editable_here: DIRECTLY_EDITABLE.has(e.source_type),
    })),
    total: count || 0, page, limit,
  });
}));

// GET /api/accounting/journal/ledger?account_id=... -- running balance for one
// account, POSTED entries only. Drafts are not ledger facts; a reversed entry
// and its reversal both appear, and cancel.
router.get('/ledger', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ lines: [], opening_balance: 0, closing_balance: 0 });
  if (await deny(req, res, companyId, 'accounting.journal.view')) return;

  const accountId = req.query.account_id;
  if (!accountId) return res.status(400).json({ error: 'account_id is required' });

  const { data: account } = await supabaseAdmin
    .from('chart_of_accounts').select('id, code, name, account_type')
    .eq('id', accountId).eq('company_id', companyId).maybeSingle();
  if (!account) return res.status(404).json({ error: 'Account not found' });

  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabaseAdmin
      .from('journal_entry_lines')
      .select('id, debit, credit, description, journal_entries!inner(id, entry_no, entry_date, memo, status, source_type, reversal_of, reversed_by)')
      .eq('company_id', companyId)
      .eq('account_id', accountId)
      .eq('journal_entries.status', 'posted')
      .order('entry_date', { ascending: true, referencedTable: 'journal_entries' })
      .range(offset, offset + 999);
    if (error) return res.status(500).json({ error: error.message });
    rows.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  rows.sort((a, b) => String(a.journal_entries.entry_date).localeCompare(String(b.journal_entries.entry_date)));

  // Debit-normal for assets and expenses; credit-normal for the rest.
  const debitNormal = ['asset', 'expense'].includes(account.account_type);
  const from = req.query.date_from || null;
  const to   = req.query.date_to   || null;

  let opening = 0, running = 0;
  const lines = [];
  for (const l of rows) {
    const je = l.journal_entries;
    const delta = debitNormal ? cents(l.debit) - cents(l.credit) : cents(l.credit) - cents(l.debit);
    if (from && je.entry_date < from) { opening += delta; continue; }
    if (to && je.entry_date > to) continue;
    running += delta;
    lines.push({
      id: l.id, entry_id: je.id, entry_no: je.entry_no, entry_date: je.entry_date,
      memo: je.memo, source_type: je.source_type,
      is_reversal: !!je.reversal_of, is_reversed: !!je.reversed_by,
      description: l.description, debit: l.debit, credit: l.credit,
      balance: money(opening + running),
    });
  }
  res.json({ account, opening_balance: money(opening), closing_balance: money(opening + running), lines });
}));

// GET /api/accounting/journal/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.journal.view')) return;

  const { data, error } = await supabaseAdmin
    .from('journal_entries').select(withLines)
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Journal entry not found' });
  res.json({ entry: { ...data, editable_here: DIRECTLY_EDITABLE.has(data.source_type) } });
}));

// POST /api/accounting/journal
// body: { entry_date, memo, post: bool, lines: [{ account_id, debit, credit, description }] }
// post:true posts in one transaction (fn_post_journal); otherwise a draft.
router.post('/', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });
  if (await deny(req, res, companyId, 'accounting.journal.manage')) return;

  const prepared = await prepareLines(req.body?.lines, companyId);
  if (prepared.error) return res.status(400).json({ error: prepared.error });

  const shouldPost = req.body?.post === true || req.body?.status === 'posted';
  if (shouldPost) {
    const bad = balanceError(prepared.lines);
    if (bad) return res.status(422).json({ error: bad });
    const posted = await createPostedEntry({
      companyId, userId: req.user.id,
      entryDate: req.body?.entry_date, memo: req.body?.memo,
      sourceType: 'manual', lines: prepared.lines,
    });
    if (posted.error) return res.status(422).json({ error: posted.error });
    const { data: full } = await supabaseAdmin.from('journal_entries').select(withLines).eq('id', posted.entry.id).single();
    logger.info('ACCOUNTING', 'journal ' + posted.entry.entry_no + ' posted by ' + req.user.id);
    return res.status(201).json({ entry: full });
  }

  const draft = await insertDraft(companyId, req.user.id, req.body || {});
  if (draft.error) return res.status(500).json({ error: draft.error });

  const { error: lineErr } = await supabaseAdmin
    .from('journal_entry_lines')
    .insert(prepared.lines.map(l => ({ ...l, entry_id: draft.entry.id })));
  if (lineErr) {
    await supabaseAdmin.from('journal_entries').delete().eq('id', draft.entry.id);   // a draft -- deletable
    return res.status(500).json({ error: lineErr.message });
  }

  const { data: full } = await supabaseAdmin.from('journal_entries').select(withLines).eq('id', draft.entry.id).single();
  res.status(201).json({ entry: full });
}));

// PUT /api/accounting/journal/:id -- drafts only. Replaces the whole line set
// when `lines` is supplied, because a partial line edit against a double-entry
// document is how you end up half-balanced.
router.put('/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.journal.manage')) return;

  const { data: existing } = await supabaseAdmin
    .from('journal_entries').select('id, status, entry_no')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Journal entry not found' });
  if (existing.status !== 'draft') {
    return res.status(409).json({ error: 'Entry ' + existing.entry_no + ' is ' + existing.status + ' and can no longer be edited. Use Correct instead.' });
  }

  if (Array.isArray(req.body?.lines)) {
    const prepared = await prepareLines(req.body.lines, companyId);
    if (prepared.error) return res.status(400).json({ error: prepared.error });
    await supabaseAdmin.from('journal_entry_lines').delete().eq('entry_id', existing.id);
    const { error: lineErr } = await supabaseAdmin
      .from('journal_entry_lines')
      .insert(prepared.lines.map(l => ({ ...l, entry_id: existing.id })));
    if (lineErr) return res.status(500).json({ error: lineErr.message });
  }

  const patch = { updated_at: new Date().toISOString() };
  for (const f of ['entry_date', 'memo']) if (req.body?.[f] !== undefined) patch[f] = req.body[f];
  const { error } = await supabaseAdmin.from('journal_entries').update(patch).eq('id', existing.id);
  if (error) return res.status(500).json({ error: error.message });

  const { data: full } = await supabaseAdmin.from('journal_entries').select(withLines).eq('id', existing.id).single();
  res.json({ entry: full });
}));

// POST /api/accounting/journal/:id/post -- a draft becomes a fact.
router.post('/:id/post', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.journal.manage')) return;

  const { data: entry } = await supabaseAdmin
    .from('journal_entries')
    .select('id, entry_no, status, journal_entry_lines(debit, credit)')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!entry) return res.status(404).json({ error: 'Journal entry not found' });
  if (entry.status === 'posted') return res.status(409).json({ error: 'Entry is already posted' });
  if (entry.status === 'void')   return res.status(409).json({ error: 'A voided draft cannot be posted' });

  const bad = balanceError(entry.journal_entry_lines || []);
  if (bad) return res.status(422).json({ error: bad });

  const { data, error } = await supabaseAdmin.from('journal_entries')
    .update({ status: 'posted', posted_at: new Date().toISOString(), posted_by: req.user.id, updated_at: new Date().toISOString() })
    .eq('id', entry.id).select().single();
  if (error) return res.status(422).json({ error: error.message });

  logger.info('ACCOUNTING', 'journal ' + entry.entry_no + ' posted by ' + req.user.id);
  res.json({ entry: data });
}));

// Shared guard for reverse / correct.
async function loadForChange(req, res, companyId) {
  const { data: entry } = await supabaseAdmin
    .from('journal_entries').select('id, entry_no, status, source_type, source_id, reversal_of, reversed_by')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!entry) { res.status(404).json({ error: 'Journal entry not found' }); return null; }
  if (entry.status !== 'posted') { res.status(409).json({ error: 'Only a posted entry can be reversed or corrected' }); return null; }
  if (entry.reversal_of) { res.status(409).json({ error: entry.entry_no + ' is itself a reversal. Post a new entry instead.' }); return null; }
  if (entry.reversed_by) { res.status(409).json({ error: entry.entry_no + ' is already reversed.' }); return null; }
  if (!DIRECTLY_EDITABLE.has(entry.source_type)) {
    res.status(409).json({
      error: entry.entry_no + ' was written by ' + (SOURCE_WORDS[entry.source_type] || entry.source_type)
        + '. Change it from that screen, so the document and the books stay in step.',
    });
    return null;
  }
  return entry;
}

// POST /api/accounting/journal/:id/reverse { reason, date? }
router.post('/:id/reverse', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.journal.manage')) return;
  const reason = (req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'Say why this entry is being reversed' });
  setChangeReason(reason);

  const entry = await loadForChange(req, res, companyId);
  if (!entry) return;
  const r = await reverseEntry({ entryId: entry.id, reason, date: req.body?.date || null, companyId });
  if (r.error) return res.status(422).json({ error: r.error });
  logger.info('ACCOUNTING', 'journal ' + entry.entry_no + ' reversed by ' + req.user.id);
  res.json({ reversal_entry_no: r.reversal?.entry_no || null });
}));

// POST /api/accounting/journal/:id/correct { reason, entry_date, memo, lines }
// Reverse + post the corrected version, one transaction.
router.post('/:id/correct', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.journal.manage')) return;
  const reason = (req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'Say what was wrong with the original' });
  setChangeReason(reason);

  const entry = await loadForChange(req, res, companyId);
  if (!entry) return;
  const r = await reverseEntry({
    entryId: entry.id, reason, companyId,
    replacement: {
      entryDate: req.body?.entry_date, memo: req.body?.memo || ('Correction of ' + entry.entry_no),
      sourceType: entry.source_type === 'manual' ? 'manual' : 'adjustment',
      lines: req.body?.lines,
    },
  });
  if (r.error) return res.status(422).json({ error: r.error });
  logger.info('ACCOUNTING', 'journal ' + entry.entry_no + ' corrected by ' + req.user.id);
  res.json({ reversal_entry_no: r.reversal?.entry_no || null, corrected_entry_no: r.replacement?.entry_no || null });
}));

// POST /api/accounting/journal/:id/void { reason }
// Drafts: marked void. Posted (manual) entries: reversed, which is what "void"
// always meant for a posted entry -- the old version marked the original void
// AND posted a mirror, so reports showed minus the original.
router.post('/:id/void', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.journal.manage')) return;

  const reason = (req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'A reason is required' });
  setChangeReason(reason);

  const { data: entry } = await supabaseAdmin
    .from('journal_entries').select('id, entry_no, status')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!entry) return res.status(404).json({ error: 'Journal entry not found' });
  if (entry.status === 'void') return res.status(409).json({ error: 'Entry is already void' });

  if (entry.status === 'posted') {
    const target = await loadForChange(req, res, companyId);
    if (!target) return;
    const r = await reverseEntry({ entryId: entry.id, reason, companyId });
    if (r.error) return res.status(422).json({ error: r.error });
    return res.json({ reversal_entry_no: r.reversal?.entry_no || null });
  }

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('journal_entries')
    .update({ status: 'void', voided_at: now, voided_by: req.user.id, void_reason: reason, updated_at: now })
    .eq('id', entry.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ entry: data, reversal_entry_no: null });
}));

// DELETE /api/accounting/journal/:id -- drafts only. Posted history is
// reversed, never removed (the database refuses too, mig 315).
router.delete('/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.journal.manage')) return;

  const { data: existing } = await supabaseAdmin
    .from('journal_entries').select('id, status, entry_no')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Journal entry not found' });
  if (existing.status !== 'draft') {
    return res.status(409).json({ error: 'Only draft entries can be deleted. Reverse ' + existing.entry_no + ' instead.' });
  }
  const { error } = await supabaseAdmin.from('journal_entries').delete().eq('id', existing.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

module.exports = router;

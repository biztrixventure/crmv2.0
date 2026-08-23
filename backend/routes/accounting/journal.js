// ============================================================================
// /api/accounting/journal -- journal entries and their lines (mig 283).
//
// The one rule this file exists to enforce: an entry cannot be POSTED unless
// its debits equal its credits, to the cent, over at least one line. The check
// runs here, before the write, so the caller gets a 422 that names the gap
// instead of a Postgres exception -- and mig 283 repeats it as a trigger so no
// other writer can get around it.
//
// Posted entries are IMMUTABLE. Correcting one means voiding it, which writes a
// mirror-image reversing entry rather than deleting history (the ledger has to
// still add up after the fix). That mirrors how policy_events (mig 087) treats
// the sale timeline.
//
// Money is handled as integer cents (round(x * 100)) and written back as a
// 2-decimal number -- summing floats and comparing them is exactly how a
// balanced entry ends up a penny out. Those primitives live in utils/ledger.js,
// shared with the invoice, expense and payroll posting paths.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../../config/database');
const { asyncHandler } = require('../../middleware/errorHandler');
const logger = require('../../utils/logger');
const { deny, readCompanyId, writeCompanyId } = require('../../utils/moduleAccess');
const { cents, money, nextEntryNo, balanceError, prepareLines } = require('../../utils/ledger');

const router = express.Router();

const withLines = 'id, company_id, entry_no, entry_date, memo, status, source_type, source_id, '
  + 'posted_at, posted_by, voided_at, voided_by, void_reason, created_by, created_at, updated_at, '
  + 'journal_entry_lines(id, account_id, debit, credit, description, line_no)';

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
  if (req.query.search)      q = q.or('entry_no.ilike.%' + req.query.search + '%,memo.ilike.%' + req.query.search + '%');

  const { data, error, count } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ entries: data || [], total: count || 0, page, limit });
}));

// GET /api/accounting/journal/ledger?account_id=... -- running balance for one
// account, POSTED entries only. Drafts are not ledger facts.
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

  const { data, error } = await supabaseAdmin
    .from('journal_entry_lines')
    .select('id, debit, credit, description, journal_entries!inner(id, entry_no, entry_date, memo, status, source_type)')
    .eq('company_id', companyId)
    .eq('account_id', accountId)
    .eq('journal_entries.status', 'posted')
    .order('entry_date', { ascending: true, referencedTable: 'journal_entries' });
  if (error) return res.status(500).json({ error: error.message });

  // Debit-normal for assets and expenses; credit-normal for the rest.
  const debitNormal = ['asset', 'expense'].includes(account.account_type);
  const from = req.query.date_from || null;
  const to   = req.query.date_to   || null;

  let opening = 0, running = 0;
  const lines = [];
  for (const l of (data || [])) {
    const je = l.journal_entries;
    const delta = debitNormal ? cents(l.debit) - cents(l.credit) : cents(l.credit) - cents(l.debit);
    if (from && je.entry_date < from) { opening += delta; continue; }
    if (to && je.entry_date > to) continue;
    running += delta;
    lines.push({
      id: l.id, entry_id: je.id, entry_no: je.entry_no, entry_date: je.entry_date,
      memo: je.memo, source_type: je.source_type,
      description: l.description, debit: l.debit, credit: l.credit,
      balance: money(opening + running),
    });
  }
  res.json({
    account,
    opening_balance: money(opening),
    closing_balance: money(opening + running),
    lines,
  });
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
  res.json({ entry: data });
}));

// POST /api/accounting/journal
// body: { entry_date, memo, post: bool, lines: [{ account_id, debit, credit, description }] }
// post:true balances first and refuses with 422 if it does not add up.
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
  }

  const { data: entry, error } = await supabaseAdmin.from('journal_entries').insert({
    company_id:  companyId,
    entry_no:    req.body?.entry_no || await nextEntryNo(companyId),
    entry_date:  req.body?.entry_date || new Date().toISOString().slice(0, 10),
    memo:        req.body?.memo || null,
    status:      'draft',
    source_type: req.body?.source_type || 'manual',
    source_id:   req.body?.source_id || null,
    created_by:  req.user.id,
  }).select().single();

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That entry number is already used' });
    return res.status(500).json({ error: error.message });
  }

  const { error: lineErr } = await supabaseAdmin
    .from('journal_entry_lines')
    .insert(prepared.lines.map(l => ({ ...l, entry_id: entry.id })));
  if (lineErr) {
    // Never leave a headless entry behind.
    await supabaseAdmin.from('journal_entries').delete().eq('id', entry.id);
    return res.status(500).json({ error: lineErr.message });
  }

  if (shouldPost) {
    const { error: postErr } = await supabaseAdmin.from('journal_entries')
      .update({ status: 'posted', posted_at: new Date().toISOString(), posted_by: req.user.id })
      .eq('id', entry.id);
    if (postErr) return res.status(500).json({ error: postErr.message });
  }

  const { data: full } = await supabaseAdmin
    .from('journal_entries').select(withLines).eq('id', entry.id).single();
  logger.info('ACCOUNTING', 'journal ' + entry.entry_no + (shouldPost ? ' posted' : ' drafted') + ' by ' + req.user.id);
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
    return res.status(409).json({ error: 'Entry ' + existing.entry_no + ' is ' + existing.status + ' and can no longer be edited. Void it and post a correction.' });
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

// POST /api/accounting/journal/:id/post
router.post('/:id/post', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.journal.manage')) return;

  const { data: entry } = await supabaseAdmin
    .from('journal_entries')
    .select('id, entry_no, status, journal_entry_lines(debit, credit)')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!entry) return res.status(404).json({ error: 'Journal entry not found' });
  if (entry.status === 'posted') return res.status(409).json({ error: 'Entry is already posted' });
  if (entry.status === 'void')   return res.status(409).json({ error: 'A voided entry cannot be posted' });

  const bad = balanceError(entry.journal_entry_lines || []);
  if (bad) return res.status(422).json({ error: bad });

  const { data, error } = await supabaseAdmin.from('journal_entries')
    .update({ status: 'posted', posted_at: new Date().toISOString(), posted_by: req.user.id, updated_at: new Date().toISOString() })
    .eq('id', entry.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  logger.info('ACCOUNTING', 'journal ' + entry.entry_no + ' posted by ' + req.user.id);
  res.json({ entry: data });
}));

// POST /api/accounting/journal/:id/void { reason }
// A posted entry is voided by writing its mirror image, so the ledger still adds
// up and the original stays readable. A draft is just marked void.
router.post('/:id/void', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.journal.manage')) return;

  const reason = (req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'A void reason is required' });

  const { data: entry } = await supabaseAdmin
    .from('journal_entries')
    .select('id, entry_no, entry_date, status, memo, source_type, source_id, journal_entry_lines(account_id, debit, credit, description, line_no)')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!entry) return res.status(404).json({ error: 'Journal entry not found' });
  if (entry.status === 'void') return res.status(409).json({ error: 'Entry is already void' });

  const now = new Date().toISOString();
  let reversal = null;

  if (entry.status === 'posted') {
    const { data: rev, error: revErr } = await supabaseAdmin.from('journal_entries').insert({
      company_id:  companyId,
      entry_no:    await nextEntryNo(companyId),
      entry_date:  new Date().toISOString().slice(0, 10),
      memo:        'Reversal of ' + entry.entry_no + ' -- ' + reason,
      status:      'draft',
      source_type: 'adjustment',
      source_id:   entry.id,
      created_by:  req.user.id,
    }).select().single();
    if (revErr) return res.status(500).json({ error: revErr.message });

    const mirrored = (entry.journal_entry_lines || []).map((l, i) => ({
      entry_id: rev.id, company_id: companyId, account_id: l.account_id,
      debit: l.credit, credit: l.debit,           // mirrored on purpose
      description: l.description, line_no: l.line_no ?? i + 1,
    }));
    const { error: mErr } = await supabaseAdmin.from('journal_entry_lines').insert(mirrored);
    if (mErr) {
      await supabaseAdmin.from('journal_entries').delete().eq('id', rev.id);
      return res.status(500).json({ error: mErr.message });
    }
    await supabaseAdmin.from('journal_entries')
      .update({ status: 'posted', posted_at: now, posted_by: req.user.id }).eq('id', rev.id);
    reversal = rev;
  }

  const { data, error } = await supabaseAdmin.from('journal_entries')
    .update({ status: 'void', voided_at: now, voided_by: req.user.id, void_reason: reason, updated_at: now })
    .eq('id', entry.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  logger.info('ACCOUNTING', 'journal ' + entry.entry_no + ' voided by ' + req.user.id + (reversal ? ' (reversal ' + reversal.entry_no + ')' : ''));
  res.json({ entry: data, reversal_entry_no: reversal?.entry_no || null });
}));

// DELETE /api/accounting/journal/:id -- drafts only. Posted history is voided,
// never removed.
router.delete('/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.journal.manage')) return;

  const { data: existing } = await supabaseAdmin
    .from('journal_entries').select('id, status, entry_no')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Journal entry not found' });
  if (existing.status !== 'draft') {
    return res.status(409).json({ error: 'Only draft entries can be deleted. Void ' + existing.entry_no + ' instead.' });
  }
  const { error } = await supabaseAdmin.from('journal_entries').delete().eq('id', existing.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

module.exports = router;

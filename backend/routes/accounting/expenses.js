// ============================================================================
// /api/accounting/expenses -- expense claims and their approval queue (285).
//
// Two audiences, one table, and the permission decides which one you are:
//
//   accounting.expenses.submit  -- your own claims. The list is filtered to
//                                  submitted_by = you, and it is filtered
//                                  server-side; the client never says whose
//                                  expenses it wants.
//   accounting.expenses.view    -- the whole company.
//   accounting.expenses.approve -- act on someone else claim.
//
// The ladder is draft -> submitted -> approved | rejected -> reimbursed, and
// every hop stamps who and when. Stamps are never overwritten by a later hop:
// an expense that was approved and then reimbursed still has to be able to say
// who approved it, which is the first thing a finance audit asks.
//
// Nobody approves their own claim, including an accountant with the permission.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../../config/database');
const { asyncHandler } = require('../../middleware/errorHandler');
const logger = require('../../utils/logger');
const { can, deny, readCompanyId, writeCompanyId, selfEmployee } = require('../../utils/moduleAccess');
const { createPostedEntry, postingRules, toBookLines } = require('../../utils/ledger');
const { getCompanyCurrency } = require('../../models/helpers');

const router = express.Router();

const full = 'id, company_id, category_id, submitted_by, employee_id, expense_date, amount, currency, '
  + 'vendor, description, receipt_url, is_billable, invoice_id, status, submitted_at, approved_by, '
  + 'approved_at, rejected_by, rejected_at, rejection_reason, reimbursed_at, reimbursed_by, '
  + 'journal_entry_id, reimbursement_journal_entry_id, receipt_path, created_at, updated_at, expense_categories(id, name, account_id), '
  + 'journal_entry:journal_entries!expenses_journal_entry_id_fkey(entry_no), '
  + 'reimbursement_entry:journal_entries!expenses_reimbursement_journal_entry_id_fkey(entry_no)';

// -- Categories ---------------------------------------------------------------

router.get('/categories', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ categories: [] });
  // Anyone who can file a claim needs to see the categories to file it against.
  const allowed = await can(req, companyId, 'accounting.expenses.submit')
               || await can(req, companyId, 'accounting.expenses.view');
  if (!allowed) return res.status(403).json({ error: 'Forbidden' });

  const { data, error } = await supabaseAdmin
    .from('expense_categories')
    .select('id, name, description, account_id, is_active')
    .eq('company_id', companyId).eq('is_active', true).order('name');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ categories: data || [] });
}));

router.post('/categories', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });
  if (await deny(req, res, companyId, 'accounting.expenses.approve')) return;

  if (!req.body?.name) return res.status(400).json({ error: 'name is required' });
  const { data, error } = await supabaseAdmin.from('expense_categories').insert({
    company_id: companyId,
    name: String(req.body.name).trim(),
    description: req.body.description || null,
    account_id: req.body.account_id || null,
    created_by: req.user.id,
  }).select().single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That category already exists' });
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json({ category: data });
}));

router.put('/categories/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.expenses.approve')) return;

  const patch = { updated_at: new Date().toISOString() };
  for (const f of ['name', 'description', 'account_id']) if (req.body?.[f] !== undefined) patch[f] = req.body[f];
  if (req.body?.is_active !== undefined) patch.is_active = !!req.body.is_active;

  const { data, error } = await supabaseAdmin.from('expense_categories')
    .update(patch).eq('id', req.params.id).eq('company_id', companyId).select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Category not found' });
  res.json({ category: data });
}));

// -- Claims -------------------------------------------------------------------

// GET /api/accounting/expenses?scope=mine|all&status=submitted
// scope defaults to the widest the caller is allowed. A caller with only
// `submit` is pinned to their own rows no matter what they ask for.
router.get('/', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ expenses: [], total: 0, scope: 'none' });

  const canSeeAll = await can(req, companyId, 'accounting.expenses.view')
                 || await can(req, companyId, 'accounting.expenses.approve');
  const canSubmit = await can(req, companyId, 'accounting.expenses.submit');
  if (!canSeeAll && !canSubmit) return res.status(403).json({ error: 'Forbidden' });

  const scope = (canSeeAll && req.query.scope !== 'mine') ? 'all' : 'mine';

  const page  = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const from  = (page - 1) * limit;

  let q = supabaseAdmin
    .from('expenses').select(full, { count: 'exact' })
    .eq('company_id', companyId)
    .order('expense_date', { ascending: false })
    .range(from, from + limit - 1);

  if (scope === 'mine') q = q.eq('submitted_by', req.user.id);
  if (req.query.status)      q = q.eq('status', req.query.status);
  if (req.query.category_id) q = q.eq('category_id', req.query.category_id);
  if (req.query.date_from)   q = q.gte('expense_date', req.query.date_from);
  if (req.query.date_to)     q = q.lte('expense_date', req.query.date_to);

  const { data, error, count } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Name the submitters. activeUserNames is deliberately not used here: an
  // expense claim is a financial record and must keep naming its claimant even
  // after they leave the company.
  const ids = [...new Set((data || []).map(r => r.submitted_by).filter(Boolean))];
  let names = {};
  if (ids.length) {
    const { data: profs } = await supabaseAdmin
      .from('user_profiles').select('user_id, first_name, last_name').in('user_id', ids);
    names = Object.fromEntries((profs || []).map(p => [
      p.user_id, [p.first_name, p.last_name].filter(Boolean).join(' ') || p.user_id,
    ]));
  }

  res.json({
    expenses: (data || []).map(r => ({ ...r, submitted_by_name: names[r.submitted_by] || null })),
    total: count || 0, page, limit, scope,
    can_approve: await can(req, companyId, 'accounting.expenses.approve'),
  });
}));

// GET /api/accounting/expenses/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  const { data, error } = await supabaseAdmin
    .from('expenses').select(full).eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Expense not found' });

  const mine = data.submitted_by === req.user.id;
  const canSeeAll = await can(req, companyId, 'accounting.expenses.view')
                 || await can(req, companyId, 'accounting.expenses.approve');
  if (!mine && !canSeeAll) return res.status(403).json({ error: 'Forbidden' });
  res.json({ expense: data });
}));

// -- Receipts (mig 318) ---------------------------------------------------------
// A receipt is a personal financial document: PRIVATE bucket, created on first
// use, and only ever shown through a signed link that expires in two minutes.
// Base64 in JSON like routes/training.js -- no multipart dependency.
const RECEIPT_BUCKET = 'expense-receipts';
const RECEIPT_MAX = 5 * 1024 * 1024;
const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];

async function ensureReceiptBucket() {
  try {
    const { data } = await supabaseAdmin.storage.getBucket(RECEIPT_BUCKET);
    if (data) return;
  } catch { /* not found -> create */ }
  const { error } = await supabaseAdmin.storage.createBucket(RECEIPT_BUCKET, { public: false, fileSizeLimit: String(RECEIPT_MAX) });
  if (error && !/already exists/i.test(error.message || '')) throw new Error(error.message);
}

// Who may touch this claim's receipt: the claimant while the claim is still
// theirs to edit, or an approver. Viewing: the claimant or anyone who sees all.
async function receiptAccess(req, companyId, id) {
  const { data: e } = await supabaseAdmin.from('expenses').select('id, submitted_by, status, receipt_path')
    .eq('id', id).eq('company_id', companyId).maybeSingle();
  if (!e) return { status: 404, error: 'Expense not found' };
  const mine = e.submitted_by === req.user.id;
  const approver = await can(req, companyId, 'accounting.expenses.approve');
  const viewer = approver || await can(req, companyId, 'accounting.expenses.view');
  return { e, mine, approver, viewer, editable: approver || (mine && ['draft', 'submitted', 'rejected'].includes(e.status)) };
}

// POST /api/accounting/expenses/:id/receipt { name, type, data (base64) }
router.post('/:id/receipt', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  const a = await receiptAccess(req, companyId, req.params.id);
  if (a.error) return res.status(a.status).json({ error: a.error });
  if (!a.editable) return res.status(403).json({ error: 'This claim can no longer take a receipt from you' });

  const type = String(req.body?.type || '').toLowerCase();
  if (!RECEIPT_TYPES.includes(type)) return res.status(400).json({ error: 'A receipt must be a photo (JPG, PNG, WEBP, HEIC) or a PDF' });
  const raw = String(req.body?.data || '');
  let buffer;
  try { buffer = Buffer.from(raw.includes(',') ? raw.split(',').pop() : raw, 'base64'); } catch { buffer = null; }
  if (!buffer || !buffer.length) return res.status(400).json({ error: 'The file is empty' });
  if (buffer.length > RECEIPT_MAX) return res.status(400).json({ error: 'A receipt can be at most 5 MB' });

  try { await ensureReceiptBucket(); } catch (e) { return res.status(500).json({ error: 'Storage error: ' + e.message }); }
  const safe = String(req.body?.name || 'receipt').replace(/[^\w.\-]+/g, '_').slice(0, 100) || 'receipt';
  const path = `${companyId}/${a.e.id}/${Date.now()}_${safe}`;
  const { error: upErr } = await supabaseAdmin.storage.from(RECEIPT_BUCKET).upload(path, buffer, { contentType: type, upsert: false });
  if (upErr) return res.status(500).json({ error: upErr.message });

  const { data, error } = await supabaseAdmin.from('expenses')
    .update({ receipt_path: path, updated_at: new Date().toISOString() }).eq('id', a.e.id).select(full).single();
  if (error) return res.status(500).json({ error: error.message });
  // The replaced file is removed; best-effort, never blocks the new one.
  if (a.e.receipt_path && a.e.receipt_path !== path) {
    supabaseAdmin.storage.from(RECEIPT_BUCKET).remove([a.e.receipt_path]).catch(() => {});
  }
  res.status(201).json({ expense: data });
}));

// GET /api/accounting/expenses/:id/receipt -> { url } (expires in 120 s)
router.get('/:id/receipt', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  const a = await receiptAccess(req, companyId, req.params.id);
  if (a.error) return res.status(a.status).json({ error: a.error });
  if (!a.mine && !a.viewer) return res.status(403).json({ error: 'Forbidden' });
  if (!a.e.receipt_path) return res.status(404).json({ error: 'No receipt attached' });
  const { data, error } = await supabaseAdmin.storage.from(RECEIPT_BUCKET).createSignedUrl(a.e.receipt_path, 120);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ url: data.signedUrl, expires_in: 120 });
}));

// DELETE /api/accounting/expenses/:id/receipt
router.delete('/:id/receipt', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  const a = await receiptAccess(req, companyId, req.params.id);
  if (a.error) return res.status(a.status).json({ error: a.error });
  if (!a.editable) return res.status(403).json({ error: 'This claim can no longer be changed by you' });
  if (!a.e.receipt_path) return res.json({ ok: true });
  const { data, error } = await supabaseAdmin.from('expenses')
    .update({ receipt_path: null, updated_at: new Date().toISOString() }).eq('id', a.e.id).select(full).single();
  if (error) return res.status(500).json({ error: error.message });
  supabaseAdmin.storage.from(RECEIPT_BUCKET).remove([a.e.receipt_path]).catch(() => {});
  res.json({ expense: data });
}));

// POST /api/accounting/expenses -- always filed AS the caller.
router.post('/', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });
  if (await deny(req, res, companyId, 'accounting.expenses.submit')) return;

  const amount = Number(req.body?.amount);
  if (!(amount > 0)) return res.status(400).json({ error: 'An amount greater than zero is required' });

  const employee = await selfEmployee(companyId, req.user.id);
  const submit = req.body?.submit === true;

  const { data, error } = await supabaseAdmin.from('expenses').insert({
    company_id:   companyId,
    category_id:  req.body?.category_id || null,
    submitted_by: req.user.id,                // never from the payload
    employee_id:  employee?.id || null,
    expense_date: req.body?.expense_date || new Date().toISOString().slice(0, 10),
    amount,
    currency:     req.body?.currency || await getCompanyCurrency(companyId),
    vendor:       req.body?.vendor || null,
    description:  req.body?.description || null,
    receipt_url:  req.body?.receipt_url || null,
    is_billable:  !!req.body?.is_billable,
    invoice_id:   req.body?.invoice_id || null,
    status:       submit ? 'submitted' : 'draft',
    submitted_at: submit ? new Date().toISOString() : null,
  }).select(full).single();
  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json({ expense: data });
}));

// PUT /api/accounting/expenses/:id -- the claimant, while it is still theirs.
router.put('/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  const { data: existing } = await supabaseAdmin
    .from('expenses').select('id, submitted_by, status')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Expense not found' });

  const mine = existing.submitted_by === req.user.id;
  const isApprover = await can(req, companyId, 'accounting.expenses.approve');
  if (!mine && !isApprover) return res.status(403).json({ error: 'Forbidden' });
  if (!['draft', 'submitted', 'rejected'].includes(existing.status)) {
    return res.status(409).json({ error: 'An expense that is ' + existing.status + ' can no longer be edited' });
  }
  if (existing.status === 'submitted' && !isApprover) {
    return res.status(409).json({ error: 'This claim is awaiting approval. Withdraw it to a draft before editing.' });
  }

  const patch = { updated_at: new Date().toISOString() };
  for (const f of ['category_id', 'expense_date', 'vendor', 'description', 'receipt_url', 'invoice_id', 'currency']) {
    if (req.body?.[f] !== undefined) patch[f] = req.body[f];
  }
  if (req.body?.is_billable !== undefined) patch.is_billable = !!req.body.is_billable;
  if (req.body?.amount !== undefined) {
    const amount = Number(req.body.amount);
    if (!(amount > 0)) return res.status(400).json({ error: 'An amount greater than zero is required' });
    patch.amount = amount;
  }

  const { data, error } = await supabaseAdmin
    .from('expenses').update(patch).eq('id', existing.id).select(full).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ expense: data });
}));

// POST /api/accounting/expenses/:id/submit  (draft or rejected -> submitted)
router.post('/:id/submit', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.expenses.submit')) return;

  const { data: e } = await supabaseAdmin
    .from('expenses').select('id, submitted_by, status')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!e) return res.status(404).json({ error: 'Expense not found' });
  if (e.submitted_by !== req.user.id) return res.status(403).json({ error: 'You can only submit your own claims' });
  if (!['draft', 'rejected'].includes(e.status)) {
    return res.status(409).json({ error: 'This claim is already ' + e.status });
  }

  const { data, error } = await supabaseAdmin.from('expenses').update({
    status: 'submitted',
    submitted_at: new Date().toISOString(),
    // A resubmission clears the previous rejection, not the approval history.
    rejected_by: null, rejected_at: null, rejection_reason: null,
    updated_at: new Date().toISOString(),
  }).eq('id', e.id).select(full).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ expense: data });
}));

// POST /api/accounting/expenses/:id/withdraw  (submitted -> draft, claimant only)
router.post('/:id/withdraw', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  const { data: e } = await supabaseAdmin
    .from('expenses').select('id, submitted_by, status')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!e) return res.status(404).json({ error: 'Expense not found' });
  if (e.submitted_by !== req.user.id) return res.status(403).json({ error: 'You can only withdraw your own claims' });
  if (e.status !== 'submitted') return res.status(409).json({ error: 'Only a submitted claim can be withdrawn' });

  const { data, error } = await supabaseAdmin.from('expenses')
    .update({ status: 'draft', submitted_at: null, updated_at: new Date().toISOString() })
    .eq('id', e.id).select(full).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ expense: data });
}));

// Does this company keep books at all? Without a chart of accounts an
// expense can still be approved and paid back -- there is simply nothing to
// record it in, and the response says so.
async function hasBooks(companyId) {
  const { count } = await supabaseAdmin.from('chart_of_accounts')
    .select('id', { count: 'exact', head: true }).eq('company_id', companyId);
  return (count || 0) > 0;
}

// POST /api/accounting/expenses/:id/approve
// Records the cost: expense (the category's account, or the Money-rules
// default) / "we owe the person who paid". A company WITH books never gets an
// approved claim without its entry -- a missing account or exchange rate stops
// the approval with a message that says what to set up.
router.post('/:id/approve', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.expenses.approve')) return;

  const { data: e } = await supabaseAdmin
    .from('expenses')
    .select('id, submitted_by, status, amount, currency, expense_date, description, vendor, category_id, expense_categories(account_id, name)')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!e) return res.status(404).json({ error: 'Expense not found' });
  if (e.status !== 'submitted') return res.status(409).json({ error: 'Only a submitted claim can be approved (this one is ' + e.status + ')' });
  if (e.submitted_by === req.user.id) {
    return res.status(403).json({ error: 'You cannot approve your own expense claim' });
  }

  // Work out the entry BEFORE approving.
  let lines = null;
  let journalNote = null;
  if (await hasBooks(companyId)) {
    const rule = (await postingRules(companyId, ['expense.approved']))['expense.approved'];
    const expenseAccountId = e.expense_categories?.account_id || rule.debit?.id;
    if (!expenseAccountId || !rule.credit) {
      return res.status(422).json({ error: 'Choose the accounts for "An expense claim is approved" in Accounts -> Settings -> Money rules (or give this category an account) before approving.' });
    }
    const label = e.description || e.vendor || 'Expense claim';
    const conv = await toBookLines(companyId, e.currency, [
      { account_id: expenseAccountId, debit: e.amount, credit: 0, description: label },
      { account_id: rule.credit.id, debit: 0, credit: e.amount, description: 'Owed to the person who paid' },
    ], e.expense_date);
    if (conv.error) return res.status(422).json({ error: conv.error });
    lines = conv.lines;
  } else {
    journalNote = 'Approved. This company has no chart of accounts yet, so nothing was recorded in the books.';
  }

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('expenses').update({
    status: 'approved', approved_by: req.user.id, approved_at: now, updated_at: now,
  }).eq('id', e.id).select(full).single();
  if (error) return res.status(500).json({ error: error.message });

  let entryNo = null;
  if (lines) {
    const posted = await createPostedEntry({
      companyId, userId: req.user.id,
      entryDate: e.expense_date,
      memo: 'Expense claim ' + (e.expense_categories?.name || '') + (e.description ? ' -- ' + e.description : ''),
      sourceType: 'expense', sourceId: e.id, sourceEvent: 'approval', lines,
    });
    if (posted.entry) {
      await supabaseAdmin.from('expenses').update({ journal_entry_id: posted.entry.id }).eq('id', e.id);
      entryNo = posted.entry.entry_no || null;
    } else { journalNote = 'Approved, but the entry in the books failed: ' + posted.error; logger.warn('ACCOUNTING', journalNote); }
  }

  logger.info('ACCOUNTING', 'expense ' + e.id + ' approved by ' + req.user.id);
  res.json({ expense: data, journal_note: journalNote, entry_no: entryNo });
}));

// POST /api/accounting/expenses/:id/reject { reason }
router.post('/:id/reject', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.expenses.approve')) return;

  const reason = (req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'A rejection reason is required -- the claimant has to know what to fix' });

  const { data: e } = await supabaseAdmin
    .from('expenses').select('id, submitted_by, status')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!e) return res.status(404).json({ error: 'Expense not found' });
  if (e.status !== 'submitted') return res.status(409).json({ error: 'Only a submitted claim can be rejected (this one is ' + e.status + ')' });
  if (e.submitted_by === req.user.id) return res.status(403).json({ error: 'You cannot action your own expense claim' });

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('expenses').update({
    status: 'rejected', rejected_by: req.user.id, rejected_at: now, rejection_reason: reason, updated_at: now,
  }).eq('id', e.id).select(full).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ expense: data });
}));

// POST /api/accounting/expenses/:id/reimburse { paid_on? }
// The person is paid back: "we owe the person who paid" / money paid out.
// This step was missing -- approved claims stayed owed in the books for ever.
router.post('/:id/reimburse', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.expenses.approve')) return;

  const { data: e } = await supabaseAdmin
    .from('expenses').select('id, status, amount, currency, description, vendor, journal_entry_id')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!e) return res.status(404).json({ error: 'Expense not found' });
  if (e.status !== 'approved') return res.status(409).json({ error: 'Only an approved claim can be marked reimbursed' });

  const paidOn = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.paid_on || '')) ? req.body.paid_on : new Date().toISOString().slice(0, 10);
  let lines = null;
  let journalNote = null;
  // Only a claim that was recorded when approved has anything to clear.
  if (e.journal_entry_id && await hasBooks(companyId)) {
    const rule = (await postingRules(companyId, ['expense.reimbursed']))['expense.reimbursed'];
    if (!rule.debit || !rule.credit) {
      return res.status(422).json({ error: 'Choose the accounts for "An expense claim is paid back" in Accounts -> Settings -> Money rules first.' });
    }
    const label = 'Paid back: ' + (e.description || e.vendor || 'expense claim');
    const conv = await toBookLines(companyId, e.currency, [
      { account_id: rule.debit.id, debit: e.amount, credit: 0, description: label },
      { account_id: rule.credit.id, debit: 0, credit: e.amount, description: label },
    ], paidOn);
    if (conv.error) return res.status(422).json({ error: conv.error });
    lines = conv.lines;
  }

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('expenses').update({
    status: 'reimbursed', reimbursed_by: req.user.id, reimbursed_at: now, updated_at: now,
  }).eq('id', e.id).select(full).single();
  if (error) return res.status(500).json({ error: error.message });

  let entryNo = null;
  if (lines) {
    const posted = await createPostedEntry({
      companyId, userId: req.user.id, entryDate: paidOn,
      memo: 'Expense claim paid back', sourceType: 'expense', sourceId: e.id, sourceEvent: 'reimbursement', lines,
    });
    if (posted.entry) {
      await supabaseAdmin.from('expenses').update({ reimbursement_journal_entry_id: posted.entry.id }).eq('id', e.id);
      entryNo = posted.entry.entry_no || null;
    } else { journalNote = 'Marked paid back, but the entry in the books failed: ' + posted.error; logger.warn('ACCOUNTING', journalNote); }
  }
  res.json({ expense: data, journal_note: journalNote, entry_no: entryNo });
}));

// DELETE /api/accounting/expenses/:id -- drafts only, by the claimant.
router.delete('/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  const { data: e } = await supabaseAdmin
    .from('expenses').select('id, submitted_by, status')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!e) return res.status(404).json({ error: 'Expense not found' });

  const isApprover = await can(req, companyId, 'accounting.expenses.approve');
  if (e.submitted_by !== req.user.id && !isApprover) return res.status(403).json({ error: 'Forbidden' });
  if (e.status !== 'draft') return res.status(409).json({ error: 'Only a draft claim can be deleted' });

  const { error } = await supabaseAdmin.from('expenses').delete().eq('id', e.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

module.exports = router;

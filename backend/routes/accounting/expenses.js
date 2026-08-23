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
const { createPostedEntry, accountByCode } = require('../../utils/ledger');

const router = express.Router();

const full = 'id, company_id, category_id, submitted_by, employee_id, expense_date, amount, currency, '
  + 'vendor, description, receipt_url, is_billable, invoice_id, status, submitted_at, approved_by, '
  + 'approved_at, rejected_by, rejected_at, rejection_reason, reimbursed_at, reimbursed_by, '
  + 'journal_entry_id, created_at, updated_at, expense_categories(id, name, account_id)';

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
    currency:     req.body?.currency || 'USD',
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

// POST /api/accounting/expenses/:id/approve
// Posts to the ledger best-effort: debit the category expense account, credit
// Payroll/other payables (2000 Accounts Payable). No accounts set up yet means
// no journal entry, never a failed approval.
router.post('/:id/approve', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.expenses.approve')) return;

  const { data: e } = await supabaseAdmin
    .from('expenses')
    .select('id, submitted_by, status, amount, expense_date, description, category_id, expense_categories(account_id, name)')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!e) return res.status(404).json({ error: 'Expense not found' });
  if (e.status !== 'submitted') return res.status(409).json({ error: 'Only a submitted claim can be approved (this one is ' + e.status + ')' });
  if (e.submitted_by === req.user.id) {
    return res.status(403).json({ error: 'You cannot approve your own expense claim' });
  }

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('expenses').update({
    status: 'approved', approved_by: req.user.id, approved_at: now, updated_at: now,
  }).eq('id', e.id).select(full).single();
  if (error) return res.status(500).json({ error: error.message });

  let journalNote = null;
  const expenseAccountId = e.expense_categories?.account_id || (await accountByCode(companyId, '5900'))?.id;
  const payable = await accountByCode(companyId, '2000');
  if (expenseAccountId && payable) {
    const posted = await createPostedEntry({
      companyId, userId: req.user.id,
      entryDate: e.expense_date,
      memo: 'Expense claim ' + (e.expense_categories?.name || 'reimbursement') + (e.description ? ' -- ' + e.description : ''),
      sourceType: 'expense', sourceId: e.id,
      lines: [
        { account_id: expenseAccountId, debit: e.amount, credit: 0, description: e.description || 'Expense claim' },
        { account_id: payable.id, debit: 0, credit: e.amount, description: 'Owed to claimant' },
      ],
    });
    if (posted.entry) await supabaseAdmin.from('expenses').update({ journal_entry_id: posted.entry.id }).eq('id', e.id);
    else { journalNote = 'Approved, but the journal entry failed: ' + posted.error; logger.warn('ACCOUNTING', journalNote); }
  } else {
    journalNote = 'Approved. No journal entry was written -- give this category a ledger account, or create account 2000 (Accounts Payable), to post automatically.';
  }

  logger.info('ACCOUNTING', 'expense ' + e.id + ' approved by ' + req.user.id);
  res.json({ expense: data, journal_note: journalNote });
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

// POST /api/accounting/expenses/:id/reimburse
router.post('/:id/reimburse', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.expenses.approve')) return;

  const { data: e } = await supabaseAdmin
    .from('expenses').select('id, status').eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!e) return res.status(404).json({ error: 'Expense not found' });
  if (e.status !== 'approved') return res.status(409).json({ error: 'Only an approved claim can be marked reimbursed' });

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('expenses').update({
    status: 'reimbursed', reimbursed_by: req.user.id, reimbursed_at: now, updated_at: now,
  }).eq('id', e.id).select(full).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ expense: data });
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

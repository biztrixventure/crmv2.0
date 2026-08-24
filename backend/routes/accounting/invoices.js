// ============================================================================
// /api/accounting/invoices -- invoices, their line items, and payments (284).
//
// The route does NOT do the arithmetic. subtotal, tax_total, total, amount_paid
// and status are maintained by triggers in mig 284, so a payment recorded here,
// a line item edited there, and a correction run in the SQL editor all land the
// same numbers. Handlers write the child row and re-read the parent.
//
// That is a deliberate departure from the brief, which asked this file to
// "auto-update invoices.status / amount_paid on payment insert". Doing it in
// route code AND leaving the columns writable elsewhere is how the sales
// denormalized columns drifted from form_data (mig 190). One writer wins.
//
// Posting to the ledger is OPTIONAL and best-effort: an invoice is a real
// business document whether or not a chart of accounts has been set up yet, so
// a missing AR / revenue account degrades to "no journal entry" with a note in
// the response, never a failed invoice.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../../config/database');
const { asyncHandler } = require('../../middleware/errorHandler');
const logger = require('../../utils/logger');
const { deny, readCompanyId, writeCompanyId } = require('../../utils/moduleAccess');
const { createPostedEntry, accountByCode } = require('../../utils/ledger');

const router = express.Router();

const full = 'id, company_id, invoice_no, customer_name, customer_email, customer_phone, customer_uuid, '
  + 'sale_id, issue_date, due_date, currency, subtotal, tax_total, discount_total, total, amount_paid, '
  + 'balance_due, status, notes, terms, journal_entry_id, created_by, created_at, updated_at, '
  + 'invoice_line_items(id, account_id, description, quantity, unit_price, tax_rate, discount, net_total, tax_amount, line_no), '
  + 'invoice_payments(id, amount, paid_at, method, reference, note, journal_entry_id, created_by, created_at)';

async function nextInvoiceNo(companyId) {
  const { data } = await supabaseAdmin
    .from('invoices').select('invoice_no')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false }).limit(1);
  const m = /^INV-(\d+)$/.exec(data?.[0]?.invoice_no || '');
  return 'INV-' + String(m ? Number(m[1]) + 1 : 1).padStart(6, '0');
}

// Normalise a line-items payload for one invoice. Returns { rows } or { error }.
async function prepareItems(rawItems, companyId, invoiceId) {
  if (!Array.isArray(rawItems)) return { rows: [] };
  const accountIds = [...new Set(rawItems.map(i => i.account_id).filter(Boolean))];
  if (accountIds.length) {
    const { data } = await supabaseAdmin
      .from('chart_of_accounts').select('id').eq('company_id', companyId).in('id', accountIds);
    const valid = new Set((data || []).map(a => a.id));
    for (const id of accountIds) {
      if (!valid.has(id)) return { error: 'Account ' + id + ' does not belong to this company' };
    }
  }
  const rows = [];
  for (let i = 0; i < rawItems.length; i++) {
    const it = rawItems[i];
    if (!it?.description) return { error: 'Line ' + (i + 1) + ': description is required' };
    const qty = Number(it.quantity ?? 1);
    const price = Number(it.unit_price ?? 0);
    if (!(qty >= 0) || !(price >= 0)) return { error: 'Line ' + (i + 1) + ': quantity and unit price cannot be negative' };
    rows.push({
      invoice_id: invoiceId,
      company_id: companyId,
      account_id: it.account_id || null,
      description: String(it.description),
      quantity: qty,
      unit_price: price,
      tax_rate: Number(it.tax_rate ?? 0),
      discount: Number(it.discount ?? 0),
      line_no: it.line_no ?? i + 1,
    });
  }
  return { rows };
}

const reload = async (id) => (await supabaseAdmin.from('invoices').select(full).eq('id', id).single()).data;

// GET /api/accounting/invoices
router.get('/', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ invoices: [], total: 0 });
  if (await deny(req, res, companyId, 'accounting.invoices.view')) return;

  const page  = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const from  = (page - 1) * limit;

  let q = supabaseAdmin
    .from('invoices')
    .select('id, invoice_no, customer_name, customer_email, issue_date, due_date, currency, total, amount_paid, balance_due, status, created_at', { count: 'exact' })
    .eq('company_id', companyId)
    .order('issue_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);

  if (req.query.status)    q = q.eq('status', req.query.status);
  if (req.query.date_from) q = q.gte('issue_date', req.query.date_from);
  if (req.query.date_to)   q = q.lte('issue_date', req.query.date_to);
  if (req.query.search) {
    const s = req.query.search;
    q = q.or('invoice_no.ilike.%' + s + '%,customer_name.ilike.%' + s + '%,customer_email.ilike.%' + s + '%');
  }
  if (req.query.unpaid === 'true') q = q.in('status', ['sent', 'partial', 'overdue']);

  const { data, error, count } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Headline numbers for the page-level KPI strip. Computed over the whole
  // company, not the current page -- a total that changes when you paginate is
  // worse than no total.
  const { data: agg } = await supabaseAdmin
    .from('invoices').select('status, total, amount_paid, balance_due')
    .eq('company_id', companyId).neq('status', 'void');
  const summary = (agg || []).reduce((acc, r) => {
    acc.invoiced += Number(r.total || 0);
    acc.collected += Number(r.amount_paid || 0);
    acc.outstanding += Number(r.balance_due || 0);
    if (r.status === 'overdue') acc.overdue += Number(r.balance_due || 0);
    return acc;
  }, { invoiced: 0, collected: 0, outstanding: 0, overdue: 0 });

  res.json({ invoices: data || [], total: count || 0, page, limit, summary });
}));

// GET /api/accounting/invoices/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.invoices.view')) return;

  const { data, error } = await supabaseAdmin
    .from('invoices').select(full).eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Invoice not found' });
  res.json({ invoice: data });
}));

// POST /api/accounting/invoices
router.post('/', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });
  if (await deny(req, res, companyId, 'accounting.invoices.manage')) return;

  const b = req.body || {};
  if (!b.customer_name) return res.status(400).json({ error: 'customer_name is required' });

  const { data: invoice, error } = await supabaseAdmin.from('invoices').insert({
    company_id:     companyId,
    invoice_no:     b.invoice_no || await nextInvoiceNo(companyId),
    customer_name:  String(b.customer_name).trim(),
    customer_email: b.customer_email || null,
    customer_phone: b.customer_phone || null,
    customer_uuid:  b.customer_uuid || null,
    sale_id:        b.sale_id || null,
    issue_date:     b.issue_date || new Date().toISOString().slice(0, 10),
    due_date:       b.due_date || null,
    currency:       b.currency || 'PKR',
    status:         b.status === 'sent' ? 'sent' : 'draft',
    notes:          b.notes || null,
    terms:          b.terms || null,
    created_by:     req.user.id,
  }).select().single();

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That invoice number is already used' });
    return res.status(500).json({ error: error.message });
  }

  if (Array.isArray(b.line_items) && b.line_items.length) {
    const prepared = await prepareItems(b.line_items, companyId, invoice.id);
    if (prepared.error) {
      await supabaseAdmin.from('invoices').delete().eq('id', invoice.id);
      return res.status(400).json({ error: prepared.error });
    }
    const { error: itemErr } = await supabaseAdmin.from('invoice_line_items').insert(prepared.rows);
    if (itemErr) {
      await supabaseAdmin.from('invoices').delete().eq('id', invoice.id);
      return res.status(500).json({ error: itemErr.message });
    }
  }

  logger.info('ACCOUNTING', 'invoice ' + invoice.invoice_no + ' created in ' + companyId + ' by ' + req.user.id);
  res.status(201).json({ invoice: await reload(invoice.id) });
}));

// PUT /api/accounting/invoices/:id
// Supplying `line_items` REPLACES the set -- the totals are derived from it, so
// a partial merge would silently leave the invoice describing something other
// than what it charges.
router.put('/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.invoices.manage')) return;

  const { data: existing } = await supabaseAdmin
    .from('invoices').select('id, invoice_no, status')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });
  if (existing.status === 'void') return res.status(409).json({ error: 'A void invoice cannot be edited' });

  const b = req.body || {};
  const patch = { updated_at: new Date().toISOString() };
  for (const f of ['customer_name', 'customer_email', 'customer_phone', 'customer_uuid',
                   'sale_id', 'issue_date', 'due_date', 'currency', 'notes', 'terms', 'invoice_no']) {
    if (b[f] !== undefined) patch[f] = b[f];
  }
  // Status is a workflow, not a free field: paid/partial/overdue are computed
  // from payments. Only the manual transitions are honoured here.
  if (b.status !== undefined) {
    if (!['draft', 'sent'].includes(b.status)) {
      return res.status(400).json({ error: 'Only draft and sent can be set directly -- paid, partial and overdue follow the payments.' });
    }
    patch.status = b.status;
  }

  if (Array.isArray(b.line_items)) {
    const prepared = await prepareItems(b.line_items, companyId, existing.id);
    if (prepared.error) return res.status(400).json({ error: prepared.error });
    await supabaseAdmin.from('invoice_line_items').delete().eq('invoice_id', existing.id);
    if (prepared.rows.length) {
      const { error: itemErr } = await supabaseAdmin.from('invoice_line_items').insert(prepared.rows);
      if (itemErr) return res.status(500).json({ error: itemErr.message });
    }
  }

  const { error } = await supabaseAdmin.from('invoices').update(patch).eq('id', existing.id);
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That invoice number is already used' });
    return res.status(500).json({ error: error.message });
  }
  res.json({ invoice: await reload(existing.id) });
}));

// POST /api/accounting/invoices/:id/send -- draft -> sent.
router.post('/:id/send', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.invoices.manage')) return;

  const { data: inv } = await supabaseAdmin
    .from('invoices').select('id, status, total').eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.status !== 'draft') return res.status(409).json({ error: 'Only a draft invoice can be sent' });
  if (Number(inv.total) <= 0) return res.status(422).json({ error: 'Invoice has no billable lines' });

  const { error } = await supabaseAdmin.from('invoices')
    .update({ status: 'sent', updated_at: new Date().toISOString() }).eq('id', inv.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ invoice: await reload(inv.id) });
}));

// POST /api/accounting/invoices/:id/payments { amount, paid_at, method, reference, note }
// amount_paid and status are recomputed by the mig 284 trigger the moment this
// row lands -- the response re-reads the invoice rather than guessing.
router.post('/:id/payments', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.invoices.manage')) return;

  const { data: inv } = await supabaseAdmin
    .from('invoices').select('id, invoice_no, status, total, amount_paid, balance_due')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.status === 'void') return res.status(409).json({ error: 'A void invoice cannot take payments' });

  const amount = Number(req.body?.amount);
  if (!(amount > 0)) return res.status(400).json({ error: 'A payment amount greater than zero is required' });

  // Overpayment is refused rather than absorbed. A payment bigger than the
  // balance is nearly always a typo, and silently accepting it turns into a
  // refund conversation later.
  if (Math.round(amount * 100) > Math.round(Number(inv.balance_due) * 100)) {
    return res.status(422).json({
      error: 'Payment of ' + amount + ' exceeds the outstanding balance of ' + inv.balance_due,
      balance_due: inv.balance_due,
    });
  }

  const { data: payment, error } = await supabaseAdmin.from('invoice_payments').insert({
    invoice_id: inv.id,
    company_id: companyId,
    amount,
    paid_at:    req.body?.paid_at || new Date().toISOString(),
    method:     req.body?.method || null,
    reference:  req.body?.reference || null,
    note:       req.body?.note || null,
    created_by: req.user.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Ledger side, best-effort: debit Cash, credit Accounts Receivable.
  let journalNote = null;
  const cash = await accountByCode(companyId, '1000');
  const ar   = await accountByCode(companyId, '1100');
  if (cash && ar) {
    const posted = await createPostedEntry({
      companyId, userId: req.user.id,
      entryDate: String(payment.paid_at).slice(0, 10),
      memo: 'Payment on invoice ' + inv.invoice_no,
      sourceType: 'payment', sourceId: payment.id,
      lines: [
        { account_id: cash.id, debit: amount,  credit: 0, description: 'Payment received' },
        { account_id: ar.id,   debit: 0,       credit: amount, description: 'Invoice ' + inv.invoice_no },
      ],
    });
    if (posted.entry) {
      await supabaseAdmin.from('invoice_payments').update({ journal_entry_id: posted.entry.id }).eq('id', payment.id);
    } else {
      journalNote = 'Payment recorded, but the journal entry failed: ' + posted.error;
      logger.warn('ACCOUNTING', 'payment ' + payment.id + ' journal failed: ' + posted.error);
    }
  } else {
    journalNote = 'Payment recorded. No journal entry was written -- set up accounts 1000 (Cash) and 1100 (Accounts Receivable) to post automatically.';
  }

  logger.info('ACCOUNTING', 'payment ' + amount + ' on ' + inv.invoice_no + ' by ' + req.user.id);
  res.status(201).json({ payment, invoice: await reload(inv.id), journal_note: journalNote });
}));

// DELETE /api/accounting/invoices/:id/payments/:paymentId
router.delete('/:id/payments/:paymentId', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.invoices.manage')) return;

  const { data: payment } = await supabaseAdmin
    .from('invoice_payments').select('id, invoice_id, journal_entry_id')
    .eq('id', req.params.paymentId).eq('company_id', companyId).maybeSingle();
  if (!payment || payment.invoice_id !== req.params.id) {
    return res.status(404).json({ error: 'Payment not found on this invoice' });
  }

  const { error } = await supabaseAdmin.from('invoice_payments').delete().eq('id', payment.id);
  if (error) return res.status(500).json({ error: error.message });

  // The journal entry is left standing and voided separately if wanted -- a
  // posted ledger entry is not deleted just because its trigger row went away.
  res.json({ ok: true, invoice: await reload(payment.invoice_id), journal_entry_id: payment.journal_entry_id });
}));

// POST /api/accounting/invoices/:id/void { reason }
router.post('/:id/void', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.invoices.manage')) return;

  const { data: inv } = await supabaseAdmin
    .from('invoices').select('id, invoice_no, status, amount_paid')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.status === 'void') return res.status(409).json({ error: 'Invoice is already void' });
  if (Number(inv.amount_paid) > 0) {
    return res.status(409).json({ error: 'This invoice has payments against it. Remove the payments first, or issue a credit note.' });
  }

  const note = req.body?.reason ? ('Voided: ' + req.body.reason) : 'Voided';
  const { error } = await supabaseAdmin.from('invoices')
    .update({ status: 'void', notes: note, updated_at: new Date().toISOString() }).eq('id', inv.id);
  if (error) return res.status(500).json({ error: error.message });
  logger.info('ACCOUNTING', 'invoice ' + inv.invoice_no + ' voided by ' + req.user.id);
  res.json({ invoice: await reload(inv.id) });
}));

// DELETE /api/accounting/invoices/:id -- drafts only.
router.delete('/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.invoices.manage')) return;

  const { data: inv } = await supabaseAdmin
    .from('invoices').select('id, invoice_no, status')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.status !== 'draft') {
    return res.status(409).json({ error: 'Only a draft invoice can be deleted. Void ' + inv.invoice_no + ' instead.' });
  }
  const { error } = await supabaseAdmin.from('invoices').delete().eq('id', inv.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

module.exports = router;

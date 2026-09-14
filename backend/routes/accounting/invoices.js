// ============================================================================
// /api/accounting/invoices -- invoices, their line items, and payments (284).
//
// The route does NOT do the arithmetic. subtotal, tax_total, total, amount_paid
// and status are maintained by triggers in mig 284, so a payment recorded here,
// a line item edited there, and a correction run in the SQL editor all land the
// same numbers. Handlers write the child row and re-read the parent.
//
// THE BOOKS (fixed in stage 3, mig 315):
//   Send     -> "customer owes us" (debit) / sales per line + tax (credit).
//               Before this nothing was recorded on send, so a payment drove
//               "customer owes us" NEGATIVE and the sale never reached the P&L.
//   Edit a sent invoice -> the old entry is reversed and the new one posted,
//               one transaction, with the reason on record.
//   Payment  -> money received / "customer owes us". A foreign-currency
//               invoice clears at the rate it was booked at; the difference
//               to the rate on the payment day goes to its own account.
//   Remove a payment / void -> the matching entry is reversed, never deleted.
// Which accounts are used is a per-company setting (Accounts -> Settings ->
// Money rules), defaulting to the codes in utils/ledger.js.
//
// A company with no chart of accounts can still invoice -- nothing is written
// to books that do not exist, and the response says so. A company WITH books
// never gets a half-recorded invoice: a missing account or exchange rate stops
// the action with a message that says what to set up.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../../config/database');
const { asyncHandler } = require('../../middleware/errorHandler');
const logger = require('../../utils/logger');
const { deny, readCompanyId, writeCompanyId } = require('../../utils/moduleAccess');
const {
  cents, money, createPostedEntry, reverseEntry, postingRules, toBookLines, fxRate, liveEntryFor, companyCurrency,
} = require('../../utils/ledger');
const { getCompanyCurrency } = require('../../models/helpers');
const { needReason, setChangeReason, getContext } = require('../../utils/requestContext');

const router = express.Router();

const full = 'id, company_id, invoice_no, customer_name, customer_email, customer_phone, customer_uuid, '
  + 'sale_id, issue_date, due_date, currency, subtotal, tax_total, discount_total, total, amount_paid, '
  + 'balance_due, status, notes, terms, journal_entry_id, created_by, created_at, updated_at, '
  + 'journal_entry:journal_entries(entry_no, entry_date), '
  + 'invoice_line_items(id, account_id, description, quantity, unit_price, tax_rate, discount, net_total, tax_amount, line_no), '
  + 'invoice_payments(id, amount, paid_at, method, reference, note, journal_entry_id, created_by, created_at, '
  + 'journal_entry:journal_entries(entry_no))';

const ISSUED = ['sent', 'partial', 'paid', 'overdue'];

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

async function hasBooks(companyId) {
  const { count } = await supabaseAdmin.from('chart_of_accounts')
    .select('id', { count: 'exact', head: true }).eq('company_id', companyId);
  return (count || 0) > 0;
}

// The "invoice sent" entry for one invoice, in the company currency.
// { lines } | { skip: note } | { error }
async function issueLines(inv) {
  if (!(await hasBooks(inv.company_id))) {
    return { skip: 'No chart of accounts yet -- the invoice was saved, but nothing was recorded in the books.' };
  }
  const rules = await postingRules(inv.company_id, ['invoice.issued', 'invoice.tax']);
  const ar = rules['invoice.issued'].debit;
  const sales = rules['invoice.issued'].credit;
  const tax = rules['invoice.tax'].credit;
  if (!ar) return { error: 'Choose the account for "Customer owes us" in Accounts -> Settings -> Money rules before sending invoices.' };

  const byAccount = new Map();
  for (const it of inv.invoice_line_items || []) {
    const acct = it.account_id || sales?.id;
    if (!acct) return { error: 'Line "' + it.description + '" has no account, and no default sales account is set in Money rules.' };
    byAccount.set(acct, (byAccount.get(acct) || 0) + cents(it.net_total));
  }
  const taxC = cents(inv.tax_total);
  if (taxC > 0) {
    if (!tax) return { error: 'This invoice charges tax: choose the "Tax we owe" account in Money rules first.' };
    byAccount.set(tax.id, (byAccount.get(tax.id) || 0) + taxC);
  }
  const label = 'Invoice ' + inv.invoice_no + ' -- ' + inv.customer_name;
  const lines = [{ account_id: ar.id, debit: money(cents(inv.total)), credit: 0, description: label }];
  for (const [acct, c] of byAccount) {
    if (c > 0) lines.push({ account_id: acct, debit: 0, credit: money(c), description: label });
    if (c < 0) lines.push({ account_id: acct, debit: money(-c), credit: 0, description: label + ' (discount)' });
  }
  const conv = await toBookLines(inv.company_id, inv.currency, lines, inv.issue_date);
  return conv.error ? { error: conv.error } : { lines: conv.lines };
}

// Post (or replace) the "invoice sent" entry. Returns { entry, note } or { error }.
async function recordIssue(inv, userId, replaceReason = null) {
  const prep = await issueLines(inv);
  if (prep.error) return { error: prep.error };
  const live = await liveEntryFor(inv.company_id, 'invoice', inv.id, 'issue');
  if (prep.skip) {
    // Books were removed after the invoice was recorded? Leave history alone.
    return { note: prep.skip };
  }
  const memo = 'Invoice ' + inv.invoice_no + ' sent to ' + inv.customer_name;
  if (live) {
    const r = await reverseEntry({
      entryId: live.id, reason: replaceReason || 'Invoice changed after it was sent', companyId: inv.company_id,
      replacement: { entryDate: inv.issue_date, memo, sourceType: 'invoice', sourceId: inv.id, sourceEvent: 'issue', lines: prep.lines },
    });
    if (r.error) return { error: r.error };
    if (r.replacement?.id) await supabaseAdmin.from('invoices').update({ journal_entry_id: r.replacement.id }).eq('id', inv.id);
    return { entry: r.replacement };
  }
  const posted = await createPostedEntry({
    companyId: inv.company_id, userId, entryDate: inv.issue_date, memo,
    sourceType: 'invoice', sourceId: inv.id, sourceEvent: 'issue', lines: prep.lines,
  });
  if (posted.error) return { error: posted.error };
  await supabaseAdmin.from('invoices').update({ journal_entry_id: posted.entry.id }).eq('id', inv.id);
  return { entry: posted.entry };
}

// The payment entry. Foreign currency: "customer owes us" clears at the rate
// the invoice was BOOKED at; cash comes in at the rate on the payment day; the
// difference is an exchange-rate gain or loss.
async function paymentLines(inv, amount, paidOn) {
  if (!(await hasBooks(inv.company_id))) return { skip: 'No chart of accounts yet -- nothing was recorded in the books.' };
  const rules = await postingRules(inv.company_id, ['invoice.payment', 'fx.difference']);
  const cash = rules['invoice.payment'].debit;
  const ar = rules['invoice.payment'].credit;
  if (!cash || !ar) return { error: 'Choose the accounts for "A customer pays an invoice" in Accounts -> Settings -> Money rules.' };

  const label = 'Payment on invoice ' + inv.invoice_no;
  const book = await companyCurrency(inv.company_id);
  if (!inv.currency || inv.currency === book) {
    return { lines: [
      { account_id: cash.id, debit: amount, credit: 0, description: label },
      { account_id: ar.id,   debit: 0, credit: amount, description: label },
    ] };
  }

  const payFx = await fxRate(inv.company_id, inv.currency, paidOn);
  if (!payFx) return { error: 'There is no ' + inv.currency + ' to ' + book + ' exchange rate on or before ' + paidOn + '. Add one in Accounts -> Settings -> Exchange rates.' };
  // The rate the invoice was booked at, from its own entry.
  let bookRate = null;
  const live = await liveEntryFor(inv.company_id, 'invoice', inv.id, 'issue');
  if (live) {
    const { data: l } = await supabaseAdmin.from('journal_entry_lines').select('fx_rate')
      .eq('entry_id', live.id).not('fx_rate', 'is', null).limit(1);
    bookRate = l?.[0]?.fx_rate ? Number(l[0].fx_rate) : null;
  }
  if (!bookRate) bookRate = (await fxRate(inv.company_id, inv.currency, inv.issue_date))?.rate || payFx.rate;

  const amtC = cents(amount);
  const cashC = Math.round(amtC * payFx.rate);
  const arC = Math.round(amtC * bookRate);
  const lines = [
    { account_id: cash.id, debit: money(cashC), credit: 0, description: label, orig_currency: inv.currency, orig_amount: amount, fx_rate: payFx.rate },
    { account_id: ar.id, debit: 0, credit: money(arC), description: label, orig_currency: inv.currency, orig_amount: amount, fx_rate: bookRate },
  ];
  const diff = cashC - arC;
  if (diff !== 0) {
    const fxAcct = rules['fx.difference'].credit;
    if (!fxAcct) return { error: 'The exchange rate moved since this invoice was sent. Choose the "Exchange-rate gains and losses" account in Money rules first.' };
    lines.push(diff > 0
      ? { account_id: fxAcct.id, debit: 0, credit: money(diff), description: 'Exchange-rate gain on ' + inv.invoice_no }
      : { account_id: fxAcct.id, debit: money(-diff), credit: 0, description: 'Exchange-rate loss on ' + inv.invoice_no });
  }
  return { lines };
}

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
    .select('id, invoice_no, customer_name, customer_email, issue_date, due_date, currency, total, amount_paid, balance_due, status, journal_entry_id, created_at', { count: 'exact' })
    .eq('company_id', companyId)
    .order('issue_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);

  if (req.query.status)    q = q.eq('status', req.query.status);
  if (req.query.date_from) q = q.gte('issue_date', req.query.date_from);
  if (req.query.date_to)   q = q.lte('issue_date', req.query.date_to);
  if (req.query.search) {
    const s = String(req.query.search).replace(/[,()*]/g, ' ').trim();
    if (s) q = q.or('invoice_no.ilike.%' + s + '%,customer_name.ilike.%' + s + '%,customer_email.ilike.%' + s + '%');
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

// POST /api/accounting/invoices  (status 'sent' = create and send in one go)
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
    currency:       b.currency || await getCompanyCurrency(companyId),
    status:         'draft',
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

  // Create-and-send: the same path as POST /:id/send, so there is one place
  // an invoice becomes a debt in the books.
  let journalNote = null;
  if (b.status === 'sent') {
    const sent = await sendInvoice(invoice.id, companyId, req.user.id);
    if (sent.error) journalNote = 'Saved as a draft, not sent: ' + sent.error;
    else journalNote = sent.note || null;
  }

  logger.info('ACCOUNTING', 'invoice ' + invoice.invoice_no + ' created in ' + companyId + ' by ' + req.user.id);
  res.status(201).json({ invoice: await reload(invoice.id), journal_note: journalNote });
}));

// The one place a draft becomes "sent": validate the books side FIRST, so a
// company with books never ends up with a sent invoice and no debt recorded.
async function sendInvoice(invoiceId, companyId, userId) {
  const inv = await reload(invoiceId);
  if (!inv || inv.company_id !== companyId) return { error: 'Invoice not found', status: 404 };
  if (inv.status !== 'draft') return { error: 'Only a draft invoice can be sent', status: 409 };
  if (Number(inv.total) <= 0) return { error: 'Invoice has no billable lines', status: 422 };

  const prep = await issueLines(inv);
  if (prep.error) return { error: prep.error, status: 422 };

  const { error } = await supabaseAdmin.from('invoices')
    .update({ status: 'sent', updated_at: new Date().toISOString() }).eq('id', inv.id);
  if (error) return { error: error.message, status: 500 };

  if (prep.skip) return { note: prep.skip };
  const rec = await recordIssue({ ...inv, status: 'sent' }, userId);
  if (rec.error) {
    await supabaseAdmin.from('invoices').update({ status: 'draft', updated_at: new Date().toISOString() }).eq('id', inv.id);
    return { error: 'Could not record the invoice in the books, so it stays a draft: ' + rec.error, status: 500 };
  }
  return { entry: rec.entry };
}

// PUT /api/accounting/invoices/:id
// Supplying `line_items` REPLACES the set -- the totals are derived from it, so
// a partial merge would silently leave the invoice describing something other
// than what it charges. Changing what a SENT invoice charges needs a reason,
// and re-posts its entry (reverse + re-post, one transaction).
router.put('/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.invoices.manage')) return;

  const { data: existing } = await supabaseAdmin
    .from('invoices').select('id, invoice_no, status, currency, issue_date')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });
  if (existing.status === 'void') return res.status(409).json({ error: 'A void invoice cannot be edited' });

  const b = req.body || {};
  // Status moves through Send and Void, which keep the books in step. A raw
  // status edit would make an invoice "sent" with nothing owed, or the reverse.
  if (b.status !== undefined && b.status !== existing.status) {
    return res.status(400).json({ error: 'Use Send or Void to change an invoice\'s status -- they keep the books in step.' });
  }

  const issued = ISSUED.includes(existing.status);
  const moneyChanges = Array.isArray(b.line_items)
    || (b.currency !== undefined && b.currency !== existing.currency)
    || (b.issue_date !== undefined && b.issue_date !== existing.issue_date);
  if (issued && moneyChanges && needReason(req, res, 'changing what a sent invoice charges')) return;

  // Pre-check the books side of a re-post before touching anything.
  if (issued && moneyChanges && await hasBooks(companyId)) {
    const cur = b.currency ?? existing.currency;
    const book = await companyCurrency(companyId);
    if (cur && cur !== book && !(await fxRate(companyId, cur, b.issue_date ?? existing.issue_date))) {
      return res.status(422).json({ error: 'There is no ' + cur + ' to ' + book + ' exchange rate for that date. Add one in Accounts -> Settings -> Exchange rates.' });
    }
  }

  const patch = { updated_at: new Date().toISOString() };
  for (const f of ['customer_name', 'customer_email', 'customer_phone', 'customer_uuid',
                   'sale_id', 'issue_date', 'due_date', 'currency', 'notes', 'terms', 'invoice_no']) {
    if (b[f] !== undefined) patch[f] = b[f];
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

  let journalNote = null;
  if (issued && moneyChanges) {
    const why = getContext()?.reason || 'Invoice changed after it was sent';
    const rec = await recordIssue(await reload(existing.id), req.user.id, why);
    if (rec.error) journalNote = 'The invoice was saved, but its entry in the books could not be updated: ' + rec.error;
    else if (rec.note) journalNote = rec.note;
  }
  res.json({ invoice: await reload(existing.id), journal_note: journalNote });
}));

// POST /api/accounting/invoices/:id/send -- draft -> sent, and into the books.
router.post('/:id/send', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.invoices.manage')) return;

  const sent = await sendInvoice(req.params.id, companyId, req.user.id);
  if (sent.error) return res.status(sent.status || 422).json({ error: sent.error });
  res.json({ invoice: await reload(req.params.id), journal_note: sent.note || null, entry_no: sent.entry?.entry_no || null });
}));

// POST /api/accounting/invoices/:id/payments { amount, paid_at, method, reference, note }
// amount_paid and status are recomputed by the mig 284 trigger the moment this
// row lands -- the response re-reads the invoice rather than guessing.
router.post('/:id/payments', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.invoices.manage')) return;

  const inv = await reload(req.params.id);
  if (!inv || inv.company_id !== companyId) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.status === 'void') return res.status(409).json({ error: 'A void invoice cannot take payments' });
  if (inv.status === 'draft') return res.status(409).json({ error: 'Send the invoice before recording a payment on it' });

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

  const paidAt = req.body?.paid_at || new Date().toISOString();
  const prep = await paymentLines(inv, amount, String(paidAt).slice(0, 10));
  if (prep.error) return res.status(422).json({ error: prep.error });

  const { data: payment, error } = await supabaseAdmin.from('invoice_payments').insert({
    invoice_id: inv.id,
    company_id: companyId,
    amount,
    paid_at:    paidAt,
    method:     req.body?.method || null,
    reference:  req.body?.reference || null,
    note:       req.body?.note || null,
    created_by: req.user.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  let journalNote = prep.skip || null;
  if (prep.lines) {
    const posted = await createPostedEntry({
      companyId, userId: req.user.id, entryDate: String(payment.paid_at).slice(0, 10),
      memo: 'Payment on invoice ' + inv.invoice_no,
      sourceType: 'payment', sourceId: payment.id, sourceEvent: 'payment', lines: prep.lines,
    });
    if (posted.entry) {
      await supabaseAdmin.from('invoice_payments').update({ journal_entry_id: posted.entry.id }).eq('id', payment.id);
    } else {
      // The payment row is real money received; keep it, and say the books
      // side needs attention rather than pretending it happened.
      journalNote = 'Payment recorded, but its entry in the books failed: ' + posted.error;
      logger.warn('ACCOUNTING', 'payment ' + payment.id + ' journal failed: ' + posted.error);
    }
  }

  logger.info('ACCOUNTING', 'payment ' + amount + ' on ' + inv.invoice_no + ' by ' + req.user.id);
  res.status(201).json({ payment, invoice: await reload(inv.id), journal_note: journalNote });
}));

// DELETE /api/accounting/invoices/:id/payments/:paymentId
// The payment row goes; its entry in the books is REVERSED (it was left
// standing before, so the books still showed money that had been taken back).
router.delete('/:id/payments/:paymentId', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.invoices.manage')) return;
  if (needReason(req, res, 'removing this payment')) return;

  const { data: payment } = await supabaseAdmin
    .from('invoice_payments').select('id, invoice_id, journal_entry_id')
    .eq('id', req.params.paymentId).eq('company_id', companyId).maybeSingle();
  if (!payment || payment.invoice_id !== req.params.id) {
    return res.status(404).json({ error: 'Payment not found on this invoice' });
  }

  let journalNote = null;
  const live = payment.journal_entry_id
    ? { id: payment.journal_entry_id }
    : await liveEntryFor(companyId, 'payment', payment.id, 'payment');
  if (live) {
    const r = await reverseEntry({ entryId: live.id, reason: getContext()?.reason || 'Payment removed', companyId });
    if (r.error) return res.status(422).json({ error: 'Could not reverse the payment in the books: ' + r.error });
    journalNote = r.reversal?.entry_no ? 'Reversed in the books as ' + r.reversal.entry_no + '.' : null;
  }

  const { error } = await supabaseAdmin.from('invoice_payments').delete().eq('id', payment.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, invoice: await reload(payment.invoice_id), journal_note: journalNote });
}));

// POST /api/accounting/invoices/:id/void { reason }
router.post('/:id/void', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.invoices.manage')) return;

  const reason = (req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'Say why the invoice is being voided' });
  setChangeReason(reason);

  const { data: inv } = await supabaseAdmin
    .from('invoices').select('id, invoice_no, status, amount_paid, notes')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.status === 'void') return res.status(409).json({ error: 'Invoice is already void' });
  if (Number(inv.amount_paid) > 0) {
    return res.status(409).json({ error: 'This invoice has payments against it. Remove the payments first, or issue a credit note.' });
  }

  let journalNote = null;
  const live = await liveEntryFor(companyId, 'invoice', inv.id, 'issue');
  if (live) {
    const r = await reverseEntry({ entryId: live.id, reason: 'Invoice voided -- ' + reason, companyId });
    if (r.error) return res.status(422).json({ error: 'Could not reverse the invoice in the books: ' + r.error });
    journalNote = r.reversal?.entry_no ? 'Reversed in the books as ' + r.reversal.entry_no + '.' : null;
  }

  const note = [inv.notes, 'Voided: ' + reason].filter(Boolean).join('\n');
  const { error } = await supabaseAdmin.from('invoices')
    .update({ status: 'void', notes: note, updated_at: new Date().toISOString() }).eq('id', inv.id);
  if (error) return res.status(500).json({ error: error.message });
  logger.info('ACCOUNTING', 'invoice ' + inv.invoice_no + ' voided by ' + req.user.id);
  res.json({ invoice: await reload(inv.id), journal_note: journalNote });
}));

// DELETE /api/accounting/invoices/:id -- drafts only (a draft was never in the books).
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
module.exports.sendInvoice = sendInvoice;
module.exports.issueLines = issueLines;

// ============================================================================
// /api/accounting/revenue -- CRM sales into the books (mig 317). OFF by default.
//
//   GET  /settings        the switches, the rate card, who the clients/partners are
//   PUT  /settings        switches, go-live, when a sale counts, rate currency
//   POST /rates           add a rate line (effective from a date)
//   PUT  /rates/:id       correct a line (reason required)
//   DELETE /rates/:id     remove a line (reason required)
//   GET  /preview         dry run: what the books would gain / lose, and the
//                         sales that cannot be priced yet -- never writes
//   POST /run             run now (in the background; the hourly job does the same)
//   GET  /statement       one client's earned sales for a month (the page makes
//                         the CSV). Revenue is booked per sale, so a statement is
//                         a document, not a second posting.
//
// Viewing needs accounting.reports.view (or accounts.view); every change needs
// accounting.settings.manage. The worker itself is utils/revenueSync.js.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../../config/database');
const { asyncHandler } = require('../../middleware/errorHandler');
const { can, deny, readCompanyId, writeCompanyId } = require('../../utils/moduleAccess');
const { needReason } = require('../../utils/requestContext');
const { planCompany, runCompany, getSettings, pickRate, amountOf, earnedState } = require('../../utils/revenueSync');
const { money, companyCurrency } = require('../../utils/ledger');

const router = express.Router();

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(new Date(s + 'T00:00:00Z').getTime());
const mayView = async (req, companyId) => await can(req, companyId, 'accounting.reports.view') || await can(req, companyId, 'accounting.accounts.view');

router.get('/settings', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ settings: null });
  if (!(await mayView(req, companyId))) return res.status(403).json({ error: 'Forbidden' });

  const settings = await getSettings(companyId);
  const [{ data: rates }, { data: companies }, { data: clientRows }, book] = await Promise.all([
    supabaseAdmin.from('revenue_rates').select('*').eq('company_id', companyId)
      .order('kind').order('client_name').order('effective_from', { ascending: false }),
    supabaseAdmin.from('companies').select('id, name').eq('is_active', true).order('name'),
    // The clients and plans actually sold since go-live, for the pickers.
    supabaseAdmin.from('sales').select('client_name, plan').gte('sale_date', settings.go_live).limit(5000),
    companyCurrency(companyId),
  ]);
  const clients = {};
  for (const r of clientRows || []) {
    if (!r.client_name) continue;
    const key = r.client_name.trim();
    (clients[key] = clients[key] || new Set()).add((r.plan || '').trim());
  }
  res.json({
    settings,
    book_currency: book,
    rates: rates || [],
    companies: (companies || []).filter(c => c.id !== companyId),
    clients: Object.entries(clients).map(([name, plans]) => ({ name, plans: [...plans].filter(Boolean).sort() }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    can_manage: await can(req, companyId, 'accounting.settings.manage'),
  });
}));

router.put('/settings', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });
  if (await deny(req, res, companyId, 'accounting.settings.manage')) return;

  const b = req.body || {};
  const cur = await getSettings(companyId);
  const row = {
    company_id: companyId,
    closer_enabled: b.closer_enabled !== undefined ? !!b.closer_enabled : cur.closer_enabled,
    fronter_enabled: b.fronter_enabled !== undefined ? !!b.fronter_enabled : cur.fronter_enabled,
    go_live: b.go_live !== undefined ? b.go_live : cur.go_live,
    recognize_on: b.recognize_on !== undefined ? b.recognize_on : cur.recognize_on,
    rate_currency: b.rate_currency !== undefined ? String(b.rate_currency).toUpperCase() : cur.rate_currency,
    updated_by: req.user.id,
    updated_at: new Date().toISOString(),
  };
  if (!isDay(row.go_live)) return res.status(400).json({ error: 'Pick the go-live date' });
  if (!['approved', 'dp_paid'].includes(row.recognize_on)) return res.status(400).json({ error: 'Unknown rule for when a sale counts' });
  if (!/^[A-Z]{3}$/.test(row.rate_currency)) return res.status(400).json({ error: 'The rate currency is a 3-letter code, e.g. USD' });
  // Changing WHEN a sale counts rewrites what is already booked -- say why.
  const rewrites = row.go_live !== cur.go_live || row.recognize_on !== cur.recognize_on || row.rate_currency !== cur.rate_currency;
  if (!cur.is_default && rewrites && (cur.closer_enabled || cur.fronter_enabled) && needReason(req, res, 'changing how sales are booked')) return;

  const { data, error } = await supabaseAdmin.from('revenue_settings').upsert(row, { onConflict: 'company_id' }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ settings: data });
}));

// -- Rate card ----------------------------------------------------------------------

function cleanRate(b, companyId) {
  const r = {
    kind: b.kind,
    client_name: b.client_name ? String(b.client_name).trim().slice(0, 200) : null,
    plan: b.plan ? String(b.plan).trim().slice(0, 200) : null,
    partner_company_id: b.partner_company_id || null,
    basis: b.basis,
    value: Number(b.value),
    effective_from: b.effective_from || '2026-06-01',
    note: b.note ? String(b.note).slice(0, 500) : null,
  };
  if (!['client', 'partner_cost', 'partner_income'].includes(r.kind)) return { error: 'Unknown kind of rate' };
  if (!['dp_percent', 'flat'].includes(r.basis)) return { error: 'A rate is a percent of the down payment or a flat amount' };
  if (!Number.isFinite(r.value) || r.value < 0) return { error: 'The rate must be zero or more' };
  if (r.basis === 'dp_percent' && r.value > 100) return { error: 'A percent of the down payment cannot be over 100' };
  if (!isDay(r.effective_from)) return { error: 'Pick the date the rate starts' };
  if (r.kind === 'client' && !r.client_name) return { error: 'Pick the client' };
  if (r.kind === 'partner_cost' && !r.partner_company_id) return { error: 'Pick the partner company' };
  if (r.partner_company_id === companyId) return { error: 'A company cannot be its own partner' };
  if (r.kind !== 'client') { r.client_name = null; r.plan = null; }
  return { rate: r };
}

router.post('/rates', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });
  if (await deny(req, res, companyId, 'accounting.settings.manage')) return;
  const c = cleanRate(req.body || {}, companyId);
  if (c.error) return res.status(400).json({ error: c.error });
  const { data, error } = await supabaseAdmin.from('revenue_rates')
    .insert({ ...c.rate, company_id: companyId, created_by: req.user.id }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ rate: data });
}));

router.put('/rates/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.settings.manage')) return;
  if (needReason(req, res, 'changing this rate')) return;
  const { data: existing } = await supabaseAdmin.from('revenue_rates').select('*').eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Rate not found' });
  const c = cleanRate({ ...existing, ...req.body }, companyId);
  if (c.error) return res.status(400).json({ error: c.error });
  const { data, error } = await supabaseAdmin.from('revenue_rates').update(c.rate).eq('id', existing.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ rate: data });
}));

router.delete('/rates/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.settings.manage')) return;
  if (needReason(req, res, 'removing this rate')) return;
  const { error } = await supabaseAdmin.from('revenue_rates').delete().eq('id', req.params.id).eq('company_id', companyId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

// -- Preview / run -------------------------------------------------------------------

// Dry run for BOTH sides, whatever the switches say -- "what would happen if
// I turned this on" is exactly the question before turning it on.
router.get('/preview', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ summary: null });
  if (!(await mayView(req, companyId))) return res.status(403).json({ error: 'Forbidden' });
  const plan = await planCompany(companyId, { sides: { closer: true, fronter: true } });
  const sample = plan.actions.slice(0, 25).map(a => ({
    op: a.op, event: a.event, sale_id: a.sale_id, date: a.date || null,
    amount: money(a.amount || 0), was: a.was !== undefined ? money(a.was) : undefined, entry_no: a.entry_no || null,
  }));
  res.json({
    summary: plan.summary, book_currency: plan.book_currency, rate_currency: plan.rate_currency,
    enabled: { closer: plan.settings.closer_enabled, fronter: plan.settings.fronter_enabled },
    sample, last_run_at: plan.settings.last_run_at || null, last_run: plan.settings.last_run_summary || null,
  });
}));

router.post('/run', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });
  if (await deny(req, res, companyId, 'accounting.settings.manage')) return;
  const s = await getSettings(companyId);
  if (!s.closer_enabled && !s.fronter_enabled) return res.status(409).json({ error: 'Switch on "Sales into the books" for this company first' });
  const userId = req.user.id;
  // Background: a first catch-up can be a few thousand entries.
  setImmediate(() => runCompany(companyId, { userId }).catch(() => {}));
  res.status(202).json({ started: true });
}));

// -- Client statement ----------------------------------------------------------------

router.get('/statement', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ rows: [] });
  if (!(await mayView(req, companyId))) return res.status(403).json({ error: 'Forbidden' });
  const client = String(req.query.client || '').trim();
  const month = String(req.query.month || '');
  if (!client) return res.status(400).json({ error: 'Pick a client' });
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Pick a month' });

  const settings = await getSettings(companyId);
  const [{ data: members }, { data: rates }] = await Promise.all([
    supabaseAdmin.from('user_company_roles').select('user_id').eq('company_id', companyId),
    supabaseAdmin.from('revenue_rates').select('*').eq('company_id', companyId).eq('kind', 'client'),
  ]);
  const ids = [...new Set((members || []).map(m => m.user_id))];
  const from = month + '-01';
  const to = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const rows = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabaseAdmin.from('sales')
      .select('id, reference_no, sale_date, client_name, plan, down_payment, status, payout_status, closer_disposition')
      .in('closer_id', ids.slice(i, i + 150)).ilike('client_name', client)
      .gte('sale_date', from).lte('sale_date', to).order('sale_date');
    if (error) return res.status(500).json({ error: error.message });
    for (const s of data || []) {
      if (!earnedState(s, settings.recognize_on).earned) continue;
      const rate = pickRate(rates || [], 'client', { client: s.client_name, plan: s.plan, onDay: s.sale_date });
      rows.push({
        sale_id: s.id, reference_no: s.reference_no, sale_date: s.sale_date, plan: s.plan,
        down_payment: Number(s.down_payment), dp_status: s.payout_status,
        amount: rate ? money(amountOf(rate, s.down_payment)) : null,
      });
    }
  }
  res.json({
    client, month, currency: settings.rate_currency, rows,
    total: money(rows.reduce((t, r) => t + Math.round((r.amount || 0) * 100), 0)),
    unpriced: rows.filter(r => r.amount === null).length,
  });
}));

module.exports = router;

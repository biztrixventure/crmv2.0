// ============================================================================
// /api/accounting/settings -- the money rules and exchange rates (mig 315).
//
//   GET    /rules            every automatic posting, in words, with the
//                            accounts it uses in this company
//   PUT    /rules/:event     pick different accounts (or switch it off)
//   DELETE /rules/:event     back to the default accounts
//   GET    /fx               exchange rates on file
//   POST   /fx               add a rate (currency, rate, from date)
//   DELETE /fx/:id           remove a rate (needs a reason)
//
// Reading needs the chart of accounts view; changing needs
// accounting.settings.manage (company_admin, or an accounting designation --
// can() covers both doors). Every change lands in the change record.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../../config/database');
const { asyncHandler } = require('../../middleware/errorHandler');
const { can, deny, readCompanyId, writeCompanyId } = require('../../utils/moduleAccess');
const { POSTING_EVENTS, postingRules, companyCurrency } = require('../../utils/ledger');
const { needReason } = require('../../utils/requestContext');

const router = express.Router();

// -- Money rules -------------------------------------------------------------------
router.get('/rules', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ rules: [], accounts: [] });
  if (await deny(req, res, companyId, 'accounting.accounts.view')) return;

  const [resolved, { data: accounts }] = await Promise.all([
    postingRules(companyId),
    supabaseAdmin.from('chart_of_accounts').select('id, code, name, account_type, is_active')
      .eq('company_id', companyId).order('code'),
  ]);
  const rules = Object.entries(POSTING_EVENTS).map(([key, spec]) => ({
    event_key: key,
    label: spec.label,
    debit: spec.debit ? { words: spec.debit.words, default_code: spec.debit.code, account: resolved[key]?.debit || null } : null,
    credit: spec.credit ? { words: spec.credit.words, default_code: spec.credit.code, account: resolved[key]?.credit || null } : null,
    enabled: resolved[key]?.enabled !== false,
    customised: !!resolved[key]?.customised,
  }));
  res.json({
    rules,
    accounts: accounts || [],
    currency: await companyCurrency(companyId),
    can_manage: await can(req, companyId, 'accounting.settings.manage'),
  });
}));

router.put('/rules/:event', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });
  if (await deny(req, res, companyId, 'accounting.settings.manage')) return;

  const key = req.params.event;
  const spec = POSTING_EVENTS[key];
  if (!spec) return res.status(404).json({ error: 'Unknown money rule' });

  const b = req.body || {};
  const ids = [b.debit_account_id, b.credit_account_id].filter(Boolean);
  if (ids.length) {
    const { data: found } = await supabaseAdmin.from('chart_of_accounts').select('id')
      .eq('company_id', companyId).in('id', ids);
    if ((found || []).length !== new Set(ids).size) {
      return res.status(400).json({ error: 'Pick accounts from this company\'s chart of accounts' });
    }
  }

  const row = {
    company_id: companyId,
    event_key: key,
    debit_account_id: spec.debit ? (b.debit_account_id || null) : null,
    credit_account_id: spec.credit ? (b.credit_account_id || null) : null,
    is_enabled: b.is_enabled === undefined ? true : !!b.is_enabled,
    updated_by: req.user.id,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabaseAdmin.from('accounting_posting_rules').upsert(row, { onConflict: 'company_id,event_key' });
  if (error) return res.status(500).json({ error: error.message });
  const resolved = (await postingRules(companyId, [key]))[key];
  res.json({ rule: { event_key: key, ...resolved } });
}));

router.delete('/rules/:event', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.settings.manage')) return;
  const { error } = await supabaseAdmin.from('accounting_posting_rules').delete()
    .eq('company_id', companyId).eq('event_key', req.params.event);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

// -- Exchange rates ------------------------------------------------------------------
router.get('/fx', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ rates: [] });
  if (await deny(req, res, companyId, 'accounting.accounts.view')) return;
  const { data, error } = await supabaseAdmin.from('fx_rates')
    .select('id, currency, rate, effective_from, note, created_by, created_at')
    .eq('company_id', companyId).order('currency').order('effective_from', { ascending: false }).limit(500);
  if (error) return res.status(500).json({ error: error.message });
  res.json({
    rates: data || [],
    currency: await companyCurrency(companyId),
    can_manage: await can(req, companyId, 'accounting.settings.manage'),
  });
}));

router.post('/fx', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });
  if (await deny(req, res, companyId, 'accounting.settings.manage')) return;

  const b = req.body || {};
  const currency = String(b.currency || '').trim().toUpperCase();
  const rate = Number(b.rate);
  const from = String(b.effective_from || '');
  const book = await companyCurrency(companyId);
  if (!/^[A-Z]{3}$/.test(currency)) return res.status(400).json({ error: 'Currency must be a 3-letter code, e.g. USD' });
  if (currency === book) return res.status(400).json({ error: book + ' is this company\'s own currency -- it needs no rate' });
  if (!(rate > 0)) return res.status(400).json({ error: 'The rate must be greater than zero' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return res.status(400).json({ error: 'Pick the date the rate applies from' });

  const { data, error } = await supabaseAdmin.from('fx_rates').insert({
    company_id: companyId, currency, rate, effective_from: from,
    note: b.note || null, created_by: req.user.id,
  }).select().single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'There is already a ' + currency + ' rate from ' + from + '. Remove it first to change it.' });
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json({ rate: data });
}));

// Removing a rate never changes what was already posted: every posted line
// kept the rate it used. It only changes future postings.
router.delete('/fx/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.settings.manage')) return;
  if (needReason(req, res, 'removing this exchange rate')) return;
  const { error } = await supabaseAdmin.from('fx_rates').delete().eq('id', req.params.id).eq('company_id', companyId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

module.exports = router;

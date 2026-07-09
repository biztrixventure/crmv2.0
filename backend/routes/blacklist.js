// ============================================================================
// routes/blacklist.js — DNC / litigation lookup proxy + settings.
//   GET  /blacklist/lookup/:phone   check one number (closer + compliance, gated)
//   GET  /blacklist/settings        superadmin: enabled + cache + key status
//   PUT  /blacklist/settings        superadmin: set enabled / cache / API key
// The API key never leaves the server; settings only ever return a masked tail.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');
const { getConfig, setConfig } = require('../utils/businessConfig');
const { isFeatureEnabled } = require('../utils/featureGate');
const bl = require('../utils/blacklist');

const router = express.Router();

// Bulk scan + report are a compliance/superadmin tool.
const canScan = async (req) =>
  req.user.role === 'superadmin' || req.user.role === 'compliance_manager' || await isSuperAdmin(req.user.id);

const VALID_VERSIONS = ['v1', 'v2', 'v3', 'v5'];
const maskedSettings = async () => {
  const key = await bl.getApiKey();
  const v = String(await getConfig(null, 'blacklist.version', 'v3'));
  return {
    enabled:    !!(await getConfig(null, 'blacklist.enabled', false)),
    cache_days: parseInt(await getConfig(null, 'blacklist.cache_days', 30), 10) || 30,
    version:    VALID_VERSIONS.includes(v) ? v : 'v3',
    has_key:    !!key,
    key_preview: key ? `••••${String(key).slice(-4)}` : null,
  };
};

// ── GET /lookup/:phone ───────────────────────────────────────────────────────
router.get('/lookup/:phone', asyncHandler(async (req, res) => {
  const sa = await isSuperAdmin(req.user.id);
  const enabled = sa || await isFeatureEnabled('tool_blacklist_lookup', req.user.company_id || null, req.user.id).catch(() => false);
  if (!enabled) return res.status(403).json({ error: 'Blacklist lookup is not enabled for you' });

  const r = await bl.lookup(req.params.phone, { force: sa && req.query.refresh === 'true' });
  if (!r.ok) {
    const code = /invalid phone/i.test(r.error) ? 422 : (/api key/i.test(r.error) ? 503 : 400);
    return res.status(code).json({ error: r.error });
  }
  res.json(r);
}));

// ── GET/PUT /settings (superadmin) ───────────────────────────────────────────
router.get('/settings', asyncHandler(async (req, res) => {
  if (!(await isSuperAdmin(req.user.id))) return res.status(403).json({ error: 'Superadmin only' });
  res.json(await maskedSettings());
}));

router.put('/settings', asyncHandler(async (req, res) => {
  if (!(await isSuperAdmin(req.user.id))) return res.status(403).json({ error: 'Superadmin only' });
  const b = req.body || {};
  if (b.enabled !== undefined)    await setConfig('global', 'blacklist.enabled', !!b.enabled, req.user.id);
  if (b.cache_days !== undefined) await setConfig('global', 'blacklist.cache_days', Math.max(1, Math.min(parseInt(b.cache_days, 10) || 30, 365)), req.user.id);
  if (b.version !== undefined && VALID_VERSIONS.includes(String(b.version))) await setConfig('global', 'blacklist.version', String(b.version), req.user.id);
  if (b.clear_key) {
    await bl.setApiKey('', req.user.id);
  } else if (typeof b.api_key === 'string' && b.api_key.trim()) {
    await bl.setApiKey(b.api_key.trim(), req.user.id);
    // Saving a key activates the feature unless the same request explicitly
    // disabled it — removes the "added the key but still off" foot-gun.
    if (b.enabled === undefined) await setConfig('global', 'blacklist.enabled', true, req.user.id);
  }
  res.json(await maskedSettings());
}));

// ── GET /scan/prepare — cost preview before a bulk scan ──────────────────────
router.get('/scan/prepare', asyncHandler(async (req, res) => {
  if (!(await canScan(req))) return res.status(403).json({ error: 'Compliance only' });
  const cfg = await bl.settings();
  if (!cfg.enabled) return res.status(400).json({ error: 'Enable the DNC lookup + set an API key first' });
  const { data, error } = await supabaseAdmin.rpc('app_sales_dnc_prepare', { p_cache_days: cfg.cacheDays });
  if (error) return res.status(500).json({ error: error.message });
  const row = Array.isArray(data) ? data[0] : data;
  res.json({ distinct_phones: Number(row?.distinct_phones || 0), to_check: Number(row?.to_check || 0), cache_days: cfg.cacheDays });
}));

// ── POST /scan/run — check the next batch of unchecked numbers ────────────────
// The frontend calls this repeatedly (with a small gap) until remaining hits 0.
router.post('/scan/run', asyncHandler(async (req, res) => {
  if (!(await canScan(req))) return res.status(403).json({ error: 'Compliance only' });
  const cfg = await bl.settings();
  if (!cfg.enabled) return res.status(400).json({ error: 'DNC lookup is turned off' });
  const batch = Math.min(Math.max(parseInt(req.body?.batch, 10) || 25, 1), 50);

  const { data: phones, error } = await supabaseAdmin.rpc('app_unchecked_sale_phones', { p_limit: batch, p_cache_days: cfg.cacheDays });
  if (error) return res.status(500).json({ error: error.message });
  const list = (phones || []).map(r => (typeof r === 'string' ? r : r.phone)).filter(Boolean);

  let checked = 0, blacklisted = 0, good = 0, failed = 0;
  // Gentle concurrency so we don't hammer the API; live calls only (these are
  // unchecked by definition, so the cache won't short-circuit them).
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(5, list.length || 1) }, async () => {
    while (i < list.length) {
      const p = list[i++];
      const r = await bl.lookup(p, { force: true });
      if (!r.ok) { failed++; continue; }
      checked++; r.blacklisted ? blacklisted++ : good++;
    }
  }));

  // What's left after this batch?
  const { data: prep } = await supabaseAdmin.rpc('app_sales_dnc_prepare', { p_cache_days: cfg.cacheDays });
  const remaining = Number((Array.isArray(prep) ? prep[0] : prep)?.to_check || 0);
  res.json({ batch_checked: checked, blacklisted, good, failed, remaining });
}));

// ── POST /bulk-check — check an ARBITRARY list of numbers (paste / file) ──────
// The frontend chunks a big list and calls this repeatedly for a live progress
// bar. `force:false` = cache-first (only fresh-checks numbers not seen recently);
// `force:true` = realtime (bypass cache, re-check every number). Either way each
// result is upserted into the shared cache, so it stays warm for everyone.
router.post('/bulk-check', asyncHandler(async (req, res) => {
  if (!(await canScan(req))) return res.status(403).json({ error: 'Compliance / superadmin only' });
  const cfg = await bl.settings();
  if (!cfg.enabled) return res.status(400).json({ error: 'Enable the DNC lookup + set an API key first' });

  const force = req.body?.force === true;
  const raw = Array.isArray(req.body?.phones) ? req.body.phones : [];
  // normalize + dedupe within this chunk (keep only valid 10-digit US numbers)
  const seen = new Set(); const phones = [];
  for (const x of raw) { const p = bl.norm(x); if (p.length === 10 && !seen.has(p)) { seen.add(p); phones.push(p); } }
  if (phones.length > 250) return res.status(400).json({ error: 'Max 250 numbers per request — send smaller chunks' });
  if (!phones.length) return res.json({ results: [], checked: 0, blacklisted: 0, good: 0, failed: 0, cached: 0, invalid: raw.length });

  const results = new Array(phones.length);
  let i = 0, blacklisted = 0, good = 0, failed = 0, cachedCount = 0;
  // Gentle concurrency so we don't hammer the DNC API.
  await Promise.all(Array.from({ length: Math.min(6, phones.length) }, async () => {
    while (i < phones.length) {
      const idx = i++; const p = phones[idx];
      const r = await bl.lookup(p, { force });
      if (!r.ok) { failed++; results[idx] = { phone: p, ok: false, error: r.error }; continue; }
      if (r.cached) cachedCount++;
      r.blacklisted ? blacklisted++ : good++;
      results[idx] = {
        phone: p, ok: true, blacklisted: r.blacklisted, message: r.message,
        codes: r.codes || [], wireless: !!r.wireless, carrier: r.carrier || null,
        cached: !!r.cached, checked_at: r.checked_at,
      };
    }
  }));
  res.json({ results, checked: blacklisted + good, blacklisted, good, failed, cached: cachedCount, invalid: raw.length - phones.length });
}));

// ── GET /report/summary — counts by verdict ──────────────────────────────────
router.get('/report/summary', asyncHandler(async (req, res) => {
  if (!(await canScan(req))) return res.status(403).json({ error: 'Compliance only' });
  const { data, error } = await supabaseAdmin.rpc('app_sales_dnc_summary');
  if (error) return res.status(500).json({ error: error.message });
  const out = { good: { sales: 0, phones: 0 }, blacklisted: { sales: 0, phones: 0 }, unchecked: { sales: 0, phones: 0 } };
  (data || []).forEach(r => { if (out[r.dnc_status]) out[r.dnc_status] = { sales: Number(r.sales), phones: Number(r.phones) }; });
  res.json(out);
}));

// ── GET /report/sales — sales joined with their DNC verdict (filter + page) ───
router.get('/report/sales', asyncHandler(async (req, res) => {
  if (!(await canScan(req))) return res.status(403).json({ error: 'Compliance only' });
  const status = ['good', 'blacklisted', 'unchecked'].includes(req.query.status) ? req.query.status : null;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 1000);
  const offset = (page - 1) * limit;

  let q = supabaseAdmin.from('v_sales_dnc')
    .select('id, customer_name, customer_phone, reference_no, plan, client_name, status, sale_date, company_id, closer_id, dnc_status, dnc_message, dnc_codes', { count: 'exact' })
    .order('sale_date', { ascending: false });
  if (status) q = q.eq('dnc_status', status);
  if (req.query.company_id) q = q.eq('company_id', req.query.company_id);
  q = q.range(offset, offset + limit - 1);

  const { data, error, count } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ sales: data || [], total: count || 0, page, limit });
}));

module.exports = router;

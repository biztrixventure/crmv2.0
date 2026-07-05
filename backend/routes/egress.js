// ============================================================================
// /egress — data-egress governance admin API (superadmin) + a lightweight
// client pre-check any authed user can call for a fast "you're near your limit"
// UX warning (the server middleware/route is the real gate).
//
//   GET   /egress/audit            — paginated audit browser (page-1 count)
//   GET   /egress/audit/meta       — distinct action types + datasets (filters)
//   GET   /egress/limits           — all egress_limits rows
//   PUT   /egress/limits           — upsert one limit row
//   DELETE/egress/limits/:id       — delete a limit row
//   GET   /egress/columns          — export.columns for a dataset+role
//   PUT   /egress/columns          — set export.columns.<dataset>.<role>
//   GET   /egress/list-layout      — list.layout for a shell+role
//   PUT   /egress/list-layout      — set list.layout.<shell>.<role>
//   GET   /egress/my-usage         — caller's own limits + today's usage (client pre-check)
//
// Schema: migration 167. Config keys live in business_config.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');
const { setConfig, getConfig, clearConfigCache } = require('../utils/businessConfig');
const { resolveEgressLimits, usageToday } = require('../utils/egressGuard');

const router = express.Router();

const superOnly = asyncHandler(async (req, res, next) => {
  if (await isSuperAdmin(req.user.id)) return next();
  return res.status(403).json({ error: 'Superadmin only' });
});

// ── audit browser ─────────────────────────────────────────────────────────────
router.get('/audit', superOnly, asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const page  = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const offset = (page - 1) * limit;
  // page-1-only exact count (perf) — later pages keep the client's page-1 total.
  const wantCount = offset === 0 ? 'exact' : undefined;

  let q = supabaseAdmin.from('export_audit_log')
    .select('*', { count: wantCount })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (req.query.user_id)     q = q.eq('user_id', req.query.user_id);
  if (req.query.action_type) q = q.eq('action_type', req.query.action_type);
  if (req.query.dataset)     q = q.eq('dataset', req.query.dataset);
  if (req.query.status && ['allowed', 'denied'].includes(req.query.status)) q = q.eq('status', req.query.status);
  if (req.query.company_id)  q = q.eq('company_id', req.query.company_id);
  if (req.query.date_from)   q = q.gte('created_at', req.query.date_from);
  if (req.query.date_to)     q = q.lte('created_at', `${req.query.date_to}T23:59:59.999Z`);

  const { data, error, count } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // hydrate actor names (batched) — same pattern as /audit route
  const ids = [...new Set((data || []).map(r => r.user_id).filter(Boolean))];
  let names = {};
  if (ids.length) {
    const { data: profs } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', ids);
    names = Object.fromEntries((profs || []).map(p => [p.user_id, `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.user_id]));
    // portal clients aren't in user_profiles — fall back to portal_clients
    const missing = ids.filter(id => !names[id]);
    if (missing.length) {
      const { data: pcs } = await supabaseAdmin.from('portal_clients').select('auth_user_id, name').in('auth_user_id', missing);
      (pcs || []).forEach(pc => { names[pc.auth_user_id] = `${pc.name} (portal)`; });
    }
  }
  res.json({
    logs: (data || []).map(r => ({ ...r, actor_name: r.user_id ? (names[r.user_id] || r.user_id) : 'System' })),
    total: offset === 0 ? (count || 0) : null, page, limit,
  });
}));

// today's headline counts for the audit summary tiles
router.get('/audit/stats', superOnly, asyncHandler(async (req, res) => {
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const count = async (extra) => {
    let q = supabaseAdmin.from('export_audit_log').select('id', { count: 'exact', head: true }).gte('created_at', startOfDay.toISOString());
    for (const [k, v] of Object.entries(extra)) q = q.eq(k, v);
    const { count: c } = await q; return c || 0;
  };
  const [exportsAllowed, denied, recordings, distinctUsers] = await Promise.all([
    count({ action_type: 'csv_export', status: 'allowed' }),
    count({ status: 'denied' }),
    count({ action_type: 'recording_listen', status: 'allowed' }),
    supabaseAdmin.from('export_audit_log').select('user_id').gte('created_at', startOfDay.toISOString()).limit(5000)
      .then(r => new Set((r.data || []).map(x => x.user_id).filter(Boolean)).size),
  ]);
  res.json({ today: { exports: exportsAllowed, denied, recordings, users: distinctUsers } });
}));

router.get('/audit/meta', superOnly, asyncHandler(async (req, res) => {
  // distinct action_types + datasets for the filter dropdowns (bounded scan)
  const { data } = await supabaseAdmin.from('export_audit_log').select('action_type, dataset').limit(5000);
  const actions = [...new Set((data || []).map(r => r.action_type).filter(Boolean))].sort();
  const datasets = [...new Set((data || []).map(r => r.dataset).filter(Boolean))].sort();
  res.json({ actions, datasets });
}));

// ── numeric limits CRUD ───────────────────────────────────────────────────────
router.get('/limits', superOnly, asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin.from('egress_limits')
    .select('*').order('scope_type', { ascending: true }).order('scope_id', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  // decorate user/company scope rows with a readable name
  const userIds = (data || []).filter(r => r.scope_type === 'user').map(r => r.scope_id);
  const coIds   = (data || []).filter(r => r.scope_type === 'company').map(r => r.scope_id);
  let uName = {}, cName = {};
  if (userIds.length) { const { data: p } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', userIds); uName = Object.fromEntries((p || []).map(x => [x.user_id, `${x.first_name || ''} ${x.last_name || ''}`.trim()])); }
  if (coIds.length)   { const { data: c } = await supabaseAdmin.from('companies').select('id, name').in('id', coIds); cName = Object.fromEntries((c || []).map(x => [x.id, x.name])); }
  res.json({ limits: (data || []).map(r => ({ ...r, scope_name: r.scope_type === 'user' ? (uName[r.scope_id] || r.scope_id) : r.scope_type === 'company' ? (cName[r.scope_id] || r.scope_id) : r.scope_id })) });
}));

const intOrNull = (v) => (v === '' || v == null) ? null : (Number.isFinite(+v) && +v >= 0 ? Math.floor(+v) : null);
router.put('/limits', superOnly, asyncHandler(async (req, res) => {
  const { scope_type, scope_id, action_type } = req.body || {};
  if (!['role', 'company', 'user'].includes(scope_type) || !scope_id || !action_type) {
    return res.status(400).json({ error: 'scope_type, scope_id, action_type are required' });
  }
  const row = {
    scope_type, scope_id: String(scope_id), action_type: String(action_type),
    max_rows_per_export:           intOrNull(req.body.max_rows_per_export),
    max_exports_per_day:           intOrNull(req.body.max_exports_per_day),
    max_recording_minutes_per_day: intOrNull(req.body.max_recording_minutes_per_day),
    updated_by: req.user.id, updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabaseAdmin.from('egress_limits')
    .upsert(row, { onConflict: 'scope_type,scope_id,action_type' }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ limit: data });
}));

router.delete('/limits/:id', superOnly, asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from('egress_limits').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

// ── export.columns config ─────────────────────────────────────────────────────
router.get('/columns', superOnly, asyncHandler(async (req, res) => {
  const { dataset, role } = req.query;
  if (!dataset || !role) return res.status(400).json({ error: 'dataset and role are required' });
  const v = await getConfig(null, `export.columns.${dataset}.${role}`, null);
  res.json({ columns: Array.isArray(v) ? v : null });   // null = all (unconfigured)
}));
router.put('/columns', superOnly, asyncHandler(async (req, res) => {
  const { dataset, role } = req.body || {};
  const columns = Array.isArray(req.body.columns) ? req.body.columns.map(String) : null;
  if (!dataset || !role) return res.status(400).json({ error: 'dataset and role are required' });
  await setConfig('global', `export.columns.${dataset}.${role}`, columns, req.user.id);
  clearConfigCache();
  res.json({ ok: true, columns });
}));

// ── list.layout config ────────────────────────────────────────────────────────
// READ is open to any authenticated user — every shell's useListLayout hook loads
// its list display config on mount (page size / default view). Only the PUT is
// superadmin-gated. (Was superOnly → 403 console error for every non-super role.)
router.get('/list-layout', asyncHandler(async (req, res) => {
  const { shell, role } = req.query;
  if (!shell || !role) return res.status(400).json({ error: 'shell and role are required' });
  const v = await getConfig(null, `list.layout.${shell}.${role}`, null);
  res.json({ layout: (v && typeof v === 'object') ? v : null });
}));
router.put('/list-layout', superOnly, asyncHandler(async (req, res) => {
  const { shell, role, layout } = req.body || {};
  if (!shell || !role || !layout || typeof layout !== 'object') return res.status(400).json({ error: 'shell, role, layout are required' });
  const clean = {
    page_size: intOrNull(layout.page_size) || undefined,
    visible_columns: Array.isArray(layout.visible_columns) ? layout.visible_columns.map(String) : undefined,
    default_view: ['expanded', 'collapsed'].includes(layout.default_view) ? layout.default_view : undefined,
  };
  await setConfig('global', `list.layout.${shell}.${role}`, clean, req.user.id);
  clearConfigCache();
  res.json({ ok: true, layout: clean });
}));

// ── client-reported export log (SOFT audit for in-memory exports that don't
// drain a list endpoint — NumbersIntelligence, CustomerProfile). row_count is
// client-supplied so this is an audit record, NOT a hard gate; it still checks
// the daily-export cap so those surfaces aren't a total bypass. Any authed user.
router.post('/client-log', asyncHandler(async (req, res) => {
  const dataset = String(req.body.dataset || 'unknown').slice(0, 60);
  const rowCount = Number.isFinite(+req.body.row_count) ? Math.max(0, Math.floor(+req.body.row_count)) : null;
  const { enforceEgress } = require('../utils/egressGuard');
  const decision = await enforceEgress({
    user: req.user, actionType: 'csv_export', dataset,
    surface: `client:${dataset}`, rowCount, filters: req.body.filters || null,
  });
  if (!decision.allowed) return res.status(429).json({ error: decision.message, code: 'EGRESS_LIMIT', limit: decision.limit });
  res.json({ ok: true });
}));

// ── client pre-check: my effective limits + today's usage (any authed user) ────
router.get('/my-usage', asyncHandler(async (req, res) => {
  const action = ['csv_export', 'recording_listen'].includes(req.query.action_type) ? req.query.action_type : 'csv_export';
  const [limits, used] = await Promise.all([
    resolveEgressLimits({ userId: req.user.id, companyId: req.user.company_id, role: req.user.role, actionType: action }),
    usageToday({ userId: req.user.id, actionType: action }),
  ]);
  res.json({ action_type: action, limits, used });
}));

module.exports = router;

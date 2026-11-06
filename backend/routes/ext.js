// ============================================================================
// routes/ext.js -- the machine API for other apps: /api/ext/v1 (mig 348).
//
// NOT behind the user authMiddleware. Every request carries an integration
// key (middleware/integrationKey.js); each route names the scope it needs.
// Read-only except POST /metrics. Docs: docs/CONNECTIONS.md.
//
//   GET  /me          the calling key: name, scopes, companies
//   GET  /companies   companies.read
//   GET  /agents      agents.read
//   GET  /sales       sales.read        (+ sales.read_pii adds customer name/phone)
//   GET  /transfers   transfers.read    (+ transfers.read_pii adds form_data)
//   POST /metrics     metrics.write
//
// Paging: ?limit= (max 1000, default 100) and either ?cursor= (the
// next_cursor of the previous page; stable while rows are being written) or
// ?offset=. Every list answers { data, has_more, next_cursor }.
// Filters: ?company=<uuid>[,<uuid>], ?from= / ?to= (YYYY-MM-DD or ISO),
// ?updated_since= (ISO). A key limited to some companies only ever sees those.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../config/database');
const logger = require('../utils/logger');
const { requireScope, scopedCompanies } = require('../middleware/integrationKey');
const {
  hasScope, parsePaging, parseTime, encodeCursor, badRequest, upper, isMissingTable, NOT_READY,
} = require('../utils/integrations');
const {
  SALE_COLS, SALE_PII_COLS, TRANSFER_COLS, TRANSFER_PII_COLS, shapeSales, shapeTransfers, companyMap, inChunks,
} = require('../utils/extData');

const router = express.Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR_VALUE = /^[0-9A-Za-z:.+\- ]{1,40}$/;

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  const status = e.status || 500;
  if (status >= 500) logger.warn('EXT_API', `${req.method} ${req.originalUrl}: ${e.message}`);
  res.status(status).json({ error: status >= 500 ? 'Request failed' : e.message, ...(status >= 500 ? { detail: e.message } : {}) });
});

function companiesOr400(req) {
  const c = scopedCompanies(req, req.query.company);
  if (c.error) throw Object.assign(new Error(c.message), { status: c.error });
  return c.ids;
}

/** end of a ?to= day, inclusive, in UTC */
const endOf = (t) => (t && t.length === 10 ? `${t}T23:59:59.999Z` : t);

/**
 * Keyset page over (sortCol, id). `build()` returns a fresh filtered query.
 * The cursor carries the column so it cannot be replayed against another sort.
 */
async function keysetPage(build, sortCol, paging) {
  let q = build().order(sortCol, { ascending: true }).order('id', { ascending: true });
  const { limit, offset, cursor } = paging;
  if (cursor) {
    if (cursor.c !== sortCol || !CURSOR_VALUE.test(String(cursor.v || '')) || !UUID.test(String(cursor.id || ''))) {
      throw badRequest('cursor does not belong to this query');
    }
    q = q.or(`${sortCol}.gt."${cursor.v}",and(${sortCol}.eq."${cursor.v}",id.gt.${cursor.id})`);
    q = q.limit(limit + 1);
  } else if (offset != null) {
    q = q.range(offset, offset + limit);
  } else {
    q = q.limit(limit + 1);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = data || [];
  const has_more = rows.length > limit;
  const page = has_more ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    rows: page,
    has_more,
    next_cursor: has_more && last && last[sortCol] ? encodeCursor({ c: sortCol, v: last[sortCol], id: last.id }) : null,
    next_offset: has_more && offset != null ? offset + limit : undefined,
  };
}

// -- GET /me -------------------------------------------------------------------
router.get('/me', wrap(async (req, res) => {
  const k = req.integration;
  let companies = null;
  if (k.company_ids) {
    const map = await companyMap();
    companies = k.company_ids.map((id) => map.get(id) || { id, name: null, slug: null });
  }
  res.json({ id: k.id, name: k.name, key_prefix: k.key_prefix, scopes: k.scopes, companies, all_companies: !k.company_ids });
}));

// -- GET /companies -----------------------------------------------------------
router.get('/companies', requireScope('companies.read'), wrap(async (req, res) => {
  const ids = companiesOr400(req);
  const { limit, offset } = parsePaging(req.query);
  const from = offset || 0;
  let q = supabaseAdmin.from('companies').select('id, name, slug, company_type, is_active').order('name').order('id');
  if (ids) q = q.in('id', ids);
  const { data, error } = await q.range(from, from + limit);
  if (error) throw new Error(error.message);
  const rows = data || [];
  const has_more = rows.length > limit;
  res.json({ data: rows.slice(0, limit), has_more, next_offset: has_more ? from + limit : null, next_cursor: null });
}));

// -- GET /agents --------------------------------------------------------------
// Everyone holding a membership (user_company_roles) in a company this key may
// read. Paged over user_id. ?include=email adds the login email (one auth
// lookup per person, so only on request, and limit is capped at 200 then).
router.get('/agents', requireScope('agents.read'), wrap(async (req, res) => {
  const ids = companiesOr400(req);
  const paging = parsePaging(req.query);
  const withEmail = String(req.query.include || '').split(',').includes('email');
  const limit = withEmail ? Math.min(paging.limit, 200) : paging.limit;

  const memberships = [];
  for (let from = 0; ; from += 1000) {
    let q = supabaseAdmin.from('user_company_roles')
      .select('user_id, company_id, is_active, custom_roles(name, level)')
      .order('user_id').order('company_id');
    if (ids) q = q.in('company_id', ids);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(error.message);
    memberships.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const byUser = new Map();
  for (const m of memberships) {
    if (!byUser.has(m.user_id)) byUser.set(m.user_id, []);
    byUser.get(m.user_id).push(m);
  }
  let userIds = [...byUser.keys()].sort();
  if (paging.cursor) {
    if (!UUID.test(String(paging.cursor.u || ''))) throw badRequest('cursor does not belong to this query');
    userIds = userIds.filter((u) => u > paging.cursor.u);
  } else if (paging.offset != null) {
    userIds = userIds.slice(paging.offset);
  }
  const has_more = userIds.length > limit;
  const pageIds = userIds.slice(0, limit);

  const profiles = await inChunks(pageIds, async (part) => {
    const { data, error } = await supabaseAdmin.from('user_profiles')
      .select('user_id, first_name, last_name, vicidial_agent_ids').in('user_id', part);
    if (error) throw new Error(error.message);
    return data || [];
  });
  const prof = new Map(profiles.map((p) => [p.user_id, p]));
  const companies = await companyMap();

  const emails = new Map();
  if (withEmail && pageIds.length) {
    for (let i = 0; i < pageIds.length; i += 20) {
      const part = pageIds.slice(i, i + 20);
      const got = await Promise.allSettled(part.map((u) => supabaseAdmin.auth.admin.getUserById(u)));
      got.forEach((r, j) => { if (r.status === 'fulfilled' && r.value?.data?.user?.email) emails.set(part[j], r.value.data.user.email); });
    }
  }

  const data = pageIds.map((u) => {
    const p = prof.get(u) || {};
    const ms = byUser.get(u) || [];
    const out = {
      user_id: u,
      name: [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
      first_name: p.first_name || null,
      last_name: p.last_name || null,
      vicidial_agent_ids: [...new Set((p.vicidial_agent_ids || []).map(upper).filter(Boolean))],
      companies: ms.map((m) => ({
        company_id: m.company_id,
        company_name: companies.get(m.company_id)?.name || null,
        role: m.custom_roles?.name || null,
        role_level: m.custom_roles?.level || null,
        is_active: m.is_active !== false,
      })),
      is_active: ms.some((m) => m.is_active !== false),
    };
    if (withEmail) out.email = emails.get(u) || null;
    return out;
  });
  const last = pageIds[pageIds.length - 1];
  res.json({
    data,
    has_more,
    next_cursor: has_more && last ? encodeCursor({ u: last }) : null,
    ...(paging.offset != null && !paging.cursor ? { next_offset: has_more ? paging.offset + limit : null } : {}),
  });
}));

// -- GET /sales ---------------------------------------------------------------
// ?from/?to filter sale_date. ?updated_since pages by updated_at (use it to
// sync changes); otherwise pages by created_at. ?status=closed_won[,..].
router.get('/sales', requireScope('sales.read'), wrap(async (req, res) => {
  const ids = companiesOr400(req);
  const paging = parsePaging(req.query);
  const from = parseTime(req.query.from, 'from');
  const to = parseTime(req.query.to, 'to');
  const updatedSince = parseTime(req.query.updated_since, 'updated_since');
  const statuses = req.query.status ? String(req.query.status).split(',').map((s) => s.trim()).filter(Boolean) : null;
  const pii = hasScope(req.integration.scopes, 'sales.read_pii');
  const cols = pii ? `${SALE_COLS}, ${SALE_PII_COLS}` : SALE_COLS;
  const sortCol = updatedSince ? 'updated_at' : 'created_at';

  const page = await keysetPage(() => {
    let q = supabaseAdmin.from('sales').select(cols);
    if (ids) q = q.in('company_id', ids);
    if (from) q = q.gte('sale_date', from.slice(0, 10));
    if (to) q = q.lte('sale_date', to.slice(0, 10));
    if (updatedSince) q = q.gte('updated_at', updatedSince);
    if (statuses) q = q.in('status', statuses);
    return q;
  }, sortCol, paging);

  res.json({ data: await shapeSales(page.rows, { pii }), has_more: page.has_more, next_cursor: page.next_cursor,
    ...(page.next_offset !== undefined ? { next_offset: page.next_offset } : {}) });
}));

// -- GET /transfers -----------------------------------------------------------
// ?from/?to filter created_at (UTC; a bare day means the whole day).
router.get('/transfers', requireScope('transfers.read'), wrap(async (req, res) => {
  const ids = companiesOr400(req);
  const paging = parsePaging(req.query);
  const from = parseTime(req.query.from, 'from');
  const to = parseTime(req.query.to, 'to');
  const updatedSince = parseTime(req.query.updated_since, 'updated_since');
  const pii = hasScope(req.integration.scopes, 'transfers.read_pii');
  const cols = pii ? `${TRANSFER_COLS}, ${TRANSFER_PII_COLS}` : TRANSFER_COLS;
  const sortCol = updatedSince ? 'updated_at' : 'created_at';

  const page = await keysetPage(() => {
    let q = supabaseAdmin.from('transfers').select(cols);
    if (ids) q = q.in('company_id', ids);
    if (from) q = q.gte('created_at', from);
    if (to) q = q.lte('created_at', endOf(to));
    if (updatedSince) q = q.gte('updated_at', updatedSince);
    return q;
  }, sortCol, paging);

  res.json({ data: await shapeTransfers(page.rows, { pii }), has_more: page.has_more, next_cursor: page.next_cursor,
    ...(page.next_offset !== undefined ? { next_offset: page.next_offset } : {}) });
}));

// -- POST /metrics ------------------------------------------------------------
// { source, items: [{ agent, metric, period, value, unit?, details? }] }, max
// 5000. Upserted on (source, agent, metric, period): send the whole period
// again and it is simply replaced. agent = VICIdial user (any case).
const MAX_ITEMS = 5000;
const PERIOD = /^\d{4}-\d{2}(-\d{2})?$/;
const NAME = /^[A-Za-z0-9_.:-]{1,64}$/;

let _agentMap = { at: 0, map: null };
/** VICIDIAL ID -> user_id (every profile, cached 5 min). */
async function agentMap() {
  if (_agentMap.map && Date.now() - _agentMap.at < 5 * 60_000) return _agentMap.map;
  const map = new Map();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin.from('user_profiles')
      .select('user_id, vicidial_agent_ids').order('user_id').range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const p of data || []) {
      for (const a of p.vicidial_agent_ids || []) {
        const k = upper(a);
        if (k && !map.has(k)) map.set(k, p.user_id);
      }
    }
    if (!data || data.length < 1000) break;
  }
  _agentMap = { at: Date.now(), map };
  return map;
}

router.post('/metrics', requireScope('metrics.write'), wrap(async (req, res) => {
  const { source, items } = req.body || {};
  if (typeof source !== 'string' || !NAME.test(source)) throw badRequest('source is required (letters, digits, _ . : -, max 64)');
  if (!Array.isArray(items)) throw badRequest('items must be an array');
  if (items.length > MAX_ITEMS) throw badRequest(`at most ${MAX_ITEMS} items per call`);

  const errors = [];
  const rows = new Map();   // dedupe: last one wins (an upsert cannot touch a row twice)
  items.forEach((it, i) => {
    const agent = upper(it && typeof it.agent === 'string' ? it.agent : null);
    const value = it && it.value === null ? null : Number(it && it.value);
    if (!agent || agent.length > 64) return errors.push({ index: i, error: 'agent is required' });
    if (!it.metric || !NAME.test(String(it.metric))) return errors.push({ index: i, error: 'metric is required (letters, digits, _ . : -, max 64)' });
    if (!PERIOD.test(String(it.period || ''))) return errors.push({ index: i, error: 'period must be YYYY-MM or YYYY-MM-DD' });
    if (value !== null && !Number.isFinite(value)) return errors.push({ index: i, error: 'value must be a number' });
    if (it.details != null && (typeof it.details !== 'object' || Array.isArray(it.details))) return errors.push({ index: i, error: 'details must be an object' });
    rows.set(`${agent}|${it.metric}|${it.period}`, {
      source, agent, metric: String(it.metric), period: String(it.period), value,
      unit: it.unit == null ? null : String(it.unit).slice(0, 32),
      details: it.details ?? null,
    });
  });

  const map = await agentMap();
  const resolvedUsers = [...new Set([...rows.values()].map((r) => map.get(r.agent)).filter(Boolean))];

  // Company of each person, inside what this key may touch.
  const allowed = req.integration.company_ids;
  const companyOf = new Map();
  if (resolvedUsers.length) {
    const ms = await inChunks(resolvedUsers, async (part) => {
      const { data, error } = await supabaseAdmin.from('user_company_roles')
        .select('user_id, company_id, is_active').in('user_id', part);
      if (error) throw new Error(error.message);
      return data || [];
    });
    for (const m of ms.sort((a, b) => Number(b.is_active !== false) - Number(a.is_active !== false))) {
      if (allowed && !allowed.includes(m.company_id)) continue;
      if (!companyOf.has(m.user_id)) companyOf.set(m.user_id, m.company_id);
    }
  }

  const unknown = new Set();
  const rejected = new Set();
  const out = [];
  const now = new Date().toISOString();
  for (const r of rows.values()) {
    const userId = map.get(r.agent) || null;
    let companyId = userId ? companyOf.get(userId) || null : null;
    if (!userId) {
      unknown.add(r.agent);
      companyId = allowed && allowed.length === 1 ? allowed[0] : null;
    } else if (allowed && !companyId) {
      rejected.add(r.agent);   // a known person outside this key's companies
      continue;
    }
    out.push({ ...r, user_id: userId, company_id: companyId, updated_at: now });
  }

  let saved = 0;
  for (let i = 0; i < out.length; i += 500) {
    const part = out.slice(i, i + 500);
    const { error } = await supabaseAdmin.from('external_metrics').upsert(part, { onConflict: 'source,agent,metric,period' });
    if (error) {
      if (isMissingTable(error)) return res.status(503).json({ error: NOT_READY });
      throw new Error(error.message);
    }
    saved += part.length;
  }

  res.json({
    received: items.length,
    saved,
    unknown: [...unknown].sort(),
    ...(rejected.size ? { rejected: [...rejected].sort() } : {}),
    ...(errors.length ? { errors: errors.slice(0, 100) } : {}),
  });
}));

router.use((req, res) => res.status(404).json({ error: 'Not found', docs: 'docs/CONNECTIONS.md' }));

module.exports = router;

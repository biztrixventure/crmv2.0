// ============================================================================
// Client recording portal
//   /admin/*  — superadmin manages client logins + sees the listen audit
//   (rest)    — the client login itself: see assigned closers' sales + play the
//               actual sale-call recording (streamed/proxied, source hidden,
//               nothing stored). Mounted at /api/portal in server.js.
// ============================================================================
const express = require('express');
const axios = require('axios');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { authMiddleware } = require('../middleware/authMiddleware');
const { isSuperAdmin } = require('../models/helpers');
const { findSaleRecording } = require('../utils/dialerBoxes');
const logger = require('../utils/logger');

const router = express.Router();

// bounded-concurrency map (don't fan out hundreds of dialer calls at once)
async function mapLimit(arr, limit, fn) {
  const out = new Array(arr.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, arr.length || 1) }, async () => {
    while (i < arr.length) { const idx = i++; out[idx] = await fn(arr[idx], idx); }
  }));
  return out;
}

const fullName = p => `${p?.first_name || ''} ${p?.last_name || ''}`.trim();
const clientIp = req => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || null;

// chunked .in() to dodge URL-length limits
async function fetchIn(table, select, col, values) {
  const vals = [...new Set(values.filter(Boolean))];
  const out = [];
  for (let i = 0; i < vals.length; i += 200) {
    const { data } = await supabaseAdmin.from(table).select(select).in(col, vals.slice(i, i + 200));
    if (data) out.push(...data);
  }
  return out;
}

// ── middleware ──────────────────────────────────────────────────────────────
const superOnly = asyncHandler(async (req, res, next) => {
  if (!(await isSuperAdmin(req.user.id))) return res.status(403).json({ error: 'Superadmin only' });
  next();
});

// Resolve + verify the caller is an ACTIVE portal client → req.portalClient.
const requirePortalClient = asyncHandler(async (req, res, next) => {
  const { data: pc } = await supabaseAdmin
    .from('portal_clients')
    .select('id, name, closer_ids, is_active')
    .eq('auth_user_id', req.user.id)
    .maybeSingle();
  if (!pc || !pc.is_active) return res.status(403).json({ error: 'Not a portal client' });
  req.portalClient = pc;
  next();
});

// ════════════════════════════════════════════════════════════════════════════
// ADMIN (superadmin)
// ════════════════════════════════════════════════════════════════════════════

// closers available to assign
router.get('/admin/closers', authMiddleware, superOnly, asyncHandler(async (req, res) => {
  const { data: roles } = await supabaseAdmin
    .from('user_company_roles')
    .select('user_id, custom_roles!inner(level)')
    .eq('is_active', true)
    .in('custom_roles.level', ['closer', 'closer_manager']);
  const ids = [...new Set((roles || []).map(r => r.user_id))];
  const profs = await fetchIn('user_profiles', 'user_id, first_name, last_name', 'user_id', ids);
  const closers = profs
    .map(p => ({ id: p.user_id, name: fullName(p) || '(unnamed)' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json({ closers });
}));

// list client logins (+ assigned closer names + listen count)
router.get('/admin/clients', authMiddleware, superOnly, asyncHandler(async (req, res) => {
  const { data: clients } = await supabaseAdmin
    .from('portal_clients')
    .select('*')
    .order('created_at', { ascending: false });
  const allCloserIds = [...new Set((clients || []).flatMap(c => c.closer_ids || []))];
  const profs = await fetchIn('user_profiles', 'user_id, first_name, last_name', 'user_id', allCloserIds);
  const nameOf = id => { const p = profs.find(x => x.user_id === id); return p ? (fullName(p) || '(unnamed)') : id; };

  const out = [];
  for (const c of (clients || [])) {
    const { count } = await supabaseAdmin
      .from('portal_listens').select('id', { count: 'exact', head: true })
      .eq('portal_client_id', c.id);
    out.push({
      id: c.id, name: c.name, login_email: c.login_email, is_active: c.is_active,
      closer_ids: c.closer_ids || [], closers: (c.closer_ids || []).map(id => ({ id, name: nameOf(id) })),
      listen_count: count || 0, created_at: c.created_at,
    });
  }
  res.json({ clients: out });
}));

// create a client login
router.post('/admin/clients', authMiddleware, superOnly, asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const closerIds = Array.isArray(req.body.closer_ids) ? req.body.closer_ids.filter(Boolean) : [];
  if (!name || !email || password.length < 6) return res.status(400).json({ error: 'name, email and a 6+ char password are required' });
  if (!closerIds.length) return res.status(400).json({ error: 'Assign at least one closer' });

  const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email, password, email_confirm: true, app_metadata: { portal_client: true },
  });
  if (authErr || !authData?.user) return res.status(400).json({ error: authErr?.message || 'Could not create login' });

  const { data: row, error: insErr } = await supabaseAdmin.from('portal_clients').insert({
    auth_user_id: authData.user.id, name, login_email: email, closer_ids: closerIds, created_by: req.user.id,
  }).select().single();
  if (insErr) { await supabaseAdmin.auth.admin.deleteUser(authData.user.id).catch(() => {}); return res.status(500).json({ error: insErr.message }); }

  logger.success('PORTAL', `client created: ${email} (${closerIds.length} closers)`);
  res.json({ client: row });
}));

// update (name / closers / active / optional new password)
router.patch('/admin/clients/:id', authMiddleware, superOnly, asyncHandler(async (req, res) => {
  const { data: pc } = await supabaseAdmin.from('portal_clients').select('*').eq('id', req.params.id).maybeSingle();
  if (!pc) return res.status(404).json({ error: 'Not found' });

  const patch = { updated_at: new Date().toISOString() };
  if (req.body.name !== undefined) patch.name = String(req.body.name).trim();
  if (Array.isArray(req.body.closer_ids)) patch.closer_ids = req.body.closer_ids.filter(Boolean);
  if (req.body.is_active !== undefined) patch.is_active = !!req.body.is_active;

  if (req.body.password) {
    if (String(req.body.password).length < 6) return res.status(400).json({ error: 'Password must be 6+ chars' });
    await supabaseAdmin.auth.admin.updateUserById(pc.auth_user_id, { password: String(req.body.password) }).catch(() => {});
  }

  const { data: row, error } = await supabaseAdmin.from('portal_clients').update(patch).eq('id', pc.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ client: row });
}));

// delete the client + its login
router.delete('/admin/clients/:id', authMiddleware, superOnly, asyncHandler(async (req, res) => {
  const { data: pc } = await supabaseAdmin.from('portal_clients').select('auth_user_id').eq('id', req.params.id).maybeSingle();
  if (!pc) return res.status(404).json({ error: 'Not found' });
  await supabaseAdmin.from('portal_clients').delete().eq('id', req.params.id);
  if (pc.auth_user_id) await supabaseAdmin.auth.admin.deleteUser(pc.auth_user_id).catch(() => {});
  res.json({ ok: true });
}));

// Dialer reachability diagnostic (run from the PROD server). Tells whether each
// VICIdial box answers recording_lookup, and (with ?sale_id=) whether a specific
// sale resolves a recording from here. If boxes show "unreachable", the server's
// IP is almost certainly not whitelisted on the dialer.
router.get('/admin/diag', authMiddleware, superOnly, asyncHandler(async (req, res) => {
  const { BOXES } = require('../utils/dialerBoxes');
  const probe = async (box) => {
    const t0 = Date.now();
    try {
      const r = await axios.get(`${box.base}/vicidial/non_agent_api.php`, {
        params: { source: 'crm', user: box.user, pass: box.pass, function: 'recording_lookup', stage: 'pipe', lead_id: '1' },
        timeout: 12000, responseType: 'text',
      });
      const text = String(r.data || '').trim().slice(0, 140);
      let status = 'reachable';
      if (/PERMISSION/i.test(text)) status = 'no_permission';
      else if (/^ERROR/i.test(text) && !/NO RECORDINGS/i.test(text)) status = 'error';
      return { box: box.id, base: box.base, ms: Date.now() - t0, status, sample: text };
    } catch (e) {
      return { box: box.id, base: box.base, ms: Date.now() - t0, status: 'unreachable', error: e.code || e.message };
    }
  };
  const boxes = await Promise.all(BOXES.map(probe));

  // The server's PUBLIC outbound IP — this is the address to whitelist on the
  // dialer. (Coolify/Docker NATs egress through the host's public IP.)
  let server_ip = null;
  for (const u of ['https://api.ipify.org', 'https://ifconfig.me/ip', 'https://icanhazip.com']) {
    try { const r = await axios.get(u, { timeout: 8000, responseType: 'text' }); const ip = String(r.data || '').trim(); if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) { server_ip = ip; break; } } catch { /* try next */ }
  }

  let sale = null;
  if (req.query.sale_id) {
    const { data: s } = await supabaseAdmin.from('sales')
      .select('id, customer_name, customer_phone, sale_date, closer_id, transfer_id').eq('id', req.query.sale_id).maybeSingle();
    if (s) {
      const [{ data: p }, { data: tr }] = await Promise.all([
        supabaseAdmin.from('user_profiles').select('vicidial_agent_ids').eq('user_id', s.closer_id).maybeSingle(),
        s.transfer_id ? supabaseAdmin.from('transfers').select('vicidial_vendor_code').eq('id', s.transfer_id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      const rec = await findSaleRecording({ code: tr?.vicidial_vendor_code, phone: s.customer_phone, agentIds: p?.vicidial_agent_ids || [], date: s.sale_date });
      sale = { customer: s.customer_name, phone: s.customer_phone, date: s.sale_date, code: tr?.vicidial_vendor_code || null, agents: p?.vicidial_agent_ids || [], found: !!rec, duration: rec?.duration || null };
    } else sale = { error: 'sale not found' };
  }
  res.json({ server_ip, boxes, sale });
}));

// listen audit for one client
router.get('/admin/clients/:id/listens', authMiddleware, superOnly, asyncHandler(async (req, res) => {
  const { data } = await supabaseAdmin
    .from('portal_listens').select('*')
    .eq('portal_client_id', req.params.id)
    .order('listened_at', { ascending: false })
    .limit(500);
  res.json({ listens: data || [] });
}));

// ════════════════════════════════════════════════════════════════════════════
// CLIENT (portal login)
// ════════════════════════════════════════════════════════════════════════════

// who am I + which closers I may see
router.get('/me', authMiddleware, requirePortalClient, asyncHandler(async (req, res) => {
  const ids = req.portalClient.closer_ids || [];
  const profs = await fetchIn('user_profiles', 'user_id, first_name, last_name', 'user_id', ids);
  const closers = ids
    .map(id => { const p = profs.find(x => x.user_id === id); return { id, name: p ? (fullName(p) || '(unnamed)') : id }; })
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json({ name: req.portalClient.name, closers });
}));

// Assigned closers' sales — INSTANT (pure DB, zero dialer calls). The recording
// is resolved only when a call is played (/sales/:id/recording). Browse = recent
// by call date; ?phone= matches by customer phone across ALL the client's sales.
router.get('/sales', authMiddleware, requirePortalClient, asyncHandler(async (req, res) => {
  const allowed = req.portalClient.closer_ids || [];
  if (!allowed.length) return res.json({ sales: [] });

  const closerFilter = req.query.closer_id && allowed.includes(req.query.closer_id) ? [req.query.closer_id] : allowed;
  const profs = await fetchIn('user_profiles', 'user_id, first_name, last_name', 'user_id', closerFilter);
  const profById = Object.fromEntries(profs.map(p => [p.user_id, p]));
  const shape = (rows) => (rows || []).map(s => ({
    id: s.id,
    customer_name: s.customer_name || '—',
    phone: s.customer_phone || '',
    sale_date: s.sale_date,
    closer_id: s.closer_id,
    closer_name: fullName(profById[s.closer_id]) || '(unnamed)',
  }));
  const cols = 'id, customer_name, customer_phone, sale_date, closer_id';

  // ── phone search ──
  const phoneQ = String(req.query.phone || '').replace(/\D/g, '');
  if (phoneQ.length >= 4) {
    const { data } = await supabaseAdmin
      .from('sales').select(cols)
      .in('closer_id', closerFilter)
      .or(`customer_phone.ilike.%${phoneQ}%,customer_phone_2.ilike.%${phoneQ}%`)
      .order('sale_date', { ascending: false })
      .limit(60);
    return res.json({ sales: shape(data), phone_search: true });
  }

  // ── browse (recent) ──
  const limit = Math.min(parseInt(req.query.scan, 10) || 100, 300);
  const offset = parseInt(req.query.offset, 10) || 0;
  let q = supabaseAdmin
    .from('sales').select(cols)
    .in('closer_id', closerFilter)
    .order('sale_date', { ascending: false })   // call date, not bulk-import created_at
    .range(offset, offset + limit - 1);
  if (req.query.date_from) q = q.gte('sale_date', req.query.date_from);
  if (req.query.date_to)   q = q.lte('sale_date', req.query.date_to);
  const { data } = await q;
  res.json({ sales: shape(data), next_offset: (data?.length === limit) ? offset + limit : null });
}));

// stream the actual sale recording (source hidden, nothing stored) + audit
router.get('/sales/:id/recording', authMiddleware, requirePortalClient, asyncHandler(async (req, res) => {
  const allowed = req.portalClient.closer_ids || [];
  const { data: sale } = await supabaseAdmin
    .from('sales')
    .select('id, customer_name, customer_phone, sale_date, closer_id, transfer_id')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!sale || !allowed.includes(sale.closer_id)) return res.status(404).json({ error: 'Not available' });

  const [{ data: prof }, { data: tr }] = await Promise.all([
    supabaseAdmin.from('user_profiles').select('first_name, last_name, vicidial_agent_ids').eq('user_id', sale.closer_id).maybeSingle(),
    sale.transfer_id ? supabaseAdmin.from('transfers').select('vicidial_vendor_code').eq('id', sale.transfer_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const rec = await findSaleRecording({
    code: tr?.vicidial_vendor_code,
    phone: sale.customer_phone,
    agentIds: prof?.vicidial_agent_ids || [],
    date: sale.sale_date,
  });
  if (!rec) {
    logger.info('PORTAL', `no recording: sale=${sale.id} code=${tr?.vicidial_vendor_code || 'none'} agents=${JSON.stringify(prof?.vicidial_agent_ids || [])} date=${sale.sale_date} (dialer reachable? run /portal/admin/diag)`);
    return res.status(404).json({ error: 'Recording not available' });
  }

  // audit (best-effort; logged only on the first chunk request, not range seeks)
  if (!req.headers.range || /bytes=0-/.test(req.headers.range)) {
    supabaseAdmin.from('portal_listens').insert({
      portal_client_id: req.portalClient.id,
      sale_id: sale.id,
      closer_id: sale.closer_id,
      closer_name: fullName(prof),
      customer_name: sale.customer_name,
      recording_id: rec.recording_id,
      ip: clientIp(req),
    }).then(() => {}, () => {});
  }

  // Proxy the upstream MP3 → client. Forward Range for seek; never reveal the URL.
  try {
    const upstream = await axios.get(rec.location, {
      responseType: 'stream',
      timeout: 30000,
      headers: req.headers.range ? { Range: req.headers.range } : {},
      validateStatus: s => s >= 200 && s < 400,
    });
    res.status(upstream.status === 206 ? 206 : 200);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, no-store');
    if (upstream.headers['content-length']) res.setHeader('Content-Length', upstream.headers['content-length']);
    if (upstream.headers['content-range'])  res.setHeader('Content-Range', upstream.headers['content-range']);
    upstream.data.pipe(res);
    upstream.data.on('error', () => { try { res.end(); } catch { /* noop */ } });
  } catch (e) {
    logger.warn('PORTAL', `stream failed sale=${sale.id}: ${e.message}`);
    if (!res.headersSent) res.status(502).json({ error: 'Could not load recording' });
  }
}));

module.exports = router;

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

// Assigned closers' sales. Browse mode shows only sales WITH a recording.
// Phone search (?phone=) matches by customer phone across ALL the client's sales
// and returns the hits with a has_recording flag (so a found-but-no-recording
// number gives a clear answer instead of an empty screen).
router.get('/sales', authMiddleware, requirePortalClient, asyncHandler(async (req, res) => {
  const allowed = req.portalClient.closer_ids || [];
  if (!allowed.length) return res.json({ sales: [] });

  const closerFilter = req.query.closer_id && allowed.includes(req.query.closer_id) ? [req.query.closer_id] : allowed;
  const profs = await fetchIn('user_profiles', 'user_id, first_name, last_name, vicidial_agent_ids', 'user_id', closerFilter);
  const profById = Object.fromEntries(profs.map(p => [p.user_id, p]));

  // resolve each sale → recording; keepEmpty keeps no-recording rows (flagged)
  const resolve = async (rows, keepEmpty) => {
    const trs = await fetchIn('transfers', 'id, vicidial_vendor_code', 'id', rows.map(s => s.transfer_id));
    const codeByTr = Object.fromEntries(trs.map(t => [t.id, t.vicidial_vendor_code]));
    const out = await mapLimit(rows, 10, async (s) => {
      const prof = profById[s.closer_id];
      const rec = await findSaleRecording({
        code: codeByTr[s.transfer_id], phone: s.customer_phone,
        agentIds: prof?.vicidial_agent_ids || [], date: s.sale_date,
      });
      if (!rec && !keepEmpty) return null;
      return {
        id: s.id,
        customer_name: s.customer_name || '—',
        phone: s.customer_phone || '',
        sale_date: s.sale_date,
        closer_id: s.closer_id,
        closer_name: fullName(prof) || '(unnamed)',
        duration: rec?.duration || null,
        has_recording: !!rec,
      };
    });
    return out.filter(Boolean);
  };

  // ── phone search ──
  const phoneQ = String(req.query.phone || '').replace(/\D/g, '');
  if (phoneQ.length >= 4) {
    const { data: sales } = await supabaseAdmin
      .from('sales')
      .select('id, customer_name, customer_phone, sale_date, closer_id, transfer_id')
      .in('closer_id', closerFilter)
      .or(`customer_phone.ilike.%${phoneQ}%,customer_phone_2.ilike.%${phoneQ}%`)
      .order('sale_date', { ascending: false })
      .limit(40);
    return res.json({ sales: await resolve(sales || [], true), phone_search: true });
  }

  // ── browse (recent, recording-only) ──
  const scanLimit = Math.min(parseInt(req.query.scan, 10) || 150, 400);
  const offset = parseInt(req.query.offset, 10) || 0;
  let q = supabaseAdmin
    .from('sales')
    .select('id, customer_name, customer_phone, sale_date, closer_id, transfer_id')
    .in('closer_id', closerFilter)
    .order('sale_date', { ascending: false })   // call date, not bulk-import created_at
    .range(offset, offset + scanLimit - 1);
  if (req.query.date_from) q = q.gte('sale_date', req.query.date_from);
  if (req.query.date_to)   q = q.lte('sale_date', req.query.date_to);
  const { data: sales } = await q;
  if (!sales?.length) return res.json({ sales: [], scanned: 0, next_offset: null });

  res.json({
    sales: await resolve(sales, false),
    scanned: sales.length,
    next_offset: sales.length === scanLimit ? offset + scanLimit : null,
  });
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
  if (!rec) return res.status(404).json({ error: 'Recording not available' });

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

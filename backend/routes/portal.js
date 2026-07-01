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
const { findSaleRecording, locationForRecording } = require('../utils/dialerBoxes');
const { getConfig, setConfig } = require('../utils/businessConfig');
const { getPseudoNames } = require('../utils/pseudonym');
const logger = require('../utils/logger');

const TEST_AUDIO_KEY = 'portal.test_audio';
const getTestAudio = async () => (await getConfig(null, TEST_AUDIO_KEY, { enabled: false, url: '', label: 'Visualizer demo' })) || {};

// Global cutover gate for the compliance recording-review workflow.
//   OFF (default) → the portal live-resolves recordings exactly as before this
//                   feature (findSaleRecording; no review gate, no 409s).
//   ON            → confirmed-reference-first; unconfirmed sales return 409
//                   "pending review" and the client sees "being verified".
// Flip via env RECORDING_REVIEW_GATE_ENABLED=true once the compliance admin UI
// is ready. Read per-request so the value takes effect on the next deploy/restart
// without touching the route code. The candidate-list / confirm / queue endpoints
// (routes/compliance.js) are NOT gated — reviewers can build the backlog first.
const recordingReviewGateOn = () =>
  String(process.env.RECORDING_REVIEW_GATE_ENABLED || '').trim().toLowerCase() === 'true';

// Pipe an upstream audio URL → client (Range-aware), hiding the source. Shared
// by the recording proxy and the test-audio proxy. `reresolve` (optional) is
// called once if the URL fails — a confirmed clip's stored location can go
// stale, so we re-derive it deterministically from its recording_id and retry.
async function pipeAudio(req, res, url, reresolve) {
  try {
    const upstream = await axios.get(url, {
      responseType: 'stream', timeout: 30000,
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
    // stored location stale/404 → re-derive from the reference once, then retry
    if (reresolve && !res.headersSent) {
      try { const fresh = await reresolve(); if (fresh && fresh !== url) return pipeAudio(req, res, fresh); } catch { /* fall through */ }
    }
    logger.warn('PORTAL', `stream failed: ${e.message}`);
    if (!res.headersSent) res.status(502).json({ error: 'Could not load audio' });
  }
}

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
    .select('id, name, closer_ids, client_names, is_active')
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
  const profs = await fetchIn('user_profiles', 'user_id, first_name, last_name, display_alias', 'user_id', ids);
  const closers = profs
    .map(p => ({ id: p.user_id, name: fullName(p) || '(unnamed)', alias: p.display_alias || '' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json({ closers });
}));

// Set a closer's pseudonym (alias) — shown to clients + guests instead of the
// real name. Blank → falls back to a stable "Agent XXXX".
router.patch('/admin/closers/:id/alias', authMiddleware, superOnly, asyncHandler(async (req, res) => {
  const alias = String(req.body.alias || '').trim().slice(0, 60);
  const { error } = await supabaseAdmin
    .from('user_profiles').update({ display_alias: alias || null }).eq('user_id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, alias });
}));

// Selectable clients (sales.client_name) — configured sale_client options merged
// with the distinct values actually on sales, so a selection always matches.
router.get('/admin/sale-clients', authMiddleware, superOnly, asyncHandler(async (req, res) => {
  const set = new Set();
  const { data: ff } = await supabaseAdmin.from('form_fields').select('options').eq('field_type', 'sale_client');
  for (const f of (ff || [])) for (const o of (f.options || [])) {
    const c = typeof o === 'string' ? o : (o?.client || o?.value || o?.label);
    if (c && String(c).trim()) set.add(String(c).trim());
  }
  const { data: rows } = await supabaseAdmin.from('sales').select('client_name').not('client_name', 'is', null).limit(8000);
  for (const r of (rows || [])) { const c = (r.client_name || '').trim(); if (c && c !== '-') set.add(c); }
  res.json({ clients: [...set].sort((a, b) => a.localeCompare(b)) });
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
      client_names: c.client_names || [],
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
  const clientNames = Array.isArray(req.body.client_names) ? req.body.client_names.map(s => String(s).trim()).filter(Boolean) : [];
  if (!name || !email || password.length < 6) return res.status(400).json({ error: 'name, email and a 6+ char password are required' });
  if (!closerIds.length && !clientNames.length) return res.status(400).json({ error: 'Assign at least one closer or client' });

  const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email, password, email_confirm: true, app_metadata: { portal_client: true },
  });
  if (authErr || !authData?.user) return res.status(400).json({ error: authErr?.message || 'Could not create login' });

  const { data: row, error: insErr } = await supabaseAdmin.from('portal_clients').insert({
    auth_user_id: authData.user.id, name, login_email: email, closer_ids: closerIds, client_names: clientNames, created_by: req.user.id,
  }).select().single();
  if (insErr) { await supabaseAdmin.auth.admin.deleteUser(authData.user.id).catch(() => {}); return res.status(500).json({ error: insErr.message }); }

  logger.success('PORTAL', `client created: ${email} (${closerIds.length} closers, ${clientNames.length} clients)`);
  res.json({ client: row });
}));

// update (name / closers / active / optional new password)
router.patch('/admin/clients/:id', authMiddleware, superOnly, asyncHandler(async (req, res) => {
  const { data: pc } = await supabaseAdmin.from('portal_clients').select('*').eq('id', req.params.id).maybeSingle();
  if (!pc) return res.status(404).json({ error: 'Not found' });

  const patch = { updated_at: new Date().toISOString() };
  if (req.body.name !== undefined) patch.name = String(req.body.name).trim();
  if (Array.isArray(req.body.closer_ids)) patch.closer_ids = req.body.closer_ids.filter(Boolean);
  if (Array.isArray(req.body.client_names)) patch.client_names = req.body.client_names.map(s => String(s).trim()).filter(Boolean);
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
  const BOXES = require('../utils/dialerBoxes').getBoxes();
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
        s.transfer_id ? supabaseAdmin.from('transfers').select('vicidial_vendor_code, created_at').eq('id', s.transfer_id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      const rec = await findSaleRecording({ code: tr?.vicidial_vendor_code, phone: s.customer_phone, agentIds: p?.vicidial_agent_ids || [], date: s.sale_date, dialerAt: tr?.created_at, closerId: s.closer_id });
      sale = { customer: s.customer_name, phone: s.customer_phone, date: s.sale_date, code: tr?.vicidial_vendor_code || null, agents: p?.vicidial_agent_ids || [], found: !!rec, duration: rec?.duration || null };
    } else sale = { error: 'sale not found' };
  }
  res.json({ server_ip, boxes, sale });
}));

// Validate THIS server's IP on the dialer by submitting the dialer's :81 "IP
// Validation Portal" form from the server (so the dialer whitelists Coolify's
// IP). Then re-probe the API to confirm it opened. Per box.
router.post('/admin/validate-ip', authMiddleware, superOnly, asyncHandler(async (req, res) => {
  const BOXES = require('../utils/dialerBoxes').getBoxes();
  const qsBody = (o) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const targets = req.body.box ? BOXES.filter(b => b.id === req.body.box) : BOXES;

  const validate = async (box) => {
    const host = box.base.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const portal = `http://${host}:81`;
    const userid = req.body.userid || box.user;
    const password = req.body.password || box.pass;
    try {
      // 1. GET the form → read the (obfuscated) password field name
      const g = await axios.get(portal + '/', { timeout: 15000, responseType: 'text', validateStatus: () => true });
      const pm = String(g.data || '').match(/<input[^>]*type="password"[^>]*>/i);
      const field = (pm && pm[0].match(/name="([^"]+)"/)) ? pm[0].match(/name="([^"]+)"/)[1] : 'password';
      // 2. POST credentials → the portal whitelists the submitting (server) IP
      const post = await axios.post(portal + '/index.php',
        qsBody({ userid, password: '', [field]: password, submit: 'SUBMIT' }),
        { timeout: 15000, responseType: 'text', maxRedirects: 0, validateStatus: () => true, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      const said = /success/i.test(String(post.data || ''));
      // 3. confirm: does the API (443) answer now?
      let apiOpen = false;
      try {
        const t = await axios.get(`${box.base}/vicidial/non_agent_api.php`,
          { params: { source: 'crm', user: box.user, pass: box.pass, function: 'recording_lookup', stage: 'pipe', lead_id: '1' }, timeout: 12000, responseType: 'text' });
        apiOpen = /NO RECORDINGS|^\d{4}-|PERMISSION/i.test(String(t.data || '').trim());
      } catch { /* still blocked */ }
      return { box: box.id, portal, submitted: post.status < 400, said_success: said, api_open: apiOpen };
    } catch (e) {
      return { box: box.id, portal, error: e.code || e.message };
    }
  };

  const results = await Promise.all(targets.map(validate));
  res.json({ results });
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

// Test audio — a demo clip the superadmin can broadcast to ALL portal clients
// (so they can see the visualizer). Stored in global business_config.
router.get('/admin/test-audio', authMiddleware, superOnly, asyncHandler(async (req, res) => {
  res.json(await getTestAudio());
}));
router.patch('/admin/test-audio', authMiddleware, superOnly, asyncHandler(async (req, res) => {
  const cur = await getTestAudio();
  const next = {
    enabled: req.body.enabled !== undefined ? !!req.body.enabled : !!cur.enabled,
    url:     req.body.url !== undefined ? String(req.body.url).trim() : (cur.url || ''),
    label:   req.body.label !== undefined ? String(req.body.label).trim() : (cur.label || 'Visualizer demo'),
  };
  await setConfig('global', TEST_AUDIO_KEY, next, req.user.id);
  res.json(next);
}));

// ════════════════════════════════════════════════════════════════════════════
// CLIENT (portal login)
// ════════════════════════════════════════════════════════════════════════════

// who am I + which closers I may see
router.get('/me', authMiddleware, requirePortalClient, asyncHandler(async (req, res) => {
  const ids = req.portalClient.closer_ids || [];
  const pseudo = await getPseudoNames(ids);   // clients see pseudonyms, never real names
  const closers = ids
    .map(id => ({ id, name: pseudo.get(id) || 'Agent' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const ta = await getTestAudio();
  res.json({
    name: req.portalClient.name,
    closers,
    test_audio: (ta.enabled && ta.url) ? { enabled: true, label: ta.label || 'Visualizer demo' } : { enabled: false },
  });
}));

// stream the test-audio clip (proxied, source hidden) — for the visualizer demo
router.get('/test-audio', authMiddleware, requirePortalClient, asyncHandler(async (req, res) => {
  const ta = await getTestAudio();
  if (!ta.enabled || !ta.url) return res.status(404).json({ error: 'No test audio' });
  return pipeAudio(req, res, ta.url);
}));

// Assigned closers' sales — INSTANT (pure DB, zero dialer calls). The recording
// is resolved only when a call is played (/sales/:id/recording). Browse = recent
// by call date; ?phone= matches by customer phone across ALL the client's sales.
router.get('/sales', authMiddleware, requirePortalClient, asyncHandler(async (req, res) => {
  const closers = req.portalClient.closer_ids || [];
  const clients = req.portalClient.client_names || [];
  if (!closers.length && !clients.length) return res.json({ sales: [] });

  const closerFilter = req.query.closer_id && closers.includes(req.query.closer_id) ? [req.query.closer_id] : closers;
  const cols = 'id, customer_name, customer_phone, sale_date, closer_id, client_name';

  // Scope every query to this portal's closers AND/OR clients.
  const scope = (q) => {
    if (closerFilter.length) q = q.in('closer_id', closerFilter);
    if (clients.length)      q = q.in('client_name', clients);
    return q;
  };
  // Pseudonyms + recording length per sale (zero dialer calls). HYBRID per sale:
  // compliance-confirmed → linked-clip count + summed length + 'confirmed';
  // unconfirmed → live-resolved length (portal_recording_meta), or 'pending_review'
  // when the strict gate is ON.
  const respond = async (rows, extra) => {
    const ids = [...new Set((rows || []).map(r => r.closer_id).filter(Boolean))];
    const pseudo = await getPseudoNames(ids);
    const base = (s) => ({
      id: s.id,
      customer_name: s.customer_name || '—',
      phone: s.customer_phone || '',
      sale_date: s.sale_date,
      closer_id: s.closer_id,
      closer_name: pseudo.get(s.closer_id) || 'Agent',
    });

    // HYBRID resolution (per sale — no global flag flip needed):
    //   compliance-CONFIRMED sale → show its linked clips (count + summed length);
    //   not yet confirmed         → live-resolve length (pre-feature behavior),
    //   strict gate ON            → unconfirmed sales report 'pending_review' instead.
    const list = rows || [];
    const confRows = await fetchIn('sale_recording_confirmations', 'sale_id, duration', 'sale_id', list.map(r => r.id));
    const confBy = new Map();   // sale_id -> { clips, duration }
    for (const c of confRows) { const g = confBy.get(c.sale_id) || { clips: 0, duration: 0 }; g.clips++; g.duration += (c.duration || 0); confBy.set(c.sale_id, g); }
    const strict = recordingReviewGateOn();
    const unconfirmed = strict ? [] : list.filter(s => !confBy.has(s.id)).map(s => s.id);
    const metaRows = unconfirmed.length ? await fetchIn('portal_recording_meta', 'sale_id, found, duration', 'sale_id', unconfirmed) : [];
    const metaBy = new Map(metaRows.map(m => [m.sale_id, m]));
    const sales = list.map(s => {
      const g = confBy.get(s.id);
      if (g) return { ...base(s), duration: g.duration || null, clips: g.clips, review_status: 'confirmed' };
      if (strict) return { ...base(s), duration: null, clips: 0, review_status: 'pending_review' };
      const m = metaBy.get(s.id);
      return { ...base(s), duration: (m && m.found) ? m.duration : null, clips: 0, meta_known: !!m };
    });
    res.json({ sales, ...extra });
  };

  // ── phone search ──
  const phoneQ = String(req.query.phone || '').replace(/\D/g, '');
  if (phoneQ.length >= 4) {
    const { data } = await scope(supabaseAdmin.from('sales').select(cols))
      .or(`customer_phone.ilike.%${phoneQ}%,customer_phone_2.ilike.%${phoneQ}%`)
      .order('sale_date', { ascending: false })
      .limit(60);
    return respond(data, { phone_search: true });
  }

  // ── browse (recent) ──
  const limit = Math.min(parseInt(req.query.scan, 10) || 100, 300);
  const offset = parseInt(req.query.offset, 10) || 0;
  let q = scope(supabaseAdmin.from('sales').select(cols))
    .order('sale_date', { ascending: false })   // call date, not bulk-import created_at
    .range(offset, offset + limit - 1);
  if (req.query.date_from) q = q.gte('sale_date', req.query.date_from);
  if (req.query.date_to)   q = q.lte('sale_date', req.query.date_to);
  const { data } = await q;
  return respond(data, { next_offset: (data?.length === limit) ? offset + limit : null });
}));

// GATE OFF only: resolve a sale's recording length live (minus the audio).
async function resolveRecordingMeta(sale) {
  const [{ data: prof }, { data: tr }] = await Promise.all([
    supabaseAdmin.from('user_profiles').select('vicidial_agent_ids').eq('user_id', sale.closer_id).maybeSingle(),
    sale.transfer_id ? supabaseAdmin.from('transfers').select('vicidial_vendor_code, created_at').eq('id', sale.transfer_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const rec = await findSaleRecording({
    code: tr?.vicidial_vendor_code, phone: sale.customer_phone,
    agentIds: prof?.vicidial_agent_ids || [], date: sale.sale_date, dialerAt: tr?.created_at, closerId: sale.closer_id,
  });
  return { found: !!rec, duration: rec?.duration || null, recording_id: rec?.recording_id || null };
}
const META_NEG_TTL = 12 * 60 * 60 * 1000;   // re-check a "not found" after 12h (positives cached forever)
const metaFresh = (row) => row && (row.found || (Date.now() - new Date(row.resolved_at).getTime() < META_NEG_TTL));

// Batch: recording length + review status per sale (HYBRID).
//   confirmed   → straight from compliance's linked clips (no dialer, no heuristic).
//   unconfirmed → cached live-resolve, bounded, with `pending` (strict gate ON →
//                 'pending_review' instead of resolving).
router.post('/sales/recording-meta', authMiddleware, requirePortalClient, asyncHandler(async (req, res) => {
  const closers = req.portalClient.closer_ids || [];
  const clients = req.portalClient.client_names || [];
  const ids = [...new Set((Array.isArray(req.body.ids) ? req.body.ids : []).filter(Boolean))].slice(0, 300);
  if (!ids.length) return res.json({ meta: {}, pending: [] });

  // HYBRID: confirmed sales come straight from compliance's linked clips; only
  // the UNCONFIRMED ones fall through to the bounded live-resolve (skipped when
  // the strict gate is ON — those report 'pending_review').
  const srows = await fetchIn('sales', 'id, customer_phone, sale_date, closer_id, client_name, transfer_id', 'id', ids);
  const inScope = (s) => (!closers.length || closers.includes(s.closer_id)) && (!clients.length || clients.includes(s.client_name));
  const sales = (srows || []).filter(inScope);
  if (!sales.length) return res.json({ meta: {}, pending: [] });
  const confs = await fetchIn('sale_recording_confirmations', 'sale_id, duration', 'sale_id', sales.map(s => s.id));
  const bySale = new Map();
  for (const c of confs) { const g = bySale.get(c.sale_id) || { clips: 0, duration: 0 }; g.clips++; g.duration += (c.duration || 0); bySale.set(c.sale_id, g); }
  const strict = recordingReviewGateOn();
  const meta = {};
  const needLive = [];
  for (const s of sales) {
    const g = bySale.get(s.id);
    if (g) meta[s.id] = { available: true, duration: g.duration || null, clips: g.clips, status: 'confirmed' };
    else if (strict) meta[s.id] = { available: false, status: 'pending_review' };
    else needLive.push(s);
  }
  if (!needLive.length) return res.json({ meta, pending: [] });

  // unconfirmed → bounded live-resolve + cache (pre-feature behavior)
  const cached = await fetchIn('portal_recording_meta', '*', 'sale_id', needLive.map(s => s.id));
  const cacheBy = new Map(cached.map(r => [r.sale_id, r]));
  const todo = [];
  for (const s of needLive) { const row = cacheBy.get(s.id); if (metaFresh(row)) meta[s.id] = { available: row.found, duration: row.duration }; else todo.push(s); }
  const CAP = 24;
  const pending = todo.slice(CAP).map(s => s.id);
  await mapLimit(todo.slice(0, CAP), 5, async (s) => {
    const m = await resolveRecordingMeta(s);
    meta[s.id] = { available: m.found, duration: m.duration };
    supabaseAdmin.from('portal_recording_meta').upsert(
      { sale_id: s.id, found: m.found, duration: m.duration, recording_id: m.recording_id, resolved_at: new Date().toISOString() },
      { onConflict: 'sale_id' },
    ).then(() => {}, () => {});
  });
  res.json({ meta, pending });
}));

// stream the actual sale recording (source hidden, nothing stored) + audit
router.get('/sales/:id/recording', authMiddleware, requirePortalClient, asyncHandler(async (req, res) => {
  // Mirror the /sales browse scope EXACTLY (closers AND/OR client_names), so a
  // client can't fetch a recording outside their scope by guessing a sale id —
  // and a client_name-only client (no closers) can still play recordings.
  const closers = req.portalClient.closer_ids || [];
  const clients = req.portalClient.client_names || [];
  const { data: sale } = await supabaseAdmin
    .from('sales')
    .select('id, customer_name, customer_phone, sale_date, closer_id, client_name, transfer_id')
    .eq('id', req.params.id)
    .maybeSingle();
  const okCloser = !closers.length || closers.includes(sale?.closer_id);
  const okClient = !clients.length || clients.includes(sale?.client_name);
  if (!sale || (!closers.length && !clients.length) || !okCloser || !okClient) {
    return res.status(404).json({ error: 'Not available' });
  }

  // ── HYBRID: play compliance's CONFIRMED clip(s) first (regardless of gate) ──
  const { data: confs } = await supabaseAdmin
    .from('sale_recording_confirmations')
    .select('*').eq('sale_id', sale.id).order('clip_order', { ascending: true });
  if (confs && confs.length) {
    // pick the requested clip (?recording_id= or ?clip=N, 1-based), else the first
    let clip = confs[0];
    if (req.query.recording_id) clip = confs.find(c => c.recording_id === req.query.recording_id) || clip;
    else if (req.query.clip) { const n = parseInt(req.query.clip, 10); if (n >= 1 && n <= confs.length) clip = confs[n - 1]; }

    if (!req.headers.range || /bytes=0-/.test(req.headers.range)) {
      const { data: prof } = await supabaseAdmin.from('user_profiles').select('first_name, last_name').eq('user_id', sale.closer_id).maybeSingle();
      supabaseAdmin.from('portal_listens').insert({
        portal_client_id: req.portalClient.id, sale_id: sale.id, closer_id: sale.closer_id,
        closer_name: fullName(prof), customer_name: sale.customer_name, recording_id: clip.recording_id, ip: clientIp(req),
      }).then(() => {}, () => {});
    }
    // Stream the confirmed clip; re-derive the URL deterministically if it's stale.
    const url = clip.location || await locationForRecording(clip);
    if (!url) return res.status(404).json({ error: 'Recording not available' });
    return pipeAudio(req, res, url, () => locationForRecording(clip));
  }
  // No confirmation for this sale: strict gate → "being verified" (409); otherwise
  // fall through to the live auto-resolve so nothing is hidden.
  if (recordingReviewGateOn()) return res.status(409).json({ status: 'pending_review', error: 'Recording is being verified' });

  // ── unconfirmed + gate OFF: pre-feature behavior — live auto-resolve ──
  const [{ data: prof }, { data: tr }] = await Promise.all([
    supabaseAdmin.from('user_profiles').select('first_name, last_name, vicidial_agent_ids').eq('user_id', sale.closer_id).maybeSingle(),
    sale.transfer_id ? supabaseAdmin.from('transfers').select('vicidial_vendor_code, created_at').eq('id', sale.transfer_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const rec = await findSaleRecording({
    code: tr?.vicidial_vendor_code, phone: sale.customer_phone,
    agentIds: prof?.vicidial_agent_ids || [], date: sale.sale_date, dialerAt: tr?.created_at, closerId: sale.closer_id,
  });
  if (!rec) {
    logger.info('PORTAL', `no recording: sale=${sale.id} code=${tr?.vicidial_vendor_code || 'none'} agents=${JSON.stringify(prof?.vicidial_agent_ids || [])} date=${sale.sale_date} (dialer reachable? run /portal/admin/diag)`);
    supabaseAdmin.from('portal_recording_meta').upsert(
      { sale_id: sale.id, found: false, duration: null, recording_id: null, resolved_at: new Date().toISOString() },
      { onConflict: 'sale_id' },
    ).then(() => {}, () => {});
    return res.status(404).json({ error: 'Recording not available' });
  }
  supabaseAdmin.from('portal_recording_meta').upsert(
    { sale_id: sale.id, found: true, duration: rec.duration || null, recording_id: rec.recording_id || null, resolved_at: new Date().toISOString() },
    { onConflict: 'sale_id' },
  ).then(() => {}, () => {});
  if (!req.headers.range || /bytes=0-/.test(req.headers.range)) {
    supabaseAdmin.from('portal_listens').insert({
      portal_client_id: req.portalClient.id, sale_id: sale.id, closer_id: sale.closer_id,
      closer_name: fullName(prof), customer_name: sale.customer_name, recording_id: rec.recording_id, ip: clientIp(req),
    }).then(() => {}, () => {});
  }
  return pipeAudio(req, res, rec.location);
}));

// Per-clip list for the multi-recording dropdown. GATE ON → the compliance-
// confirmed clips in order with their STORED durations + recording_id (so the
// portal labels "Call N (m:ss)" from the confirmation, matching what plays).
// GATE OFF → empty (findSaleRecording resolves a single recording, no split).
router.get('/sales/:id/clips', authMiddleware, requirePortalClient, asyncHandler(async (req, res) => {
  const closers = req.portalClient.closer_ids || [];
  const clients = req.portalClient.client_names || [];
  const { data: sale } = await supabaseAdmin.from('sales').select('id, closer_id, client_name').eq('id', req.params.id).maybeSingle();
  const okCloser = !closers.length || closers.includes(sale?.closer_id);
  const okClient = !clients.length || clients.includes(sale?.client_name);
  if (!sale || (!closers.length && !clients.length) || !okCloser || !okClient) return res.status(404).json({ error: 'Not available' });
  // Hybrid: return the compliance-confirmed clips whenever they exist (a linked
  // sale gets its multi-clip dropdown even while the strict gate is OFF).
  const { data: confs } = await supabaseAdmin
    .from('sale_recording_confirmations').select('clip_order, duration, recording_id')
    .eq('sale_id', sale.id).order('clip_order', { ascending: true });
  res.json({ clips: (confs || []).map(c => ({ clip_order: c.clip_order, duration: c.duration || null, recording_id: c.recording_id })) });
}));

module.exports = router;

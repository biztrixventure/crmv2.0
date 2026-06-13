// ============================================================================
// presence.js — last-seen + activity tracking endpoints.
//
// Live online/offline is Supabase Realtime Presence (websocket, instant —
// handled entirely client-side). This route persists the parts a websocket
// can't answer once the socket is gone:
//
//   POST /presence/heartbeat      — client beats every ~2 min (+ on boot, on
//                                   tab-hide via fetch keepalive). Updates the
//                                   user_presence snapshot and accumulates the
//                                   user_activity_daily aggregates.
//   GET  /presence/last-seen      — ?ids=a,b,c → { last_seen: { id: ts } }.
//                                   Any authed user (chat "Last seen …").
//   GET  /presence/admin/activity — superadmin/readonly: full roster with
//                                   per-user activity + business summary.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const router = express.Router();

// ET business day, consistent with the rest of the app's "today" semantics.
const etToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

const clientIp = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || null;

// "/admin/business-rules" → "admin"; "/" → "home". Keeps module_minutes keys tiny.
const moduleOf = (page) => {
  const seg = String(page || '').split('?')[0].split('/').filter(Boolean)[0];
  return seg ? seg.slice(0, 24) : 'home';
};

// ── POST /presence/heartbeat ──────────────────────────────────────────────────
// Body: { page, device, idle, boot }
//   idle — tab hidden / no input for a while → last_seen still updates but no
//          active-minutes credit accrues.
//   boot — first beat of a browser session → counts a login when the previous
//          beat is >30 min old (multi-tab boots within the window don't
//          double-count).
router.post('/heartbeat', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { page = null, device = null, idle = false, boot = false } = req.body || {};
  const now = new Date();
  const nowIso = now.toISOString();

  const { data: prev } = await supabaseAdmin
    .from('user_presence').select('last_seen_at').eq('user_id', userId).maybeSingle();

  const elapsedMin = prev?.last_seen_at
    ? Math.max(0, (now - new Date(prev.last_seen_at)) / 60000)
    : Infinity;
  // Credit ≈ time since the previous beat, capped at 2× the beat interval so a
  // single missed beat doesn't lose time but a closed laptop doesn't gain it.
  const credit = idle ? 0 : Math.min(elapsedMin === Infinity ? 1 : elapsedMin, 4);
  const newSession = boot === true && elapsedMin > 30;

  await supabaseAdmin.from('user_presence').upsert({
    user_id:      userId,
    last_seen_at: nowIso,
    last_page:    page ? String(page).slice(0, 120) : null,
    device:       device ? String(device).slice(0, 120) : null,
    ip:           clientIp(req),
    updated_at:   nowIso,
  });

  // Daily aggregate (read-modify-write; one beat per user per ~2 min keeps
  // contention irrelevant).
  const day = etToday();
  const { data: agg } = await supabaseAdmin
    .from('user_activity_daily').select('*').eq('user_id', userId).eq('day', day).maybeSingle();

  const mod = moduleOf(page);
  const moduleMinutes = { ...(agg?.module_minutes || {}) };
  if (credit > 0) moduleMinutes[mod] = Math.round(((moduleMinutes[mod] || 0) + credit) * 10) / 10;

  await supabaseAdmin.from('user_activity_daily').upsert({
    user_id:        userId,
    day,
    first_seen_at:  agg?.first_seen_at || nowIso,
    last_seen_at:   nowIso,
    active_minutes: Math.round((agg?.active_minutes || 0) + credit),
    login_count:    (agg?.login_count || 0) + (newSession ? 1 : 0),
    module_minutes: moduleMinutes,
  });

  res.json({ ok: true });
}));

// ── GET /presence/last-seen?ids=a,b,c ────────────────────────────────────────
router.get('/last-seen', asyncHandler(async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 200);
  if (!ids.length) return res.json({ last_seen: {} });
  const { data } = await supabaseAdmin
    .from('user_presence').select('user_id, last_seen_at').in('user_id', ids);
  const map = {};
  (data || []).forEach(r => { map[r.user_id] = r.last_seen_at; });
  res.json({ last_seen: map });
}));

// ── GET /presence/admin/activity ─────────────────────────────────────────────
// SuperAdmin (+ readonly_admin) roster with per-user activity + summary.
//
// The aggregates only move at heartbeat cadence (~2 min), so we share ONE
// computation across every admin + every poll via a tiny in-memory cache. Live
// online/idle status doesn't ride this payload (it's realtime on the websocket),
// so a few seconds of staleness here is free. This is what makes the panel fast:
// the heavy roster + 30-day scan runs at most once per CACHE_TTL.
let _activityCache = null;          // { at, payload }
const ACTIVITY_TTL = 15_000;

router.get('/admin/activity', asyncHandler(async (req, res) => {
  if (!['superadmin', 'readonly_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Superadmin access required' });
  }

  if (_activityCache && Date.now() - _activityCache.at < ACTIVITY_TTL) {
    return res.json(_activityCache.payload);
  }

  const day = etToday();
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const since7  = new Date(Date.now() -  7 * 86400000).toISOString().slice(0, 10);

  // Select only the columns we use — smaller payload off Postgres, faster scan.
  const [rolesRes, presenceRes, dailyRes] = await Promise.all([
    supabaseAdmin.from('user_company_roles')
      .select('user_id, company_id, custom_roles(level), companies(name)')
      .eq('is_active', true),
    supabaseAdmin.from('user_presence').select('user_id, last_seen_at, last_page, device, ip'),
    supabaseAdmin.from('user_activity_daily')
      .select('user_id, day, first_seen_at, last_seen_at, active_minutes, login_count, module_minutes')
      .gte('day', since30),
  ]);

  const roleRows = rolesRes.data || [];
  const userIds = [...new Set(roleRows.map(r => r.user_id))];
  let profileMap = {};
  if (userIds.length) {
    const { data: profs } = await supabaseAdmin
      .from('user_profiles').select('user_id, first_name, last_name').in('user_id', userIds);
    (profs || []).forEach(p => {
      profileMap[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || null;
    });
  }

  const presenceMap = {};
  (presenceRes.data || []).forEach(p => { presenceMap[p.user_id] = p; });

  // Bucket the 30-day aggregates per user.
  const byUser = {};
  (dailyRes.data || []).forEach(a => {
    const b = (byUser[a.user_id] = byUser[a.user_id] || { today: null, week_minutes: 0, month_days: 0, month_minutes: 0 });
    if (a.day === day) b.today = a;
    if (a.day >= since7) b.week_minutes += a.active_minutes || 0;
    if ((a.active_minutes || 0) > 0) { b.month_days += 1; b.month_minutes += a.active_minutes || 0; }
  });

  // Dedupe roster to one row per user (first company/role wins for display).
  const seen = new Set();
  const users = [];
  for (const r of roleRows) {
    if (seen.has(r.user_id)) continue;
    seen.add(r.user_id);
    const p = presenceMap[r.user_id];
    const b = byUser[r.user_id] || { today: null, week_minutes: 0, month_days: 0, month_minutes: 0 };
    const t = b.today;
    const avgDaily = b.month_days ? b.month_minutes / b.month_days : 0;
    const topModule = t?.module_minutes
      ? Object.entries(t.module_minutes).sort((a, z) => z[1] - a[1])[0]?.[0] || null
      : null;
    users.push({
      user_id:      r.user_id,
      name:         profileMap[r.user_id] || 'Unknown',
      role:         r.custom_roles?.level || null,
      company:      r.companies?.name || null,
      last_seen_at: p?.last_seen_at || null,
      last_page:    p?.last_page || null,
      device:       p?.device || null,
      ip:           p?.ip || null,
      never_seen:   !p,
      today: {
        logged_in:      !!t,
        first_seen_at:  t?.first_seen_at || null,
        last_seen_at:   t?.last_seen_at || null,
        active_minutes: t?.active_minutes || 0,
        login_count:    t?.login_count || 0,
        top_module:     topModule,
      },
      week_minutes:      b.week_minutes,
      month_active_days: b.month_days,
      // Engagement 0-100: consistency (active days of last 30) + intensity
      // (average daily minutes vs a 90-min/day baseline).
      engagement: Math.round(Math.min(100, (b.month_days / 30) * 60 + Math.min(avgDaily / 90, 1) * 40)),
    });
  }

  // Business summary across the roster.
  const todayUsers = users.filter(u => u.today.logged_in);
  const totalLoginsToday = todayUsers.reduce((n, u) => n + u.today.login_count, 0);
  const totalMinToday    = todayUsers.reduce((n, u) => n + u.today.active_minutes, 0);
  const dauSet = new Set((dailyRes.data || []).filter(a => a.day === day).map(a => a.user_id));
  const wauSet = new Set((dailyRes.data || []).filter(a => a.day >= since7).map(a => a.user_id));
  const mauSet = new Set((dailyRes.data || []).map(a => a.user_id));

  const payload = {
    users,
    summary: {
      total_users:     users.length,
      dau:             dauSet.size,
      wau:             wauSet.size,
      mau:             mauSet.size,
      avg_session_min: totalLoginsToday ? Math.round(totalMinToday / totalLoginsToday) : 0,
      total_active_min_today: totalMinToday,
    },
    generated_at: new Date().toISOString(),
  };
  _activityCache = { at: Date.now(), payload };
  res.json(payload);
  logger.info('PRESENCE', `Activity snapshot computed for ${req.user.id} (${users.length} users)`);
}));

module.exports = router;

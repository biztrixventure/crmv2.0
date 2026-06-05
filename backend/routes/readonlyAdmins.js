// ============================================================================
// /api/readonly-admins — SuperAdmin tool for managing readonly_admin users.
//
//   GET    /readonly-admins              → list every user the system treats
//                                          as readonly_admin (env-stamped +
//                                          custom_roles assignment), each
//                                          enriched with their per-user nav
//                                          allowlist from business_config.
//   PUT    /readonly-admins/:userId/nav  → update the user's allowed tab IDs
//   POST   /readonly-admins              → create a new readonly_admin user
//                                          (auth user + role + initial nav)
//   DELETE /readonly-admins/:userId      → revoke role (deactivate the
//                                          custom_roles row + strip
//                                          app_metadata). NEVER deletes the
//                                          auth user — operator can re-grant
//                                          later without re-inviting.
//
// Per-user nav config lives under business_config keys shaped
// `readonly_admin.nav.<user_id>` = ["dashboard","calendar", ...]. Missing
// config = full SuperAdmin parity (current default after commit 17810d0).
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const router = express.Router();

// Only superadmin may use these routes. readonly_admin sees the page but the
// page itself never calls these endpoints from a readonly session.
router.use((req, res, next) => {
  if (req.user?.role !== 'superadmin') {
    return res.status(403).json({ error: 'Superadmin only.' });
  }
  next();
});

const NAV_KEY   = (uid) => `readonly_admin.nav.${uid}`;
const FLAGS_KEY = (uid) => `readonly_admin.flags.${uid}`;

// Defaults — every flag visible to the operator in the manager UI, all
// permissive so a freshly-created RO sees what the SuperAdmin would.
// The flag keys are checked from the frontend AuthContext + helpers.
const DEFAULT_FLAGS = {
  view_financial_data: true,   // monthly_payment / down_payment columns
  view_pii:            true,   // customer phone / email / full address
  can_export:          true,   // Export buttons (CSV / Excel)
  view_audit_history:  true,   // edit_history reveal on drawers
};
const VALID_FLAG_KEYS = new Set(Object.keys(DEFAULT_FLAGS));
function sanitizeFlags(input) {
  const out = { ...DEFAULT_FLAGS };
  if (input && typeof input === 'object') {
    for (const [k, v] of Object.entries(input)) {
      if (VALID_FLAG_KEYS.has(k)) out[k] = !!v;
    }
  }
  return out;
}

// Resolve the env list of readonly admin emails so the list endpoint can
// distinguish env-stamped from DB-assigned. Env users can't be revoked from
// the UI alone — the env var must change too.
const envReadonlyEmails = () =>
  new Set((process.env.READONLY_ADMIN_EMAIL || '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean));

router.get('/', asyncHandler(async (req, res) => {
  // Pull every auth user and the active custom_roles assignments. We
  // surface BOTH stamp paths so the operator sees who got there how:
  //   - env-stamped: email matches READONLY_ADMIN_EMAIL
  //   - app_metadata.role='readonly_admin' (env-stamped historically)
  //   - active user_company_roles row with custom_roles.level='readonly_admin'
  const envSet = envReadonlyEmails();
  const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  if (authErr) return res.status(500).json({ error: authErr.message });

  // Find role IDs whose level is readonly_admin so we can list active assigns.
  const { data: roles } = await supabaseAdmin
    .from('custom_roles').select('id, name').eq('level', 'readonly_admin');
  const roIds = (roles || []).map(r => r.id);

  let assignedUserIds = new Set();
  if (roIds.length) {
    const { data: ucr } = await supabaseAdmin
      .from('user_company_roles').select('user_id, company_id, role_id, is_active')
      .in('role_id', roIds).eq('is_active', true);
    (ucr || []).forEach(r => assignedUserIds.add(r.user_id));
  }

  // Pull every nav-allowlist + flags row in one shot.
  const { data: cfgRows } = await supabaseAdmin
    .from('business_config').select('key, value')
    .or('key.like.readonly_admin.nav.%,key.like.readonly_admin.flags.%');
  const navByUserId = new Map();
  const flagsByUserId = new Map();
  (cfgRows || []).forEach(r => {
    if (r.key.startsWith('readonly_admin.nav.'))   navByUserId.set(r.key.slice('readonly_admin.nav.'.length), r.value);
    if (r.key.startsWith('readonly_admin.flags.')) flagsByUserId.set(r.key.slice('readonly_admin.flags.'.length), r.value);
  });

  const users = (authData?.users || []).filter(u => {
    const e = (u.email || '').toLowerCase();
    return envSet.has(e)
      || u.app_metadata?.role === 'readonly_admin'
      || assignedUserIds.has(u.id);
  });

  // Pull profile names in one round-trip.
  const ids = users.map(u => u.id);
  let profileMap = {};
  if (ids.length) {
    const { data: profiles } = await supabaseAdmin
      .from('user_profiles').select('user_id, first_name, last_name').in('user_id', ids);
    (profiles || []).forEach(p => { profileMap[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim(); });
  }

  const enriched = users.map(u => {
    const e = (u.email || '').toLowerCase();
    return {
      id:           u.id,
      email:        u.email,
      name:         profileMap[u.id] || null,
      created_at:   u.created_at,
      last_sign_in: u.last_sign_in_at || null,
      via_env:      envSet.has(e),
      via_metadata: u.app_metadata?.role === 'readonly_admin',
      via_role:     assignedUserIds.has(u.id),
      nav_allowed:  navByUserId.get(u.id) || null,           // null = full SA parity
      flags:        sanitizeFlags(flagsByUserId.get(u.id)),  // merged with defaults
    };
  });

  res.json({ readonly_admins: enriched, count: enriched.length });
}));

router.put('/:userId/nav', asyncHandler(async (req, res) => {
  const userId = req.params.userId;
  const allowed = Array.isArray(req.body?.allowed) ? req.body.allowed : null;
  if (!allowed) return res.status(400).json({ error: '"allowed" must be an array of tab IDs.' });

  // Clean: keep strings only, dedup, cap at 64 entries.
  const clean = [...new Set(allowed.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim()))].slice(0, 64);

  const { error } = await supabaseAdmin.from('business_config').upsert({
    scope: 'global', key: NAV_KEY(userId), value: clean,
    updated_by: req.user.id, updated_at: new Date().toISOString(),
  }, { onConflict: 'scope,key' });
  if (error) return res.status(500).json({ error: error.message });

  logger.success('READONLY_ADMIN_NAV', `Updated nav allowlist for ${userId}: ${clean.length} tabs`);
  res.json({ user_id: userId, nav_allowed: clean });
}));

router.put('/:userId/flags', asyncHandler(async (req, res) => {
  const userId = req.params.userId;
  const clean = sanitizeFlags(req.body?.flags || req.body);
  const { error } = await supabaseAdmin.from('business_config').upsert({
    scope: 'global', key: FLAGS_KEY(userId), value: clean,
    updated_by: req.user.id, updated_at: new Date().toISOString(),
  }, { onConflict: 'scope,key' });
  if (error) return res.status(500).json({ error: error.message });
  logger.success('READONLY_ADMIN_FLAGS', `Updated flags for ${userId}`);
  res.json({ user_id: userId, flags: clean });
}));

router.post('/', asyncHandler(async (req, res) => {
  const email      = String(req.body?.email || '').trim().toLowerCase();
  const password   = String(req.body?.password || '').trim();
  const first_name = String(req.body?.first_name || '').trim();
  const last_name  = String(req.body?.last_name || '').trim();
  const allowed    = Array.isArray(req.body?.allowed) ? req.body.allowed : null;
  const flags      = req.body?.flags ? sanitizeFlags(req.body.flags) : null;
  // send_invite=true → use inviteUserByEmail so Supabase sends the welcome
  // email with a magic link to set their password. send_invite=false (or
  // missing) → use createUser with the supplied password (no email sent
  // because email_confirm=true short-circuits Supabase's confirmation).
  const sendInvite = req.body?.send_invite === true;

  if (!email) return res.status(400).json({ error: 'email is required' });
  if (!sendInvite && password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 chars (or set send_invite=true to email a link)' });
  }

  let userId;
  if (sendInvite) {
    // Resolve the frontend base URL the same way the existing /users
    // invite-email path does. Without redirectTo, Supabase falls back to
    // the project's Site URL, which on a fresh project is empty / wrong
    // and the link 404s after Supabase verifies the OTP. With it set,
    // Supabase appends the access_token to this URL's hash fragment and
    // the AcceptInvite page picks it up.
    const appBase = (process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');
    const { data: invited, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: { first_name, last_name, role: 'readonly_admin' },
      redirectTo: `${appBase}/accept-invite`,
    });
    if (inviteErr) return res.status(400).json({ error: inviteErr.message });
    userId = invited.user?.id;
    if (!userId) return res.status(500).json({ error: 'Invite sent but no user id returned.' });
    // Invite doesn't carry app_metadata; stamp the role on the returned id.
    try {
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        app_metadata: { ...(invited.user?.app_metadata || {}), role: 'readonly_admin' },
      });
    } catch (e) { logger.warn('READONLY_ADMIN_CREATE', `metadata stamp on invite failed: ${e.message}`); }
  } else {
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { first_name, last_name },
      app_metadata:  { role: 'readonly_admin' },
    });
    if (createErr) return res.status(400).json({ error: createErr.message });
    userId = created.user?.id;
    if (!userId) return res.status(500).json({ error: 'User created but no id returned.' });
  }

  // Profile row for the user-list display. Non-fatal.
  try {
    await supabaseAdmin.from('user_profiles').upsert({
      user_id: userId, first_name, last_name,
    }, { onConflict: 'user_id' });
  } catch { /* ignore */ }

  // Initial nav allowlist + flags.
  if (allowed && allowed.length) {
    const clean = [...new Set(allowed.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim()))].slice(0, 64);
    await supabaseAdmin.from('business_config').upsert({
      scope: 'global', key: NAV_KEY(userId), value: clean,
      updated_by: req.user.id, updated_at: new Date().toISOString(),
    }, { onConflict: 'scope,key' });
  }
  if (flags) {
    await supabaseAdmin.from('business_config').upsert({
      scope: 'global', key: FLAGS_KEY(userId), value: flags,
      updated_by: req.user.id, updated_at: new Date().toISOString(),
    }, { onConflict: 'scope,key' });
  }

  logger.success('READONLY_ADMIN_CREATE', `Created readonly_admin ${email} (${userId}) via ${sendInvite ? 'invite' : 'password'}`);
  res.status(201).json({ user_id: userId, email, invited: sendInvite });
}));

router.delete('/:userId', asyncHandler(async (req, res) => {
  const userId = req.params.userId;
  // ?permanent=true → wipe the auth user entirely (cascades user_profiles
  // via FK; business_config keys cleaned up explicitly below). Default
  // (no flag) only revokes the readonly_admin grant so re-grant is cheap.
  const permanent = String(req.query?.permanent || '').toLowerCase() === 'true';

  if (!permanent) {
    // Soft revoke: strip metadata role + deactivate role assignments.
    try {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(userId);
      if (u?.user) {
        const meta = { ...(u.user.app_metadata || {}) };
        if (meta.role === 'readonly_admin') {
          delete meta.role;
          await supabaseAdmin.auth.admin.updateUserById(userId, { app_metadata: meta });
        }
      }
    } catch (err) { logger.warn('READONLY_ADMIN_REVOKE', `metadata strip failed: ${err.message}`); }

    const { data: roles } = await supabaseAdmin
      .from('custom_roles').select('id').eq('level', 'readonly_admin');
    if (roles?.length) {
      await supabaseAdmin.from('user_company_roles')
        .update({ is_active: false })
        .eq('user_id', userId).in('role_id', roles.map(r => r.id));
    }
    await supabaseAdmin.from('business_config').delete()
      .eq('scope', 'global').in('key', [NAV_KEY(userId), FLAGS_KEY(userId)]);
    logger.success('READONLY_ADMIN_REVOKE', `Soft-revoked readonly_admin from ${userId}`);
    return res.json({ user_id: userId, revoked: true, permanent: false });
  }

  // Permanent: wipe config + delete auth user.
  await supabaseAdmin.from('business_config').delete()
    .eq('scope', 'global').in('key', [NAV_KEY(userId), FLAGS_KEY(userId)]);

  // Best-effort deactivate role assignments first so any FK on
  // user_company_roles → auth.users doesn't block the delete.
  const { data: roles } = await supabaseAdmin
    .from('custom_roles').select('id').eq('level', 'readonly_admin');
  if (roles?.length) {
    await supabaseAdmin.from('user_company_roles').delete()
      .eq('user_id', userId).in('role_id', roles.map(r => r.id));
  }

  const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (delErr) {
    logger.error('READONLY_ADMIN_DELETE', `auth.admin.deleteUser failed: ${delErr.message}`);
    return res.status(500).json({ error: delErr.message });
  }
  logger.success('READONLY_ADMIN_DELETE', `PERMANENTLY deleted readonly_admin ${userId}`);
  res.json({ user_id: userId, revoked: true, permanent: true });
}));

module.exports = router;

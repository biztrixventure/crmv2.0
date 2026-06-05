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

const NAV_KEY = (uid) => `readonly_admin.nav.${uid}`;

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

  // Pull every nav-allowlist row in one shot so per-user enrichment is O(1).
  const { data: cfgRows } = await supabaseAdmin
    .from('business_config').select('key, value')
    .like('key', 'readonly_admin.nav.%');
  const navByUserId = new Map((cfgRows || []).map(r => [r.key.replace('readonly_admin.nav.', ''), r.value]));

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
      nav_allowed:  navByUserId.get(u.id) || null,   // null = full SA parity
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

router.post('/', asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '').trim();
  const first_name = String(req.body?.first_name || '').trim();
  const last_name  = String(req.body?.last_name || '').trim();
  const allowed = Array.isArray(req.body?.allowed) ? req.body.allowed : null;
  if (!email)            return res.status(400).json({ error: 'email is required' });
  if (password.length < 8) return res.status(400).json({ error: 'password must be at least 8 chars' });

  // Create auth user (already-existing email returns 422 from Supabase — we
  // pass that back so the operator can use the existing user instead).
  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { first_name, last_name },
    app_metadata:  { role: 'readonly_admin' },
  });
  if (createErr) return res.status(400).json({ error: createErr.message });

  const userId = created.user?.id;
  if (!userId) return res.status(500).json({ error: 'User created but no id returned.' });

  // Stamp profile row so name shows in lists. Non-fatal.
  try {
    await supabaseAdmin.from('user_profiles').upsert({
      user_id: userId, first_name, last_name,
    }, { onConflict: 'user_id' });
  } catch { /* ignore */ }

  // Initial nav allowlist if provided.
  if (allowed && allowed.length) {
    const clean = [...new Set(allowed.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim()))].slice(0, 64);
    await supabaseAdmin.from('business_config').upsert({
      scope: 'global', key: NAV_KEY(userId), value: clean,
      updated_by: req.user.id, updated_at: new Date().toISOString(),
    }, { onConflict: 'scope,key' });
  }

  logger.success('READONLY_ADMIN_CREATE', `Created readonly_admin ${email} (${userId})`);
  res.status(201).json({ user_id: userId, email });
}));

router.delete('/:userId', asyncHandler(async (req, res) => {
  const userId = req.params.userId;

  // Strip the metadata role first so the JWT stops treating them as RO on
  // their next token refresh. Env-stamped users will be re-stamped on
  // server restart — operator must remove the email from env too.
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

  // Deactivate any user_company_roles row tied to a readonly_admin custom_role.
  const { data: roles } = await supabaseAdmin
    .from('custom_roles').select('id').eq('level', 'readonly_admin');
  if (roles?.length) {
    await supabaseAdmin.from('user_company_roles')
      .update({ is_active: false })
      .eq('user_id', userId).in('role_id', roles.map(r => r.id));
  }

  // Drop nav allowlist so a future re-grant starts clean.
  await supabaseAdmin.from('business_config')
    .delete().eq('scope', 'global').eq('key', NAV_KEY(userId));

  logger.success('READONLY_ADMIN_REVOKE', `Revoked readonly_admin from ${userId}`);
  res.json({ user_id: userId, revoked: true });
}));

module.exports = router;

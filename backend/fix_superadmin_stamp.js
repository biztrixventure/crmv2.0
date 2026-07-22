/**
 * One-off: fix a stale app_metadata.role stamp on a Supabase auth account.
 *
 *   node backend/fix_superadmin_stamp.js [email] [role]
 *
 * Why this exists: superadmin identity is a PERSISTENT stamp on the auth
 * account (app_metadata.role='superadmin'), baked in by syncSuperadminMetadata
 * on startup. Removing the email from SUPERADMIN_EMAIL does NOT clear that
 * stamp, so the account keeps minting superadmin JWTs forever. This script
 * (and the reconcile now in server.js) clears it.
 *
 * Defaults: demote superadmin867673@biztrixventure.com → readonly_admin.
 *   role = 'readonly_admin' | 'superadmin' | 'none' (clears the role)
 *
 * NOTE: the account must LOG OUT and back IN afterward — existing JWTs still
 * carry the old app_metadata until a fresh token is issued.
 *
 * Reads creds from backend/.env (same as verify_migrations.js).
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (e.g. in backend/.env) before running.');
  process.exit(1);
}
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const EMAIL = (process.argv[2] || 'superadmin867673@biztrixventure.com').toLowerCase();
const ROLE_ARG = (process.argv[3] || 'readonly_admin').toLowerCase();
const NEW_ROLE = ROLE_ARG === 'none' || ROLE_ARG === 'null' ? null : ROLE_ARG;

async function findUserByEmail(email) {
  // Paginate — listUsers caps at 1000/page.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const users = data?.users || [];
    const hit = users.find(u => (u.email || '').toLowerCase() === email);
    if (hit) return hit;
    if (users.length < 1000) break;   // last page
  }
  return null;
}

(async () => {
  console.log(`Looking up ${EMAIL} …`);
  const user = await findUserByEmail(EMAIL);
  if (!user) {
    console.error(`✗ No auth user found for ${EMAIL}. Nothing changed.`);
    process.exit(1);
  }
  const before = user.app_metadata?.role ?? '(none)';
  console.log(`Found ${user.email}  id=${user.id}  current app_metadata.role=${before}`);

  const { error } = await sb.auth.admin.updateUserById(user.id, {
    app_metadata: { ...user.app_metadata, role: NEW_ROLE },
  });
  if (error) {
    console.error('✗ Update failed:', error.message);
    process.exit(1);
  }
  console.log(`✓ Set app_metadata.role: ${before} → ${NEW_ROLE ?? '(cleared)'}`);
  console.log('  Have that account log OUT and back IN so a fresh JWT picks up the change.');
  if (NEW_ROLE === 'readonly_admin') {
    console.log('  For it to resolve as system readonly_admin, also add the email to READONLY_ADMIN_EMAIL.');
  }
  process.exit(0);
})().catch(e => { console.error('✗', e.message); process.exit(1); });

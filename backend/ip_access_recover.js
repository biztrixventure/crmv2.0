/**
 * Break-glass recovery for IP access control (mig 319). Needs no login -- only
 * the service-role key the backend already runs with.
 *
 *   node backend/ip_access_recover.js status
 *   node backend/ip_access_recover.js disable
 *   node backend/ip_access_recover.js anywhere <email | user-id>
 *
 *   (or from backend/:  npm run ip-access -- disable)
 *
 * disable   turns the master switch OFF in the database. The running backend
 *           re-reads the switch every 60 seconds, so it takes effect within a
 *           minute with no restart. For an instant stop -- or if the database
 *           itself is the problem -- set IP_RESTRICTION_FORCE_OFF=true in the
 *           backend environment and restart; that overrides the database.
 * anywhere  sets one user back to "allow access from anywhere". Takes effect on
 *           their next request (within ~30s at most).
 * status    prints the switch, the override, and who is restricted.
 *
 * Every change is recorded in module_audit_log with source
 * 'cli:ip_access_recover', exactly like a change made from the admin screen.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY (e.g. in backend/.env) before running.');
  process.exit(1);
}
// The source header is what the audit trigger (fn_module_audit) records as
// "where this change came from".
const sb = createClient(URL, KEY, {
  auth: { persistSession: false },
  global: { headers: { 'x-change-source': 'cli:ip_access_recover' } },
});

const SWITCH_KEY = 'security.ip_restriction.enabled';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findUser(ref) {
  if (UUID.test(ref)) {
    const { data, error } = await sb.auth.admin.getUserById(ref);
    if (error || !data?.user) return null;
    return data.user;
  }
  const email = ref.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const users = data?.users || [];
    const hit = users.find(u => (u.email || '').toLowerCase() === email);
    if (hit) return hit;
    if (users.length < 1000) break;
  }
  return null;
}

async function status() {
  const [{ data: cfg, error: cfgErr }, { data: restricted, error: rErr }, { count: ruleCount }] = await Promise.all([
    sb.from('business_config').select('key, value, updated_at').eq('scope', 'global').like('key', 'security.ip_restriction.%'),
    sb.from('user_ip_access').select('user_id').eq('ip_access_mode', 'restricted'),
    sb.from('user_ip_rules').select('id', { count: 'exact', head: true }).eq('is_active', true),
  ]);
  if (cfgErr) throw new Error(cfgErr.message);
  if (rErr) throw new Error(rErr.message);
  const sw = (cfg || []).find(r => r.key === SWITCH_KEY);
  console.log(`Master switch (database): ${sw?.value === true ? 'ON' : 'OFF'}${sw ? `  (updated ${sw.updated_at})` : '  (not set -> OFF)'}`);
  console.log(`IP_RESTRICTION_FORCE_OFF in this shell: ${String(process.env.IP_RESTRICTION_FORCE_OFF || '(unset)')}`);
  console.log('  (the override that counts is the one in the RUNNING backend\'s environment)');
  console.log(`Restricted users: ${(restricted || []).length}`);
  console.log(`Active rules: ${ruleCount ?? '?'}`);
  for (const r of cfg || []) if (r.key !== SWITCH_KEY) console.log(`${r.key} = ${JSON.stringify(r.value)}`);
}

async function disable() {
  const { error } = await sb.from('business_config').upsert(
    { scope: 'global', key: SWITCH_KEY, value: false, updated_by: null, updated_at: new Date().toISOString() },
    { onConflict: 'scope,key' },
  );
  if (error) throw new Error(error.message);
  console.log('✓ IP restriction switched OFF in the database.');
  console.log('  The running backend picks this up within 60 seconds -- no restart needed.');
  console.log('  Instant alternative: set IP_RESTRICTION_FORCE_OFF=true in the backend environment and restart.');
}

async function anywhere(ref) {
  if (!ref) {
    console.error('Usage: node backend/ip_access_recover.js anywhere <email | user-id>');
    process.exit(1);
  }
  const user = await findUser(ref.trim());
  if (!user) {
    console.error(`✗ No account found for ${ref}. Nothing changed.`);
    process.exit(1);
  }
  const { data: before } = await sb.from('user_ip_access').select('ip_access_mode').eq('user_id', user.id).maybeSingle();
  const now = new Date().toISOString();
  const { error } = await sb.from('user_ip_access').upsert(
    { user_id: user.id, ip_access_mode: 'anywhere', mode_changed_by: null, mode_changed_at: now, updated_at: now },
    { onConflict: 'user_id' },
  );
  if (error) throw new Error(error.message);
  console.log(`✓ ${user.email} (${user.id}): ${before?.ip_access_mode || 'anywhere'} -> anywhere`);
  console.log('  Their rules are kept; they are simply no longer checked. Takes effect within ~30 seconds.');
}

(async () => {
  const [cmd, arg] = process.argv.slice(2);
  switch ((cmd || '').toLowerCase()) {
    case 'status':   await status(); break;
    case 'disable':  await disable(); await status(); break;
    case 'anywhere': await anywhere(arg); break;
    default:
      console.log('IP access control -- break-glass recovery\n');
      console.log('  node backend/ip_access_recover.js status');
      console.log('  node backend/ip_access_recover.js disable');
      console.log('  node backend/ip_access_recover.js anywhere <email | user-id>');
      process.exit(cmd ? 1 : 0);
  }
  process.exit(0);
})().catch(e => { console.error('✗', e.message); process.exit(1); });

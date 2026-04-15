/**
 * seed-demo.js — creates demo company + one user per BLP role
 * Run: node seed-demo.js
 * Password for all: 123@Qwerty
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PASSWORD = '123@Qwerty';
const COMPANY_NAME = 'BLP Demo Co';
const DOMAIN = 'blpdemo.com';

// ── Role templates (must match seed-defaults BLP_DEFAULTS levels) ────────────
const ROLES = [
  {
    name: 'Fronter',
    level: 'fronter',
    email: `fronter@${DOMAIN}`,
    firstName: 'Frank',
    lastName: 'Fronter',
    permissions: ['create_transfer', 'view_own_transfers', 'update_transfer',
                  'view_callbacks', 'manage_callbacks', 'view_notifications'],
  },
  {
    name: 'Closer',
    level: 'closer',
    email: `closer@${DOMAIN}`,
    firstName: 'Charlie',
    lastName: 'Closer',
    permissions: ['create_sale', 'view_own_sales', 'update_sale', 'view_own_transfers',
                  'reject_transfer',
                  'view_callbacks', 'manage_callbacks', 'view_notifications'],
  },
  {
    name: 'Fronter Manager',
    level: 'fronter_manager',
    email: `fronter.manager@${DOMAIN}`,
    firstName: 'Fred',
    lastName: 'Manager',
    permissions: ['create_transfer', 'view_own_transfers', 'view_team_transfers',
                  'assign_transfer', 'reassign_transfer', 'update_transfer', 'delete_transfer',
                  'create_user', 'view_reports', 'view_fronter_stats',
                  'view_all_company_transfers',
                  'view_callbacks', 'manage_callbacks', 'view_team_callbacks', 'view_notifications'],
  },
  {
    name: 'Closer Manager',
    level: 'closer_manager',
    email: `closer.manager@${DOMAIN}`,
    firstName: 'Carl',
    lastName: 'Manager',
    permissions: ['create_sale', 'view_own_sales', 'update_sale', 'view_team_sales',
                  'assign_transfer', 'view_all_company_transfers',
                  'create_user', 'view_reports', 'view_closer_stats',
                  'view_callbacks', 'manage_callbacks', 'view_team_callbacks', 'view_notifications'],
  },
  {
    name: 'Operations Manager',
    level: 'operations_manager',
    email: `ops@${DOMAIN}`,
    firstName: 'Oscar',
    lastName: 'Ops',
    permissions: ['create_transfer', 'view_own_transfers', 'view_team_transfers',
                  'assign_transfer', 'reassign_transfer', 'update_transfer', 'delete_transfer',
                  'create_sale', 'view_own_sales', 'update_sale', 'view_team_sales', 'delete_sale',
                  'create_user', 'manage_users', 'view_reports',
                  'view_fronter_stats', 'view_closer_stats',
                  'view_all_company_transfers', 'view_all_company_sales',
                  'manage_company_users', 'manage_company_roles', 'view_company_reports',
                  'view_callbacks', 'manage_callbacks', 'view_team_callbacks', 'view_notifications'],
  },
  {
    name: 'Company Admin',
    level: 'company_admin',
    email: `admin@${DOMAIN}`,
    firstName: 'Angela',
    lastName: 'Admin',
    permissions: ['manage_company_users', 'manage_company_roles', 'view_company_reports',
                  'view_all_company_transfers', 'view_all_company_sales',
                  'view_reports', 'view_notifications'],
  },
];

async function run() {
  console.log('=== BLP Demo Seed ===\n');

  // ── 1. Create company ──────────────────────────────────────────────────────
  console.log(`Creating company "${COMPANY_NAME}"...`);
  let companyId;
  const { data: existing } = await supabase
    .from('companies').select('id').eq('name', COMPANY_NAME).single();

  if (existing) {
    companyId = existing.id;
    console.log(`  ↳ Already exists: ${companyId}`);
  } else {
    const { data: co, error: coErr } = await supabase
      .from('companies')
      .insert({ name: COMPANY_NAME, is_active: true })
      .select().single();
    if (coErr) { console.error('Company create failed:', coErr.message); process.exit(1); }
    companyId = co.id;
    console.log(`  ↳ Created: ${companyId}`);
  }

  // ── 2. Fetch all permissions ───────────────────────────────────────────────
  const { data: allPerms } = await supabase.from('permissions').select('id, name');
  const permMap = Object.fromEntries((allPerms || []).map(p => [p.name, p.id]));

  // ── 3. Create roles + users ────────────────────────────────────────────────
  const results = [];
  const { data: authList } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });

  for (const tpl of ROLES) {
    process.stdout.write(`\nRole: ${tpl.name} (${tpl.level})\n`);

    // Create or reuse role
    let roleId;
    const { data: existingRole } = await supabase
      .from('custom_roles').select('id')
      .eq('company_id', companyId).eq('name', tpl.name).single();

    if (existingRole) {
      roleId = existingRole.id;
      console.log(`  Role already exists: ${roleId}`);
    } else {
      const { data: role, error: roleErr } = await supabase
        .from('custom_roles')
        .insert({ name: tpl.name, description: tpl.name, level: tpl.level, company_id: companyId })
        .select().single();
      if (roleErr) { console.error('  Role create failed:', roleErr.message); continue; }
      roleId = role.id;

      const permRows = tpl.permissions
        .filter(p => permMap[p])
        .map(p => ({ role_id: roleId, permission_id: permMap[p] }));
      if (permRows.length) await supabase.from('role_permissions').insert(permRows);
      console.log(`  Role created: ${roleId} (${permRows.length} permissions)`);
    }

    // Create auth user
    let userId;
    const existingAuth = authList?.users?.find(u => u.email === tpl.email);

    if (existingAuth) {
      userId = existingAuth.id;
      console.log(`  Auth user already exists: ${tpl.email}`);
    } else {
      const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
        email: tpl.email,
        password: PASSWORD,
        email_confirm: true,
      });
      if (authErr) { console.error('  Auth create failed:', authErr.message); continue; }
      userId = authData.user.id;

      // Create profile
      await supabase.from('user_profiles').insert({
        user_id: userId,
        first_name: tpl.firstName,
        last_name: tpl.lastName,
        theme_preference: 'light',
      });
      console.log(`  Auth user created: ${userId}`);
    }

    // Assign to company + role
    const { data: existing_assign } = await supabase
      .from('user_company_roles').select('id')
      .eq('user_id', userId).eq('company_id', companyId).single();

    if (!existing_assign) {
      const { error: assignErr } = await supabase.from('user_company_roles').insert({
        user_id: userId,
        company_id: companyId,
        role_id: roleId,
        is_active: true,
      });
      if (assignErr) console.error('  Assign failed:', assignErr.message);
      else console.log(`  Assigned to company`);
    } else {
      console.log(`  Already assigned to company`);
    }

    results.push({ role: tpl.name, email: tpl.email, password: PASSWORD });
  }

  // ── 4. Print summary ───────────────────────────────────────────────────────
  console.log('\n\n╔══════════════════════════════════════════════════════╗');
  console.log('║              DEMO ACCOUNT CREDENTIALS               ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Company: ${COMPANY_NAME.padEnd(42)}║`);
  console.log('╠════════════════════╦══════════════════════╦══════════╣');
  console.log('║ Role               ║ Email                ║ Password ║');
  console.log('╠════════════════════╬══════════════════════╬══════════╣');
  for (const r of results) {
    const role  = r.role.padEnd(18);
    const email = r.email.padEnd(20);
    console.log(`║ ${role} ║ ${email} ║ ${r.password} ║`);
  }
  console.log('╚════════════════════╩══════════════════════╩══════════╝\n');
}

run().catch(e => { console.error(e); process.exit(1); });

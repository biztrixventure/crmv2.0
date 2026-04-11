const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://tdqljwenzuptupjihsvg.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY not set in environment');
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function verifySuperAdmin() {
  console.log('\n🔍 Checking custom_roles levels...\n');

  const { data: roles } = await supabaseAdmin
    .from('custom_roles')
    .select('id, name, level, company_id')
    .limit(10);

  console.log('📋 Sample of custom_roles in database:');
  roles?.forEach((role, idx) => {
    console.log(`  ${idx + 1}. Name: ${role.name}, Level: ${role.level} (type: ${typeof role.level}), Company: ${role.company_id || 'NULL'}`);
  });

  console.log('\n✨ Done!\n');
}

verifySuperAdmin().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});

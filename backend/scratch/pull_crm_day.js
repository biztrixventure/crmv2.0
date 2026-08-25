/**
 * One-off: run the CRM-day pull for a company + date from the CLI — the exact
 * routine behind Load Day's "Pull this day from the CRM" button, for days a
 * manager hasn't pulled yet. Idempotent (existingKeys skips what exists).
 *
 * Usage: node backend/scratch/pull_crm_day.js "<Company Name>" YYYY-MM-DD
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { createClient } = require('@supabase/supabase-js');
const { refreshBoxes } = require('../utils/dialerBoxes');
const { populateCrmDay } = require('../utils/qa2CrmDay');

const [name, date] = process.argv.slice(2);
if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
  console.error('usage: node pull_crm_day.js "<Company Name>" YYYY-MM-DD');
  process.exit(1);
}

const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

(async () => {
  await refreshBoxes();
  const { data: co } = await db.from('companies').select('id, name').ilike('name', name).maybeSingle();
  if (!co) { console.error(`company not found: ${name}`); process.exit(1); }
  console.log(`pulling ${co.name} — ${date} …`);
  const r = await populateCrmDay(co.id, date);
  console.log(JSON.stringify(r));
})();

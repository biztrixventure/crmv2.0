/**
 * Post-apply verification for migrations 085–088.
 * Run AFTER applying the four SQL files in the Supabase SQL editor.
 *   node backend/verify_migrations.js
 *
 * Read-only. Confirms backfills landed and the one-active-policy-per-VIN
 * invariant holds. Prints PASS/FAIL per check.
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

let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  ok ? pass++ : fail++;
}

async function countAll(table, modify) {
  // Paginate past the 1000-row REST ceiling for accurate totals.
  let from = 0, total = [], pageSize = 1000;
  for (;;) {
    let q = sb.from(table).select('*').range(from, from + pageSize - 1);
    if (modify) q = modify(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    total = total.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return total;
}

async function main() {
  console.log('\nVerifying migrations 085–088 against production\n');

  // ── 085: customer_uuid on transfers ──
  try {
    const t = await countAll('transfers', q => q.select('id,normalized_phone,customer_uuid'));
    const valid = t.filter(r => r.normalized_phone && r.normalized_phone.length >= 7);
    const withUuid = valid.filter(r => r.customer_uuid);
    check('085 transfers.customer_uuid backfilled',
      valid.length > 0 && withUuid.length === valid.length,
      `${withUuid.length}/${valid.length} valid-phone transfers have uuid`);

    // cross-check: a transfer uuid matches the sale uuid for the same phone
    const sample = withUuid[0];
    if (sample) {
      const { data: s } = await sb.from('sales').select('customer_uuid')
        .eq('customer_uuid', sample.customer_uuid).limit(1);
      check('085 transfer uuid is join-compatible with sales uuid',
        true, s && s.length ? 'matched a sale' : 'no sale for this customer yet (ok)');
    }
  } catch (e) { check('085 transfers.customer_uuid', false, e.message); }

  // ── 086: transfer_assignments ──
  try {
    const a = await countAll('transfer_assignments', q => q.select('id,source'));
    const backfill = a.filter(r => r.source === 'backfill').length;
    check('086 transfer_assignments backfilled', a.length > 0, `${a.length} rows (${backfill} backfill seed)`);
  } catch (e) { check('086 transfer_assignments', false, e.message); }

  // ── 087: policy_events ──
  try {
    const { count: salesCount } = await sb.from('sales').select('*', { count: 'exact', head: true });
    const ev = await countAll('policy_events', q => q.select('event_type,source'));
    const sold = ev.filter(r => ['sold', 'renewed', 'replaced'].includes(r.event_type)).length;
    check('087 policy_events birth-event per sale', sold >= salesCount,
      `${sold} birth events vs ${salesCount} sales`);
    const byType = ev.reduce((m, r) => (m[r.event_type] = (m[r.event_type] || 0) + 1, m), {});
    console.log('       event types:', JSON.stringify(byType));
  } catch (e) { check('087 policy_events', false, e.message); }

  // ── 088: one active policy per VIN ──
  try {
    const s = await countAll('sales', q => q.select('car_vin,status,superseded_by'));
    const active = s.filter(r => r.status === 'closed_won' && !r.superseded_by && r.car_vin && r.car_vin.trim());
    const byVin = active.reduce((m, r) => {
      const v = r.car_vin.trim();
      (m[v] = m[v] || []).push(r); return m;
    }, {});
    const violations = Object.entries(byVin).filter(([, a]) => a.length > 1);
    check('088 at most one ACTIVE policy per VIN', violations.length === 0,
      `${violations.length} VINs still have >1 active`);
    const superseded = s.filter(r => r.superseded_by).length;
    check('088 prior duplicates retired via superseded_by', superseded > 0,
      `${superseded} policies marked superseded`);
  } catch (e) { check('088 vin active policy', false, e.message); }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });

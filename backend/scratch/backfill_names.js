/**
 * One-off: fill the customer name on transfers the dialer never sent one for.
 *
 * Local equivalent of POST /api/vicidial/backfill/names (commit cc3f856), run
 * from here because that endpoint needs a deploy first. Same rules:
 *   - only ever FILLS a blank field, never overwrites
 *   - requires parseVendorCode().exact — a bare lead_id is unique only per box,
 *     so an unresolvable prefix is skipped rather than risking a wrong customer
 *   - originals saved to transfers_name_backfill_292, so it is reversible
 *
 * Box URLs/creds come from refreshBoxes() (the vicidial_boxes table), NOT the
 * hardcoded fallback — that fallback pointed at a host which no longer resolves,
 * which is what made these lookups look like "the lead has no name".
 *
 * Usage: node backend/scratch/backfill_names.js [limit] [--commit]
 *        without --commit it is a dry run.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { createClient } = require('@supabase/supabase-js');
const { refreshBoxes, parseVendorCode, leadFieldCustomer } = require('../utils/dialerBoxes');

const LIMIT  = parseInt(process.argv[2], 10) || 25;
const COMMIT = process.argv.includes('--commit');
const CONC   = 4;      // parallel leads — gentle on the boxes

const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const blank = (v) => String(v ?? '').trim() === '';

async function enrich(tr) {
  const parsed = parseVendorCode(tr.vicidial_vendor_code);
  if (!parsed || !parsed.exact || !parsed.leadId) return { id: tr.id, skip: 'no box for prefix' };

  let cust = null;
  for (const box of parsed.boxes) {
    cust = await leadFieldCustomer(box, parsed.leadId);
    if (cust && cust.customer_name) break;
  }
  if (!cust || !cust.customer_name) return { id: tr.id, skip: 'dialer has no name' };

  const fd = tr.form_data || {};
  const patch = {};
  const [first, ...rest] = String(cust.customer_name).trim().split(/\s+/);
  if (blank(fd.FirstName)) patch.FirstName = first;
  if (rest.length && blank(fd.LastName)) patch.LastName = rest.join(' ');
  if (blank(fd.customer_name)) patch.customer_name = cust.customer_name;
  if (cust.customer_zip     && blank(fd.Zip))     patch.Zip     = cust.customer_zip;
  if (cust.customer_state   && blank(fd.State))   patch.State   = cust.customer_state;
  if (cust.customer_address && blank(fd.Address)) patch.Address = cust.customer_address;
  if (!Object.keys(patch).length) return { id: tr.id, skip: 'nothing blank to fill' };

  if (COMMIT) {
    await db.from('transfers_name_backfill_292')
      .upsert({ id: tr.id, old_form_data: fd, donor_id: null }, { onConflict: 'id', ignoreDuplicates: true });
    const { error } = await db.from('transfers').update({ form_data: { ...fd, ...patch } }).eq('id', tr.id);
    if (error) return { id: tr.id, skip: `db error: ${error.message}` };
  }
  return { id: tr.id, filled: patch.customer_name || `${patch.FirstName || ''} ${patch.LastName || ''}`.trim() };
}

(async () => {
  await refreshBoxes();
  const { data: rows, error } = await db
    .from('transfers')
    .select('id, vicidial_vendor_code, form_data')
    .not('vicidial_vendor_code', 'is', null)
    .is('form_data->>FirstName', null)
    .order('created_at', { ascending: false })
    .limit(LIMIT);
  if (error) { console.error('query failed:', error.message); process.exit(1); }

  console.log(`${COMMIT ? 'COMMIT' : 'DRY RUN'} — ${rows.length} candidates\n`);
  const out = [];
  for (let i = 0; i < rows.length; i += CONC) {
    const batch = await Promise.all(rows.slice(i, i + CONC).map(r => enrich(r).catch(e => ({ id: r.id, skip: e.message }))));
    out.push(...batch);
    process.stdout.write(`\r  ${out.length}/${rows.length}`);
  }
  const filled = out.filter(r => r.filled);
  const skips  = out.filter(r => r.skip);
  console.log(`\n\nfilled: ${filled.length}   skipped: ${skips.length}`);
  filled.slice(0, 8).forEach(r => console.log(`  + ${r.filled}`));
  const reasons = {};
  skips.forEach(r => { reasons[r.skip] = (reasons[r.skip] || 0) + 1; });
  Object.entries(reasons).forEach(([k, v]) => console.log(`  - ${k}: ${v}`));
})();

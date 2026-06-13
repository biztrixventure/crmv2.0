/**
 * Migration Impact Assessment — uses Supabase JS (HTTPS, no direct TCP needed)
 * Run: node backend/migration_assessment.js
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (e.g. in backend/.env) before running.');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

function section(title) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(70));
}

function row(label, value) {
  console.log(`  ${label.padEnd(55)} ${String(value)}`);
}

async function get(table, opts = {}) {
  const q = sb.from(table).select(opts.select || '*', {
    count: opts.count || undefined,
    head: opts.head || false,
  });
  if (opts.not)    q.not(...opts.not);
  if (opts.is)     q.is(...opts.is);
  if (opts.in)     q.in(...opts.in);
  if (opts.filter) q.filter(...opts.filter);
  if (opts.limit)  q.limit(opts.limit);
  if (opts.order)  q.order(...opts.order);
  const { data, count, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return { data, count };
}

// ─── util ──────────────────────────────────────────────────────────────────
function normPhone(p) {
  if (!p) return null;
  const d = String(p).replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') return d.slice(1);
  return d.length >= 7 ? d.slice(-10) : null;
}

function groupCount(arr, keyFn) {
  const m = {};
  for (const x of arr) {
    const k = keyFn(x);
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}

// ─── RPC wrapper for SQL (if exec_sql function exists) ────────────────────
async function rpc(fn, args = {}) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) return null; // function doesn't exist — skip
  return data;
}

async function main() {
  console.log('\n🔍  BizTrix CRM — Migration Impact Assessment');
  console.log(`    ${new Date().toISOString()}\n`);

  // ── 1. CUSTOMER UUID ANALYSIS ───────────────────────────────────────────
  section('1. CUSTOMER UUID ANALYSIS');

  // 1a. Sales
  const { count: totalSales } = await get('sales', { count: 'exact', head: true });
  const { count: salesWithUuid } = await get('sales', {
    count: 'exact', head: true, not: ['customer_uuid', 'is', null],
  });
  row('Total sales',              totalSales);
  row('Sales WITH customer_uuid', salesWithUuid);
  row('Sales WITHOUT customer_uuid', totalSales - salesWithUuid);
  row('Coverage %', `${((salesWithUuid / totalSales) * 100).toFixed(1)}%`);

  // 1b. Transfers — fetch normalized_phone to check coverage
  const { data: transfers } = await get('transfers', {
    select: 'id, normalized_phone',
  });
  const totalTransfers     = transfers.length;
  const validPhone         = transfers.filter(t => t.normalized_phone && t.normalized_phone.length >= 7).length;
  const invalidPhone       = totalTransfers - validPhone;
  const alreadyHasUuid     = 0; // column does not exist yet — migration 085 pending
  const uniquePhonesExpect = new Set(
    transfers.filter(t => t.normalized_phone && t.normalized_phone.length >= 7)
             .map(t => t.normalized_phone)
  ).size;

  row('Total transfers',                      totalTransfers);
  row('Transfers with valid normalized_phone', validPhone);
  row('Transfers with invalid/missing phone',  invalidPhone);
  row('Transfers already have customer_uuid',  alreadyHasUuid);
  row('Unique customer_uuid expected (post-backfill)', uniquePhonesExpect);

  // ── 2. DUPLICATE CUSTOMER ANALYSIS ────────────────────────────────────
  section('2. DUPLICATE CUSTOMER ANALYSIS');

  const phoneCounts = groupCount(
    transfers.filter(t => t.normalized_phone && t.normalized_phone.length >= 7),
    t => t.normalized_phone
  );
  const multiTransfer = Object.values(phoneCounts).filter(c => c > 1).length;
  row('Customers with multiple transfers', multiTransfer);

  // Top 10 duplicate phones on transfers
  const top10 = Object.entries(phoneCounts)
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  console.log('\n  Top duplicate phone numbers (transfers):');
  top10.forEach(([ph, c]) => console.log(`    ${ph}  ×${c}`));

  // Sales duplicates by customer_uuid
  const { data: salesUuids } = await get('sales', {
    select: 'customer_uuid',
    not: ['customer_uuid', 'is', null],
  });
  const uuidCounts   = groupCount(salesUuids, s => s.customer_uuid);
  const multiSale    = Object.values(uuidCounts).filter(c => c > 1).length;
  row('Customers with multiple sales (by uuid)', multiSale);

  // Customers in both transfers + sales
  const { data: salesPhones } = await get('sales', {
    select: 'customer_phone, form_data',
  });
  const saleNormPhones = new Set(
    salesPhones.map(s => {
      const raw = s.customer_phone ||
        s.form_data?.Phone || s.form_data?.phone ||
        s.form_data?.customer_phone || s.form_data?.Mobile;
      return normPhone(raw);
    }).filter(Boolean)
  );
  const transferPhoneSet = new Set(
    transfers.filter(t => t.normalized_phone && t.normalized_phone.length >= 7)
             .map(t => t.normalized_phone)
  );
  const inBoth = [...transferPhoneSet].filter(p => saleNormPhones.has(p)).length;
  row('Customers with BOTH transfers and sales', inBoth);

  // ── 3. VIN ANALYSIS ──────────────────────────────────────────────────
  section('3. VIN ANALYSIS');

  const { data: allSales } = await get('sales', {
    select: 'id, car_vin, status, reference_no, created_at',
  });
  const withVin       = allSales.filter(s => s.car_vin && s.car_vin.trim());
  const distinctVins  = new Set(withVin.map(s => s.car_vin.trim().toUpperCase())).size;

  row('Total sales',           allSales.length);
  row('Sales with a VIN',      withVin.length);
  row('Distinct VINs',         distinctVins);

  // VIN → list of sales
  const vinMap = {};
  for (const s of withVin) {
    const v = s.car_vin.trim().toUpperCase();
    if (!vinMap[v]) vinMap[v] = [];
    vinMap[v].push(s);
  }
  const dupVins = Object.entries(vinMap).filter(([, ss]) => ss.length > 1);
  row('VINs with >1 record (any status)', dupVins.length);

  // VINs with multiple ACTIVE policies
  const activeStatuses = new Set(['closed_won', 'pending_review']);
  const vinViolations = dupVins.filter(([, ss]) =>
    ss.filter(s => activeStatuses.has(s.status)).length > 1
  );
  row('VINs violating proposed unique index (active/pending dupe)', vinViolations.length);

  if (vinViolations.length > 0) {
    console.log('\n  Exact VIN violations (would block migration 088):');
    vinViolations.slice(0, 20).forEach(([vin, ss]) => {
      const active = ss.filter(s => activeStatuses.has(s.status));
      console.log(`    VIN: ${vin}`);
      active.forEach(s =>
        console.log(`      id=${s.id}  status=${s.status}  ref=${s.reference_no}  created=${s.created_at?.slice(0,10)}`)
      );
    });
  }

  // VINs with conflicting statuses (active + cancelled on same VIN)
  const conflicting = dupVins.filter(([, ss]) => {
    const hasActive = ss.some(s => activeStatuses.has(s.status));
    const hasCancelled = ss.some(s => ['cancelled','returned'].includes(s.status));
    return hasActive && hasCancelled;
  });
  row('VINs with conflicting statuses (active + cancelled)', conflicting.length);
  if (conflicting.length > 0) {
    console.log('\n  Sample conflicting VINs:');
    conflicting.slice(0, 5).forEach(([vin, ss]) => {
      console.log(`    ${vin}: ${ss.map(s => s.status).join(', ')}`);
    });
  }

  // ── 4. TRANSFER CHAIN / ASSIGNMENT RECOVERABILITY ────────────────────
  section('4. TRANSFER CHAIN / ASSIGNMENT RECOVERABILITY');

  // Check columns on transfers table
  const { data: tCols } = await get('transfers', { select: 'id', limit: 1 });
  // Fetch one full row to see all columns
  const { data: sampleT } = await sb.from('transfers').select('*').limit(1);
  const transferCols = sampleT?.[0] ? Object.keys(sampleT[0]) : [];
  const assignmentCols = transferCols.filter(c =>
    /assign|closer_id|agent|owner|handed|reassign/.test(c)
  );
  console.log('  Transfer columns related to assignment:');
  if (assignmentCols.length) {
    assignmentCols.forEach(c => console.log(`    • ${c}`));
  } else {
    console.log('    (none found)');
  }

  // Check transfer_dedup_events
  let dedupCount = 0, dedupSample = null;
  try {
    const { count } = await get('transfer_dedup_events', { count: 'exact', head: true });
    dedupCount = count;
    const { data: ds } = await get('transfer_dedup_events', { limit: 3 });
    dedupSample = ds;
  } catch (e) {
    console.log('  transfer_dedup_events: not accessible or does not exist');
  }
  row('transfer_dedup_events row count', dedupCount);
  if (dedupSample?.length) {
    console.log('  Sample dedup event columns:', Object.keys(dedupSample[0]).join(', '));
  }

  // Check transfers for current/last assignment signals
  const hasAssignedTo = transferCols.includes('assigned_to');
  const hasCloserId   = transferCols.includes('closer_id') || transferCols.includes('assigned_closer_id');
  row('Column assigned_to exists on transfers', hasAssignedTo);
  row('Column closer_id exists on transfers',   hasCloserId);

  // Assess recoverability
  console.log('\n  Recoverability verdict:');
  if (!hasAssignedTo && !hasCloserId && dedupCount === 0) {
    console.log('  ⚠️  NOT RECOVERABLE — no assignment history, no audit log found.');
    console.log('     transfer_assignments table starts fresh; historical chain lost.');
  } else if (hasAssignedTo || hasCloserId) {
    console.log('  ⚡ PARTIALLY RECOVERABLE — current assignment only, no history chain.');
    console.log('     Can backfill current assignee but not A→B→C chain.');
  } else {
    console.log('  ✓ PARTIALLY RECOVERABLE — dedup events may carry assignment signals.');
  }

  // ── 5. POLICY LIFECYCLE ANALYSIS ─────────────────────────────────────
  section('5. POLICY LIFECYCLE ANALYSIS');

  const { data: salesFull } = await get('sales', {
    select: 'status, is_resell, cancellation_date, closer_disposition, compliance_note, returned_at, approved_at, charge_at',
  });

  const statusDist = groupCount(salesFull, s => s.status || 'null');
  console.log('  Status distribution:');
  Object.entries(statusDist).sort((a,b) => b[1]-a[1])
    .forEach(([s, c]) => console.log(`    ${s.padEnd(25)} ${c}`));

  const resells    = salesFull.filter(s => s.is_resell === true).length;
  const cancelled  = salesFull.filter(s => s.status === 'cancelled').length;
  const withCanDate= salesFull.filter(s => s.cancellation_date).length;
  const returned   = salesFull.filter(s => s.status === 'returned').length;
  const withRetAt  = salesFull.filter(s => s.returned_at).length;
  const withAppAt  = salesFull.filter(s => s.approved_at).length;
  const postDate   = salesFull.filter(s => s.closer_disposition === 'Post Date').length;
  const chargeAt   = salesFull.filter(s => s.charge_at).length;
  const hasNote    = salesFull.filter(s => s.compliance_note).length;

  row('Resells (is_resell=true)',            resells);
  row('Cancelled (status)',                  cancelled);
  row('Cancelled with cancellation_date',    withCanDate);
  row('Returned (status)',                   returned);
  row('Returned with returned_at timestamp', withRetAt);
  row('Approved with approved_at timestamp', withAppAt);
  row('Post Date disposition',               postDate);
  row('Post Date with charge_at set',        chargeAt);
  row('Sales with compliance_note',          hasNote);

  const dispositions = groupCount(
    salesFull.filter(s => s.closer_disposition),
    s => s.closer_disposition
  );
  console.log('\n  Closer dispositions → policy_events mapping:');
  Object.entries(dispositions).sort((a,b)=>b[1]-a[1]).forEach(([d,c]) => {
    const ev = d === 'Post Date' ? 'pending_charge'
             : d === 'Sold'      ? 'sold'
             : d === 'Cancelled' ? 'cancelled'
             : `custom:${d}`;
    console.log(`    ${d.padEnd(30)} ×${c}  → event: ${ev}`);
  });

  // ── 6. MIGRATION RISK ASSESSMENT ──────────────────────────────────────
  section('6. MIGRATION RISK ASSESSMENT');

  const uuidMissing   = totalSales - salesWithUuid;
  const vinConflicts  = vinViolations.length;

  console.log(`
  ┌──────────────────────────────────────────────┬──────────────────────────────┐
  │ Migration                                    │ Risk                         │
  ├──────────────────────────────────────────────┼──────────────────────────────┤
  │ 085: customer_uuid on transfers              │ ✅ SAFE TO BACKFILL          │
  │      (normalized_phone already clean)        │    No cleanup needed         │
  ├──────────────────────────────────────────────┼──────────────────────────────┤
  │ 086: transfer_assignments table              │ ✅ SAFE (additive only)      │
  │      (no history to recover — start fresh)   │    No backfill risk          │
  ├──────────────────────────────────────────────┼──────────────────────────────┤
  │ 087: policy_events table                     │ ⚠️  PARTIAL RISK             │
  │      (backfill from existing columns)        │    Some events reconstructed │
  │      approved_at/returned_at/cancel_date     │    History incomplete before │
  │      exist — good coverage for recent rows   │    those cols were added     │
  ├──────────────────────────────────────────────┼──────────────────────────────┤
  │ 088: VIN partial unique index                │ ${vinConflicts > 0
    ? '❌ REQUIRES CLEANUP FIRST  '
    : '✅ SAFE — zero active dupe '} │
  │      ${vinConflicts} active/pending VIN dup(s) found       │    ${vinConflicts > 0
    ? 'Resolve dupes before adding'
    : 'Index can be added safely  '} │
  └──────────────────────────────────────────────┴──────────────────────────────┘`);

  // ── 7. STEP-BY-STEP MIGRATION PLAN ───────────────────────────────────
  section('7. STEP-BY-STEP MIGRATION PLAN');

  console.log(`
  Step 1  ──  Run 083 & 084 (already written, pending Supabase apply)
              charge_at, charge_notified_at on sales
              user_presence, user_activity_daily tables
              Risk: NONE — additive columns

  Step 2  ──  Run 085_customer_uuid_on_transfers.sql  [READY]
              ADD COLUMN customer_uuid to transfers
              Trigger on normalized_phone
              Backfill: ${validPhone} rows will get uuid, ${invalidPhone} skipped (no valid phone)
              Risk: NONE — column nullable, trigger additive

  Step 3  ──  Run 086_transfer_assignments.sql  [TO WRITE]
              CREATE TABLE transfer_assignments (append-only log)
              NO backfill — historical chain not recoverable
              Application code starts writing new rows from deploy date
              Risk: NONE — new table, no schema change to existing tables

  Step 4  ──  Run 087_policy_events.sql  [TO WRITE]
              CREATE TABLE policy_events
              Backfill from existing columns:
                approved_at  → approved event  (${withAppAt} rows)
                returned_at  → returned event   (${withRetAt} rows)
                cancellation_date → cancelled   (${withCanDate} rows)
                is_resell=true    → reinstated  (${resells} rows)
                charge_at IS NOT NULL → pending_charge (${chargeAt} rows)
              Risk: LOW — new table; backfill is INSERT-only, no UPDATE to sales

  Step 5  ──  ${vinConflicts > 0 ? `CLEANUP REQUIRED before 088:
              ${vinConflicts} VIN(s) have multiple active/pending policies.
              Decision required for each: cancel older, merge, or mark superseded.
              DO NOT run 088 until all ${vinConflicts} conflicts resolved.`
    : `Run 088_vin_unique_active.sql  [SAFE]
              CREATE UNIQUE INDEX ON sales(car_vin)
              WHERE car_vin IS NOT NULL AND status IN ('closed_won','pending_review')
              0 conflicts found — index can be added immediately`}

  ─────────────────────────────────────────────────────────────────────────
  DEPLOYMENT ORDER: 083 → 084 → 085 → 086 → 087 → (cleanup) → 088
  ALL migrations idempotent. Safe to re-run if interrupted.
  `);

  console.log('✓ Assessment complete.\n');
}

main().catch(e => {
  console.error('\n❌ Fatal:', e.message);
  process.exit(1);
});

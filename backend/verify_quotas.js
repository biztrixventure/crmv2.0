/**
 * Post-apply verification for migration 216 (team_quotas) + the quota counter.
 *   node backend/verify_quotas.js
 *
 * Read-only except for TWO deliberate constraint probes that are expected to be
 * REJECTED by the database (and are deleted immediately if they somehow aren't).
 *
 * Proves, in order:
 *   1. the table exists and is readable
 *   2. the goal_monthly_* backfill landed (one row per legacy goal, same value)
 *   3. the CHECK constraints actually reject malformed rows
 *   4. the quota counter agrees with the team report for the same people and
 *      window — the "one number" guarantee the whole feature rests on
 *   5. no live allocation points at someone who left the team
 *
 * Prints PASS/FAIL per check and exits non-zero if anything failed.
 */
require('dotenv').config({ path: require('node:path').join(__dirname, '.env.local') });
require('dotenv').config();   // fall back to backend/.env if .env.local is absent

const { createClient } = require('@supabase/supabase-js');
const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in backend/.env.local first.');
  process.exit(1);
}
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  ok ? pass++ : fail++;
};

(async () => {
  console.log('\n── 1. table + shape ────────────────────────────────────────');
  const probe = await sb.from('team_quotas').select('*').limit(1);
  if (probe.error) {
    check('team_quotas exists', false, `${probe.error.code}: ${probe.error.message} — apply 216_team_quotas.sql first`);
    process.exit(1);
  }
  check('team_quotas exists', true);

  const { count: total } = await sb.from('team_quotas').select('*', { count: 'exact', head: true });
  console.log(`        rows: ${total}`);

  console.log('\n── 2. legacy goal_monthly_* backfill ───────────────────────');
  const { data: teams } = await sb.from('teams').select('id, name, company_id, goal_monthly_sales, goal_monthly_transfers');
  const expectSales = (teams || []).filter(t => t.goal_monthly_sales > 0).length;
  const expectXfer  = (teams || []).filter(t => t.goal_monthly_transfers > 0).length;
  const { data: allQ } = await sb.from('team_quotas').select('*');
  const teamTier = (allQ || []).filter(q => !q.user_id);
  const gotSales = teamTier.filter(q => q.metric === 'sales_won'  && q.label === 'Migrated monthly goal').length;
  const gotXfer  = teamTier.filter(q => q.metric === 'transfers'  && q.label === 'Migrated monthly goal').length;
  check(`sales_won backfill (${gotSales}/${expectSales})`, gotSales === expectSales);
  check(`transfers backfill (${gotXfer}/${expectXfer})`,   gotXfer === expectXfer);

  // Every backfilled target must equal the legacy column it came from.
  let mismatched = 0;
  for (const t of (teams || [])) {
    const s = teamTier.find(q => q.team_id === t.id && q.metric === 'sales_won');
    const x = teamTier.find(q => q.team_id === t.id && q.metric === 'transfers');
    if (t.goal_monthly_sales > 0     && Number(s?.target_value) !== Number(t.goal_monthly_sales))     mismatched++;
    if (t.goal_monthly_transfers > 0 && Number(x?.target_value) !== Number(t.goal_monthly_transfers)) mismatched++;
  }
  check('backfilled targets match the legacy columns', mismatched === 0, mismatched ? `${mismatched} mismatch(es)` : '');

  console.log('\n── 3. constraints actually bite ────────────────────────────');
  const anyTeam = (teams || [])[0];
  if (!anyTeam) {
    check('constraint probe', false, 'no teams exist to probe against');
  } else {
    // A TEAM-tier row (user_id NULL) may never carry a parent — team_quotas_tier_shape.
    const bad = await sb.from('team_quotas').insert({
      company_id: anyTeam.company_id, team_id: anyTeam.id,
      user_id: null, parent_quota_id: teamTier[0]?.id || anyTeam.id,
      metric: 'transfers', target_value: 1, period_kind: 'day',
      starts_at: '2000-01-01', ends_at: '2000-01-01', label: '__verify_probe__',
    }).select();
    if (bad.error) {
      check('tier-shape CHECK rejects team-tier row with a parent', bad.error.code === '23514' || /tier_shape/.test(bad.error.message), bad.error.code);
    } else {
      check('tier-shape CHECK rejects team-tier row with a parent', false, 'row was ACCEPTED — constraint missing');
      const id = bad.data?.[0]?.id;
      if (id) { await sb.from('team_quotas').delete().eq('id', id); console.log('        (probe row removed)'); }
    }

    // target_value must be > 0.
    const bad2 = await sb.from('team_quotas').insert({
      company_id: anyTeam.company_id, team_id: anyTeam.id, metric: 'transfers',
      target_value: 0, period_kind: 'day', starts_at: '2000-01-01', ends_at: '2000-01-01', label: '__verify_probe__',
    }).select();
    if (bad2.error) check('target_value > 0 enforced', true, bad2.error.code);
    else {
      check('target_value > 0 enforced', false, 'zero target ACCEPTED');
      const id = bad2.data?.[0]?.id;
      if (id) await sb.from('team_quotas').delete().eq('id', id);
    }
  }

  console.log('\n── 4. the counter agrees with the team report ──────────────');
  // The whole point of quotaMetrics: a team quota's `actual` must equal the sum
  // of its members' actuals, and the transfers figure must match what
  // teamMetrics reports for the same people over the same window.
  const { attachAttainment, countWindow, getCatalog } = require('./utils/quotaMetrics');
  const { teamMetrics, resolveTeamMemberIds } = require('./utils/teamMetrics');

  const sample = teamTier.find(q => q.metric === 'transfers');
  if (!sample) {
    check('counter cross-check', false, 'no transfers quota to test against');
  } else {
    const ids = await resolveTeamMemberIds(sample.team_id, { includeSub: true, companyId: sample.company_id });
    const catalog = await getCatalog(sample.company_id);
    const metric  = catalog.find(m => m.key === 'transfers');

    // Fronter side (all current teams sit in fronter companies); the closer-side
    // column is exercised the moment a closer company gets a team.
    const { byUser, total } = await countWindow({
      metric, userIds: ids, companyId: sample.company_id, closerSide: false,
      from: sample.starts_at, to: sample.ends_at,
    });
    const sumOfMembers = Object.values(byUser).reduce((a, b) => a + b, 0);
    check('team actual === sum of member actuals', total === sumOfMembers, `${total} vs ${sumOfMembers}`);

    const tm = await teamMetrics({ ids, companyId: sample.company_id, from: sample.starts_at, to: sample.ends_at });
    check('quota transfers === teamMetrics transfers', total === tm.totals.transfers,
      `quota ${total} vs report ${tm.totals.transfers}` + (total === tm.totals.transfers ? '' : '  ← THESE MUST MATCH'));

    const decorated = await attachAttainment([sample], {
      companyId: sample.company_id, closerSide: false, memberIdsByTeam: { [sample.team_id]: ids },
    });
    const d = decorated[0];
    const expectPct = Math.round((d.actual / Number(sample.target_value)) * 1000) / 10;
    check('pct is derived from the same actual', d.pct === expectPct, `${d.pct}% of ${sample.target_value}`);
    console.log(`        window ${sample.starts_at}..${sample.ends_at}, ${ids.length} members, actual ${d.actual}`);
  }

  console.log('\n── 5. no orphaned member allocations ───────────────────────');
  const memberTier = (allQ || []).filter(q => q.user_id && q.status !== 'archived');
  let orphans = 0;
  for (const q of memberTier) {
    const { data: m } = await sb.from('team_members').select('id').eq('team_id', q.team_id).eq('user_id', q.user_id).maybeSingle();
    if (!m) orphans++;
  }
  check('every live member allocation targets a current team member', orphans === 0,
    orphans ? `${orphans} allocation(s) point at someone who left the team` : `${memberTier.length} checked`);

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('verify_quotas crashed:', e); process.exit(1); });

// ============================================================================
// SPIFF auto-metrics — derive participant progress from real business activity
// (transfers, sales, revenue) instead of values typed in by a superadmin.
//
// Attribution rules (fixed):
//   transfers → counted by transfers.created_by, status='completed'
//   sales     → counted by sales.closer_id,   status in CLOSED_LIKE
//   revenue   → sum(monthly_payment)          status in REVENUE_LIKE
//
// Compute model: live SQL per request, cached in-process for 60s per campaign.
// Suitable for current scale; swap for a cron-materialized table if leaderboard
// queries get hot. Cache is busted on campaign PUT/DELETE from the route.
// ============================================================================

const { supabaseAdmin } = require('../config/database');

const TTL = 60_000;
const cache = new Map();   // campaign_id -> { at, data }

// "Closed" = a sale that counts toward a "sales" target. Credit is gated on a
// COMPLETED compliance review (closed_won / sold) so the counter increments the
// moment compliance approves a sale — pending_review is intentionally excluded,
// otherwise the number wouldn't move on approval (it already counted at submit).
const CLOSED_LIKE  = ['closed_won', 'sold'];
const REVENUE_LIKE = ['closed_won', 'sold'];

// Resolve the participant pool for a campaign from its targeting fields.
// - target_user_ids wins (explicit list).
// - else: users in target_company_ids whose custom-role level is in target_roles.
// - if no targeting at all → empty pool (we don't silently pick "everyone" because
//   that's almost never what a creator means).
async function resolveParticipants(campaign) {
  if (campaign.target_user_ids?.length) {
    return [...new Set(campaign.target_user_ids)];
  }
  const companyIds = campaign.target_company_ids?.length ? campaign.target_company_ids : null;
  const roles      = campaign.target_roles?.length        ? campaign.target_roles        : null;
  if (!companyIds && !roles) return [];

  let q = supabaseAdmin
    .from('user_company_roles')
    .select('user_id, custom_roles(level)')
    .eq('is_active', true);
  if (companyIds) q = q.in('company_id', companyIds);
  const { data } = await q;
  const filtered = (data || []).filter(r => !roles || roles.includes(r.custom_roles?.level));
  return [...new Set(filtered.map(r => r.user_id))];
}

async function nameMap(userIds) {
  if (!userIds.length) return {};
  const { data } = await supabaseAdmin
    .from('user_profiles').select('user_id, first_name, last_name')
    .in('user_id', userIds);
  const map = {};
  (data || []).forEach(p => { map[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown'; });
  return map;
}

// Paginate past PostgREST's 1000-row cap. Each call returns rows of a single
// kind (transfers OR sales), so total rows per campaign is bounded by the
// active window × participant size — typically well under 10k.
async function fetchAllRows(builder) {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await builder.range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    all.push(...data);
    if (data.length < 1000) break;
  }
  return all;
}

async function computeValues(campaign, userIds) {
  const out = {};
  userIds.forEach(id => { out[id] = 0; });
  if (!userIds.length) return out;

  const { metric_source, starts_at, ends_at } = campaign;

  if (metric_source === 'transfers') {
    const rows = await fetchAllRows(supabaseAdmin
      .from('transfers').select('created_by')
      .eq('status', 'completed')
      .gte('created_at', starts_at).lte('created_at', ends_at)
      .in('created_by', userIds));
    rows.forEach(r => { if (out[r.created_by] != null) out[r.created_by] += 1; });
    return out;
  }

  // Sales / revenue credit. Real-world facts that shaped this:
  //   1. A sale is credited to BOTH its closer and its fronter — whichever side
  //      the campaign targets is the one in the participant pool. Counting only
  //      closer_id (the old behaviour) meant a fronter-audience campaign never
  //      scored, because a fronter is never a sale's closer_id.
  //   2. The fronter = `fronter_id`, OR (when that wasn't denormalized onto the
  //      sale — common on imported/older rows) the linked transfer's creator
  //      (transfers.created_by), the fronter who actually fronted the lead.
  //   3. We window by `sale_date` (the business day the deal happened), NOT
  //      created_at (the row-insert / bulk-upload day), so a deal counts on its
  //      real date and a compliance approval moves the right day's counter.
  if (metric_source === 'sales' || metric_source === 'revenue') {
    const pool      = new Set(userIds);
    const statuses  = metric_source === 'revenue' ? REVENUE_LIKE : CLOSED_LIKE;
    const startDate = String(starts_at).slice(0, 10);
    const endDate   = String(ends_at).slice(0, 10);
    const rows = await fetchAllRows(supabaseAdmin
      .from('sales').select('closer_id, fronter_id, monthly_payment, transfers(created_by)')
      .in('status', statuses)
      .gte('sale_date', startDate).lte('sale_date', endDate));
    rows.forEach(r => {
      const inc     = metric_source === 'revenue' ? (Number(r.monthly_payment) || 0) : 1;
      const fronter = r.fronter_id || r.transfers?.created_by || null;
      if (r.closer_id && pool.has(r.closer_id)) out[r.closer_id] += inc;
      if (fronter && fronter !== r.closer_id && pool.has(fronter)) out[fronter] += inc;
    });
    return out;
  }

  return out;   // 'manual' shouldn't reach this util; defensive fallthrough.
}

// Public: get a campaign's live progress (cached). Returns null for manual
// campaigns so the caller falls back to the existing spiff_entries flow.
async function getProgress(campaign) {
  if (!campaign || campaign.metric_source === 'manual') return null;
  const hit = cache.get(campaign.id);
  if (hit && Date.now() - hit.at < TTL) return hit.data;

  const ids    = await resolveParticipants(campaign);
  const values = await computeValues(campaign, ids);
  const names  = await nameMap(ids);

  // Leaderboard format mirrors the existing manual spiff_entries shape so the
  // widget/UI doesn't have to know which mode produced the row.
  const entries = ids
    .map(id => ({ user_id: id, value: values[id] || 0, name: names[id] || 'Unknown' }))
    .sort((a, b) => b.value - a.value)
    .map((e, i) => ({ ...e, rank: i + 1 }));

  const data = { entries, valueByUser: values, participantCount: ids.length };
  cache.set(campaign.id, { at: Date.now(), data });
  return data;
}

function invalidate(campaignId) { cache.delete(campaignId); }
function invalidateAll()         { cache.clear(); }

// Call when sales activity changes (e.g. compliance approves a sale). Auto
// sales/revenue campaigns derive progress from the `sales` table — which is NOT
// in the realtime publication — so the SpiffWidget would never refresh on its
// own. We (1) drop the cache so the next read recomputes, and (2) fire a
// realtime event on spiff_campaigns (which IS published and the widget already
// listens to) via a no-op write, so every viewer's counter refreshes instantly.
// spiff_campaigns has no updated_at column, so re-writing `status` to its own
// value is the safe no-op that still emits a logical-replication change.
async function onSalesActivityChanged() {
  invalidateAll();
  try {
    await supabaseAdmin.from('spiff_campaigns')
      .update({ status: 'active' })
      .eq('status', 'active')
      .in('metric_source', ['sales', 'revenue']);
  } catch { /* non-critical — cache is already busted */ }
}

module.exports = { getProgress, invalidate, invalidateAll, onSalesActivityChanged, CLOSED_LIKE, REVENUE_LIKE };

// ============================================================================
// teamMetrics — roll a team's members' output into team progress + a per-member
// leaderboard + a daily trend, computed LIVE from attribution columns:
//   sales:     closer_id (closed), fronter_id (fronted), down_payment (gross),
//              monthly_payment (MRR), status, sale_date (business day)
//   transfers: created_by (fronter), assigned_closer_id (closer), created_at,
//              exclude vicidial_pending
//   callbacks: user_id, status, callback_at
//
// A team is just a set of member user_ids (optionally including nested sub-team
// members). No denormalized totals — always current. Never throws (returns
// zeros) so a report page can't 500.
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const logger = require('./logger');

const WON = ['closed_won', 'sold'];   // matches spiffMetrics CLOSED_LIKE
const ROW_CAP = 20000;                // Supabase page cap per query; surfaced as `capped`

// Resolve the member user_ids of a team. includeSub → also members of every
// descendant team (parent_team_id chain), for nested-org rollups.
async function resolveTeamMemberIds(teamId, { includeSub = true, companyId = null } = {}) {
  let teamIds = [teamId];
  if (includeSub) {
    const { data: team } = await supabaseAdmin.from('teams').select('company_id').eq('id', teamId).maybeSingle();
    const coId = companyId || team?.company_id;
    if (coId) {
      const { data: all } = await supabaseAdmin.from('teams').select('id, parent_team_id').eq('company_id', coId);
      const childrenOf = {};
      (all || []).forEach(t => { (childrenOf[t.parent_team_id] = childrenOf[t.parent_team_id] || []).push(t.id); });
      const acc = new Set([teamId]);
      const stack = [teamId];
      while (stack.length) { const cur = stack.pop(); for (const c of (childrenOf[cur] || [])) if (!acc.has(c)) { acc.add(c); stack.push(c); } }
      teamIds = [...acc];
    }
  }
  const { data: members } = await supabaseAdmin.from('team_members').select('user_id').in('team_id', teamIds);
  return [...new Set((members || []).map(m => m.user_id).filter(Boolean))];
}

const dayKey = (d) => (d ? String(d).slice(0, 10) : null);
const blankTotals = () => ({
  transfers: 0, assigned: 0, sales: 0, gross: 0, callbacks: 0,
  mrr: 0, fronted: 0, fronted_gross: 0,
  conversion: null, avg_deal: null, close_rate: null, active_members: 0,
});

// Full team report for a set of member ids in a company + [from,to] date range.
async function teamMetrics({ ids, companyId, from, to }) {
  const blank = { totals: blankTotals(), members: [], trend: [], capped: false };
  if (!ids || !ids.length || !companyId) return blank;
  const idSet = new Set(ids);
  // Chunk the id list so the .or()/.in() filter never overflows the request URL
  // on a large nested rollup (each 36-char uuid is embedded up to twice per
  // query). ~100 ids/chunk keeps the encoded URL well under gateway limits;
  // rows spanning two chunks are de-duped by primary key so nothing is
  // double-counted. Teams ≤100 members run exactly one query per table.
  const ID_CHUNK = 100;
  const idChunks = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) idChunks.push(ids.slice(i, i + ID_CHUNK));
  let capped = false;
  try {
    const M = {};
    // every member carries the full stat shape so the client never sees undefined
    const m = (id) => (M[id] = M[id] || { user_id: id, transfers: 0, assigned: 0, sales: 0, gross: 0, callbacks: 0, fronted: 0, fronted_gross: 0, mrr: 0 });
    const trend = {};   // date → { transfers, sales, gross, callbacks, assigned }
    const day = (date) => { const k = dayKey(date); if (!k) return null; return (trend[k] = trend[k] || { date: k, transfers: 0, sales: 0, gross: 0, callbacks: 0, assigned: 0, fronted: 0 }); };
    const bump = (date, key) => { const d = day(date); if (d) d[key]++; };
    const bumpVal = (date, key, amt) => { const d = day(date); if (d) d[key] += amt; };

    // 1) transfers — fronter (created_by) + closer pipeline (assigned_closer_id)
    const seenT = new Set();   // dedup rows matched across chunks
    for (const chunk of idChunks) {
      let tq = supabaseAdmin.from('transfers')
        .select('id, created_by, assigned_closer_id, created_at')
        .eq('company_id', companyId).neq('vicidial_pending', true)
        .or(`created_by.in.(${chunk.join(',')}),assigned_closer_id.in.(${chunk.join(',')})`);
      if (from) tq = tq.gte('created_at', from);
      if (to)   tq = tq.lte('created_at', `${to}T23:59:59.999Z`);
      const { data: tfs } = await tq.limit(ROW_CAP);
      if ((tfs?.length || 0) === ROW_CAP) capped = true;
      for (const t of (tfs || [])) {
        if (seenT.has(t.id)) continue; seenT.add(t.id);
        if (idSet.has(t.created_by)) { m(t.created_by).transfers++; bump(t.created_at, 'transfers'); }
        if (idSet.has(t.assigned_closer_id)) { m(t.assigned_closer_id).assigned++; bump(t.created_at, 'assigned'); }
      }
    }

    // 2) sales — closed by a member (closer_id); gross = down_payment on won;
    //    MRR = monthly_payment on won; also credit fronted wins (fronter_id).
    const seenS = new Set();
    for (const chunk of idChunks) {
      let sq = supabaseAdmin.from('sales')
        .select('id, closer_id, fronter_id, down_payment, monthly_payment, status, sale_date')
        .eq('company_id', companyId)
        .or(`closer_id.in.(${chunk.join(',')}),fronter_id.in.(${chunk.join(',')})`);
      if (from) sq = sq.gte('sale_date', from);
      if (to)   sq = sq.lte('sale_date', to);
      const { data: sales } = await sq.limit(ROW_CAP);
      if ((sales?.length || 0) === ROW_CAP) capped = true;
      for (const s of (sales || [])) {
        if (seenS.has(s.id)) continue; seenS.add(s.id);
        if (!WON.includes(s.status)) continue;
        const dp = Number(s.down_payment) || 0;
        if (idSet.has(s.closer_id)) {
          const rec = m(s.closer_id); rec.sales++; rec.gross += dp; rec.mrr += Number(s.monthly_payment) || 0;
          bump(s.sale_date, 'sales'); bumpVal(s.sale_date, 'gross', dp);
        }
        // Fronted-win credit (rows already fetched — the OR filter includes fronter_id).
        if (idSet.has(s.fronter_id)) { const r2 = m(s.fronter_id); r2.fronted++; r2.fronted_gross += dp; bump(s.sale_date, 'fronted'); }
      }
    }

    // 3) callbacks — handled (completed) by a member. Chunks are disjoint id
    //    sets and a callback has one user_id, so no cross-chunk dedup needed.
    for (const chunk of idChunks) {
      let cq = supabaseAdmin.from('callbacks')
        .select('user_id, status, callback_at')
        .eq('company_id', companyId).eq('status', 'completed').in('user_id', chunk);
      if (from) cq = cq.gte('callback_at', from);
      if (to)   cq = cq.lte('callback_at', `${to}T23:59:59.999Z`);
      const { data: cbs } = await cq.limit(ROW_CAP);
      if ((cbs?.length || 0) === ROW_CAP) capped = true;
      for (const c of (cbs || [])) if (idSet.has(c.user_id)) { m(c.user_id).callbacks++; bump(c.callback_at, 'callbacks'); }
    }

    // names
    const names = {};
    const { data: profs } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', ids);
    (profs || []).forEach(p => { names[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown'; });

    ids.forEach(id => m(id));   // every member appears, even at zero
    const members = Object.values(M).map(r => ({
      ...r, name: names[r.user_id] || 'Unknown',
      avg_deal: r.sales ? +(r.gross / r.sales).toFixed(2) : null,
    })).sort((a, b) => (b.sales - a.sales) || (b.gross - a.gross) || (b.transfers - a.transfers));

    const totals = members.reduce((t, r) => ({
      transfers: t.transfers + r.transfers, assigned: t.assigned + r.assigned,
      sales: t.sales + r.sales, gross: t.gross + r.gross, callbacks: t.callbacks + r.callbacks,
      mrr: t.mrr + r.mrr, fronted: t.fronted + r.fronted, fronted_gross: t.fronted_gross + r.fronted_gross,
    }), { transfers: 0, assigned: 0, sales: 0, gross: 0, callbacks: 0, mrr: 0, fronted: 0, fronted_gross: 0 });

    // Derived, all divide-by-zero guarded.
    totals.conversion = totals.transfers > 0 && totals.sales <= totals.transfers
      ? +(100 * totals.sales / totals.transfers).toFixed(1) : null;
    totals.avg_deal = totals.sales > 0 ? +(totals.gross / totals.sales).toFixed(2) : null;
    totals.close_rate = totals.assigned > 0 ? +(100 * totals.sales / totals.assigned).toFixed(1) : null;
    totals.active_members = members.filter(r => r.transfers || r.assigned || r.sales || r.callbacks).length;

    return { totals, members, trend: Object.values(trend).sort((a, b) => a.date.localeCompare(b.date)), capped };
  } catch (e) {
    logger.warn('TEAM_METRICS', `teamMetrics failed: ${e.message}`);
    return blank;
  }
}

module.exports = { resolveTeamMemberIds, teamMetrics, WON };

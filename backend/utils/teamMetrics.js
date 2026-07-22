// ============================================================================
// teamMetrics — roll a team's members' output into team progress + a per-member
// leaderboard + a daily trend, computed LIVE from attribution columns:
//   sales:     closer_id (closed), fronter_id (fronted), down_payment (gross),
//              status, sale_date (business day)
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

// Full team report for a set of member ids in a company + [from,to] date range.
async function teamMetrics({ ids, companyId, from, to }) {
  const blank = { totals: { transfers: 0, assigned: 0, sales: 0, gross: 0, callbacks: 0, conversion: null }, members: [], trend: [] };
  if (!ids || !ids.length || !companyId) return blank;
  const idSet = new Set(ids);
  try {
    const M = {};
    const m = (id) => (M[id] = M[id] || { user_id: id, transfers: 0, assigned: 0, sales: 0, gross: 0, callbacks: 0 });
    const trend = {};   // date → { transfers, sales }
    const bump = (date, key) => { const k = dayKey(date); if (!k) return; (trend[k] = trend[k] || { date: k, transfers: 0, sales: 0 })[key]++; };

    // 1) transfers — fronter (created_by) + closer pipeline (assigned_closer_id)
    let tq = supabaseAdmin.from('transfers')
      .select('created_by, assigned_closer_id, created_at')
      .eq('company_id', companyId).neq('vicidial_pending', true)
      .or(`created_by.in.(${ids.join(',')}),assigned_closer_id.in.(${ids.join(',')})`);
    if (from) tq = tq.gte('created_at', from);
    if (to)   tq = tq.lte('created_at', `${to}T23:59:59.999Z`);
    const { data: tfs } = await tq.limit(20000);
    for (const t of (tfs || [])) {
      if (idSet.has(t.created_by)) { m(t.created_by).transfers++; bump(t.created_at, 'transfers'); }
      if (idSet.has(t.assigned_closer_id)) m(t.assigned_closer_id).assigned++;
    }

    // 2) sales — closed by a member (closer_id); gross = down_payment on won
    let sq = supabaseAdmin.from('sales')
      .select('closer_id, fronter_id, down_payment, status, sale_date')
      .eq('company_id', companyId)
      .or(`closer_id.in.(${ids.join(',')}),fronter_id.in.(${ids.join(',')})`);
    if (from) sq = sq.gte('sale_date', from);
    if (to)   sq = sq.lte('sale_date', to);
    const { data: sales } = await sq.limit(20000);
    for (const s of (sales || [])) {
      if (idSet.has(s.closer_id) && WON.includes(s.status)) {
        const rec = m(s.closer_id); rec.sales++; rec.gross += Number(s.down_payment) || 0;
        bump(s.sale_date, 'sales');
      }
    }

    // 3) callbacks — handled (completed) by a member
    let cq = supabaseAdmin.from('callbacks')
      .select('user_id, status, callback_at')
      .eq('company_id', companyId).eq('status', 'completed').in('user_id', ids);
    if (from) cq = cq.gte('callback_at', from);
    if (to)   cq = cq.lte('callback_at', `${to}T23:59:59.999Z`);
    const { data: cbs } = await cq.limit(20000);
    for (const c of (cbs || [])) if (idSet.has(c.user_id)) m(c.user_id).callbacks++;

    // names
    const names = {};
    const { data: profs } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', ids);
    (profs || []).forEach(p => { names[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown'; });

    ids.forEach(id => m(id));   // every member appears, even at zero
    const members = Object.values(M).map(r => ({ ...r, name: names[r.user_id] || 'Unknown' }))
      .sort((a, b) => (b.sales - a.sales) || (b.transfers - a.transfers));

    const totals = members.reduce((t, r) => ({
      transfers: t.transfers + r.transfers, assigned: t.assigned + r.assigned,
      sales: t.sales + r.sales, gross: t.gross + r.gross, callbacks: t.callbacks + r.callbacks,
    }), { transfers: 0, assigned: 0, sales: 0, gross: 0, callbacks: 0 });
    totals.conversion = totals.transfers > 0 && totals.sales <= totals.transfers
      ? +(100 * totals.sales / totals.transfers).toFixed(1) : null;

    return { totals, members, trend: Object.values(trend).sort((a, b) => a.date.localeCompare(b.date)) };
  } catch (e) {
    logger.warn('TEAM_METRICS', `teamMetrics failed: ${e.message}`);
    return blank;
  }
}

module.exports = { resolveTeamMemberIds, teamMetrics, WON };

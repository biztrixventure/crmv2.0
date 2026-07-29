const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { etDateToUtcStart, etDateToUtcEnd, todayEt } = require('../utils/etUtils');
const { getConfig } = require('../utils/businessConfig');
const { isCloserSideScope, getCompanyType } = require('../models/helpers');
const logger = require('../utils/logger');

const router = express.Router();

// ============================================================================
// GET /stats/dashboard - Get dashboard statistics for the current user
// ============================================================================
router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const companyId = req.user.company_id;
    const userRole = req.user.role;

    logger.info('GET_DASHBOARD_STATS', `Fetching stats for user=${userId}, role=${userRole}`);

    try {
      const stats = {};

      const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
      // company_admin resolves its side from the COMPANY TYPE (helpers), so a
      // closer company's admin now counts the same rows its Team Sales tab
      // lists. Every other role answers exactly as it did before.
      const isCloserSide = await isCloserSideScope(userRole, companyId);

      // Closer-side company user ids (for assigned_closer_id / closer_id scoping).
      let coUserIds = [];
      if (isCloserSide && companyId && userRole !== 'closer') {
        const { data: coUsers } = await supabaseAdmin
          .from('user_company_roles').select('user_id').eq('company_id', companyId).eq('is_active', true);
        coUserIds = (coUsers || []).map(u => u.user_id);
      }

      // ── Transfer stats — COUNT queries so figures are never capped at the
      //    1000-row fetch limit (the old code counted statuses inside a fetched
      //    array, so "Pending" only reflected the first 1000 transfers). ──────────
      const scopeTransfers = (q) => {
        // VICIdial pending-from-dialer rows aren't real transfers yet — never count them.
        q = q.neq('vicidial_pending', true);
        if (isCloserSide && companyId) {
          if (userRole === 'closer') return q.eq('assigned_closer_id', userId);
          if (coUserIds.length) return q.in('assigned_closer_id', coUserIds);
          return q.eq('id', ZERO_UUID);
        }
        if (companyId) q = q.eq('company_id', companyId);
        if (userRole === 'fronter') q = q.eq('created_by', userId);
        return q;
      };
      const xferCount = (status) => {
        let q = scopeTransfers(supabaseAdmin.from('transfers').select('id', { count: 'exact', head: true }));
        if (status) q = q.eq('status', status);
        return q;
      };
      const [tAll, tPending, tAssigned, tCompleted] = await Promise.all([
        xferCount(), xferCount('pending'), xferCount('assigned'), xferCount('completed'),
      ]);
      stats.totalTransfers     = tAll.count || 0;
      stats.pendingTransfers   = tPending.count || 0;
      stats.assignedTransfers  = tAssigned.count || 0;
      stats.completedTransfers = tCompleted.count || 0;

      // ── "Today" window — config-driven timezone via kpi.today_timezone.
      // Defaults to America/New_York. Closer in any timezone sees the same
      // company-defined business day boundary.
      const tzName     = await getConfig(companyId, 'kpi.today_timezone', 'America/New_York');
      const todayStr   = todayEt(tzName);
      const todayStart = etDateToUtcStart(todayStr);
      const todayEndIso = etDateToUtcEnd(todayStr);
      const tToday = await scopeTransfers(supabaseAdmin.from('transfers').select('id', { count: 'exact', head: true }))
        .gte('created_at', todayStart)
        .lte('created_at', todayEndIso);
      stats.todayTransfers = tToday.count || 0;

      // Resell privacy + KPI counting rules — pre-resolve once per request.
      let hideResells = false;
      if (userRole === 'fronter') {
        hideResells = !!(await getConfig(companyId, 'resell.hide_from_fronter', true));
      } else if (userRole === 'fronter_manager') {
        hideResells = !!(await getConfig(companyId, 'resell.hide_from_fronter_manager', true));
      } else if (userRole === 'compliance_manager') {
        hideResells = !!(await getConfig(companyId, 'resell.hide_from_compliance', false));
      }
      // kpi.resell_counts_in toggles whether resells contribute to each stat
      // family. Privacy filter still wins (a fronter who hides resells never
      // sees them regardless of this flag), but for closer-side roles it lets
      // superadmin decide if "Total Sales" should include resells or not.
      const kpiCounts = (await getConfig(companyId, 'kpi.resell_counts_in', {
        closer_total: true, conversion: false, fronter_stats: false, resells_card: true,
      })) || {};
      const excludeResellsFromTotal = !hideResells && kpiCounts.closer_total === false;
      const excludeResellsFromConversion = kpiCounts.conversion === false;

      // ── Sales stats — role-scoped COUNT queries (also uncapped). ───────────────
      const scopeSales = (q) => {
        if (['superadmin', 'readonly_admin'].includes(userRole)) return q;              // global
        if (userRole === 'closer') return q.eq('closer_id', userId);                    // own sales
        // Fronter: their personal pipeline only — sales whose fronter_id is them.
        // Without this branch the company_id filter below would surface every
        // sale in the fronter's company, which made the dashboard show team-
        // wide totals instead of the fronter's own numbers.
        if (userRole === 'fronter') {
          q = q.eq('fronter_id', userId);
          if (hideResells) q = q.eq('is_resell', false);
          return q;
        }
        if (isCloserSide && companyId) return coUserIds.length ? q.in('closer_id', coUserIds) : q.eq('id', ZERO_UUID);
        // Fronter managers and other in-company roles: fronter-pipeline sales
        // carry the fronter company_id.
        if (companyId) {
          q = q.eq('company_id', companyId);
          if (hideResells) q = q.eq('is_resell', false);
          return q;
        }
        return q.eq('id', ZERO_UUID);
      };
      const saleCount = (status, opts = {}) => {
        let q = scopeSales(supabaseAdmin.from('sales').select('id', { count: 'exact', head: true }));
        if (status) q = q.eq('status', status);
        // closer-side roles may opt to exclude resells from totals via kpi config.
        if (opts.excludeResells || (excludeResellsFromTotal && !opts.includeResells)) {
          q = q.eq('is_resell', false);
        }
        return q;
      };
      const [sAll, sOpen, sWon, sLost, sReview, sCancelled, sRevision] = await Promise.all([
        saleCount(), saleCount('open'), saleCount('closed_won'), saleCount('closed_lost'), saleCount('pending_review'),
        saleCount('cancelled'), saleCount('needs_revision'),
      ]);
      stats.totalSales         = sAll.count || 0;
      stats.openSales          = sOpen.count || 0;
      stats.closedWon          = sWon.count || 0;
      stats.closedLost         = sLost.count || 0;
      stats.awaitingCompliance = sReview.count || 0;
      stats.cancelledSales     = sCancelled.count || 0;
      // Live backlog of sales compliance returned for revision. This is a
      // CURRENT count, not cumulative — when compliance's issue is resolved and
      // the sale moves out of needs_revision (resubmitted / approved), it stops
      // being counted, so the "Returned from compliance" KPI decrements on its
      // own. Closer scope = own returns; manager scope = company.
      stats.needsRevision      = sRevision.count || 0;

      // Per-status sale counts — drives the dynamic pipeline bar on the
      // SuperAdmin dashboard so adding a custom status in Business Rules →
      // Compliance Workflow → Sale status catalog instantly shows up in the
      // pipeline. Reads enabled keys from compliance.status_catalog or
      // falls back to allowed_statuses; final fallback is the hardcoded
      // legacy list so old deployments still render something useful.
      const catalog = await getConfig(companyId, 'compliance.status_catalog', null);
      let enabledStatusKeys;
      if (Array.isArray(catalog) && catalog.length) {
        enabledStatusKeys = catalog.filter(s => s.enabled !== false).map(s => s.key);
      } else {
        enabledStatusKeys = (await getConfig(companyId, 'compliance.allowed_statuses', [
          'open','sold','cancelled','follow_up','closed_won','closed_lost',
          'pending_review','needs_revision','compliance_cancelled','chargeback','dispute',
        ])) || [];
      }
      const byStatus = {};
      // Reuse existing aggregate counts where we already have them to skip
      // duplicate round-trips.
      const known = {
        open: stats.openSales,
        closed_won: stats.closedWon,
        closed_lost: stats.closedLost,
        pending_review: stats.awaitingCompliance,
        cancelled: stats.cancelledSales,
      };
      for (const key of enabledStatusKeys) {
        if (Object.prototype.hasOwnProperty.call(known, key)) {
          byStatus[key] = known[key] || 0;
        } else {
          try {
            const r = await saleCount(key);
            byStatus[key] = r.count || 0;
          } catch { byStatus[key] = 0; }
        }
      }
      stats.salesByStatus = byStatus;

      // Today's sales totals — keyed on sale_date (the business day the sale
      // actually happened), NOT created_at. Without this, a bulk upload of an
      // old April workbook today would inflate "Today: N" because every row's
      // created_at = NOW(). sale_date is a DATE column so plain string equality
      // matches the ET calendar day. UI Date columns already display sale_date,
      // so the count and the visible list now agree.
      const sToday = await scopeSales(supabaseAdmin.from('sales').select('id', { count: 'exact', head: true }))
        .eq('sale_date', todayStr);
      stats.todaySales = sToday.count || 0;
      const sTodayWon = await scopeSales(supabaseAdmin.from('sales').select('id', { count: 'exact', head: true }))
        .eq('status', 'closed_won')
        .eq('sale_date', todayStr);
      stats.todayClosedWon = sTodayWon.count || 0;
      // ── Cancellation count (G7) ────────────────────────────────────────────
      // Config picks the anchor: 'cancellation_date' (default, matches what
      // auditors expect — "cancels that happened in May") OR 'sale_date'
      // (legacy — counts sales SOLD in May that later cancelled, regardless
      // of when the cancel was filed). Switchable per company so downstream
      // BI tools aren't surprised by a silent shift.
      const cancelKey = await getConfig(companyId, 'kpi.cancel_count_keys_on', 'cancellation_date');
      const cancelAnchor = cancelKey === 'sale_date' ? 'sale_date' : 'cancellation_date';
      const sTodayCancelled = await scopeSales(supabaseAdmin.from('sales').select('id', { count: 'exact', head: true }))
        .eq('status', 'cancelled')
        .eq(cancelAnchor, todayStr);
      stats.todayCancelled = sTodayCancelled.count || 0;

      // ── Month-to-date sales metrics — same scope/privacy as today, just a
      // wider date window. Drives the third clickable segment on stat cards. ──
      const monthStart = `${todayStr.slice(0, 7)}-01`;
      const monthSales = await scopeSales(supabaseAdmin.from('sales').select('id', { count: 'exact', head: true }))
        .gte('sale_date', monthStart).lte('sale_date', todayStr);
      stats.monthSales = monthSales.count || 0;
      const monthWon = await scopeSales(supabaseAdmin.from('sales').select('id', { count: 'exact', head: true }))
        .eq('status', 'closed_won').gte('sale_date', monthStart).lte('sale_date', todayStr);
      stats.monthClosedWon = monthWon.count || 0;
      const monthCanc = await scopeSales(supabaseAdmin.from('sales').select('id', { count: 'exact', head: true }))
        .eq('status', 'cancelled').gte(cancelAnchor, monthStart).lte(cancelAnchor, todayStr);
      stats.monthCancelled = monthCanc.count || 0;

      // Month-to-date transfers — keyed on created_at (no business-date col).
      const mtStart = etDateToUtcStart(monthStart);
      const monthXfers = await scopeTransfers(supabaseAdmin.from('transfers').select('id', { count: 'exact', head: true }))
        .gte('created_at', mtStart).lte('created_at', todayEndIso);
      stats.monthTransfers = monthXfers.count || 0;

      // Today/MTD completed transfers — the fronter's "approved" KPI on their
      // dashboard. Counting completed transfers (not closed_won sales) keeps
      // the card number aligned with the records shown when the user clicks
      // through, so Total on Approved actually surfaces those rows.
      const todayCompletedX = await scopeTransfers(supabaseAdmin.from('transfers').select('id', { count: 'exact', head: true }))
        .eq('status', 'completed').gte('created_at', todayStart).lte('created_at', todayEndIso);
      stats.todayCompletedTransfers = todayCompletedX.count || 0;
      const monthCompletedX = await scopeTransfers(supabaseAdmin.from('transfers').select('id', { count: 'exact', head: true }))
        .eq('status', 'completed').gte('created_at', mtStart).lte('created_at', todayEndIso);
      stats.monthCompletedTransfers = monthCompletedX.count || 0;

      // Duplicate-attempt counts — fronter-side company scope only. Surfaces
      // refresh / reengage / sale_overlap events the dedup flow logged but
      // didn't count as new transfers. Closer-side and superadmin (no
      // companyId) get 0 by omission.
      stats.dupToday = 0; stats.dupMonth = 0; stats.dupTotal = 0;
      if (companyId && !isCloserSide) {
        try {
          const dupBase = () => supabaseAdmin
            .from('transfer_dedup_events').select('id', { count: 'exact', head: true })
            .eq('company_id', companyId);
          const scopeDup = (q) => userRole === 'fronter' ? q.eq('fronter_id', userId) : q;
          const [dToday, dMonth, dTotal] = await Promise.all([
            scopeDup(dupBase()).gte('created_at', todayStart).lte('created_at', todayEndIso),
            scopeDup(dupBase()).gte('created_at', mtStart).lte('created_at', todayEndIso),
            scopeDup(dupBase()),
          ]);
          stats.dupToday = dToday.count || 0;
          stats.dupMonth = dMonth.count || 0;
          stats.dupTotal = dTotal.count || 0;
        } catch {
          // Table missing (pre-mig 072) — leave zeros so UI renders cleanly.
        }
      }

      // Resell counts — month-to-date + all-time. Always-on; fronter scope
      // still applies, so a fronter with hide_from_fronter=true sees 0 here
      // (their pipeline doesn't include resells by definition).
      try {
        const monthStart = `${todayStr.slice(0, 7)}-01`;
        const sResellMtd = await scopeSales(supabaseAdmin.from('sales').select('id', { count: 'exact', head: true }))
          .eq('is_resell', true).gte('sale_date', monthStart).lte('sale_date', todayStr);
        stats.resellsThisMonth = sResellMtd.count || 0;
        const sResellTotal = await scopeSales(supabaseAdmin.from('sales').select('id', { count: 'exact', head: true }))
          .eq('is_resell', true);
        stats.resellsTotal = sResellTotal.count || 0;
      } catch {
        // Column missing (pre-mig 069) — leave counts undefined so frontend renders 0.
        stats.resellsThisMonth = 0;
        stats.resellsTotal = 0;
      }

      // Conversion rate — config-driven numerator + denominator.
      //   numerator:    closed_won (default) | closed_won_plus_sold | all_non_cancelled
      //   denominator:  all_transfers (default) | transfers_minus_rejected | assigned_transfers_only
      const numMode = await getConfig(companyId, 'kpi.conversion_numerator',   'closed_won');
      const denMode = await getConfig(companyId, 'kpi.conversion_denominator', 'all_transfers');
      let conversionNumerator = stats.closedWon;
      try {
        if (numMode === 'closed_won_plus_sold') {
          const a = await saleCount('closed_won', { excludeResells: excludeResellsFromConversion });
          const b = await saleCount('sold',       { excludeResells: excludeResellsFromConversion });
          conversionNumerator = (a.count || 0) + (b.count || 0);
        } else if (numMode === 'all_non_cancelled') {
          let q = scopeSales(supabaseAdmin.from('sales').select('id', { count: 'exact', head: true }));
          q = q.not('status', 'in', '(cancelled,compliance_cancelled,closed_lost)');
          if (excludeResellsFromConversion) q = q.eq('is_resell', false);
          const r = await q;
          conversionNumerator = r.count || 0;
        } else if (excludeResellsFromConversion) {
          const r = await saleCount('closed_won', { excludeResells: true });
          conversionNumerator = r.count || 0;
        }
      } catch { /* fall back to base closedWon */ }

      let conversionDenominator = stats.totalTransfers;
      if (denMode === 'transfers_minus_rejected') {
        conversionDenominator = stats.totalTransfers - (tPending.count || 0) - 0;
        // approximate — actual rejected count would need another query
        try {
          let q = scopeTransfers(supabaseAdmin.from('transfers').select('id', { count: 'exact', head: true }))
            .eq('status', 'rejected');
          const r = await q;
          conversionDenominator = stats.totalTransfers - (r.count || 0);
        } catch { /* ignore */ }
      } else if (denMode === 'assigned_transfers_only') {
        try {
          let q = scopeTransfers(supabaseAdmin.from('transfers').select('id', { count: 'exact', head: true }))
            .in('status', ['assigned', 'completed']);
          const r = await q;
          conversionDenominator = r.count || 0;
        } catch { /* fall back to totalTransfers */ }
      }
      stats.conversionRate = conversionDenominator > 0
        ? Math.round((conversionNumerator / conversionDenominator) * 100)
        : 0;

      // Admin-level stats
      if (['superadmin', 'readonly_admin', 'company_admin'].includes(userRole)) {
        // User count
        let userQuery = supabaseAdmin
          .from('user_company_roles')
          .select('id', { count: 'exact' })
          .eq('is_active', true);

        if (companyId && userRole !== 'superadmin') {
          userQuery = userQuery.eq('company_id', companyId);
        }

        const { count: userCount } = await userQuery;
        stats.totalUsers = userCount || 0;

        // Company count (superadmin only)
        if (userRole === 'superadmin') {
          const { count: companyCount } = await supabaseAdmin
            .from('companies')
            .select('id', { count: 'exact' })
            .eq('is_active', true);
          stats.totalCompanies = companyCount || 0;
        }

        // Role count
        let roleQuery = supabaseAdmin
          .from('custom_roles')
          .select('id', { count: 'exact' });

        if (companyId && userRole !== 'superadmin') {
          roleQuery = roleQuery.or(`company_id.eq.${companyId},company_id.is.null`);
        }

        const { count: roleCount } = await roleQuery;
        stats.totalRoles = roleCount || 0;
      }

      // Team stats for managers
      if (['manager', 'fronter_manager', 'operations_manager', 'closer_manager', 'company_admin'].includes(userRole)) {
        const { count: teamCount } = await supabaseAdmin
          .from('user_company_roles')
          .select('id', { count: 'exact' })
          .eq('company_id', companyId)
          .eq('is_active', true);
        stats.teamSize = teamCount || 0;
      }

      logger.success('GET_DASHBOARD_STATS', `Stats computed`, stats);
      res.json({ success: true, stats });
    } catch (err) {
      logger.error('GET_DASHBOARD_STATS', 'Failed to compute stats', err);
      res.status(500).json({ success: false, error: err.message });
    }
  })
);

// ============================================================================
// GET /stats/team-trends?days=14 — daily activity + agent leaderboard for the
// manager's team. Scoped exactly like /dashboard (company / closer-side). Feeds
// the Team Performance charts in the Manager overview.
// ============================================================================
router.get('/team-trends', asyncHandler(async (req, res) => {
  const userId = req.user.id, companyId = req.user.company_id, role = req.user.role;
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 7), 60);
  const ZERO = '00000000-0000-0000-0000-000000000000';
  // Window, resolved ONCE and shared by the totals and the chart.
  //
  // These used to disagree. The totals counted from `now - days*24h`, a rolling
  // instant, while the chart drew buckets for `days` CALENDAR dates ending
  // today — so rows in the part-day at the start of the window were counted in
  // the headline but had no bar to land in. Measured on EasyTech: headline 351,
  // bars summing 302. Same panel, same request, two different answers.
  //
  // Both now use whole days in the company's configured KPI timezone, from the
  // start of (today - days) to the end of today, which is also what the
  // "Last 7 days" preset in DateRangePicker asks the list endpoints for — so
  // this panel finally agrees with the funnel, the agent table and compliance.
  const tzName   = await getConfig(companyId, 'kpi.today_timezone', 'America/New_York');
  const todayStr = todayEt(tzName);
  const dayList  = [];
  for (let i = days; i >= 0; i--) {
    dayList.push(new Date(Date.parse(`${todayStr}T00:00:00Z`) - i * 86400000).toISOString().slice(0, 10));
  }
  const windowStart = etDateToUtcStart(dayList[0]);
  const windowEnd   = etDateToUtcEnd(dayList[dayList.length - 1]);
  // Same company-type rule as /dashboard, minus 'closer': a lone closer has no
  // team here and must not be widened to their whole company's numbers.
  const isCloserSide = role !== 'closer' && await isCloserSideScope(role, companyId);
  const isGlobal = ['superadmin', 'readonly_admin'].includes(role);

  let coUserIds = [];
  if (isCloserSide && companyId) {
    const { data } = await supabaseAdmin
      .from('user_company_roles').select('user_id').eq('company_id', companyId).eq('is_active', true);
    coUserIds = (data || []).map(u => u.user_id);
  }

  const scopeT = (q) => {
    q = q.neq('vicidial_pending', true);
    if (isGlobal) return q;
    if (isCloserSide) return coUserIds.length ? q.in('assigned_closer_id', coUserIds) : q.eq('id', ZERO);
    return companyId ? q.eq('company_id', companyId) : q;
  };
  const scopeS = (q) => {
    if (isGlobal) return q;
    if (isCloserSide) return coUserIds.length ? q.in('closer_id', coUserIds) : q.eq('id', ZERO);
    return companyId ? q.eq('company_id', companyId) : q;
  };

  // Whose leaderboard matters: a fronter manager wants top fronters (by leads);
  // closer-side wants top closers (by sales); operations/admin default to closers.
  //
  // A FRONTER company's admin runs a room of fronters, so ranking their people
  // by closer metrics ranked nobody — every closer on the board belongs to the
  // partner company. Resolve it from the company type, company_admin only.
  const isFronterCoAdmin = role === 'company_admin'
    && (await getCompanyType(companyId)) === 'fronter';
  const side = (role === 'fronter_manager' || isFronterCoAdmin)
    ? 'fronter'
    : (isCloserSide ? 'closer' : 'both');

  const [{ data: trs }, { data: sls }] = await Promise.all([
    scopeT(supabaseAdmin.from('transfers').select('created_at, created_by')
      .gte('created_at', windowStart).lte('created_at', windowEnd)).limit(20000),
    scopeS(supabaseAdmin.from('sales').select('sale_date, created_at, status, closer_id, fronter_id')
      .gte('created_at', windowStart).lte('created_at', windowEnd)).limit(20000),
  ]);

  const dayOf = (d) => String(d || '').slice(0, 10);
  // One bucket per date in the SAME window the rows were fetched from, so the
  // bars always add up to the headline.
  const buckets = {};
  dayList.forEach(d => { buckets[d] = { date: d, transfers: 0, sales: 0, approved: 0 }; });
  (trs || []).forEach(t => { const d = dayOf(t.created_at); if (buckets[d]) buckets[d].transfers++; });
  (sls || []).forEach(s => {
    const d = dayOf(s.sale_date || s.created_at);
    if (buckets[d]) { buckets[d].sales++; if (s.status === 'closed_won') buckets[d].approved++; }
  });

  // Role-aware leaderboard. Fronter side ranks fronters by leads created;
  // closer/both ranks closers by sales. `value` is the primary metric either way.
  const agentMetric = side === 'fronter' ? 'leads' : 'sales';
  const byAgent = {};
  if (side === 'fronter') {
    (trs || []).forEach(t => {
      if (!t.created_by) return;
      byAgent[t.created_by] = byAgent[t.created_by] || { value: 0, approved: 0 };
      byAgent[t.created_by].value++;
    });
    (sls || []).forEach(s => {                       // credit approved sales they fronted
      const f = s.fronter_id; if (!f || !byAgent[f]) return;
      if (s.status === 'closed_won') byAgent[f].approved++;
    });
  } else {
    (sls || []).forEach(s => {
      if (!s.closer_id) return;
      byAgent[s.closer_id] = byAgent[s.closer_id] || { value: 0, approved: 0 };
      byAgent[s.closer_id].value++;
      if (s.status === 'closed_won') byAgent[s.closer_id].approved++;
    });
  }
  const agentIds = Object.keys(byAgent);
  const names = {};
  if (agentIds.length) {
    const { data } = await supabaseAdmin
      .from('user_profiles').select('user_id, first_name, last_name').in('user_id', agentIds);
    (data || []).forEach(p => { names[p.user_id] = [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unknown'; });
  }
  const topAgents = agentIds
    .map(id => ({ user_id: id, name: names[id] || 'Unknown', value: byAgent[id].value, sales: byAgent[id].value, approved: byAgent[id].approved }))
    .sort((a, b) => b.value - a.value).slice(0, 8);

  const totalT = (trs || []).length, totalS = (sls || []).length;
  const totalApproved = (sls || []).filter(s => s.status === 'closed_won').length;
  res.json({
    days,
    side,
    agent_metric: agentMetric,
    daily: Object.values(buckets),
    top_agents: topAgents,
    // Conversion is only meaningful when sales came from transfers (sales ≤
    // transfers). More sales than transfers means bulk-imported rows with no
    // transfer link → the rate is undefined, so return null (UI shows "—")
    // rather than a misleading capped 100%.
    totals: { transfers: totalT, sales: totalS, approved: totalApproved, conversion: (totalT > 0 && totalS <= totalT) ? Math.round(totalS / totalT * 100) : null },
  });
}));

// ============================================================================
// GET /stats/user-performance/:userId?days=30 — one teammate's scorecard.
// A manager may only view a user in their own company (superadmin sees anyone).
// Role-aware: fronter numbers use created transfers + fronted sales; closer
// numbers use assigned transfers + closed sales.
// ============================================================================
router.get('/user-performance/:userId', asyncHandler(async (req, res) => {
  const reqRole = req.user.role, companyId = req.user.company_id, targetId = req.params.userId;
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 7), 60);
  const isGlobal = ['superadmin', 'readonly_admin'].includes(reqRole);

  if (!isGlobal) {
    // limit(1) — a user can have more than one active role row in a company;
    // maybeSingle() alone would error on that and wrongly 403.
    const { data: rel } = await supabaseAdmin.from('user_company_roles')
      .select('user_id').eq('company_id', companyId).eq('user_id', targetId).eq('is_active', true).limit(1).maybeSingle();
    if (!rel) return res.status(403).json({ error: 'User is not in your team' });
  }

  const { data: prof } = await supabaseAdmin.from('user_profiles')
    .select('user_id, first_name, last_name').eq('user_id', targetId).maybeSingle();
  if (!prof) return res.status(404).json({ error: 'User not found' });
  const { data: roleRow } = await supabaseAdmin.from('user_company_roles')
    .select('custom_roles(level)').eq('user_id', targetId).eq('is_active', true).limit(1).maybeSingle();
  const level = roleRow?.custom_roles?.level || null;

  const sinceUtc = new Date(Date.now() - days * 86400000).toISOString();
  const [{ data: closerSales }, { data: fronterSales }, { data: xCreated }, { data: xAssigned }] = await Promise.all([
    supabaseAdmin.from('sales').select('sale_date, created_at, status, cancellation_date').eq('closer_id', targetId).gte('created_at', sinceUtc).limit(8000),
    supabaseAdmin.from('sales').select('sale_date, created_at, status, cancellation_date').eq('fronter_id', targetId).gte('created_at', sinceUtc).limit(8000),
    supabaseAdmin.from('transfers').select('created_at').eq('created_by', targetId).neq('vicidial_pending', true).gte('created_at', sinceUtc).limit(8000),
    supabaseAdmin.from('transfers').select('created_at').eq('assigned_closer_id', targetId).neq('vicidial_pending', true).gte('created_at', sinceUtc).limit(8000),
  ]);

  const isFronterRole = !!(level && level.includes('fronter'));
  const sales = isFronterRole ? (fronterSales || []) : (closerSales || []);
  const xfers = isFronterRole ? (xCreated || []) : (xAssigned || []);
  const TERMINAL = ['cancelled', 'compliance_cancelled', 'closed_lost', 'chargeback'];
  const won = sales.filter(s => s.status === 'closed_won').length;
  const cancellations = sales.filter(s => s.cancellation_date || TERMINAL.includes(s.status)).length;

  const dayOf = (d) => String(d || '').slice(0, 10);
  const buckets = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    buckets[d] = { date: d, transfers: 0, sales: 0 };
  }
  xfers.forEach(t => { const d = dayOf(t.created_at); if (buckets[d]) buckets[d].transfers++; });
  sales.forEach(s => { const d = dayOf(s.sale_date || s.created_at); if (buckets[d]) buckets[d].sales++; });

  const totalX = xfers.length, totalS = sales.length;
  res.json({
    user: { user_id: targetId, name: [prof.first_name, prof.last_name].filter(Boolean).join(' ') || 'Unknown', role: level },
    days,
    side: isFronterRole ? 'fronter' : 'closer',
    // null (UI shows "—") when not meaningful — more sales than transfers means
    // bulk-imported rows with no transfer link, so the rate is undefined.
    totals: { transfers: totalX, sales: totalS, won, cancellations, conversion: (totalX > 0 && totalS <= totalX) ? Math.round(totalS / totalX * 100) : null },
    daily: Object.values(buckets),
  });
}));

// ============================================================================
// GET /stats/agent-performance?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
//
// Per-AGENT scoreboard for the manager Overview: who is doing what, and how
// well. One row per person with the funnel they own end to end —
// transfers → sales → approved — plus the two rates that actually drive a
// coaching conversation:
//
//   conversion = sales / transfers     "this fronter sent 120 leads, 9 sold"
//   approval   = approved / sales      "…and 7 of those 9 survived compliance"
//
// Side-aware, the same company-type rule the rest of the shell uses. A FRONTER
// company ranks its fronters by leads generated (transfers.created_by) and
// credits them the sales their leads produced (sales.fronter_id). A CLOSER
// company ranks its closers by sales closed (sales.closer_id) against the
// leads handed to them (transfers.assigned_closer_id).
//
// Why this exists rather than reusing the client-side leaderboard: that one
// pages 1,000 rows to the browser and counts them in JS, so on a company with
// 6,614 transfers it silently ranked a sample. It also called
// completed/transfers "conversion", which is a TRANSFER STATUS, not a sale —
// a fronter whose leads never sold could still show 90%.
// ============================================================================
router.get('/agent-performance', asyncHandler(async (req, res) => {
  const userId = req.user.id, companyId = req.user.company_id, role = req.user.role;
  const isGlobal = ['superadmin', 'readonly_admin'].includes(role);
  if (!companyId && !isGlobal) return res.json({ side: null, agents: [], totals: null });

  const closerSide = await isCloserSideScope(role, companyId);
  const side = closerSide ? 'closer' : 'fronter';

  // Date window. Transfers key on created_at (when the lead was sent), sales on
  // sale_date (the business day the deal happened) — the same columns the two
  // list endpoints filter on, so these numbers reconcile with the tabs.
  const { date_from, date_to } = req.query;
  const tFrom = date_from ? etDateToUtcStart(date_from) : null;
  const tTo   = date_to   ? etDateToUtcEnd(date_to)     : null;

  // Company members — the roster we rank, and (closer side) the id set the
  // transfer/sale scoping keys on.
  let memberIds = [];
  if (companyId) {
    const { data: mem } = await supabaseAdmin
      .from('user_company_roles').select('user_id').eq('company_id', companyId).eq('is_active', true);
    memberIds = [...new Set((mem || []).map(m => m.user_id))];
  }
  if (closerSide && !memberIds.length) return res.json({ side, agents: [], totals: null });

  // Paginated narrow fetch. PostgREST caps a page at 1000, so counting rows in
  // one .select() silently truncates — which is the bug this endpoint replaces.
  const PAGE = 1000, MAX_PAGES = 40;          // 40k rows is far past any real window
  const fetchAll = async (build) => {
    const out = [];
    for (let p = 0; p < MAX_PAGES; p++) {
      const { data, error } = await build().range(p * PAGE, p * PAGE + PAGE - 1);
      if (error) { logger.warn('AGENT_PERF', error.message); break; }
      out.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
    return out;
  };

  const transfers = await fetchAll(() => {
    let q = supabaseAdmin.from('transfers')
      .select('created_by, assigned_closer_id')
      .neq('vicidial_pending', true);
    if (closerSide) q = q.in('assigned_closer_id', memberIds);
    else if (companyId) q = q.eq('company_id', companyId);
    if (tFrom) q = q.gte('created_at', tFrom);
    if (tTo)   q = q.lte('created_at', tTo);
    return q;
  });

  const sales = await fetchAll(() => {
    let q = supabaseAdmin.from('sales')
      .select('fronter_id, closer_id, status, monthly_payment');
    if (closerSide) q = q.in('closer_id', memberIds);
    else if (companyId) q = q.eq('company_id', companyId);
    if (date_from) q = q.gte('sale_date', date_from);
    if (date_to)   q = q.lte('sale_date', date_to);
    return q;
  });

  // ── Group ────────────────────────────────────────────────────────────────
  const row = () => ({ transfers: 0, sales: 0, approved: 0, cancelled: 0, pending: 0, revenue: 0 });
  const byAgent = {};
  const bucket = (id) => { if (!id) return null; byAgent[id] = byAgent[id] || row(); return byAgent[id]; };

  const tKey = closerSide ? 'assigned_closer_id' : 'created_by';
  transfers.forEach(t => { const b = bucket(t[tKey]); if (b) b.transfers++; });

  const sKey = closerSide ? 'closer_id' : 'fronter_id';
  sales.forEach(s => {
    const b = bucket(s[sKey]);
    if (!b) return;
    b.sales++;
    if (s.status === 'closed_won')     { b.approved++; b.revenue += Number(s.monthly_payment || 0); }
    else if (s.status === 'cancelled')   b.cancelled++;
    else if (s.status === 'pending_review') b.pending++;
  });

  const ids = Object.keys(byAgent);
  const names = {};
  if (ids.length) {
    const { data: profs } = await supabaseAdmin
      .from('user_profiles').select('user_id, first_name, last_name').in('user_id', ids);
    (profs || []).forEach(p => { names[p.user_id] = [p.first_name, p.last_name].filter(Boolean).join(' ') || null; });
  }

  // A rate with a zero denominator is undefined, not 0 — the UI shows "—".
  // Reporting 0% for a fronter who sent no leads today reads as failure.
  const rate = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

  const agents = ids.map(id => {
    const a = byAgent[id];
    return {
      user_id: id,
      name: names[id] || 'Unknown',
      transfers: a.transfers,
      sales: a.sales,
      approved: a.approved,
      cancelled: a.cancelled,
      pending: a.pending,
      revenue: Math.round(a.revenue * 100) / 100,
      conversion: rate(a.sales, a.transfers),
      approval:   rate(a.approved, a.sales),
    };
  })
  // Rank by the metric this side is judged on, then by approved as the
  // tie-break so volume alone can't outrank someone who actually closes.
  .sort((x, y) => (side === 'fronter'
    ? (y.transfers - x.transfers) || (y.approved - x.approved)
    : (y.sales - x.sales) || (y.approved - x.approved)));

  const sum = (k) => agents.reduce((n, a) => n + a[k], 0);
  const totT = sum('transfers'), totS = sum('sales'), totA = sum('approved');

  // Rows in scope that no agent owns — a sale with no fronter_id, or a transfer
  // with no creator. They are real records and they DO count on the KPI cards,
  // so if the scoreboard silently omitted them the two would disagree by a few
  // and neither number would be believed. Reported explicitly instead, and the
  // company-level rates use the full in-scope figures, not just the attributed
  // ones, so the funnel here matches the funnel above it.
  const unattributedSales     = sales.filter(s => !s[sKey]).length;
  const unattributedTransfers = transfers.filter(t => !t[tKey]).length;
  const scopeT = transfers.length, scopeS = sales.length;
  const scopeA = sales.filter(s => s.status === 'closed_won').length;

  res.json({
    side,
    agent_metric: side === 'fronter' ? 'transfers' : 'sales',
    range: { from: date_from || null, to: date_to || null },
    agents,
    totals: {
      agents: agents.length,
      // company-wide, every row in scope
      transfers: scopeT, sales: scopeS, approved: scopeA,
      cancelled: sales.filter(s => s.status === 'cancelled').length,
      pending:   sales.filter(s => s.status === 'pending_review').length,
      revenue: Math.round(sum('revenue') * 100) / 100,
      conversion: rate(scopeS, scopeT),
      approval:   rate(scopeA, scopeS),
      // what the rows above actually add up to, and the gap
      attributed_transfers: totT, attributed_sales: totS, attributed_approved: totA,
      unattributed_transfers: unattributedTransfers,
      unattributed_sales: unattributedSales,
    },
  });
}));

module.exports = router;

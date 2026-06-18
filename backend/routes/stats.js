const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { etDateToUtcStart, etDateToUtcEnd, todayEt } = require('../utils/etUtils');
const { getConfig } = require('../utils/businessConfig');
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
      const isCloserSide = userRole === 'closer' || userRole === 'closer_manager' || userRole === 'compliance_manager';

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

module.exports = router;

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

      // ── "Today" window — ET calendar day boundaries (the app's display
      //    timezone). Transfers have no business-date column, so the lead-
      //    created moment is the only signal — counted in ET so a closer in
      //    Florida at 9pm sees their day, not tomorrow's UTC bucket.
      const todayStr   = todayEt();
      const todayStart = etDateToUtcStart(todayStr);
      const todayEndIso = etDateToUtcEnd(todayStr);
      const tToday = await scopeTransfers(supabaseAdmin.from('transfers').select('id', { count: 'exact', head: true }))
        .gte('created_at', todayStart)
        .lte('created_at', todayEndIso);
      stats.todayTransfers = tToday.count || 0;

      // Resell privacy — pre-resolve once per request (config is cached anyway)
      // so each saleCount() call doesn't await individually.
      let hideResells = false;
      if (userRole === 'fronter') {
        hideResells = !!(await getConfig(companyId, 'resell.hide_from_fronter', true));
      } else if (userRole === 'fronter_manager') {
        hideResells = !!(await getConfig(companyId, 'resell.hide_from_fronter_manager', true));
      } else if (userRole === 'compliance_manager') {
        hideResells = !!(await getConfig(companyId, 'resell.hide_from_compliance', false));
      }

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
      const saleCount = (status) => {
        let q = scopeSales(supabaseAdmin.from('sales').select('id', { count: 'exact', head: true }));
        if (status) q = q.eq('status', status);
        return q;
      };
      const [sAll, sOpen, sWon, sLost, sReview, sCancelled] = await Promise.all([
        saleCount(), saleCount('open'), saleCount('closed_won'), saleCount('closed_lost'), saleCount('pending_review'),
        saleCount('cancelled'),
      ]);
      stats.totalSales         = sAll.count || 0;
      stats.openSales          = sOpen.count || 0;
      stats.closedWon          = sWon.count || 0;
      stats.closedLost         = sLost.count || 0;
      stats.awaitingCompliance = sReview.count || 0;
      stats.cancelledSales     = sCancelled.count || 0;

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
      const sTodayCancelled = await scopeSales(supabaseAdmin.from('sales').select('id', { count: 'exact', head: true }))
        .eq('status', 'cancelled')
        .eq('sale_date', todayStr);
      stats.todayCancelled = sTodayCancelled.count || 0;

      // Conversion rate: compliance-approved sales / total transfers
      stats.conversionRate = stats.totalTransfers > 0
        ? Math.round((stats.closedWon / stats.totalTransfers) * 100)
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

const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
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

      // Transfer stats
      let transferQuery = supabaseAdmin
        .from('transfers')
        .select('id, status', { count: 'exact' });

      if (companyId) {
        transferQuery = transferQuery.eq('company_id', companyId);
      }

      // Role-based filtering
      if (userRole === 'fronter') {
        transferQuery = transferQuery.eq('created_by', userId);
      } else if (userRole === 'closer') {
        transferQuery = transferQuery.eq('assigned_to', userId);
      }
      // Managers and admins see all company transfers

      const { data: transfers, count: transferCount } = await transferQuery;

      stats.totalTransfers = transferCount || 0;
      stats.pendingTransfers = (transfers || []).filter(t => t.status === 'pending').length;
      stats.assignedTransfers = (transfers || []).filter(t => t.status === 'assigned').length;
      stats.completedTransfers = (transfers || []).filter(t => t.status === 'completed').length;

      // Sales stats
      let salesQuery = supabaseAdmin
        .from('sales')
        .select('id, status', { count: 'exact' });

      if (companyId) {
        salesQuery = salesQuery.eq('company_id', companyId);
      }

      if (userRole === 'closer') {
        salesQuery = salesQuery.eq('created_by', userId);
      }

      const { data: sales, count: salesCount } = await salesQuery;

      stats.totalSales = salesCount || 0;
      stats.openSales = (sales || []).filter(s => s.status === 'open').length;
      stats.closedWon = (sales || []).filter(s => s.status === 'closed_won').length;
      stats.closedLost = (sales || []).filter(s => s.status === 'closed_lost').length;

      // Conversion rate
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

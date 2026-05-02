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

      // Closer-side roles (closer company): query by assigned_closer_id, not company_id
      const isCloserSide = userRole === 'closer' || userRole === 'closer_manager' || userRole === 'compliance_manager';
      if (isCloserSide && companyId) {
        // Fetch user IDs in their (closer) company, filter transfers by those assigned_closer_ids
        const { data: coUsers } = await supabaseAdmin
          .from('user_company_roles').select('user_id').eq('company_id', companyId).eq('is_active', true);
        const coUserIds = (coUsers || []).map(u => u.user_id);
        if (userRole === 'closer') {
          transferQuery = transferQuery.eq('assigned_closer_id', userId);
        } else if (coUserIds.length > 0) {
          transferQuery = transferQuery.in('assigned_closer_id', coUserIds);
        } else {
          // No users in company — zero result shortcut
          transferQuery = transferQuery.eq('id', '00000000-0000-0000-0000-000000000000');
        }
      } else {
        if (companyId) transferQuery = transferQuery.eq('company_id', companyId);
        if (userRole === 'fronter') transferQuery = transferQuery.eq('created_by', userId);
      }
      // Managers and admins see all company transfers

      const { data: transfers, count: transferCount } = await transferQuery;

      stats.totalTransfers = transferCount || 0;
      stats.pendingTransfers = (transfers || []).filter(t => t.status === 'pending').length;
      stats.assignedTransfers = (transfers || []).filter(t => t.status === 'assigned').length;
      stats.completedTransfers = (transfers || []).filter(t => t.status === 'completed').length;

      // Sales stats — role-scoped to avoid leaking cross-company data.
      let sales = [];
      const transferIds = (transfers || []).map(t => t.id).filter(Boolean);

      if (['superadmin', 'readonly_admin'].includes(userRole)) {
        // Global view — all sales
        const { data: salesData } = await supabaseAdmin.from('sales').select('id, status');
        sales = salesData || [];
      } else if (userRole === 'closer') {
        // Closer sees only their own sales
        const { data: salesData } = await supabaseAdmin
          .from('sales').select('id, status').eq('closer_id', userId);
        sales = salesData || [];
      } else if (isCloserSide && companyId) {
        // Closer-side managers / compliance: all sales in their (closer) company
        const { data: salesData } = await supabaseAdmin
          .from('sales').select('id, status').eq('company_id', companyId);
        sales = salesData || [];
      } else if (transferIds.length > 0) {
        // Fronter / fronter managers: only sales linked to their company's transfers
        const { data: salesData } = await supabaseAdmin
          .from('sales').select('id, status').in('transfer_id', transferIds);
        sales = salesData || [];
      }

      const salesCount = sales.length;

      stats.totalSales = salesCount || 0;
      stats.openSales = (sales || []).filter(s => s.status === 'open').length;
      stats.closedWon = (sales || []).filter(s => s.status === 'closed_won').length;
      stats.closedLost = (sales || []).filter(s => s.status === 'closed_lost').length;
      stats.awaitingCompliance = (sales || []).filter(s => s.status === 'pending_review').length;

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

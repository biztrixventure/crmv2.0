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
          transferQuery = transferQuery.eq('assigned_to', userId);
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

      // Sales stats — expand scope for fronter company users to include linked closer companies
      let salesQuery = supabaseAdmin
        .from('sales')
        .select('id, status', { count: 'exact' });

      if (companyId) {
        let saleScopeIds = [companyId];
        if (userRole !== 'closer') {
          const { data: co } = await supabaseAdmin.from('companies').select('company_type').eq('id', companyId).single();
          if (co?.company_type === 'fronter') {
            const { data: lnks } = await supabaseAdmin.from('company_links').select('closer_company_id').eq('fronter_company_id', companyId);
            const linked = (lnks || []).map(l => l.closer_company_id).filter(Boolean);
            if (linked.length > 0) saleScopeIds = [...saleScopeIds, ...linked];
          }
        }
        if (saleScopeIds.length > 1) salesQuery = salesQuery.in('company_id', saleScopeIds);
        else salesQuery = salesQuery.eq('company_id', saleScopeIds[0]);
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

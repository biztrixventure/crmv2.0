const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const router = express.Router();

// ============================================================================
// GET /notifications - Get notifications for current user
// ============================================================================
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { unread_only, limit = 30 } = req.query;

    let query = supabaseAdmin
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (unread_only === 'true') {
      query = query.eq('is_read', false);
    }

    const { data, error } = await query;

    if (error) {
      logger.error('GET_NOTIFICATIONS', 'Query failed', error);
      return res.status(500).json({ error: error.message });
    }

    const unreadCount = data?.filter(n => !n.is_read).length || 0;

    res.json({
      notifications: data || [],
      total: data?.length || 0,
      unread_count: unreadCount,
    });
  })
);

// ============================================================================
// PATCH /notifications/:id/read - Mark one notification as read
// ============================================================================
router.patch(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    const { error } = await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
      .eq('user_id', userId); // ensure ownership

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ message: 'Marked as read' });
  })
);

// ============================================================================
// PATCH /notifications/read-all - Mark all notifications as read
// ============================================================================
router.patch(
  '/read-all',
  asyncHandler(async (req, res) => {
    const userId = req.user.id;

    const { error } = await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ message: 'All notifications marked as read' });
  })
);

// ============================================================================
// DELETE /notifications/:id - Delete a notification
// ============================================================================
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    const { error } = await supabaseAdmin
      .from('notifications')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ message: 'Notification deleted' });
  })
);

// ============================================================================
// DELETE /notifications - Clear all notifications for current user
// ============================================================================
router.delete(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user.id;

    const { error } = await supabaseAdmin
      .from('notifications')
      .delete()
      .eq('user_id', userId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ message: 'All notifications cleared' });
  })
);

module.exports = router;

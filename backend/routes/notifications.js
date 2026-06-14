const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const router = express.Router();

// ── Per-user response cache ───────────────────────────────────────────────────
// Collapses thundering-herd bursts where 350 clients all poll simultaneously.
// Cache entries hold the full JSON response for CACHE_TTL ms, so concurrent
// requests for the same user share one DB round-trip instead of N.
//
// TTL (35 s) now COVERS the steady poll instead of sitting under it: with the
// client poll slowed to ~5 min and realtime as the primary path, an 8 s TTL
// expired before nearly every poll → almost every request hit Postgres. 35 s
// means repeat polls inside the window are served from memory (no egress).
// New notifications still arrive instantly via realtime; mark-read / clear
// invalidate the entry so the bell never shows stale unread state.

const notifCache = new Map(); // userId → { response, expiresAt }
const inFlight   = new Map(); // userId → Promise<response>  (request coalescing)
const CACHE_TTL  = 35_000;   // ms

// Prune expired entries once per minute so the map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of notifCache) {
    if (now > v.expiresAt) notifCache.delete(k);
  }
}, 60_000).unref();

function invalidateCache(userId) {
  notifCache.delete(userId);
  // Don't touch inFlight — a racing query should still complete and repopulate.
}

// ============================================================================
// GET /notifications
// ============================================================================
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { unread_only, limit = 30 } = req.query;

    // unread_only=true bypasses cache (state-dependent query)
    const cacheable = unread_only !== 'true';

    if (cacheable) {
      const cached = notifCache.get(userId);
      if (cached && Date.now() < cached.expiresAt) {
        return res.json(cached.response);
      }

      // Coalesce: if this user already has a query running, await the same promise
      if (inFlight.has(userId)) {
        const response = await inFlight.get(userId);
        return res.json(response);
      }
    }

    // Build the actual DB promise
    const queryPromise = (async () => {
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
        throw error;
      }

      return {
        notifications: data || [],
        total:         data?.length || 0,
        unread_count:  data?.filter(n => !n.is_read).length || 0,
      };
    })();

    if (cacheable) inFlight.set(userId, queryPromise);

    try {
      const response = await queryPromise;
      if (cacheable) {
        notifCache.set(userId, { response, expiresAt: Date.now() + CACHE_TTL });
      }
      return res.json(response);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    } finally {
      inFlight.delete(userId);
    }
  })
);

// ============================================================================
// PATCH /notifications/:id/read
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
      .eq('user_id', userId);

    if (error) return res.status(500).json({ error: error.message });

    invalidateCache(userId);
    res.json({ message: 'Marked as read' });
  })
);

// ============================================================================
// PATCH /notifications/read-all
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

    if (error) return res.status(500).json({ error: error.message });

    invalidateCache(userId);
    res.json({ message: 'All notifications marked as read' });
  })
);

// ============================================================================
// DELETE /notifications/:id
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

    if (error) return res.status(500).json({ error: error.message });

    invalidateCache(userId);
    res.json({ message: 'Notification deleted' });
  })
);

// ============================================================================
// DELETE /notifications  (clear all)
// ============================================================================
router.delete(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user.id;

    const { error } = await supabaseAdmin
      .from('notifications')
      .delete()
      .eq('user_id', userId);

    if (error) return res.status(500).json({ error: error.message });

    invalidateCache(userId);
    res.json({ message: 'All notifications cleared' });
  })
);

module.exports = router;

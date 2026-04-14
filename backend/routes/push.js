/**
 * Push Subscription Routes
 * Manages Web Push API subscriptions per user per browser.
 */
const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

// ============================================================================
// GET /push/vapid-key — public VAPID key for browser subscription
// ============================================================================
router.get('/vapid-key', (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(503).json({ error: 'Push notifications not configured' });
  res.json({ publicKey: key });
});

// ============================================================================
// POST /push/subscribe — save a push subscription
// ============================================================================
router.post('/subscribe',
  [
    body('endpoint').notEmpty(),
    body('keys.p256dh').notEmpty(),
    body('keys.auth').notEmpty(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Invalid subscription object' });

    const userId = req.user.id;
    const { endpoint, keys, userAgent } = req.body;

    const { error } = await supabaseAdmin
      .from('push_subscriptions')
      .upsert({
        user_id:    userId,
        endpoint,
        p256dh:     keys.p256dh,
        auth_key:   keys.auth,
        user_agent: userAgent || null,
      }, { onConflict: 'user_id,endpoint' });

    if (error) return res.status(400).json({ error: error.message });

    res.json({ message: 'Push subscription saved' });
  })
);

// ============================================================================
// DELETE /push/unsubscribe — remove a push subscription
// ============================================================================
router.delete('/unsubscribe',
  [body('endpoint').notEmpty()],
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { endpoint } = req.body;

    await supabaseAdmin
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userId)
      .eq('endpoint', endpoint);

    res.json({ message: 'Unsubscribed' });
  })
);

module.exports = router;

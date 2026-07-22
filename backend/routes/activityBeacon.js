// ============================================================================
// /api/activity/beacon — soft, client-reported RO navigation telemetry.
//
// A readonly_admin's browser batches tab-opens, record-views, and blocked-copy
// events and flushes them here (timer + navigator.sendBeacon on pagehide). These
// are BEST-EFFORT signals (a determined RO could suppress them in devtools), so
// they are stored source='client' and shown as "reported" — the HARD signals
// (exports, blocked writes) are logged server-side and are unforgeable.
//
// Mounted at /api/activity with authMiddleware; readonlyGuard allowlists the
// '/activity/beacon' suffix so a read-only account's POST isn't 403'd.
// ============================================================================
const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { bulkLogReadonlyActivity } = require('../utils/readonlyGovernance');

const router = express.Router();

const CLIENT_ACTIONS = new Set(['tab_open', 'record_view', 'copy_blocked']);
const clip = (s, n) => (typeof s === 'string' ? s.slice(0, n) : null);

router.post('/beacon', asyncHandler(async (req, res) => {
  // Only readonly_admin self-reports; ignore anyone else silently (204).
  if (req.user?.role !== 'readonly_admin') return res.status(204).end();

  const events = Array.isArray(req.body?.events) ? req.body.events.slice(0, 50) : [];
  const rows = events
    .filter(e => e && CLIENT_ACTIONS.has(e.action_type))
    .map(e => ({
      user_id:     req.user.id,
      role_level:  req.user.role,
      company_id:  req.user.company_id || null,
      action_type: e.action_type,
      surface:     clip(e.surface, 120),
      dataset:     clip(e.dataset, 60),
      record_id:   e.record_id != null ? String(e.record_id).slice(0, 80) : null,
      detail:      e.detail && typeof e.detail === 'object' ? e.detail : null,
      source:      'client',
    }));

  if (rows.length) await bulkLogReadonlyActivity(rows);   // fire-and-forget internally
  res.status(204).end();
}));

module.exports = router;

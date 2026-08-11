// ============================================================================
// /api/payouts — the payout-field write endpoint (mig 243/244).
//
// The list/filter/KPI surface that used to live here has been merged into
// GET /compliance/sales (the same table the payout section always drew
// from) — this router is now just the write path the Compliance "Update"
// popup calls when a superadmin sets DP Status / Payout Status on an
// already-approved sale. Superadmin-only.
//
//   DP Status (payout_status)        — pending (default) → paid / reverted
//   Payout Status (payout_confirmed) — manual tri-state, pending (default)
//                                       → yes / no, no derived meaning
//   Paid to closer (paid_to_closer)  — mig 246, independent boolean: has the
//                                       eligible payout actually gone out.
//                                       Surfaced to the closer as the
//                                       "Incentive" pill on their Sale card.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');

const router = express.Router();

const PAYOUT_STATUSES = ['pending', 'paid', 'reverted'];
const PAYOUT_CONFIRMED_STATUSES = ['pending', 'yes', 'no'];

router.use(asyncHandler(async (req, res, next) => {
  if (!(await isSuperAdmin(req.user.id))) {
    return res.status(403).json({ error: 'Superadmin access required' });
  }
  next();
}));

// PATCH /payouts/:id — set payout_status and/or payout_confirmed. Either
// field may be sent alone; at least one is required.
router.patch('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { payout_status, payout_confirmed, paid_to_closer } = req.body;

  const updates = {};
  if (payout_status !== undefined) {
    if (!PAYOUT_STATUSES.includes(payout_status)) {
      return res.status(400).json({ error: 'payout_status must be one of: ' + PAYOUT_STATUSES.join(', ') });
    }
    updates.payout_status = payout_status;
  }
  if (payout_confirmed !== undefined) {
    if (!PAYOUT_CONFIRMED_STATUSES.includes(payout_confirmed)) {
      return res.status(400).json({ error: 'payout_confirmed must be one of: ' + PAYOUT_CONFIRMED_STATUSES.join(', ') });
    }
    updates.payout_confirmed = payout_confirmed;
  }
  if (paid_to_closer !== undefined) updates.paid_to_closer = !!paid_to_closer;
  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'Send payout_status, payout_confirmed, and/or paid_to_closer' });
  }
  updates.payout_updated_at = new Date().toISOString();
  updates.payout_updated_by = req.user.id;

  const { data, error } = await supabaseAdmin
    .from('sales')
    .update(updates)
    .eq('id', id)
    .not('compliance_reviewed_at', 'is', null)
    .select('id, payout_status, payout_confirmed, paid_to_closer, payout_updated_at')
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Sale not found, or it has never been compliance-approved' });

  res.json({ sale: data });
}));

module.exports = router;

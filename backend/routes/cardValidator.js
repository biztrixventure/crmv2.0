// ============================================================================
// routes/cardValidator.js — issuer (BIN) lookup for the card validator.
//   POST /card-validator/bin  { bin }   → issuer/bank/country for the BIN.
// Only the BIN (6-8 digits) is accepted — never a full card number. Gated by the
// tool_card_validator feature flag (or superadmin).
// ============================================================================
const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');
const { isFeatureEnabled } = require('../utils/featureGate');
const { lookupBin, normBin } = require('../utils/binLookup');

const router = express.Router();

router.post('/bin', asyncHandler(async (req, res) => {
  const sa = await isSuperAdmin(req.user.id);
  const enabled = sa || await isFeatureEnabled('tool_card_validator', req.user.company_id || null, req.user.id).catch(() => false);
  if (!enabled) return res.status(403).json({ error: 'Card validator is not enabled for you' });

  // Hard guard: only ever accept the BIN. If a longer value slips in, keep just
  // the first 8 digits so a full PAN can never be forwarded or logged.
  const bin = normBin(req.body?.bin);
  if (bin.length < 6) return res.status(400).json({ error: 'Enter at least the first 6 digits' });

  const r = await lookupBin(bin);
  if (!r.ok) return res.status(/rate-limited/i.test(r.error) ? 429 : 400).json({ error: r.error });
  res.json(r);
}));

module.exports = router;

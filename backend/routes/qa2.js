// ============================================================================
// qa2.js — /api/qa2 entry point. Split into sub-routers by area (brief
// section 8) rather than one file the size of v1's qa.js (4,282 lines).
// Mounted in server.js exactly like /api/qa: authMiddleware, readonlyGuard,
// egressAudit ahead of this router — nothing here re-checks auth, every
// sub-router calls resolveQa2Scope() itself.
// ============================================================================

const express = require('express');
const router = express.Router();

router.use('/org', require('./qa2Org'));
router.use('/team', require('./qa2Team'));
router.use('/assign', require('./qa2Assign'));
router.use('/', require('./qa2Methods'));
router.use('/', require('./qa2Forms'));
router.use('/', require('./qa2Assignments'));
router.use('/', require('./qa2Evaluations'));
router.use('/', require('./qa2Calibration'));
router.use('/', require('./qa2Reports'));
router.use('/', require('./qa2MyScores'));

module.exports = router;

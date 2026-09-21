// ============================================================================
// qa2.js — /api/qa2 entry point. Split into sub-routers by area (brief
// section 8) rather than one file the size of v1's qa.js (4,282 lines).
// Mounted in server.js exactly like /api/qa: authMiddleware, readonlyGuard,
// egressAudit ahead of this router — nothing here re-checks auth, every
// sub-router calls resolveQa2Scope() itself.
// ============================================================================

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const { supabaseAdmin } = require('../config/database');
const { resolveQa2Scope } = require('../utils/qa2ScopeResolver');

// ── GET /qa2/companies — the company list every QA2 tab needs ────────────────
// Four tabs (Team, Load Day, Reports, Org) used to read /compliance/companies
// and filter it client-side. That endpoint is compliance-only, so a REAL
// qa_manager got a 403 on all four: the Team tab's whole Promise.all rejected
// and the manager saw nothing — no agents, no companies — even with the org
// chart wired correctly. The list belongs to QA2, scoped by QA2's own rules:
//   compliance / superadmin -> every company (they wire the org chart)
//   qa_manager (or toggled compliance) -> the companies assigned to them
//   qa_agent -> the companies they actually hold grants for
// Anyone else gets an empty list rather than a 403: this is reference data for
// a screen they were already allowed to open.
router.get('/companies', asyncHandler(async (req, res) => {
  const scope = await resolveQa2Scope(req);
  let query = supabaseAdmin.from('companies')
    .select('id, name, company_type, is_active').order('name');

  if (!scope.isCompliance) {
    const ids = scope.operationalCompanyIds;
    if (ids !== 'all') {
      if (!Array.isArray(ids) || !ids.length) return res.json({ companies: [], scoped: true });
      query = query.in('id', ids);
    }
  }
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ companies: data || [], scoped: !scope.isCompliance });
}));

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

const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { CustomerProfileRepository: Repo } = require('../models/domain');
const { requireToolAccess } = require('../utils/featureGate');

const router = express.Router();

// Superadmin / readonly_admin always; other users when a superadmin has granted
// them the 'tool_customer_profiles' feature (per-user or per-company).
const superOnly = requireToolAccess('tool_customer_profiles');

// GET /api/customer-profile/search?q=&limit=  — browse/lookup distinct customers
router.get('/search', superOnly, asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 25, 50);
  res.json({ results: await Repo.search(req.query.q || '', limit) });
}));

// GET /api/customer-profile/browse — filterable customer segments
// query: segment, sort, dir, q, limit, min_transfers, min_policies, min_cancellations
router.get('/browse', superOnly, asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  res.json({ results: await Repo.browse({
    segment: req.query.segment || 'all',
    sort:    req.query.sort || 'score',
    dir:     req.query.dir === 'asc' ? 'asc' : 'desc',
    q:       req.query.q || '',
    limit,
    minT: parseInt(req.query.min_transfers, 10)    || 0,
    minP: parseInt(req.query.min_policies, 10)      || 0,
    minC: parseInt(req.query.min_cancellations, 10) || 0,
    minS: parseInt(req.query.min_sales, 10)         || 0,
  }) });
}));

// GET /api/customer-profile/by-phone/:phone — resolve a customer by phone
router.get('/by-phone/:phone', superOnly, asyncHandler(async (req, res) => {
  const customer = await Repo.loadByPhone(req.params.phone);
  if (!customer) return res.status(404).json({ error: 'No customer found for that phone' });
  res.json(customer.toProfile());
}));

// GET /api/customer-profile/agent/:userId?role=fronter|closer — agent mini-profile
router.get('/agent/:userId', superOnly, asyncHandler(async (req, res) => {
  const agent = await Repo.loadAgentProfile(req.params.userId, req.query.role === 'closer' ? 'closer' : 'fronter');
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  res.json(agent.serialize());
}));

// GET /api/customer-profile/:uuid/timeline — unified activity feed (lazy).
router.get('/:uuid/timeline', superOnly, asyncHandler(async (req, res) => {
  res.json({ timeline: await Repo.loadTimeline(req.params.uuid) });
}));

// ── Customer notes (migration 140) ──────────────────────────────────────────
router.get('/:uuid/notes', superOnly, asyncHandler(async (req, res) => {
  res.json({ notes: await Repo.listNotes(req.params.uuid) });
}));
router.post('/:uuid/notes', superOnly, asyncHandler(async (req, res) => {
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Note text required' });
  res.json({ note: await Repo.addNote(req.params.uuid, req.user.id, body, !!req.body?.pinned) });
}));
router.patch('/:uuid/notes/:id', superOnly, asyncHandler(async (req, res) => {
  res.json({ note: await Repo.setNotePinned(req.params.id, !!req.body?.pinned) });
}));
router.delete('/:uuid/notes/:id', superOnly, asyncHandler(async (req, res) => {
  await Repo.deleteNote(req.params.id);
  res.json({ ok: true });
}));

// GET /api/customer-profile/:uuid — the unified profile (MUST stay last; it's a
// catch-all on the first path segment).
router.get('/:uuid', superOnly, asyncHandler(async (req, res) => {
  const customer = await Repo.loadByUuid(req.params.uuid);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  res.json(customer.toProfile());
}));

module.exports = router;

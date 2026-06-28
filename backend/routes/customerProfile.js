const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');
const { CustomerProfileRepository: Repo } = require('../models/domain');

const router = express.Router();

// Superadmin panel feature. readonly_admin may view (read-only); everyone else
// 403s. Mirrors the access model of the other superadmin-only tools.
const superOnly = asyncHandler(async (req, res, next) => {
  if (req.user?.role === 'superadmin' || req.user?.role === 'readonly_admin' || await isSuperAdmin(req.user?.id)) {
    return next();
  }
  return res.status(403).json({ error: 'Superadmin access required' });
});

// GET /api/customer-profile/search?q=&limit=  — browse/lookup distinct customers
router.get('/search', superOnly, asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 25, 50);
  res.json({ results: await Repo.search(req.query.q || '', limit) });
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

// GET /api/customer-profile/:uuid — the unified profile (MUST stay last; it's a
// catch-all on the first path segment).
router.get('/:uuid', superOnly, asyncHandler(async (req, res) => {
  const customer = await Repo.loadByUuid(req.params.uuid);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  res.json(customer.toProfile());
}));

module.exports = router;

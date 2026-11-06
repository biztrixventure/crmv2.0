// Superadmin view of the CRM -> HRMS sales push (utils/hrmsSync.js).
//   GET  /api/hrms-sync        is it on, which HRMS companies, the last result
//   POST /api/hrms-sync/run    push now and return the result
const express = require('express');
const { isSuperAdmin } = require('../models/helpers');
const { pushSalesToHrms, lastHrmsPush } = require('../utils/hrmsSync');

const router = express.Router();

router.use(async (req, res, next) => {
  try {
    if (!(await isSuperAdmin(req.user.id))) return res.status(403).json({ error: 'Superadmin access required' });
    next();
  } catch (e) {
    next(e);
  }
});

router.get('/', (req, res) => res.json(lastHrmsPush()));

router.post('/run', async (req, res, next) => {
  try {
    res.json(await pushSalesToHrms());
  } catch (e) {
    next(e);
  }
});

module.exports = router;

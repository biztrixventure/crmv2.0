// ============================================================================
// scratchpad.js — /api/scratchpad — one private spreadsheet and one notepad
// per user.
//
//   GET  /                  my access + both documents, in ONE request
//   PUT  /:kind             save (sheet | note)
//   GET  /admin/:userId     what this person is allowed  (superadmin)
//   PUT  /admin/:userId     set it                        (superadmin)
//   PUT  /admin/defaults    what EVERYONE gets            (superadmin)
//
// ONE REQUEST TO OPEN. The header launcher needs the access answer AND the
// content to render, and both are a single row each keyed by the caller's own
// id — two round trips to paint a notepad would be the kind of thing that
// makes a CRM feel slow for no reason. GET / returns everything.
//
// THE CALLER'S ID IS NEVER TAKEN FROM THE CLIENT on the document paths. There
// is no /scratchpad/:userId, and `kind` is validated against a fixed list, so
// the only row any of these can reach is the caller's own. That is what makes
// the policy-less, service-role table in mig 347 safe.
// ============================================================================

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');
const sp = require('../utils/scratchpad');
const logger = require('../utils/logger');

const isKind = (k) => sp.KINDS.includes(String(k || ''));

async function superOnly(req, res) {
  if (req.user.role === 'superadmin' || await isSuperAdmin(req.user.id)) return true;
  res.status(403).json({ error: 'Superadmin only' });
  return false;
}

// ── GET / — access + both documents ────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const access = await sp.accessFor(req.user.id, {
    superadmin: req.user.role === 'superadmin' || await isSuperAdmin(req.user.id),
  });

  // Only fetch what they may actually open. Someone with the sheet switched
  // off should not have its bytes travel to their browser at all.
  const [sheet, note] = await Promise.all([
    access.sheet ? sp.load(req.user.id, 'sheet') : Promise.resolve(null),
    access.note ? sp.load(req.user.id, 'note') : Promise.resolve(null),
  ]);

  res.json({
    access: { sheet: access.sheet, note: access.note },
    sheet: sheet?.data ?? null,
    note: note?.data ?? null,
    updated_at: { sheet: sheet?.updated_at || null, note: note?.updated_at || null },
    max_bytes: sp.MAX_BYTES,
  });
}));

// ── PUT /:kind — save ──────────────────────────────────────────────────────
router.put('/:kind', asyncHandler(async (req, res) => {
  const { kind } = req.params;
  if (!isKind(kind)) return res.status(400).json({ error: 'Unknown document' });

  const access = await sp.accessFor(req.user.id, {
    superadmin: req.user.role === 'superadmin' || await isSuperAdmin(req.user.id),
  });
  if (!access[kind]) return res.status(403).json({ error: 'That tool is switched off for your account' });

  try {
    const { bytes } = await sp.save(req.user.id, kind, req.body?.data);
    res.json({ ok: true, bytes });
  } catch (e) {
    // A document the client let grow past the cap is a 413 with a sentence the
    // UI can show, never a raw Postgres check-constraint error.
    if (e.tooLarge) return res.status(413).json({ error: e.message });
    logger.warn('SCRATCHPAD', `save ${kind} for ${req.user.id}: ${e.message}`);
    res.status(500).json({ error: 'Could not save' });
  }
}));

// ── admin ──────────────────────────────────────────────────────────────────
// `/admin/defaults` is declared BEFORE `/admin/:userId` or Express matches the
// literal word "defaults" as a user id and tries to save access for it.

router.put('/admin/defaults', asyncHandler(async (req, res) => {
  if (!(await superOnly(req, res))) return;
  const defaults = await sp.setDefaultAccess(req.body || {}, req.user.id);
  res.json({ ok: true, defaults });
}));

router.get('/admin/:userId', asyncHandler(async (req, res) => {
  if (!(await superOnly(req, res))) return;
  // NOT passing superadmin:true here — this answers "what is this person
  // configured for", which a superadmin's own always-on bypass would hide.
  const access = await sp.accessFor(req.params.userId);
  res.json(access);
}));

router.put('/admin/:userId', asyncHandler(async (req, res) => {
  if (!(await superOnly(req, res))) return;
  const row = await sp.setAccess(req.params.userId, req.body || {}, req.user.id);
  res.json({ ok: true, row, defaults: await sp.defaultAccess() });
}));

module.exports = router;

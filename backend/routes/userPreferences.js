// ============================================================================
// /user-preferences — generic per-user UI state store. Backed by migration 065.
//
// GET    /user-preferences/:key   → { value }   (null if not set)
// PUT    /user-preferences/:key   { value: <any json> }  → { value }
// DELETE /user-preferences/:key   → { ok: true }
//
// No role gate — any authenticated user can read / write their OWN prefs only.
// Cross-user reads are impossible because we filter on req.user.id everywhere.
// ============================================================================

const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler }  = require('../middleware/errorHandler');

const router = express.Router();

// Keys are lowercased dot-separated identifiers (e.g., "companies.order").
// Enforced server-side so a typo client-side doesn't write a forever-stranded
// row, and so the table doesn't accumulate random debug values.
const VALID_KEY = /^[a-z0-9][a-z0-9_.-]{0,63}$/;

router.get('/:key', asyncHandler(async (req, res) => {
  const key = String(req.params.key || '');
  if (!VALID_KEY.test(key)) return res.status(400).json({ error: 'Invalid preference key' });

  const { data, error } = await supabaseAdmin
    .from('user_preferences')
    .select('value, updated_at')
    .eq('user_id', req.user.id)
    .eq('key', key)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ value: data?.value ?? null, updated_at: data?.updated_at ?? null });
}));

router.put('/:key', asyncHandler(async (req, res) => {
  const key = String(req.params.key || '');
  if (!VALID_KEY.test(key)) return res.status(400).json({ error: 'Invalid preference key' });
  if (req.body?.value === undefined) return res.status(400).json({ error: 'value required' });

  // Upsert keyed on (user_id, key). Always touches updated_at so the client
  // can detect a stale local cache by comparing timestamps.
  const { data, error } = await supabaseAdmin
    .from('user_preferences')
    .upsert(
      { user_id: req.user.id, key, value: req.body.value, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,key' }
    )
    .select('value, updated_at')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ value: data.value, updated_at: data.updated_at });
}));

router.delete('/:key', asyncHandler(async (req, res) => {
  const key = String(req.params.key || '');
  if (!VALID_KEY.test(key)) return res.status(400).json({ error: 'Invalid preference key' });
  const { error } = await supabaseAdmin
    .from('user_preferences').delete().eq('user_id', req.user.id).eq('key', key);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

module.exports = router;

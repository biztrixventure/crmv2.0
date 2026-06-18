/**
 * VICIdial -> CRM integration (one-directional).
 *
 * Ingest (no CRM session — the VICIdial server fires these; guarded by a shared
 * token in the URL, set VICIDIAL_INGEST_TOKEN):
 *   GET|POST /api/vicidial/fronter-xfer  ?key=&code=&phone=&agent=
 *       On XFER → create a PENDING transfer (code + phone), routed to the CRM
 *       user mapped from the VICIdial agent.
 *   GET|POST /api/vicidial/closer-dispo   ?key=&code=&dispo=&talk_time=&agent=
 *       On a closer disposition → match the code → record the disposition onto
 *       that transfer so the fronter sees the outcome.
 *
 * API (CRM session — the fronter's app):
 *   GET  /api/vicidial/pending            — my pending-from-dialer transfers
 *   POST /api/vicidial/pending/:id/confirm— fill remaining fields + confirm
 *
 * Matching is exact on transfers.vicidial_vendor_code (idempotent — a duplicate
 * fire updates, never duplicates). Routing is by user_profiles.vicidial_agent_id.
 */
const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const { normPhone } = require('../utils/uploadService');
const { titleCaseFormData } = require('../utils/titleCase');
const { expandStateInFormData } = require('../utils/stateMap');

const ingest = express.Router();
const api = express.Router();

// ── shared-secret guard for the public ingest endpoints ──────────────────────
const requireToken = (req, res, next) => {
  const expected = process.env.VICIDIAL_INGEST_TOKEN;
  const got = req.query.key || req.headers['x-vici-key'];
  if (!expected || got !== expected) return res.status(401).json({ ok: false, error: 'unauthorized' });
  next();
};

// Resolve a VICIdial agent id → CRM user + their (active) company.
async function resolveAgent(agentId) {
  if (!agentId) return { userId: null, companyId: null };
  const { data: prof } = await supabaseAdmin
    .from('user_profiles').select('user_id').eq('vicidial_agent_id', agentId).maybeSingle();
  if (!prof?.user_id) return { userId: null, companyId: null };
  const { data: ucr } = await supabaseAdmin
    .from('user_company_roles').select('company_id').eq('user_id', prof.user_id).eq('is_active', true)
    .order('created_at', { ascending: true }).limit(1).maybeSingle();
  return { userId: prof.user_id, companyId: ucr?.company_id || null };
}

// ── INGEST: fronter XFER → pending transfer (code + phone only) ──────────────
ingest.all('/fronter-xfer', requireToken, asyncHandler(async (req, res) => {
  const p = { ...req.query, ...req.body };
  const code  = String(p.code || '').trim();
  const phone = String(p.phone || '').trim();
  const agent = String(p.agent || '').trim();
  if (!code || !phone) return res.status(400).json({ ok: false, error: 'code and phone required' });

  // Idempotent on the correlation code.
  const { data: existing } = await supabaseAdmin
    .from('transfers').select('id').eq('vicidial_vendor_code', code).maybeSingle();

  const norm = normPhone(phone);
  if (existing) {
    await supabaseAdmin.from('transfers')
      .update({ vicidial_agent: agent || null, normalized_phone: norm || null })
      .eq('id', existing.id);
    return res.json({ ok: true, transfer_id: existing.id, updated: true });
  }

  // Route to the fronter the VICIdial agent maps to. Unmapped agent → capture
  // is skipped (200 so the dialer doesn't retry) and logged for the superadmin.
  const { userId, companyId } = await resolveAgent(agent);
  if (!userId || !companyId) {
    logger.warn('VICIDIAL_XFER', `Unmapped agent "${agent}" (code ${code}) — pending transfer not created`);
    return res.json({ ok: false, reason: 'agent not mapped', code });
  }

  const { data, error } = await supabaseAdmin.from('transfers').insert({
    company_id: companyId,
    created_by: userId,
    status: 'pending',
    vicidial_pending: true,
    vicidial_vendor_code: code,
    vicidial_agent: agent || null,
    normalized_phone: norm || null,
    form_data: { cli_number: norm || null, customer_phone: phone, Phone: phone },
  }).select('id').single();
  if (error) return res.status(500).json({ ok: false, error: error.message });

  logger.success('VICIDIAL_XFER', `Pending transfer ${data.id} for agent ${agent} (code ${code})`);
  res.json({ ok: true, transfer_id: data.id });
}));

// ── INGEST: closer disposition → map onto the transfer ───────────────────────
ingest.all('/closer-dispo', requireToken, asyncHandler(async (req, res) => {
  const p = { ...req.query, ...req.body };
  const code  = String(p.code || '').trim();
  const dispo = String(p.dispo || '').trim();
  if (!code) return res.status(400).json({ ok: false, error: 'code required' });

  const { data: tr } = await supabaseAdmin
    .from('transfers').select('id').eq('vicidial_vendor_code', code).maybeSingle();
  if (!tr) {
    logger.warn('VICIDIAL_DISPO', `No transfer for code ${code} (dispo ${dispo})`);
    return res.json({ ok: false, reason: 'no matching transfer', code });   // 200 → no dialer retry
  }

  const talk = parseInt(p.talk_time, 10);
  const { error } = await supabaseAdmin.from('transfers').update({
    vicidial_dispo:     dispo || null,
    vicidial_dispo_at:  new Date().toISOString(),
    vicidial_talk_time: Number.isFinite(talk) ? talk : null,
    vicidial_agent:     String(p.agent || '').trim() || undefined,
  }).eq('id', tr.id);
  if (error) return res.status(500).json({ ok: false, error: error.message });

  logger.success('VICIDIAL_DISPO', `Transfer ${tr.id} ← dispo "${dispo}" (code ${code})`);
  res.json({ ok: true, transfer_id: tr.id });
}));

// ── API: my pending-from-dialer transfers ────────────────────────────────────
api.get('/pending', asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('transfers')
    .select('id, vicidial_vendor_code, normalized_phone, form_data, vicidial_dispo, vicidial_dispo_at, vicidial_agent, created_at')
    .eq('created_by', req.user.id).eq('vicidial_pending', true)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ pending: data || [] });
}));

// ── API: fill remaining fields + confirm → becomes a normal transfer ─────────
api.post('/pending/:id/confirm', asyncHandler(async (req, res) => {
  const { data: tr } = await supabaseAdmin
    .from('transfers').select('id, created_by, form_data, vicidial_pending').eq('id', req.params.id).maybeSingle();
  if (!tr || tr.created_by !== req.user.id || !tr.vicidial_pending) {
    return res.status(404).json({ error: 'Pending transfer not found' });
  }

  const incoming = (req.body.form_data && typeof req.body.form_data === 'object') ? req.body.form_data : {};
  const merged = { ...(tr.form_data || {}), ...titleCaseFormData(expandStateInFormData(incoming)) };
  const norm = normPhone(merged.cli_number || merged.Phone || merged.customer_phone || '');

  const { data, error } = await supabaseAdmin.from('transfers').update({
    vicidial_pending: false,
    status: 'pending',
    form_data: { ...merged, cli_number: norm || merged.cli_number || null },
    normalized_phone: norm || null,
    updated_at: new Date().toISOString(),
  }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ transfer: data });
}));

module.exports = { ingest, api };

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
const { isSuperAdmin } = require('../models/helpers');

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

  // The fronter campaign's Dispo Call URL fires on EVERY disposition. Only the
  // configured transfer dispositions (config.field_map.xfer_dispos) create a
  // pending transfer — otherwise NI/DNC/no-answer calls would spam the CRM.
  // No list configured → accept any (back-compat).
  const dispo = String(p.dispo || '').trim().toUpperCase();
  if (dispo) {
    const { data: cfg } = await supabaseAdmin
      .from('vicidial_config').select('field_map').eq('company_id', companyId).maybeSingle();
    const xferDispos = Array.isArray(cfg?.field_map?.xfer_dispos)
      ? cfg.field_map.xfer_dispos.map(s => String(s).trim().toUpperCase()).filter(Boolean) : [];
    if (xferDispos.length && !xferDispos.includes(dispo)) {
      return res.json({ ok: false, reason: 'non-transfer disposition', dispo });   // 200 → no dialer retry
    }
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
    .from('transfers').select('id, company_id').eq('vicidial_vendor_code', code).maybeSingle();
  if (!tr) {
    logger.warn('VICIDIAL_DISPO', `No transfer for code ${code} (dispo ${dispo})`);
    return res.json({ ok: false, reason: 'no matching transfer', code });   // 200 → no dialer retry
  }

  const now = new Date().toISOString();
  const talk = parseInt(p.talk_time, 10);
  const rawCode = dispo.toUpperCase();

  // Resolve raw dialer code → CRM disposition via the per-company map. Record the
  // code either way: an unmapped code is auto-inserted (disposition_name NULL) so
  // it shows in the superadmin's "unmapped" inbox — nothing is ever lost.
  let mapped = null;
  if (rawCode) {
    const { data: m } = await supabaseAdmin.from('vicidial_dispo_map')
      .select('id, disposition_name, category, hits')
      .eq('company_id', tr.company_id).eq('vici_code', rawCode).maybeSingle();
    if (m) {
      mapped = m;
      await supabaseAdmin.from('vicidial_dispo_map').update({ hits: (m.hits || 0) + 1, last_seen_at: now }).eq('id', m.id);
    } else {
      await supabaseAdmin.from('vicidial_dispo_map')
        .insert({ company_id: tr.company_id, vici_code: rawCode, hits: 1, last_seen_at: now })
        .then(() => {}, () => {});   // ignore unique race
    }
  }

  const updates = {
    vicidial_dispo:     dispo || null,
    vicidial_dispo_at:  now,
    vicidial_talk_time: Number.isFinite(talk) ? talk : null,
    vicidial_agent:     String(p.agent || '').trim() || undefined,
  };
  // Apply the mapped CRM disposition (text snapshot, like disposition_actions).
  // Unmapped → closer_disposition left untouched; the closer picks it manually.
  if (mapped?.disposition_name) updates.closer_disposition = mapped.disposition_name;

  const { error } = await supabaseAdmin.from('transfers').update(updates).eq('id', tr.id);
  if (error) return res.status(500).json({ ok: false, error: error.message });

  // Mapped dispos also land on the lead's disposition timeline (best-effort).
  if (mapped?.disposition_name) {
    try {
      await supabaseAdmin.from('disposition_actions').insert({
        transfer_id: tr.id, company_id: tr.company_id,
        disposition_name: mapped.disposition_name,
        note: `From dialer (${rawCode})`, setter_role: 'closer',
      });
    } catch { /* non-critical */ }
  }

  logger.success('VICIDIAL_DISPO', `Transfer ${tr.id} ← "${dispo}" → ${mapped?.disposition_name || '(unmapped)'}`);
  res.json({ ok: true, transfer_id: tr.id, mapped: mapped?.disposition_name || null });
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

// ── superadmin: prefix registry + agent mapping (config UI) ──────────────────
const superOnly = asyncHandler(async (req, res, next) => {
  if (!(await isSuperAdmin(req.user.id))) return res.status(403).json({ error: 'Superadmin access required' });
  next();
});

api.get('/config', superOnly, asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin.from('vicidial_config').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const ids = [...new Set((data || []).map(c => c.company_id).filter(Boolean))];
  let names = {};
  if (ids.length) { const { data: co } = await supabaseAdmin.from('companies').select('id, name').in('id', ids); (co || []).forEach(c => { names[c.id] = c.name; }); }
  res.json({ configs: (data || []).map(c => ({ ...c, company_name: names[c.company_id] || null })) });
}));

api.post('/config', superOnly, asyncHandler(async (req, res) => {
  const prefix = String(req.body.prefix || '').trim();
  if (!prefix) return res.status(400).json({ error: 'Prefix is required' });
  const { data, error } = await supabaseAdmin.from('vicidial_config')
    .insert({ prefix, company_id: req.body.company_id || null, field_map: req.body.field_map || {} }).select().single();
  if (error) return res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'That prefix is already in use' : error.message });
  res.status(201).json({ config: data });
}));

api.put('/config/:id', superOnly, asyncHandler(async (req, res) => {
  const upd = {};
  if (req.body.prefix !== undefined)     upd.prefix = String(req.body.prefix).trim();
  if (req.body.company_id !== undefined) upd.company_id = req.body.company_id || null;
  if (req.body.is_active !== undefined)  upd.is_active = !!req.body.is_active;
  if (req.body.field_map !== undefined)  upd.field_map = req.body.field_map;
  const { data, error } = await supabaseAdmin.from('vicidial_config').update(upd).eq('id', req.params.id).select().single();
  if (error) return res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'That prefix is already in use' : error.message });
  if (!data) return res.status(404).json({ error: 'Config not found' });
  res.json({ config: data });
}));

api.delete('/config/:id', superOnly, asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from('vicidial_config').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'deleted' });
}));

// Agent-id map — list users (search) with their current mapping.
api.get('/agents', superOnly, asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  let query = supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name, vicidial_agent_id').order('first_name').limit(100);
  if (q) { const s = q.replace(/[%,]/g, ''); query = query.or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,vicidial_agent_id.ilike.%${s}%`); }
  const { data: profs } = await query;
  const ids = (profs || []).map(p => p.user_id);
  let meta = {};
  if (ids.length) {
    const { data: ucr } = await supabaseAdmin.from('user_company_roles')
      .select('user_id, companies(name), custom_roles(level)').in('user_id', ids).eq('is_active', true);
    (ucr || []).forEach(r => { if (!meta[r.user_id]) meta[r.user_id] = { company: r.companies?.name || '', role: r.custom_roles?.level || '' }; });
  }
  res.json({ agents: (profs || []).map(p => ({
    user_id: p.user_id, name: `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'User',
    vicidial_agent_id: p.vicidial_agent_id || '', company: meta[p.user_id]?.company || '', role: meta[p.user_id]?.role || '',
  })) });
}));

api.post('/agents', superOnly, asyncHandler(async (req, res) => {
  if (!req.body.user_id) return res.status(400).json({ error: 'user_id required' });
  const agent = String(req.body.agent_id || '').trim() || null;
  const { error } = await supabaseAdmin.from('user_profiles').update({ vicidial_agent_id: agent }).eq('user_id', req.body.user_id);
  if (error) return res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'That agent id is already mapped to another user' : error.message });
  res.json({ ok: true });
}));

// ── superadmin: disposition map (raw dialer code → CRM disposition) ──────────
// CRM dispositions for the dropdown (a company's active disposition_configs).
api.get('/dispositions', superOnly, asyncHandler(async (req, res) => {
  let q = supabaseAdmin.from('disposition_configs').select('id, name, company_id').eq('is_active', true).order('name');
  if (req.query.company_id) q = q.eq('company_id', req.query.company_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  // distinct names
  const seen = new Set(); const names = [];
  (data || []).forEach(d => { if (d.name && !seen.has(d.name)) { seen.add(d.name); names.push(d.name); } });
  res.json({ dispositions: names });
}));

api.get('/dispo-map', superOnly, asyncHandler(async (req, res) => {
  let q = supabaseAdmin.from('vicidial_dispo_map').select('*');
  if (req.query.company_id) q = q.eq('company_id', req.query.company_id);
  // Unmapped (pending) first, then by most-seen.
  const { data, error } = await q.order('disposition_name', { ascending: true, nullsFirst: true }).order('hits', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ map: data || [] });
}));

api.post('/dispo-map', superOnly, asyncHandler(async (req, res) => {
  const company_id = req.body.company_id || null;
  const vici_code  = String(req.body.vici_code || '').trim().toUpperCase();
  if (!company_id || !vici_code) return res.status(400).json({ error: 'company_id and vici_code are required' });
  const row = {
    company_id, vici_code,
    disposition_name: req.body.disposition_name ? String(req.body.disposition_name).trim() : null,
    category: req.body.category ? String(req.body.category).trim() : null,
  };
  const { data, error } = await supabaseAdmin.from('vicidial_dispo_map')
    .upsert(row, { onConflict: 'company_id,vici_code' }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ entry: data });
}));

api.put('/dispo-map/:id', superOnly, asyncHandler(async (req, res) => {
  const upd = {};
  if (req.body.disposition_name !== undefined) upd.disposition_name = req.body.disposition_name ? String(req.body.disposition_name).trim() : null;
  if (req.body.category !== undefined)         upd.category = req.body.category ? String(req.body.category).trim() : null;
  const { data, error } = await supabaseAdmin.from('vicidial_dispo_map').update(upd).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Not found' });
  res.json({ entry: data });
}));

api.delete('/dispo-map/:id', superOnly, asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from('vicidial_dispo_map').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'deleted' });
}));

module.exports = { ingest, api };

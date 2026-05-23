const express = require('express');
const router  = express.Router();
const { supabaseAdmin } = require('../config/database');
const { isSuperAdmin }  = require('../models/helpers');
const { onDispositionSubmitted } = require('../utils/notificationService');

const ADMIN_ROLES = ['superadmin', 'readonly_admin', 'company_admin', 'operations_manager'];

// GET /api/disposition-configs
// Returns active configs: global (company_id IS NULL) + company-specific for caller's company
router.get('/', async (req, res) => {
  try {
    const { company_id } = req.user;
    const { data, error } = await supabaseAdmin
      .from('disposition_configs')
      .select('*')
      .eq('is_active', true)
      .or(`company_id.is.null,company_id.eq.${company_id}`)
      .order('sort_order', { ascending: true })
      .order('created_at',  { ascending: true });
    if (error) throw error;
    res.json({ configs: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/disposition-configs/all — admin: see own company + global
router.get('/all', async (req, res) => {
  try {
    const userId    = req.user.id;
    const companyId = req.user.company_id;
    const sa        = await isSuperAdmin(userId);
    if (!sa && !ADMIN_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    let query = supabaseAdmin.from('disposition_configs').select('*');
    if (!sa) query = query.or(`company_id.is.null,company_id.eq.${companyId}`);
    query = query.order('sort_order', { ascending: true }).order('created_at', { ascending: true });
    const { data, error } = await query;
    if (error) throw error;
    res.json({ configs: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/disposition-configs — admin: create new config
router.post('/', async (req, res) => {
  const userId    = req.user.id;
  const companyId = req.user.company_id;
  const role      = req.user.role;
  try {
    const sa = await isSuperAdmin(userId);
    if (!sa && !ADMIN_ROLES.includes(role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const {
      name, color = '#6b7280', description,
      notify_roles = [], notify_fronter = false,
      notify_fronter_manager = false, requires_note = false,
      sort_order = 0,
    } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });

    // Superadmin may create global (null) configs; others always own-company
    const targetCompany = (sa && req.body.company_id === null) ? null : companyId;

    const { data, error } = await supabaseAdmin
      .from('disposition_configs')
      .insert({
        company_id: targetCompany,
        name: name.trim(), color, description,
        notify_roles, notify_fronter, notify_fronter_manager,
        requires_note, sort_order, is_active: true,
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ config: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/disposition-configs/:id — admin: update
router.put('/:id', async (req, res) => {
  const userId    = req.user.id;
  const companyId = req.user.company_id;
  const role      = req.user.role;
  try {
    const sa = await isSuperAdmin(userId);
    if (!sa && !ADMIN_ROLES.includes(role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const { data: existing } = await supabaseAdmin
      .from('disposition_configs').select('id, company_id').eq('id', req.params.id).single();
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (!sa && existing.company_id !== null && existing.company_id !== companyId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const allowed = ['name','color','description','notify_roles','notify_fronter','notify_fronter_manager','requires_note','sort_order','is_active'];
    const updates = { updated_at: new Date().toISOString() };
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    if (updates.name) updates.name = updates.name.trim();

    const { data, error } = await supabaseAdmin
      .from('disposition_configs').update(updates).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ config: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/disposition-configs/:id — admin: soft delete
router.delete('/:id', async (req, res) => {
  const userId    = req.user.id;
  const companyId = req.user.company_id;
  const role      = req.user.role;
  try {
    const sa = await isSuperAdmin(userId);
    if (!sa && !ADMIN_ROLES.includes(role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const { data: existing } = await supabaseAdmin
      .from('disposition_configs').select('id, company_id').eq('id', req.params.id).single();
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (!sa && existing.company_id !== null && existing.company_id !== companyId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    await supabaseAdmin
      .from('disposition_configs')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/disposition-configs/submit — closer: submit a disposition action
router.post('/submit', async (req, res) => {
  const userId    = req.user.id;
  const companyId = req.user.company_id;
  try {
    const { transfer_id, disposition_config_id, note } = req.body;
    if (!transfer_id)           return res.status(400).json({ error: 'transfer_id required' });
    if (!disposition_config_id) return res.status(400).json({ error: 'disposition_config_id required' });

    const [{ data: transfer, error: tfErr }, { data: config, error: cfgErr }] = await Promise.all([
      supabaseAdmin.from('transfers').select('id, company_id, created_by, form_data, assigned_closer_id').eq('id', transfer_id).single(),
      supabaseAdmin.from('disposition_configs').select('*').eq('id', disposition_config_id).eq('is_active', true).single(),
    ]);

    if (tfErr  || !transfer) return res.status(404).json({ error: 'Transfer not found' });
    if (cfgErr || !config)   return res.status(404).json({ error: 'Disposition config not found' });
    if (config.requires_note && !note?.trim()) {
      return res.status(400).json({ error: `A note is required for "${config.name}"` });
    }

    const { data: action, error: actErr } = await supabaseAdmin
      .from('disposition_actions')
      .insert({
        transfer_id,
        company_id:            companyId,
        user_id:               userId,
        disposition_config_id,
        disposition_name:      config.name,
        color:                 config.color,
        note:                  note?.trim() || null,
        setter_role:           req.user.role || null,
      })
      .select()
      .single();
    if (actErr) throw actErr;

    // Claim the transfer for the closer who handled it, so the fronter sees the
    // closer's name instead of "Unassigned" (mirrors manual sale creation +
    // bulk upload). Only when not already assigned and the submitter is a closer.
    if (!transfer.assigned_closer_id && req.user.role === 'closer') {
      await supabaseAdmin.from('transfers')
        .update({ assigned_closer_id: userId, assigned_to: userId, updated_at: new Date().toISOString() })
        .eq('id', transfer_id);
    }

    onDispositionSubmitted({ action, transfer, config, submitterId: userId, submitterCompanyId: companyId })
      .catch(err => console.error('[DISPOSITION] Notification error:', err.message));

    res.status(201).json({ action });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/disposition-configs/submit-callback
// Closer: schedule a callback for a transfer. Logs a "Callback Scheduled" disposition action
// AND creates a callback record so it appears in the closer's callbacks section.
router.post('/submit-callback', async (req, res) => {
  const userId    = req.user.id;
  const companyId = req.user.company_id;
  try {
    const { transfer_id, callback_at, note, customer_timezone, customer_state, customer_city } = req.body;
    if (!transfer_id)  return res.status(400).json({ error: 'transfer_id required' });
    if (!callback_at)  return res.status(400).json({ error: 'callback_at required' });

    const { data: transfer, error: tfErr } = await supabaseAdmin
      .from('transfers')
      .select('id, company_id, created_by, form_data, assigned_closer_id')
      .eq('id', transfer_id)
      .single();
    if (tfErr || !transfer) return res.status(404).json({ error: 'Transfer not found' });

    const fd           = transfer.form_data || {};
    const customerName = fd.customer_name
      || (fd.FirstName ? `${fd.FirstName} ${fd.LastName || ''}`.trim() : null)
      || 'Unknown';
    const customerPhone = fd.customer_phone || fd.Phone || null;

    const [{ data: action, error: actErr }, { data: callback, error: cbErr }] = await Promise.all([
      supabaseAdmin.from('disposition_actions').insert({
        transfer_id,
        company_id:       companyId,
        user_id:          userId,
        disposition_name: 'Callback Scheduled',
        color:            '#3b82f6',
        note:             note?.trim() || null,
        setter_role:      req.user.role || null,
      }).select().single(),
      supabaseAdmin.from('callbacks').insert({
        user_id:           userId,
        company_id:        companyId,
        customer_name:     customerName,
        customer_phone:    customerPhone,
        notes:             note?.trim() || null,
        callback_at,
        priority:          'Medium',
        status:            'pending',
        source:            'transfer',
        source_id:         transfer_id,
        notified:          false,
        customer_timezone: customer_timezone || null,
        customer_state:    customer_state    || null,
        customer_city:     customer_city     || null,
      }).select().single(),
    ]);

    if (actErr) throw actErr;
    if (cbErr)  throw cbErr;

    // Claim the transfer for the closer (same as a disposition) so the fronter
    // sees who scheduled the callback rather than "Unassigned".
    if (!transfer.assigned_closer_id && req.user.role === 'closer') {
      await supabaseAdmin.from('transfers')
        .update({ assigned_closer_id: userId, assigned_to: userId, updated_at: new Date().toISOString() })
        .eq('id', transfer_id);
    }

    res.status(201).json({ action, callback });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/disposition-configs/history/:transferId
// Returns full disposition history for a transfer, enriched with setter name + role.
// Accessible by any authenticated user who can see the transfer.
router.get('/history/:transferId', async (req, res) => {
  try {
    const { transferId } = req.params;

    const { data: actions, error } = await supabaseAdmin
      .from('disposition_actions')
      .select('*')
      .eq('transfer_id', transferId)
      .order('created_at', { ascending: false });
    if (error) throw error;

    if (!actions || actions.length === 0) return res.json({ history: [] });

    // Resolve user names in one batch
    const userIds = [...new Set(actions.map(a => a.user_id).filter(Boolean))];
    let nameMap = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from('user_profiles')
        .select('user_id, first_name, last_name')
        .in('user_id', userIds);
      (profiles || []).forEach(p => {
        nameMap[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown';
      });
    }

    const history = actions.map(a => ({
      ...a,
      setter_name: nameMap[a.user_id] || 'Unknown',
    }));

    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

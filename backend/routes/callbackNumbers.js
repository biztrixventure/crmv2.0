const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { notifyManagers } = require('../utils/notificationService');
const logger = require('../utils/logger');
const { requireFeature } = require('../utils/featureGate');

const router = express.Router();

// All callbackNumbers routes require the feature to be enabled
router.use(requireFeature('callback_numbers'));

const MANAGER_LEVELS = [
  'superadmin', 'company_admin', 'manager',
  'operations_manager', 'closer_manager', 'fronter_manager',
];

const LOCK_DAYS    = 7;
const RELEASE_DAYS = 30;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

async function logHistory(numberId, actorId, action, opts = {}) {
  const { field, oldVal, newVal, metadata = {} } = opts;
  try {
    await supabaseAdmin.from('callback_number_history').insert({
      callback_number_id: numberId,
      actor_id:           actorId || null,
      action,
      field_name:  field  ?? null,
      old_value:   oldVal != null ? String(oldVal) : null,
      new_value:   newVal != null ? String(newVal) : null,
      metadata,
    });
  } catch { /* non-critical — never block the main operation */ }
}

async function enrichWithOwnerNames(numbers) {
  if (!numbers.length) return numbers;
  const ownerIds = [...new Set(numbers.map(n => n.owner_id).filter(Boolean))];
  if (!ownerIds.length) return numbers;
  const { data: profiles } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, first_name, last_name')
    .in('user_id', ownerIds);
  const map = {};
  (profiles || []).forEach(p => {
    map[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown';
  });
  return numbers.map(n => ({ ...n, owner_name: n.owner_id ? (map[n.owner_id] || 'Unknown') : null }));
}

async function enrichWithAttemptSummary(numbers) {
  if (!numbers.length) return numbers;
  const ids = numbers.map(n => n.id);
  const { data: attempts } = await supabaseAdmin
    .from('callback_number_attempts')
    .select('callback_number_id, outcome, attempted_at')
    .in('callback_number_id', ids)
    .order('attempted_at', { ascending: false });

  const summaryMap = {};
  for (const a of (attempts || [])) {
    if (!summaryMap[a.callback_number_id]) {
      summaryMap[a.callback_number_id] = { count: 0, last_outcome: null, last_attempted_at: null };
    }
    const s = summaryMap[a.callback_number_id];
    s.count++;
    if (!s.last_outcome) {
      s.last_outcome = a.outcome;
      s.last_attempted_at = a.attempted_at;
    }
  }
  return numbers.map(n => ({ ...n, ...(summaryMap[n.id] || { count: 0, last_outcome: null, last_attempted_at: null }) }));
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /callback-numbers — list numbers
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const userId    = req.user.id;
  const companyId = req.query.company_id || req.user.company_id;
  const status    = req.query.status;
  const ownerId   = req.query.owner_id;
  const search    = req.query.search;

  const isManager = MANAGER_LEVELS.includes(req.user.role);

  let query = supabaseAdmin
    .from('callback_numbers')
    .select('*')
    .order('updated_at', { ascending: false });

  if (isManager && companyId) {
    query = query.eq('company_id', companyId);
    if (ownerId) query = query.eq('owner_id', ownerId);
  } else {
    query = query.eq('owner_id', userId);
  }

  if (status) query = query.eq('status', status);
  if (search)  query = query.or(`phone_number.ilike.%${search}%,customer_name.ilike.%${search}%`);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  let numbers = data || [];
  numbers = await enrichWithOwnerNames(numbers);
  numbers = await enrichWithAttemptSummary(numbers);

  res.json({ numbers });
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /callback-numbers/claimable — numbers available to claim in this company
// ─────────────────────────────────────────────────────────────────────────────
router.get('/claimable', asyncHandler(async (req, res) => {
  const companyId = req.query.company_id || req.user.company_id;
  if (!companyId) return res.status(400).json({ error: 'company_id required' });

  const { data, error } = await supabaseAdmin
    .from('callback_numbers')
    .select('*')
    .eq('company_id', companyId)
    .eq('status', 'claimable')
    .order('updated_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  let numbers = await enrichWithAttemptSummary(data || []);

  // Attach previous owner summary only (count + last outcome) — not full history
  const ids = numbers.map(n => n.id);
  if (ids.length) {
    const { data: claims } = await supabaseAdmin
      .from('callback_number_claims')
      .select('callback_number_id, attempt_count, last_outcome, owner_id')
      .in('callback_number_id', ids)
      .not('owned_until', 'is', null)
      .order('owned_until', { ascending: false });

    const prevMap = {};
    for (const c of (claims || [])) {
      if (!prevMap[c.callback_number_id]) {
        prevMap[c.callback_number_id] = { prev_attempts: c.attempt_count, prev_last_outcome: c.last_outcome };
      }
    }
    numbers = numbers.map(n => ({ ...n, ...(prevMap[n.id] || {}) }));
  }

  res.json({ numbers });
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /callback-numbers/:id — full detail with attempts + ownership history
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const isManager = MANAGER_LEVELS.includes(req.user.role);

  const { data: number, error } = await supabaseAdmin
    .from('callback_numbers')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !number) return res.status(404).json({ error: 'Number not found' });
  if (!isManager && number.owner_id !== userId && number.status !== 'claimable') {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Fetch attempts — managers see all, individuals see only their own
  let attemptsQuery = supabaseAdmin
    .from('callback_number_attempts')
    .select('*')
    .eq('callback_number_id', id)
    .order('attempted_at', { ascending: false });

  if (!isManager) attemptsQuery = attemptsQuery.eq('caller_id', userId);

  const { data: attempts } = await attemptsQuery;

  // Enrich attempt caller names
  const callerIds = [...new Set((attempts || []).map(a => a.caller_id))];
  let callerMap = {};
  if (callerIds.length) {
    const { data: profiles } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, first_name, last_name')
      .in('user_id', callerIds);
    (profiles || []).forEach(p => {
      callerMap[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown';
    });
  }
  const enrichedAttempts = (attempts || []).map(a => ({
    ...a,
    caller_name: callerMap[a.caller_id] || 'Unknown',
  }));

  // Ownership history
  let claims = [];
  if (isManager) {
    const { data: claimsData } = await supabaseAdmin
      .from('callback_number_claims')
      .select('*')
      .eq('callback_number_id', id)
      .order('owned_from', { ascending: false });
    const claimOwnerIds = [...new Set((claimsData || []).map(c => c.owner_id))];
    let claimOwnerMap = {};
    if (claimOwnerIds.length) {
      const { data: cProfiles } = await supabaseAdmin
        .from('user_profiles')
        .select('user_id, first_name, last_name')
        .in('user_id', claimOwnerIds);
      (cProfiles || []).forEach(p => {
        claimOwnerMap[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown';
      });
    }
    claims = (claimsData || []).map(c => ({ ...c, owner_name: claimOwnerMap[c.owner_id] || 'Unknown' }));
  } else {
    // Non-manager: show only a summary of previous ownership (no detail)
    const { data: claimsData } = await supabaseAdmin
      .from('callback_number_claims')
      .select('attempt_count, last_outcome')
      .eq('callback_number_id', id)
      .not('owned_until', 'is', null)
      .order('owned_until', { ascending: false })
      .limit(1);
    claims = claimsData || [];
  }

  // Transfer detail if linked
  let transfer = null;
  if (number.source === 'transfer' && number.source_id) {
    const { data: t } = await supabaseAdmin
      .from('transfers')
      .select('id, form_data, status, created_at')
      .eq('id', number.source_id)
      .single();
    transfer = t || null;
  }

  // Current owner name
  let ownerName = null;
  if (number.owner_id) {
    const { data: op } = await supabaseAdmin
      .from('user_profiles')
      .select('first_name, last_name')
      .eq('user_id', number.owner_id)
      .single();
    ownerName = op ? `${op.first_name || ''} ${op.last_name || ''}`.trim() : 'Unknown';
  }

  res.json({
    number: { ...number, owner_name: ownerName },
    attempts: enrichedAttempts,
    claims,
    transfer,
    is_manager: isManager,
  });
}));

// ─────────────────────────────────────────────────────────────────────────────
// POST /callback-numbers — create a new tracked number
// ─────────────────────────────────────────────────────────────────────────────
router.post('/',
  [
    body('phone_number').trim().notEmpty().withMessage('phone_number required'),
    body('customer_name').optional().trim(),
    body('notes').optional().trim(),
    body('source').optional().isIn(['manual', 'transfer']),
    body('source_id').optional().isUUID(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errors.array() });

    const userId    = req.user.id;
    const companyId = req.body.company_id || req.user.company_id;
    if (!companyId) return res.status(400).json({ error: 'company_id required' });

    const now        = new Date();
    const lockedUntil = addDays(now, LOCK_DAYS);
    const releaseAt   = addDays(now, RELEASE_DAYS);

    const { data, error } = await supabaseAdmin
      .from('callback_numbers')
      .insert({
        company_id:    companyId,
        phone_number:  req.body.phone_number,
        customer_name: req.body.customer_name || null,
        notes:         req.body.notes         || null,
        source:        req.body.source        || 'manual',
        source_id:     req.body.source_id     || null,
        owner_id:      userId,
        status:        'active',
        locked_until:  lockedUntil,
        assigned_at:   now.toISOString(),
        release_at:    releaseAt,
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Open a claim record for the first owner
    await supabaseAdmin.from('callback_number_claims').insert({
      callback_number_id: data.id,
      owner_id:           userId,
      owned_from:         now.toISOString(),
    });

    await logHistory(data.id, userId, 'created', {
      metadata: { phone_number: data.phone_number, source: data.source, customer_name: data.customer_name || null },
    });

    logger.info('CALLBACK_NUMBERS', `Created tracked number ${data.phone_number}`, { userId });
    res.status(201).json({ number: data });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /callback-numbers/:id/attempt — log a call attempt
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/attempt',
  [
    body('outcome').isIn([
      'answered_sold', 'answered_no_sale', 'answered_callback',
      'no_answer', 'voicemail', 'wrong_number', 'do_not_call',
    ]).withMessage('Invalid outcome'),
    body('remarks').optional().trim(),
    body('scheduled_callback_at').optional().isISO8601(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errors.array() });

    const { id }   = req.params;
    const userId   = req.user.id;
    const companyId = req.user.company_id;

    const { data: number, error: fetchErr } = await supabaseAdmin
      .from('callback_numbers')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !number) return res.status(404).json({ error: 'Number not found' });
    if (number.owner_id !== userId) return res.status(403).json({ error: 'Only the current owner can log attempts' });
    if (number.status === 'released') return res.status(400).json({ error: 'Number is released' });

    const { outcome, remarks, scheduled_callback_at } = req.body;
    const now = new Date();

    // Insert attempt
    const { data: attempt, error: aErr } = await supabaseAdmin
      .from('callback_number_attempts')
      .insert({
        callback_number_id:    id,
        caller_id:             userId,
        company_id:            number.company_id,
        outcome,
        remarks:               remarks || null,
        scheduled_callback_at: scheduled_callback_at || null,
      })
      .select()
      .single();

    if (aErr) return res.status(400).json({ error: aErr.message });

    // Re-lock: extend locked_until by 7 days from now
    const newLockedUntil = addDays(now, LOCK_DAYS);
    const numberUpdates = {
      last_attempt_at: now.toISOString(),
      locked_until:    newLockedUntil,
      status:          'active', // re-activates if it was claimable
      updated_at:      now.toISOString(),
    };

    // If do_not_call, mark released
    if (outcome === 'do_not_call') {
      numberUpdates.status     = 'released';
      numberUpdates.owner_id   = null;
      await logHistory(id, userId, 'status_changed', {
        field: 'status', oldVal: number.status, newVal: 'released',
        metadata: { reason: 'do_not_call' },
      });
    }

    await supabaseAdmin.from('callback_numbers').update(numberUpdates).eq('id', id);

    // Count total attempts for this number, update open claim record
    const { count: totalAttempts } = await supabaseAdmin
      .from('callback_number_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('callback_number_id', id);

    await supabaseAdmin
      .from('callback_number_claims')
      .update({ attempt_count: totalAttempts || 1, last_outcome: outcome })
      .eq('callback_number_id', id)
      .is('owned_until', null);

    // If outcome = answered_callback and time given → create a regular callback entry
    // so the existing notification scheduler fires at that time
    if (outcome === 'answered_callback' && scheduled_callback_at) {
      await supabaseAdmin.from('callbacks').insert({
        user_id:        userId,
        company_id:     number.company_id,
        customer_name:  number.customer_name || number.phone_number,
        customer_phone: number.phone_number,
        notes:          remarks || null,
        callback_at:    scheduled_callback_at,
        status:         'pending',
        source:         'manual',
        notified:       false,
      });
    }

    logger.info('CALLBACK_NUMBERS', `Attempt logged: ${outcome} on ${number.phone_number}`, { userId });
    res.status(201).json({ attempt });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /callback-numbers/:id/claim — claim a claimable number
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/claim', asyncHandler(async (req, res) => {
  const { id }   = req.params;
  const userId   = req.user.id;

  const { data: number, error } = await supabaseAdmin
    .from('callback_numbers')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !number) return res.status(404).json({ error: 'Number not found' });
  if (number.status !== 'claimable') return res.status(400).json({ error: 'Number is not available to claim' });
  if (number.company_id !== req.user.company_id) return res.status(403).json({ error: 'Access denied' });

  const now          = new Date();
  const lockedUntil  = addDays(now, LOCK_DAYS);
  const releaseAt    = addDays(now, RELEASE_DAYS);

  // Close previous claim
  await supabaseAdmin
    .from('callback_number_claims')
    .update({ owned_until: now.toISOString(), release_reason: 'inactivity_7d' })
    .eq('callback_number_id', id)
    .is('owned_until', null);

  // Update number ownership
  await supabaseAdmin.from('callback_numbers').update({
    owner_id:    userId,
    status:      'active',
    assigned_at: now.toISOString(),
    locked_until: lockedUntil,
    release_at:  releaseAt,
    updated_at:  now.toISOString(),
  }).eq('id', id);

  // Open new claim
  await supabaseAdmin.from('callback_number_claims').insert({
    callback_number_id: id,
    owner_id:           userId,
    owned_from:         now.toISOString(),
  });

  await logHistory(id, userId, 'status_changed', {
    field: 'status', oldVal: 'claimable', newVal: 'active',
    metadata: { reason: 'claimed', prev_owner: number.owner_id || null },
  });

  logger.info('CALLBACK_NUMBERS', `Number ${number.phone_number} claimed by ${userId}`);
  res.json({ message: 'Number claimed successfully' });
}));

// ─────────────────────────────────────────────────────────────────────────────
// PUT /callback-numbers/:id — update number details (owner only)
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id',
  [
    body('customer_name').optional().trim(),
    body('notes').optional().trim(),
    body('phone_number').optional().trim(),
  ],
  asyncHandler(async (req, res) => {
    const { id }   = req.params;
    const userId   = req.user.id;

    const isManager = MANAGER_LEVELS.includes(req.user.role);

    const { data: existing } = await supabaseAdmin
      .from('callback_numbers')
      .select('owner_id, company_id, customer_name, notes, phone_number')
      .eq('id', id)
      .single();

    if (!existing) return res.status(404).json({ error: 'Number not found' });
    if (!isManager && existing.owner_id !== userId) return res.status(403).json({ error: 'Access denied' });

    const allowed = ['customer_name', 'notes', 'phone_number'];
    const updates = { updated_at: new Date().toISOString() };
    for (const k of allowed) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }

    const { data, error } = await supabaseAdmin
      .from('callback_numbers')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Log each changed field
    for (const k of allowed) {
      if (req.body[k] !== undefined && req.body[k] !== existing[k]) {
        await logHistory(id, userId, 'field_updated', {
          field: k, oldVal: existing[k] ?? '', newVal: req.body[k] ?? '',
        });
      }
    }

    res.json({ number: data });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// PUT /callback-numbers/:id/reassign — manager only
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id/reassign',
  [body('new_owner_id').isUUID().withMessage('new_owner_id must be UUID')],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errors.array() });

    const userId   = req.user.id;
    const isManager = MANAGER_LEVELS.includes(req.user.role);
    if (!isManager) return res.status(403).json({ error: 'Managers only' });

    const { id }          = req.params;
    const { new_owner_id } = req.body;
    const now              = new Date();

    const { data: number } = await supabaseAdmin
      .from('callback_numbers')
      .select('*')
      .eq('id', id)
      .single();

    if (!number) return res.status(404).json({ error: 'Number not found' });

    // Close current claim
    if (number.owner_id) {
      await supabaseAdmin
        .from('callback_number_claims')
        .update({ owned_until: now.toISOString(), release_reason: 'manager_reassign' })
        .eq('callback_number_id', id)
        .is('owned_until', null);
    }

    const lockedUntil = addDays(now, LOCK_DAYS);
    const releaseAt   = addDays(now, RELEASE_DAYS);

    await supabaseAdmin.from('callback_numbers').update({
      owner_id:     new_owner_id,
      status:       'active',
      assigned_at:  now.toISOString(),
      locked_until: lockedUntil,
      release_at:   releaseAt,
      updated_at:   now.toISOString(),
    }).eq('id', id);

    // Open new claim
    await supabaseAdmin.from('callback_number_claims').insert({
      callback_number_id: id,
      owner_id:           new_owner_id,
      owned_from:         now.toISOString(),
    });

    await logHistory(id, userId, 'reassigned', {
      field: 'owner_id', oldVal: number.owner_id || null, newVal: new_owner_id,
      metadata: { prev_owner: number.owner_id || null, new_owner: new_owner_id },
    });

    logger.info('CALLBACK_NUMBERS', `Number ${number.phone_number} reassigned by manager ${userId} → ${new_owner_id}`);
    res.json({ message: 'Reassigned successfully' });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /callback-numbers/:id — manager releases / owner self-releases
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id }   = req.params;
  const userId   = req.user.id;

  const isManager = MANAGER_LEVELS.includes(req.user.role);

  const { data: number } = await supabaseAdmin
    .from('callback_numbers')
    .select('owner_id, phone_number')
    .eq('id', id)
    .single();

  if (!number) return res.status(404).json({ error: 'Number not found' });
  if (!isManager && number.owner_id !== userId) return res.status(403).json({ error: 'Access denied' });

  const now = new Date();
  await supabaseAdmin
    .from('callback_number_claims')
    .update({ owned_until: now.toISOString(), release_reason: isManager ? 'manager_reassign' : 'self_release' })
    .eq('callback_number_id', id)
    .is('owned_until', null);

  await supabaseAdmin.from('callback_numbers').update({
    owner_id:   null,
    status:     'released',
    updated_at: now.toISOString(),
  }).eq('id', id);

  await logHistory(id, userId, 'status_changed', {
    field: 'status', oldVal: number.status, newVal: 'released',
    metadata: { reason: isManager ? 'manager_release' : 'self_release' },
  });

  logger.info('CALLBACK_NUMBERS', `Number ${number.phone_number} released`, { userId });
  res.json({ message: 'Number released' });
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /callback-numbers/:id/team-members — for manager reassign dropdown
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/team-members', asyncHandler(async (req, res) => {
  const userId   = req.user.id;
  const companyId = req.user.company_id;

  const isManager = MANAGER_LEVELS.includes(req.user.role);
  if (!isManager) return res.status(403).json({ error: 'Managers only' });

  const { data } = await supabaseAdmin
    .from('user_company_roles')
    .select(`
      user_id,
      custom_roles (name, level),
      user_profiles (first_name, last_name)
    `)
    .eq('company_id', companyId)
    .eq('is_active', true);

  const members = (data || [])
    .filter(r => ['fronter', 'closer', 'fronter_manager', 'closer_manager'].includes(r.custom_roles?.level))
    .map(r => ({
      user_id:    r.user_id,
      role:       r.custom_roles?.name,
      role_level: r.custom_roles?.level,
      name:       `${r.user_profiles?.first_name || ''} ${r.user_profiles?.last_name || ''}`.trim() || 'Unknown',
    }));

  res.json({ members });
}));

module.exports = router;

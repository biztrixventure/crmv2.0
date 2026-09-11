// ============================================================================
// /api/training -- the Training portal (mig 311).
//
// One router serves both sides, because they are the same material seen from
// two angles: a trainee reading it, and the person who put it there. Splitting
// them into two routers would mean two copies of the company-scoping rule, and
// that is precisely the rule that must never disagree with itself.
//
// WHO GETS IN -- always through moduleAccess.can(), never hasPermission()
// directly. A designation (module_designations, module='training') is invisible
// to hasPermission, and the designation is how a compliance manager runs
// training for a company they do not belong to. Calling hasPermission here
// would shut the module for exactly the people it was built for -- the lesson
// the Accounting/HR modules wrote into CLAUDE.md.
//
// COMPANY SCOPE -- every list is "this company OR global". company_id NULL
// means the row belongs to every company, and only a superadmin writes those
// (`global: true` on the body). A manager's writes always land in a company
// writeCompanyId() approved, so a picker can never drop a document into a
// tenant the caller cannot reach.
//
// READS ARE OPEN TO STAFF. training.view is seeded broadly on purpose: the
// whole point is that a trainee promoted to fronter keeps seeing the material,
// and gating the read any tighter would take it away on the day of promotion.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const { isSuperAdmin, getUserCompanies } = require('../models/helpers');
const {
  can, deny, readCompanyId, writeCompanyId, moduleCompanies, isDesignated,
} = require('../utils/moduleAccess');

const router = express.Router();

const BUCKET = 'training-media';
const MAX_FILE_BYTES = 25 * 1024 * 1024;      // 25 MB -- a training PDF or a call

// Every helper in moduleAccess resolves scope from req.moduleKey, so stamp it
// once here instead of threading 'training' through 30 call sites.
router.use((req, _res, next) => { req.moduleKey = 'training'; next(); });

// ── small helpers ────────────────────────────────────────────────────────────
const str = (v, n = 500) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, n) : null;
};
const int = (v, d = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};
const bool = (v, d = false) => (typeof v === 'boolean' ? v : d);

// Paste-a-list parsing, same shape as routes/vehicles.js parseCsv: split on the
// separators people actually paste, keep the casing as typed (brand styling
// carries meaning), dedupe case-insensitively so a re-paste does not multiply.
function parseList(input) {
  if (typeof input !== 'string') return [];
  const seen = new Set();
  const out = [];
  for (const raw of input.split(/[,\n\r\t|;]+/)) {
    const name = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

const manageable = (req, companyId) => can(req, companyId, 'training.manage');

// A list reads "this company OR global". With no company resolved, a
// cross-company admin sees everything and everyone else sees only the global
// rows -- never another tenant's, which is what a bare unfiltered select would
// have leaked.
async function scopedList(table, companyId, { admin = false, activeOnly = true, select = '*' } = {}) {
  let q = supabaseAdmin.from(table).select(select);
  if (companyId) q = q.or(`company_id.eq.${companyId},company_id.is.null`);
  else if (!admin) q = q.is('company_id', null);
  if (activeOnly) q = q.eq('is_active', true);
  const { data, error } = await q.order('sort_order', { ascending: true }).order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

// Load one row and confirm the caller may write to it. Returns
// { row } | { error, status }, so callers stay one `if` long.
async function ownedRow(req, table, id) {
  const { data: row, error } = await supabaseAdmin.from(table).select('*').eq('id', id).maybeSingle();
  if (error) return { status: 500, error: error.message };
  if (!row) return { status: 404, error: 'Not found' };
  // A global row belongs to every company, so only a superadmin may edit it --
  // otherwise one company's manager silently rewrites material everyone sees.
  if (!row.company_id) {
    if (!(await isSuperAdmin(req.user.id))) return { status: 403, error: 'Only a superadmin can edit shared material' };
    return { row };
  }
  if (!(await manageable(req, row.company_id))) return { status: 403, error: 'Forbidden' };
  return { row };
}

// Which company a WRITE lands in. `global: true` (superadmin only) writes the
// row every company sees; everything else goes through writeCompanyId so the
// answer matches what the read scope would have shown.
async function targetCompany(req) {
  if (req.body?.global === true && await isSuperAdmin(req.user.id)) return null;
  return writeCompanyId(req);
}

// Whether this viewer sees the manage surface for the resolved company. Every
// list handler asks the same question the same way.
async function viewerMode(req, companyId) {
  const admin = await isSuperAdmin(req.user.id);
  const manage = admin || await manageable(req, companyId);
  const wantsArchived = req.query.include_inactive === '1' || req.query.include_inactive === 'true';
  return { admin, manage, activeOnly: !(manage && wantsArchived) };
}

// ── GET /training/my-scope ───────────────────────────────────────────────────
// What the shell asks before it draws anything: may I view, may I manage, and
// which companies may I point this at. The portal renders from this alone, so
// it can never offer a control the API would refuse.
router.get('/my-scope', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  const [superadmin, view, manage, progress, designated] = await Promise.all([
    isSuperAdmin(req.user.id),
    can(req, companyId, 'training.view'),
    can(req, companyId, 'training.manage'),
    can(req, companyId, 'training.progress'),
    isDesignated(req.user.id, 'training'),
  ]);

  // A trainee is a trainee: the role itself is the grant. A company that made
  // the role without ticking training.view would otherwise hand a new hire an
  // empty portal on day one, which is the one day it has to work.
  const isTrainee = req.user.role === 'trainee';

  res.json({
    company_id: companyId,
    companies: await moduleCompanies(req),
    can_view:     superadmin || view || isTrainee,
    can_manage:   superadmin || manage,
    can_progress: superadmin || manage || progress,
    designated,
    is_trainee: isTrainee,
  });
}));

// ── GET /training/documents ──────────────────────────────────────────────────
router.get('/documents', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  const { admin, activeOnly } = await viewerMode(req, companyId);
  res.json({ documents: await scopedList('training_documents', companyId, { admin, activeOnly }) });
}));

// ── GET /training/recordings ─────────────────────────────────────────────────
router.get('/recordings', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  const { admin, activeOnly } = await viewerMode(req, companyId);
  res.json({ recordings: await scopedList('training_recordings', companyId, { admin, activeOnly }) });
}));

// ── GET /training/scenarios ──────────────────────────────────────────────────
// Options come back nested. They are fetched in one second query keyed on the
// scenario ids rather than a PostgREST embed, so a scenario with no options
// still lists instead of vanishing behind an inner join.
router.get('/scenarios', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  const { admin, manage, activeOnly } = await viewerMode(req, companyId);

  const scenarios = await scopedList('training_scenarios', companyId, { admin, activeOnly });
  if (!scenarios.length) return res.json({ scenarios: [] });

  const { data: opts } = await supabaseAdmin
    .from('training_scenario_options').select('*')
    .in('scenario_id', scenarios.map(s => s.id))
    .order('sort_order', { ascending: true });

  const byScenario = {};
  for (const o of (opts || [])) (byScenario[o.scenario_id] ||= []).push(o);

  res.json({
    scenarios: scenarios.map(s => ({
      ...s,
      // A trainee must not be handed the answer key with the question. The
      // correct option is revealed by POST /scenarios/:id/answer, never by the
      // list that renders the choices.
      options: (byScenario[s.id] || []).map(o => manage ? o : {
        id: o.id, scenario_id: o.scenario_id, label: o.label,
        disposition: o.disposition, sort_order: o.sort_order,
      }),
    })),
  });
}));

// ── GET /training/toolkit ────────────────────────────────────────────────────
// The pronunciation lists.
//
// Vehicle makes and models are read LIVE from the form builder catalog
// (vehicle_makes / vehicle_models) rather than copied into training_terms --
// copying would fork the list the moment an admin edits the catalog, and the
// trainee would be practising names the form no longer offers. training_terms
// carries only the extras a manager typed in, and the uploaded name lists.
router.get('/toolkit', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  const admin = await isSuperAdmin(req.user.id);
  const kind = req.query.kind === 'name' ? 'name' : 'vehicle';

  let q = supabaseAdmin.from('training_terms').select('*').eq('kind', kind).eq('is_active', true);
  if (companyId) q = q.or(`company_id.eq.${companyId},company_id.is.null`);
  else if (!admin) q = q.is('company_id', null);
  const { data: terms, error } = await q.order('term', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  if (kind === 'name') return res.json({ kind, names: terms || [] });

  const [{ data: makes }, { data: models }] = await Promise.all([
    supabaseAdmin.from('vehicle_makes').select('id, name, hidden').order('name'),
    supabaseAdmin.from('vehicle_models').select('id, make_id, name, hidden').order('name'),
  ]);
  const byMake = {};
  for (const m of (models || [])) { if (!m.hidden) (byMake[m.make_id] ||= []).push({ id: m.id, name: m.name }); }

  res.json({
    kind,
    makes: (makes || []).filter(m => !m.hidden)
      .map(m => ({ id: m.id, name: m.name, models: byMake[m.id] || [] })),
    extras: terms || [],
  });
}));

// ── Progress ─────────────────────────────────────────────────────────────────

// GET /training/progress/me -- everything this person has opened or finished.
router.get('/progress/me', asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('training_progress').select('*').eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ progress: data || [] });
}));

// POST /training/progress { item_type, item_id?, item_key?, status?, score? }
//
// Upserted by hand rather than with onConflict: the unique index is on
// COALESCE() expressions (so a NULL item_id still dedupes), and PostgREST's
// onConflict only accepts bare column names. Read-then-write is exact here and
// this endpoint is called once per item opened.
//
// The row is always written for the CALLER. A user_id from the client is never
// honoured -- that would let anyone mark anyone else as trained.
router.post('/progress', asyncHandler(async (req, res) => {
  const itemType = ['document', 'recording', 'scenario', 'toolkit'].includes(req.body?.item_type)
    ? req.body.item_type : null;
  if (!itemType) return res.status(400).json({ error: 'item_type must be document, recording, scenario or toolkit' });

  const itemId  = str(req.body?.item_id, 40);
  const itemKey = str(req.body?.item_key, 120);
  const status  = req.body?.status === 'completed' ? 'completed' : 'opened';
  const score   = req.body?.score === undefined || req.body?.score === null ? null : int(req.body.score, 0);
  const companyId = await readCompanyId(req);

  // .eq() cannot express "IS NULL", so build the match explicitly -- an item
  // with no id (a toolkit list) must still find its own row rather than
  // inserting a duplicate on every visit.
  let q = supabaseAdmin.from('training_progress').select('*')
    .eq('user_id', req.user.id).eq('item_type', itemType);
  q = itemId  ? q.eq('item_id', itemId)   : q.is('item_id', null);
  q = itemKey ? q.eq('item_key', itemKey) : q.is('item_key', null);
  const { data: current } = await q.maybeSingle();

  const now = new Date().toISOString();
  if (current) {
    const patch = {
      attempts: (current.attempts || 1) + 1,
      updated_at: now,
      company_id: companyId || current.company_id,
    };
    // Completion is a ratchet: re-opening a finished document does not un-finish
    // it, and a manager reading this table should never watch progress go
    // backwards because someone clicked twice.
    if (status === 'completed') {
      patch.status = 'completed';
      patch.completed_at = current.completed_at || now;
    }
    if (score !== null) patch.score = Math.max(current.score ?? 0, score);
    const { data, error } = await supabaseAdmin
      .from('training_progress').update(patch).eq('id', current.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ progress: data });
  }

  const { data, error } = await supabaseAdmin.from('training_progress').insert({
    user_id: req.user.id,
    company_id: companyId,
    item_type: itemType,
    item_id: itemId,
    item_key: itemKey,
    status,
    score,
    completed_at: status === 'completed' ? now : null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ progress: data });
}));

// GET /training/progress -- the team view, for whoever decides on promotion.
router.get('/progress', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (await deny(req, res, companyId, 'training.progress')) return;

  let q = supabaseAdmin.from('training_progress').select('*');
  if (companyId) q = q.eq('company_id', companyId);
  if (req.query.user_id) q = q.eq('user_id', req.query.user_id);
  const { data, error } = await q.order('updated_at', { ascending: false }).limit(5000);
  if (error) return res.status(500).json({ error: error.message });

  const rows = data || [];
  const uids = [...new Set(rows.map(r => r.user_id))];
  let names = {};
  if (uids.length) {
    // user_profiles has no email column -- selecting one 400s the request.
    const { data: profs } = await supabaseAdmin
      .from('user_profiles').select('user_id, first_name, last_name').in('user_id', uids);
    names = Object.fromEntries((profs || []).map(p =>
      [p.user_id, [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || p.user_id]));
  }

  res.json({ progress: rows.map(r => ({ ...r, user_name: names[r.user_id] || r.user_id })) });
}));

// ── Scenario answering ───────────────────────────────────────────────────────
// Kept separate from the scenario list so the list never carries is_correct.
router.post('/scenarios/:id/answer', asyncHandler(async (req, res) => {
  const optionId = str(req.body?.option_id, 40);
  if (!optionId) return res.status(400).json({ error: 'option_id required' });

  const { data: opts, error } = await supabaseAdmin
    .from('training_scenario_options').select('*').eq('scenario_id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  const picked = (opts || []).find(o => o.id === optionId);
  if (!picked) return res.status(404).json({ error: 'Unknown option for this scenario' });

  const correctIds = (opts || []).filter(o => o.is_correct).map(o => o.id);
  res.json({
    correct: picked.is_correct,
    feedback: picked.feedback || null,
    // With no option marked correct the scenario is a discussion piece, not a
    // test. Say so rather than reporting every answer as wrong.
    graded: correctIds.length > 0,
    correct_option_ids: correctIds,
  });
}));

// ============================================================================
// MANAGEMENT
// ============================================================================

// ── POST /training/upload -- base64 file → Supabase Storage → public URL ─────
// Mirrors routes/chat.js: base64 in JSON, no multipart dependency. The bucket is
// created lazily (routes/branding.js does the same) so there is no manual
// provisioning step between applying mig 311 and the first upload.
async function ensureBucket() {
  try {
    const { data } = await supabaseAdmin.storage.getBucket(BUCKET);
    if (data) return;
  } catch { /* not found → create */ }
  const { error } = await supabaseAdmin.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: `${MAX_FILE_BYTES}`,
  });
  if (error && !/already exists/i.test(error.message || '')) throw new Error(error.message);
}

router.post('/upload', asyncHandler(async (req, res) => {
  const companyId = await targetCompany(req);
  if (await deny(req, res, companyId, 'training.manage')) return;

  const kind = ['document', 'recording'].includes(req.body?.kind) ? req.body.kind : null;
  if (!kind) return res.status(400).json({ error: 'kind must be document or recording' });

  const type = String(req.body?.type || '').slice(0, 120);
  if (kind === 'document' && type !== 'application/pdf') {
    return res.status(400).json({ error: 'Documents must be PDF files' });
  }
  if (kind === 'recording' && !type.startsWith('audio/')) {
    return res.status(400).json({ error: 'Recordings must be audio files' });
  }

  const raw = String(req.body?.data || '');
  if (!raw) return res.status(400).json({ error: 'data required' });
  let buffer;
  try { buffer = Buffer.from(raw.includes(',') ? raw.split(',').pop() : raw, 'base64'); }
  catch { return res.status(400).json({ error: 'Invalid file data' }); }
  if (!buffer.length) return res.status(400).json({ error: 'Empty file' });
  if (buffer.length > MAX_FILE_BYTES) {
    return res.status(400).json({ error: `File exceeds the ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB limit` });
  }

  try { await ensureBucket(); }
  catch (e) {
    logger.error('TRAINING', `bucket: ${e.message}`);
    return res.status(500).json({ error: `Storage bucket error: ${e.message}` });
  }

  const safeName = String(req.body?.name || 'file').replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'file';
  const path = `${kind}/${companyId || 'global'}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}`;

  const { error: upErr } = await supabaseAdmin.storage
    .from(BUCKET).upload(path, buffer, { contentType: type, upsert: false });
  if (upErr) {
    logger.error('TRAINING', `upload: ${upErr.message}`);
    return res.status(500).json({ error: upErr.message });
  }
  const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);

  res.status(201).json({
    file: {
      url: pub.publicUrl,
      storage_path: path,
      name: String(req.body?.name || safeName).slice(0, 255),
      type,
      size: buffer.length,
    },
  });
}));

// Remove the stored object behind a row. Best-effort: a failed storage delete
// must never block the database delete, or a broken object would pin the row
// on the trainee's screen forever.
async function dropObject(storagePath) {
  if (!storagePath) return;
  try { await supabaseAdmin.storage.from(BUCKET).remove([storagePath]); }
  catch (e) { logger.warn('TRAINING', `storage remove failed for ${storagePath}: ${e.message}`); }
}

// ── Documents / Recordings CRUD ──────────────────────────────────────────────
// One factory for both: they differ only by table and by the two extra columns
// a recording carries. Two near-identical blocks would drift the moment one got
// a fix -- the same reasoning behind utils/exportSpec.js being one catalog.
function mediaRoutes(kind, table, singular, extraFields) {
  const base = `/${kind}`;

  router.post(base, asyncHandler(async (req, res) => {
    const companyId = await targetCompany(req);
    if (await deny(req, res, companyId, 'training.manage')) return;

    const title = str(req.body?.title, 200);
    const fileUrl = str(req.body?.file_url, 1000);
    if (!title)   return res.status(400).json({ error: 'title required' });
    if (!fileUrl) return res.status(400).json({ error: 'Upload the file first' });

    const row = {
      company_id:   companyId,
      title,
      description:  str(req.body?.description, 2000),
      category:     str(req.body?.category, 120),
      file_url:     fileUrl,
      storage_path: str(req.body?.storage_path, 1000),
      file_name:    str(req.body?.file_name, 255),
      file_size:    req.body?.file_size ? int(req.body.file_size, 0) : null,
      sort_order:   int(req.body?.sort_order, 0),
      is_active:    bool(req.body?.is_active, true),
      created_by:   req.user.id,
      ...extraFields(req.body, false),
    };
    const { data, error } = await supabaseAdmin.from(table).insert(row).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ [singular]: data });
  }));

  router.put(`${base}/:id`, asyncHandler(async (req, res) => {
    const owned = await ownedRow(req, table, req.params.id);
    if (owned.error) return res.status(owned.status).json({ error: owned.error });

    const patch = { updated_at: new Date().toISOString() };
    if (req.body?.title !== undefined)       patch.title       = str(req.body.title, 200) || owned.row.title;
    if (req.body?.description !== undefined) patch.description = str(req.body.description, 2000);
    if (req.body?.category !== undefined)    patch.category    = str(req.body.category, 120);
    if (req.body?.sort_order !== undefined)  patch.sort_order  = int(req.body.sort_order, 0);
    if (req.body?.is_active !== undefined)   patch.is_active   = bool(req.body.is_active, true);
    // A replacement file is optional; when one arrives the old object is dropped
    // so the bucket does not accumulate orphans nobody can find.
    if (req.body?.file_url) {
      patch.file_url     = str(req.body.file_url, 1000);
      patch.storage_path = str(req.body.storage_path, 1000);
      patch.file_name    = str(req.body.file_name, 255);
      patch.file_size    = req.body.file_size ? int(req.body.file_size, 0) : null;
      if (owned.row.storage_path && owned.row.storage_path !== patch.storage_path) {
        await dropObject(owned.row.storage_path);
      }
    }
    Object.assign(patch, extraFields(req.body, true));

    const { data, error } = await supabaseAdmin.from(table).update(patch).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ [singular]: data });
  }));

  router.delete(`${base}/:id`, asyncHandler(async (req, res) => {
    const owned = await ownedRow(req, table, req.params.id);
    if (owned.error) return res.status(owned.status).json({ error: owned.error });

    const { error } = await supabaseAdmin.from(table).delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    await dropObject(owned.row.storage_path);
    res.json({ ok: true });
  }));
}

mediaRoutes('documents', 'training_documents', 'document', (body, isPatch) => {
  const out = {};
  if (!isPatch) {
    out.mime_type = str(body?.type, 120) || 'application/pdf';
    out.accent = str(body?.accent, 40);
  } else if (body?.accent !== undefined) {
    out.accent = str(body.accent, 40);
  }
  return out;
});

mediaRoutes('recordings', 'training_recordings', 'recording', (body, isPatch) => {
  const out = {};
  if (!isPatch) {
    out.mime_type = str(body?.type, 120) || 'audio/mpeg';
    out.duration_sec = body?.duration_sec ? int(body.duration_sec, 0) : null;
  } else if (body?.duration_sec !== undefined) {
    out.duration_sec = body.duration_sec === null ? null : int(body.duration_sec, 0);
  }
  return out;
});

// ── Scenarios CRUD ───────────────────────────────────────────────────────────
// Options are replaced wholesale on every write. The editor sends the full set
// it is showing, so a diff would only add a way for the two to disagree.
function cleanOptions(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 30).map((o, i) => ({
    label:       str(o?.label, 300),
    disposition: str(o?.disposition, 120),
    is_correct:  bool(o?.is_correct, false),
    feedback:    str(o?.feedback, 1000),
    sort_order:  Number.isFinite(parseInt(o?.sort_order, 10)) ? parseInt(o.sort_order, 10) : i,
  })).filter(o => o.label);
}

async function writeOptions(scenarioId, options) {
  await supabaseAdmin.from('training_scenario_options').delete().eq('scenario_id', scenarioId);
  if (!options.length) return;
  const { error } = await supabaseAdmin.from('training_scenario_options')
    .insert(options.map(o => ({ ...o, scenario_id: scenarioId })));
  if (error) throw new Error(error.message);
}

router.post('/scenarios', asyncHandler(async (req, res) => {
  const companyId = await targetCompany(req);
  if (await deny(req, res, companyId, 'training.manage')) return;

  const title = str(req.body?.title, 200);
  const situation = str(req.body?.situation, 8000);
  if (!title || !situation) return res.status(400).json({ error: 'title and situation are required' });

  const { data, error } = await supabaseAdmin.from('training_scenarios').insert({
    company_id: companyId,
    title,
    situation,
    guidance:   str(req.body?.guidance, 4000),
    category:   str(req.body?.category, 120),
    sort_order: int(req.body?.sort_order, 0),
    is_active:  bool(req.body?.is_active, true),
    created_by: req.user.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  const options = cleanOptions(req.body?.options);
  try { await writeOptions(data.id, options); }
  catch (e) { return res.status(500).json({ error: e.message }); }

  res.status(201).json({ scenario: { ...data, options } });
}));

router.put('/scenarios/:id', asyncHandler(async (req, res) => {
  const owned = await ownedRow(req, 'training_scenarios', req.params.id);
  if (owned.error) return res.status(owned.status).json({ error: owned.error });

  const patch = { updated_at: new Date().toISOString() };
  if (req.body?.title !== undefined)      patch.title      = str(req.body.title, 200) || owned.row.title;
  if (req.body?.situation !== undefined)  patch.situation  = str(req.body.situation, 8000) || owned.row.situation;
  if (req.body?.guidance !== undefined)   patch.guidance   = str(req.body.guidance, 4000);
  if (req.body?.category !== undefined)   patch.category   = str(req.body.category, 120);
  if (req.body?.sort_order !== undefined) patch.sort_order = int(req.body.sort_order, 0);
  if (req.body?.is_active !== undefined)  patch.is_active  = bool(req.body.is_active, true);

  const { data, error } = await supabaseAdmin
    .from('training_scenarios').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Options are replaced only when the caller actually sent them. A PUT that
  // just renames a scenario must not silently wipe its dispositions.
  let options = null;
  if (req.body?.options !== undefined) {
    options = cleanOptions(req.body.options);
    try { await writeOptions(data.id, options); }
    catch (e) { return res.status(500).json({ error: e.message }); }
  }
  res.json({ scenario: options ? { ...data, options } : data });
}));

router.delete('/scenarios/:id', asyncHandler(async (req, res) => {
  const owned = await ownedRow(req, 'training_scenarios', req.params.id);
  if (owned.error) return res.status(owned.status).json({ error: owned.error });
  // training_scenario_options is ON DELETE CASCADE, so the children go with it.
  const { error } = await supabaseAdmin.from('training_scenarios').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

// ── Tool Kit terms CRUD ──────────────────────────────────────────────────────
router.post('/terms', asyncHandler(async (req, res) => {
  const companyId = await targetCompany(req);
  if (await deny(req, res, companyId, 'training.manage')) return;

  const kind = ['vehicle', 'name'].includes(req.body?.kind) ? req.body.kind : null;
  const term = str(req.body?.term, 200);
  if (!kind) return res.status(400).json({ error: 'kind must be vehicle or name' });
  if (!term) return res.status(400).json({ error: 'term required' });

  const { data, error } = await supabaseAdmin.from('training_terms').insert({
    company_id: companyId,
    kind,
    term,
    phonetic: str(req.body?.phonetic, 200),
    note:     str(req.body?.note, 500),
    source:   'manual',
    created_by: req.user.id,
  }).select().single();
  // The unique index is the point of the 409: a manager re-adding a name they
  // already added should be told, not handed a second identical card.
  if (error) {
    if (/duplicate key|uq_training_terms/i.test(error.message)) {
      return res.status(409).json({ error: `"${term}" is already on this list` });
    }
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json({ term: data });
}));

// POST /training/terms/bulk { kind, text } -- paste or upload a list.
// Inserted with ignoreDuplicates so re-pasting a longer version of the same
// list adds only what is new, which is how these lists actually grow.
router.post('/terms/bulk', asyncHandler(async (req, res) => {
  const companyId = await targetCompany(req);
  if (await deny(req, res, companyId, 'training.manage')) return;

  const kind = ['vehicle', 'name'].includes(req.body?.kind) ? req.body.kind : null;
  if (!kind) return res.status(400).json({ error: 'kind must be vehicle or name' });

  const names = parseList(req.body?.text).slice(0, 5000);
  if (!names.length) return res.status(400).json({ error: 'Nothing to add' });

  const { data, error } = await supabaseAdmin.from('training_terms')
    .upsert(names.map(term => ({
      company_id: companyId, kind, term, source: 'import', created_by: req.user.id,
    })), { ignoreDuplicates: true })
    .select();
  if (error) return res.status(500).json({ error: error.message });

  const added = (data || []).length;
  res.status(201).json({ added, skipped: names.length - added, terms: data || [] });
}));

router.put('/terms/:id', asyncHandler(async (req, res) => {
  const owned = await ownedRow(req, 'training_terms', req.params.id);
  if (owned.error) return res.status(owned.status).json({ error: owned.error });

  const patch = {};
  if (req.body?.term !== undefined)      patch.term      = str(req.body.term, 200) || owned.row.term;
  if (req.body?.phonetic !== undefined)  patch.phonetic  = str(req.body.phonetic, 200);
  if (req.body?.note !== undefined)      patch.note      = str(req.body.note, 500);
  if (req.body?.is_active !== undefined) patch.is_active = bool(req.body.is_active, true);

  const { data, error } = await supabaseAdmin
    .from('training_terms').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ term: data });
}));

router.delete('/terms/:id', asyncHandler(async (req, res) => {
  const owned = await ownedRow(req, 'training_terms', req.params.id);
  if (owned.error) return res.status(owned.status).json({ error: owned.error });
  const { error } = await supabaseAdmin.from('training_terms').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

// ── GET /training/trainees ───────────────────────────────────────────────────
// Who is currently in training, for the manager deciding on promotion. Reads
// user_company_roles rather than a trainee table, because the role IS the
// state -- promoting someone is a role change and nothing here needs updating.
router.get('/trainees', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (await deny(req, res, companyId, 'training.progress')) return;

  let q = supabaseAdmin
    .from('user_company_roles')
    .select('user_id, company_id, custom_roles(name, level)')
    .eq('is_active', true);
  if (companyId) q = q.eq('company_id', companyId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const rows = (data || []).filter(r => {
    const lvl = Array.isArray(r.custom_roles) ? r.custom_roles[0]?.level : r.custom_roles?.level;
    return lvl === 'trainee';
  });
  if (!rows.length) return res.json({ trainees: [] });

  const uids = [...new Set(rows.map(r => r.user_id))];
  const { data: profs } = await supabaseAdmin
    .from('user_profiles').select('user_id, first_name, last_name').in('user_id', uids);
  const names = Object.fromEntries((profs || []).map(p =>
    [p.user_id, [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || p.user_id]));

  const { data: prog } = await supabaseAdmin
    .from('training_progress').select('user_id, status').in('user_id', uids);
  const tally = {};
  for (const p of (prog || [])) {
    (tally[p.user_id] ||= { opened: 0, completed: 0 });
    tally[p.user_id][p.status === 'completed' ? 'completed' : 'opened'] += 1;
  }

  res.json({
    trainees: rows.map(r => ({
      user_id: r.user_id,
      company_id: r.company_id,
      name: names[r.user_id] || r.user_id,
      role_name: Array.isArray(r.custom_roles) ? r.custom_roles[0]?.name : r.custom_roles?.name,
      opened:    tally[r.user_id]?.opened || 0,
      completed: tally[r.user_id]?.completed || 0,
    })).sort((a, b) => a.name.localeCompare(b.name)),
  });
}));

// ── GET /training/companies ──────────────────────────────────────────────────
// The company picker for a manager. moduleCompanies already unions membership
// with the designation scope, so the picker can never offer a company the write
// path would refuse.
router.get('/companies', asyncHandler(async (req, res) => {
  if (await isSuperAdmin(req.user.id)) {
    const { data } = await supabaseAdmin.from('companies').select('id, name').eq('is_active', true).order('name');
    return res.json({ companies: data || [], superadmin: true });
  }
  res.json({
    companies: await moduleCompanies(req),
    superadmin: false,
    member_count: (await getUserCompanies(req.user.id)).length,
  });
}));

module.exports = router;

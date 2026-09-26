const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { escapeOrValue } = require('../utils/searchSanitize');
const { makeCategoryRouter, cleanCategoryIds } = require('../utils/categoryRoutes');
const kb = require('../utils/knowledgeBase');

const router = express.Router();

const VALID_AUDIENCE = ['closer', 'fronter', 'both'];

// Normalize tagged sections: [{ heading, content, tags }]. Sanitized + capped.
function cleanSections(input) {
  if (!Array.isArray(input)) return null;
  const out = input.slice(0, 50).map(s => ({
    heading: String(s?.heading || '').slice(0, 200),
    content: String(s?.content || '').slice(0, 8000),
    tags:    String(s?.tags || '').slice(0, 500),
  })).filter(s => s.heading.trim() || s.content.trim());
  return out;
}

// Insert/update that tolerates a column not being migrated yet: on a schema
// error we retry without it so the rest of the script still saves. `sections`
// came with mig 056, `company_id` with mig 331 -- and this is the path a
// manager saves on, so the backend shipping first must not 500 every save.
async function writeScript(op, row) {
  let res = await op(row);
  const schemaErr = (r) => /column .*(sections|company_id)|schema cache/i.test(r.error?.message || '');
  if (res.error && row.sections !== undefined && schemaErr(res)) {
    const { sections, ...rest } = row;
    res = await op(rest);
  }
  if (res.error && row.company_id !== undefined && schemaErr(res)) {
    const { company_id, ...rest } = row;
    res = await op(rest);
  }
  return res;
}

// Which script audiences a viewer may see, derived from their role.
function viewerAudiences(role) {
  if (['fronter', 'fronter_manager'].includes(role)) return ['fronter', 'both'];
  if (['closer', 'closer_manager'].includes(role))   return ['closer', 'both'];
  return ['closer', 'fronter', 'both'];
}

// Scripts reuse the manage_faqs permission (same knowledge-base authority), and
// since mig 331 that permission is held by the roles that coach a floor -- plus
// team leads, whom no permission names. utils/knowledgeBase.js is the one
// definition; faqs.js asks it the same question.
const canManage = (req) => kb.canManage(req);

// What may I do, and whose rows am I writing? The editor asks before it draws,
// so it never offers a control the API would refuse.
router.get('/my-access', asyncHandler(async (req, res) => {
  res.json(await kb.manageScope(req));
}));

// Category CRUD (mounted before /:id so "categories" isn't read as an id).
router.use('/categories', makeCategoryRouter('script_categories', canManage));

// ============================================================================
// GET /scripts — role-scoped, searchable call scripts
// ============================================================================
router.get('/', asyncHandler(async (req, res) => {
  const { q, audience, include_inactive, category_id } = req.query;
  const allowed = viewerAudiences(req.user.role);
  const manage  = await canManage(req);

  // This company's scripts plus the shared ones. An estate-wide viewer
  // (superadmin / compliance) sees every company's, and may pin the list to one
  // with ?company_id=. Before mig 331 every row was estate-wide by accident.
  const { companyId, estate } = await kb.readCompanyFilter(req);
  let query = kb.scopeRead(
    supabaseAdmin.from('scripts').select('*').order('created_at', { ascending: false }),
    { companyId, estate },
  );

  if (!(manage && (include_inactive === 'true' || include_inactive === true))) {
    query = query.eq('is_active', true);
  }
  if (audience && allowed.includes(audience)) query = query.eq('audience', audience);
  else query = query.in('audience', allowed);

  // Category filter (uuid[] contains the selected category).
  if (category_id && /^[0-9a-f-]{36}$/i.test(category_id)) query = query.contains('category_ids', [category_id]);

  if (q && q.trim()) {
    const s = escapeOrValue(q.trim());
    query = query.or(`title.ilike.%${s}%,content.ilike.%${s}%,keywords.ilike.%${s}%`);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ scripts: data || [] });
}));

// ============================================================================
// POST /scripts — create (manage_faqs / superadmin)
// ============================================================================
router.post('/', [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('content').trim().notEmpty().withMessage('Script content is required'),
  body('audience').optional().isIn(VALID_AUDIENCE),
  body('keywords').optional({ nullable: true }).isString(),
], asyncHandler(async (req, res) => {
  // writeCompany() answers both questions at once: may they write, and whose
  // script is this. `global: true` (estate-wide only) writes the shared row.
  const target = await kb.writeCompany(req);
  if (target.error) return res.status(target.status || 403).json({ error: target.error });

  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errs.array() });

  const { title, content, keywords, audience, sections } = req.body;
  const row = {
    company_id: target.companyId,
    title:      title.trim(),
    content:    content.trim(),
    keywords:   keywords?.trim() || null,
    audience:   VALID_AUDIENCE.includes(audience) ? audience : 'both',
    category_ids: cleanCategoryIds(req.body.category_ids) || [],
    created_by: req.user.id,
    sections:   cleanSections(sections),
  };
  const { data, error } = await writeScript(
    (r) => supabaseAdmin.from('scripts').insert(r).select().single(), row);

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ script: data });
}));

// ============================================================================
// PUT /scripts/:id — update
// ============================================================================
router.put('/:id', [
  body('title').optional().trim().notEmpty(),
  body('content').optional().trim().notEmpty(),
  body('audience').optional().isIn(VALID_AUDIENCE),
  body('keywords').optional({ nullable: true }).isString(),
  body('is_active').optional().isBoolean(),
], asyncHandler(async (req, res) => {
  // The ROW decides, not only the caller: a company's manager must not be able
  // to rewrite a shared script, or another company's.
  const g = await kb.guardRow(req, 'scripts', req.params.id);
  if (g.error) return res.status(g.status).json({ error: g.error });

  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errs.array() });

  const updates = { updated_at: new Date().toISOString() };
  if (req.body.title     !== undefined) updates.title     = req.body.title.trim();
  if (req.body.content   !== undefined) updates.content   = req.body.content.trim();
  if (req.body.keywords  !== undefined) updates.keywords  = req.body.keywords?.trim() || null;
  if (req.body.audience  !== undefined) updates.audience  = req.body.audience;
  if (req.body.is_active !== undefined) updates.is_active = req.body.is_active;
  if (req.body.sections  !== undefined) updates.sections  = cleanSections(req.body.sections);
  const catIds = cleanCategoryIds(req.body.category_ids);
  if (catIds !== undefined) updates.category_ids = catIds;

  const { data, error } = await writeScript(
    (r) => supabaseAdmin.from('scripts').update(r).eq('id', req.params.id).select().single(), updates);
  if (error)  return res.status(500).json({ error: error.message });
  if (!data)  return res.status(404).json({ error: 'Script not found' });
  res.json({ script: data });
}));

// ============================================================================
// DELETE /scripts/:id
// ============================================================================
router.delete('/:id', asyncHandler(async (req, res) => {
  const g = await kb.guardRow(req, 'scripts', req.params.id);
  if (g.error) return res.status(g.status).json({ error: g.error });

  const { error } = await supabaseAdmin.from('scripts').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Script deleted' });
}));

module.exports = router;

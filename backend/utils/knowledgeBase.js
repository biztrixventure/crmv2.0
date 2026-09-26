// ============================================================================
// knowledgeBase.js -- who owns a script / rebuttal / FAQ, and who may write it.
//
// ONE definition for both routes. scripts.js and faqs.js each carried their own
// copy of canManage(), and the two answered the same question, so a rule fixed
// in one was still wrong in the other.
//
// WHO WRITES IT (mig 331). The knowledge base is written by the people who coach
// the floor, not only by compliance:
//   - superadmin / compliance_manager: everything, including the SHARED rows.
//   - manage_faqs on the role (fronter_manager, closer_manager,
//     operations_manager, company_admin): their own company's rows.
//   - a TEAM LEAD: their own company's rows. A lead is not a role -- it is
//     teams.lead_user_id -- so no permission would ever name them, and they are
//     exactly the person who hears the objection the rebuttal answers.
//
// WHAT THEY WRITE IT INTO. company_id NULL means SHARED with every company, and
// that is what every row created before mig 331 is. A company's manager may
// never edit a shared row: one floor's wording would silently become everyone's.
// They write rows carrying their own company, and they see those plus the shared
// ones -- the same "this company OR global" rule the training portal uses.
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const { isSuperAdmin, hasPermission } = require('../models/helpers');

// Cross-company authority: sees every company's rows and may edit the shared ones.
async function isEstateWide(req) {
  return req.user.role === 'compliance_manager'
    || req.user.role === 'readonly_admin'
    || await isSuperAdmin(req.user.id);
}

// Does this person lead a team in this company? teams.lead_user_id is the lead;
// an inactive team is not a job.
async function leadsTeamIn(userId, companyId) {
  if (!userId || !companyId) return false;
  const { data } = await supabaseAdmin
    .from('teams').select('id')
    .eq('company_id', companyId).eq('lead_user_id', userId).eq('is_active', true)
    .limit(1);
  return !!(data && data.length);
}

// May this person write knowledge-base rows for this company?
async function canManageCompany(req, companyId) {
  if (await isSuperAdmin(req.user.id)) return true;
  if (req.user.role === 'compliance_manager') return true;
  if (!companyId) return false;
  if (await hasPermission(req.user.id, companyId, 'manage_faqs')) return true;
  return leadsTeamIn(req.user.id, companyId);
}

// May this person write anything at all (their own company counts)?
async function canManage(req) {
  return canManageCompany(req, req.user.company_id || null);
}

// What the editor needs before it draws: may I write, do I write for everyone,
// and which company will my rows land in.
async function manageScope(req) {
  const estate = await isEstateWide(req);
  const companyId = req.user.company_id || null;
  const manage = estate || await canManageCompany(req, companyId);
  return { estate, manage, company_id: companyId };
}

/**
 * Narrow a list query to what this viewer may see.
 *   estate-wide  -> every row, every company (they are responsible for all of it)
 *   a company    -> that company's rows OR the shared ones
 *   no company   -> shared rows only. NEVER an unfiltered select, which is how a
 *                   tenant would read another tenant's material.
 */
function scopeRead(query, { companyId, estate }) {
  if (estate) return query;
  if (companyId) return query.or(`company_id.eq.${companyId},company_id.is.null`);
  return query.is('company_id', null);
}

/**
 * Which company a WRITE lands in. `global: true` writes the shared row every
 * company sees and is estate-wide only. Everyone else writes their own company,
 * and a person with no company cannot write at all -- silently creating a shared
 * row instead would publish one floor's wording to the whole estate.
 */
async function writeCompany(req) {
  if (req.body?.global === true && await isEstateWide(req)) return { companyId: null };
  const companyId = req.user.company_id || null;
  if (!companyId) {
    return { status: 400, error: 'Your login is not attached to a company, so there is nowhere to save this.' };
  }
  if (!(await canManageCompany(req, companyId))) return { status: 403, error: 'You do not have permission to write here' };
  return { companyId };
}

/**
 * Load one row and confirm the caller may change it.
 * Returns { row } | { status, error } so callers stay one `if` long.
 */
async function guardRow(req, table, id) {
  const { data: row, error } = await supabaseAdmin.from(table).select('*').eq('id', id).maybeSingle();
  if (error) return { status: 500, error: error.message };
  if (!row) return { status: 404, error: 'Not found' };
  if (!row.company_id) {
    // Shared with every company -- estate-wide authority only.
    if (!(await isEstateWide(req))) {
      return { status: 403, error: 'This one is shared with every company. Ask a superadmin to change it, or add your own version for your company.' };
    }
    return { row };
  }
  if (!(await canManageCompany(req, row.company_id))) return { status: 403, error: 'Forbidden' };
  return { row };
}

// A company_id a caller may FILTER a read by (the admin company picker). An
// estate-wide viewer may ask for one company or for all of them; everyone else
// is pinned to their own, whatever the query string says.
async function readCompanyFilter(req) {
  const asked = String(req.query.company_id || '').trim();
  const estate = await isEstateWide(req);
  if (!estate) return { companyId: req.user.company_id || null, estate: false };
  if (!asked || asked.toLowerCase() === 'all') return { companyId: null, estate: true };
  if (!/^[0-9a-f-]{36}$/i.test(asked)) return { companyId: null, estate: true };
  return { companyId: asked, estate: false };   // pinned to the company they picked
}

module.exports = {
  isEstateWide, leadsTeamIn, canManage, canManageCompany, manageScope,
  scopeRead, writeCompany, guardRow, readCompanyFilter,
};

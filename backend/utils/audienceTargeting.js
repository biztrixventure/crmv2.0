const { supabaseAdmin } = require('../config/database');

// ── Does an item target this viewer? ─────────────────────────────────────────
// viewer = { id, role (level), company_id }

// Announcements use an explicit target_type.
function announcementMatches(a, viewer) {
  switch (a.target_type) {
    case 'global':  return true;
    case 'role':    return (a.target_roles || []).includes(viewer.role);
    case 'users':   return (a.target_user_ids || []).includes(viewer.id);
    case 'company': return viewer.company_id && (a.target_company_ids || []).includes(viewer.company_id);
    default:        return false;
  }
}

// Marquee + SPIFF target via nullable arrays: a null/empty dimension = no
// restriction; a set dimension must match. All set dimensions must match (AND).
function arrayTargetMatches(item, viewer) {
  const u = item.target_user_ids, r = item.target_roles, c = item.target_company_ids;
  if (u && u.length && !u.includes(viewer.id)) return false;
  if (r && r.length && !r.includes(viewer.role)) return false;
  if (c && c.length && !(viewer.company_id && c.includes(viewer.company_id))) return false;
  return true;
}

// ── Resolve the concrete user ids an announcement should notify ──────────────
// (role/users/company targeting). 'global' returns [] — delivered via the feed
// + realtime, not by inserting a row per user.
async function resolveTargetUserIds(target) {
  if (target.target_type === 'users') return [...new Set(target.target_user_ids || [])];

  if (target.target_type === 'role' && (target.target_roles || []).length) {
    const { data } = await supabaseAdmin
      .from('user_company_roles')
      .select('user_id, custom_roles(level)')
      .eq('is_active', true);
    return [...new Set((data || []).filter(r => (target.target_roles || []).includes(r.custom_roles?.level)).map(r => r.user_id))];
  }

  if (target.target_type === 'company' && (target.target_company_ids || []).length) {
    const { data } = await supabaseAdmin
      .from('user_company_roles')
      .select('user_id')
      .eq('is_active', true)
      .in('company_id', target.target_company_ids);
    return [...new Set((data || []).map(r => r.user_id))];
  }

  return [];
}

// ── Reference data for the superadmin target pickers ─────────────────────────
async function getAudienceReference() {
  const [{ data: roleRows }, { data: companies }, { data: ucr }] = await Promise.all([
    supabaseAdmin.from('custom_roles').select('level').not('level', 'is', null),
    supabaseAdmin.from('companies').select('id, name').eq('is_active', true).order('name'),
    supabaseAdmin.from('user_company_roles').select('user_id, company_id, custom_roles(level), companies(name)').eq('is_active', true),
  ]);

  const roles = [...new Set((roleRows || []).map(r => r.level))].sort();

  const userIds = [...new Set((ucr || []).map(r => r.user_id))];
  const profiles = {};
  if (userIds.length) {
    const { data } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', userIds);
    (data || []).forEach(p => { profiles[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim(); });
  }
  const emails = {};
  try {
    const { data } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    (data?.users || []).forEach(u => { emails[u.id] = u.email; });
  } catch { /* email is best-effort for the picker */ }

  const seen = new Set();
  const users = (ucr || []).filter(r => { if (seen.has(r.user_id)) return false; seen.add(r.user_id); return true; })
    .map(r => ({
      user_id: r.user_id,
      name: profiles[r.user_id] || emails[r.user_id] || 'Unknown',
      email: emails[r.user_id] || '',
      role: r.custom_roles?.level || null,
      company_id: r.company_id,
      company_name: r.companies?.name || null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { roles, companies: companies || [], users };
}

module.exports = { announcementMatches, arrayTargetMatches, resolveTargetUserIds, getAudienceReference };

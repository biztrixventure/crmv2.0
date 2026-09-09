const { getConfig } = require('./businessConfig');

// ============================================================================
// Resell privacy resolver — returns true when the caller should NOT see
// is_resell=true sale rows. Looked up per request because the company config
// can flip on/off independently of the user's role/company.
//
// Lived inside routes/sales.js until the Reports leaderboards started counting
// sales server-side. Two definitions of "may this person see resells" is how
// one screen ends up reporting 638 sales and the screen beside it 611, with
// neither number wrong on its own terms. One definition, both callers.
// ============================================================================
async function shouldHideResellsForUser(userRole, companyId, companyType) {
  if (userRole === 'superadmin' || userRole === 'readonly_admin') return false;
  if (userRole === 'closer' || userRole === 'closer_manager') return false;
  if (userRole === 'compliance_manager') {
    return !!(await getConfig(companyId, 'resell.hide_from_compliance', false));
  }
  if (userRole === 'fronter_manager') {
    return !!(await getConfig(companyId, 'resell.hide_from_fronter_manager', true));
  }
  if (userRole === 'fronter' || companyType === 'fronter') {
    return !!(await getConfig(companyId, 'resell.hide_from_fronter', true));
  }
  return false;
}

module.exports = { shouldHideResellsForUser };

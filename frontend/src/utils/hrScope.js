// ============================================================================
// hrScope -- "is this person here to ADMINISTER, or to self-serve?"
//
// The distinction matters because the two audiences need opposite messages. An
// employee with no hr_employees record genuinely cannot request leave and needs
// telling. An HR manager with no record is entirely normal -- they administer
// other people's leave and may have no employee row at all, least of all in a
// company they were designated into rather than employed by. Telling THEM "you
// have no employee record, ask HR" is nonsense: they ARE HR.
//
// One derivation, imported by every surface that draws that banner, so the
// shell and the individual pages can never disagree about which audience is
// looking.
// ============================================================================
const ADMIN_KEYS = [
  'hr.employees.manage',
  'hr.attendance.manage', 'hr.attendance.view_team',
  'hr.leave.approve', 'hr.leave.manage', 'hr.leave.view_team',
  'hr.payroll.view', 'hr.payroll.manage',
  'hr.reviews.manage', 'hr.reviews.view_team',
];

/** True when any permission implies they act on OTHER people's records here. */
export const isHrAdmin = (permissions = {}) => ADMIN_KEYS.some(k => !!permissions[k]);

/**
 * True only when the "you have no employee record" notice is worth showing:
 * they self-serve, they have no record, so the tabs really are empty for them.
 */
export const needsOwnEmployeeRecord = (scope) =>
  !!scope && !scope.employee && !isHrAdmin(scope.permissions || {});

export default { isHrAdmin, needsOwnEmployeeRecord };

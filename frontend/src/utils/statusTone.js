// ============================================================================
// statusTone — badge vocabulary → kit accent tone.
//
// The status catalogs (transfer.status_catalog / compliance.status_catalog) name
// their colour with a `badge` value, and the kit names the same idea with a
// tone. The two vocabularies disagree on two words: the catalog says
// warning/error, the kit says warn/danger. So this map is load-bearing, not
// decoration — a missed key falls through to `muted` and the status silently
// loses its colour.
//
// One definition, because three surfaces read the same catalogs: the Overview's
// stat sections, the record tabs' clickable status strip, and the Top Agents
// table. A per-file copy is how "cancelled" ends up red in one strip and grey
// in the next.
// ============================================================================
export const TONE_BY_BADGE = {
  success:   'success',
  error:     'danger',
  warning:   'warn',
  info:      'info',
  secondary: 'muted',
  primary:   'primary',
};

/** @param badge catalog badge value @returns a kit accent() tone */
export const toneOfBadge = (badge) => TONE_BY_BADGE[badge] || 'muted';

export default toneOfBadge;

// ============================================================================
// utils/lookupHistory.js — how a saved Customer Lookup search reads on screen.
//
// Both history surfaces (an agent's own History tab and the superadmin
// Activity tab) list the same rows, so the wording lives here once rather than
// drifting between two tables. Pure functions only: a row in, a string out.
//
// The backend keeps a SMALL summary for the list (names + places, vehicle
// titles, VINs) and the whole payload separately. These read the summary — the
// payload is only fetched when somebody opens one row.
// ============================================================================

export const KIND_LABEL = {
  people: 'People',
  search: 'Name search',
  addresses: 'Addresses',
  vehicles: 'Vehicles',
  vin: 'VIN',
  enrich: 'People + vehicles',
};

// Which tab a saved search re-opens into.
export const KIND_TAB = {
  people: 'people', search: 'people', enrich: 'people',
  addresses: 'vehicles', vehicles: 'vehicles', vin: 'vin',
};

// Badge variants, as components/UI/Badge.jsx names them.
export const STATUS_TONE = {
  ok: 'success',
  empty: 'info',
  pending: 'warning',
  error: 'error',
};

export const STATUS_LABEL = {
  ok: 'Found',
  empty: 'Nothing',
  pending: 'Running',
  error: 'Failed',
};

// "4m ago" / "3h ago" / "2 Oct". Close times are relative because that is how
// someone looks for the search they ran a minute ago.
export function whenText(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const secs = Math.round((Date.now() - t) / 1000);
  if (secs < 45) return 'just now';
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  if (secs < 7 * 86400) return `${Math.round(secs / 86400)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export const exactText = (iso) => (iso ? new Date(iso).toLocaleString() : '');

// What came back, in one line. A failed search and an empty one are different
// facts and are never collapsed into each other.
export function summaryText(row) {
  if (!row) return '';
  if (row.status === 'pending') return 'Still running — it had not answered yet';
  if (row.status === 'error') return row.error || 'The search did not complete';

  const s = row.summary || {};
  const extra = (shown) => (row.result_count > shown ? ` +${row.result_count - shown} more` : '');

  if (Array.isArray(s.people) && s.people.length) {
    const names = s.people.map(p => p.name + (p.place ? ` · ${p.place}` : ''));
    return names.join('  |  ') + extra(s.people.length);
  }
  if (Array.isArray(s.vehicles) && s.vehicles.length) {
    return s.vehicles.join('  |  ') + extra(s.vehicles.length);
  }
  if (Array.isArray(s.vins) && s.vins.length) {
    return s.vins.join(', ') + extra(s.vins.length);
  }
  if (Array.isArray(s.addresses) && s.addresses.length) {
    return s.addresses.join('  |  ') + extra(s.addresses.length);
  }
  if (!row.result_count) return 'No results';
  return `${row.result_count} result${row.result_count === 1 ? '' : 's'}`;
}

// A result that is still on file can be re-opened for free. One that has aged
// past the 30-day payload retention cannot, and saying so beats a dead button.
const RESULT_DAYS = 30;

export function canReopen(row) {
  if (!row || row.status === 'pending' || row.status === 'error') return false;
  const t = new Date(row.created_at).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < RESULT_DAYS * 86400000;
}

export const msText = (ms) => (ms === null || ms === undefined ? '' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);

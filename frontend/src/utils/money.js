// ============================================================================
// Money + date formatting for the Accounting and HR modules.
//
// One place, because the alternative is four pages each rendering 1234.5 a
// slightly different way and a fifth showing NaN. Everything here is
// null-tolerant: a missing number renders as a dash, never as 0 -- "we do not
// have this" and "this is zero" are different facts and a finance surface must
// not confuse them.
// ============================================================================

// Currency, using the browser locale for grouping but an explicit currency code
// so a US-formatted number never silently claims to be dollars when it is not.
export const fmtMoney = (value, currency = 'USD') => {
  if (value === null || value === undefined || value === '') return '--';
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(n);
  } catch {
    // Unknown currency code -- still show the number rather than nothing.
    return n.toFixed(2) + ' ' + currency;
  }
};

// Compact form for KPI tiles, where the exact cents are noise: 1.2M, 84.3k.
export const fmtMoneyShort = (value, currency = 'USD') => {
  if (value === null || value === undefined || value === '') return '--';
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  const abs = Math.abs(n);
  if (abs < 10_000) return fmtMoney(n, currency);
  const sym = { USD: '$', EUR: '\u20AC', GBP: '\u00A3' }[currency] || '';
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return sign + sym + (abs / 1_000_000).toFixed(1) + 'M';
  return sign + sym + Math.round(abs / 1000) + 'k';
};

export const fmtNumber = (value, digits = 2) => {
  if (value === null || value === undefined || value === '') return '--';
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : '--';
};

// A bare YYYY-MM-DD is a CALENDAR date, not an instant. Parsing it with
// new Date() treats it as UTC midnight, which renders as the previous day for
// anyone west of Greenwich -- the same class of bug the callback timezone rule
// exists for. Split it instead.
export const fmtDate = (value) => {
  if (!value) return '--';
  const s = String(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

// Timestamps ARE instants -- render them in local time, as everywhere else.
export const fmtDateTime = (value) => {
  if (!value) return '--';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// Today, and the first of this month, as YYYY-MM-DD in LOCAL time.
export const todayISO = () => {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
};

export const monthStartISO = () => {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), '01'].join('-');
};

export const yearStartISO = () => new Date().getFullYear() + '-01-01';

// Status -> kit tone. Shared so an invoice, an expense, a leave request and a
// payroll run all mean the same thing by the same color.
export const STATUS_TONE = {
  draft: 'muted', sent: 'info', partial: 'warning', paid: 'success',
  overdue: 'error', void: 'muted',
  submitted: 'info', approved: 'success', rejected: 'error', reimbursed: 'success',
  pending: 'warning', cancelled: 'muted',
  posted: 'success', processing: 'info', finalized: 'success',
  pending_self: 'warning', pending_manager: 'info', pending_signoff: 'info', completed: 'success',
  active: 'success', on_leave: 'warning', terminated: 'muted', suspended: 'error',
  present: 'success', absent: 'error', late: 'warning', half_day: 'warning',
  remote: 'info', holiday: 'muted',
};

export const prettyStatus = (s) => String(s || '').replace(/_/g, ' ');

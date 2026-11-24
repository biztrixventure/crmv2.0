// Formatting shared by the support desk screens. Times are shown in US Eastern,
// the same day boundary every report in the CRM uses.

const ET = 'America/New_York';

export const money = (v) => {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : String(v);
};

// A DATE column ("2026-11-16") is a calendar day, not an instant -- print it as
// written, or a browser west of UTC shows the day before.
export const day = (v) => {
  if (!v) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  return m ? `${m[2]}/${m[3]}/${m[1]}` : String(v);
};

export const dateTime = (v) => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    timeZone: ET, month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
};

export const num = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('en-US'));

export const SALE_STATUS = {
  closed_won: { label: 'Active', tone: 'active' },
  cancelled: { label: 'Cancelled', tone: 'cancelled' },
  compliance_cancelled: { label: 'Cancelled (Compliance)', tone: 'cancelled' },
  pending_review: { label: 'Pending Review', tone: 'other' },
  needs_revision: { label: 'Needs Revision', tone: 'other' },
  open: { label: 'Open', tone: 'other' },
  chargeback: { label: 'Chargeback', tone: 'cancelled' },
  closed_lost: { label: 'Lost', tone: 'cancelled' },
};
export const saleStatus = (s) => SALE_STATUS[s] || { label: s ? String(s).replace(/_/g, ' ') : '', tone: 'other' };

// 'open' reads as "In Progress" everywhere a person sees it.
export const CASE_STATUS = {
  open: { label: 'In Progress', pill: 'amber' },
  saved: { label: 'Saved', pill: 'green' },
  lost: { label: 'Not Saved', pill: 'red' },
};
export const caseStatus = (s) => CASE_STATUS[s] || { label: s || '', pill: '' };

export const pretty = (s) => (s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '');

export const vehicle = (p) => [p?.car_year, p?.car_make, p?.car_model].filter(Boolean).join(' ').toUpperCase();

// <input type="datetime-local"> hands back a bare local wall clock. Convert to a
// real UTC instant before it leaves the browser (the callback_at rule).
export const localInputToIso = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

export const errText = (e, fallback) => e?.response?.data?.error || fallback;

// Row colour for a call outcome. The catalog (key, label, tone) comes from the
// server with /support/me, so a new outcome needs no change here.
export const outcomeOf = (outcomes, key) => (outcomes || []).find((o) => o.key === key) || null;
export const toneClass = (outcomes, key) => {
  const o = outcomeOf(outcomes, key);
  return o && o.tone && o.tone !== 'none' ? `sx-tone-${o.tone}` : '';
};

// Monthly payment date as stored on the sale form: an ISO day, or free text.
export const monthlyDate = (v) => (!v || v === '-' ? '' : day(v));

// ============================================================================
// utils/firstMonthly.js -- the support desk's "First Monthly call" list.
//
// A new policy's first monthly payment is the moment most customers fall off.
// Support calls each one three times before it -- 1 week, 3 days and 1 day
// ahead -- then records what happened to the payment (mig 359).
//
// Nothing about the policy is copied: the list IS the sales whose
// form_data->>'Monthly_Date' falls in the window, joined to the steps logged
// so far (first_monthly_steps, one row per sale + step).
//
// Everything that decides "what is due today" is in stepStates(), a pure
// function, because three callers must agree on it: the list the agent works
// from, the count in their daily reminder, and the report.
//
// Days are US Eastern calendar days, written 'YYYY-MM-DD', and are compared as
// strings. No Date arithmetic touches a time zone.
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const { excludePostDate } = require('./postDate');

// The three calls. `days` = how many days before the first monthly date.
const FOLLOW_UPS = [
  { step: 'fu1', label: 'Follow up 1', days: 7, when: '1 week before' },
  { step: 'fu2', label: 'Follow up 2', days: 3, when: '3 days before' },
  { step: 'fu3', label: 'Follow up 3', days: 1, when: '1 day before' },
];
const STEPS = [...FOLLOW_UPS.map(f => f.step), 'final'];

// How a follow-up call ended. 'agreed' is the one that matters to the rule:
// once the customer has agreed, the later calls are not needed (N/A).
const FU_RESULTS = [
  { key: 'agreed',       label: 'Agreed - will pay' },
  { key: 'no_answer',    label: 'No answer' },
  { key: 'voicemail',    label: 'Left voicemail' },
  { key: 'callback',     label: 'Asked to call back' },
  { key: 'card_issue',   label: 'Card / payment problem' },
  { key: 'wants_cancel', label: 'Wants to cancel' },
  { key: 'wrong_number', label: 'Wrong number' },
  { key: 'other',        label: 'Other' },
];
// What happened to the first monthly payment itself.
const FINAL_STATUSES = [
  { key: 'file_closed',  label: 'File closed' },
  { key: 'authorized',   label: 'Authorized / Paid' },
  { key: 'insufficient', label: 'Insufficient funds' },
  { key: 'declined',     label: 'Card declined' },
  { key: 'rescheduled',  label: 'Payment rescheduled' },
  { key: 'cancelled',    label: 'Customer cancelled' },
  { key: 'no_response',  label: 'No response' },
  { key: 'other',        label: 'Other' },
];
const labelOf = (step, key) =>
  ((step === 'final' ? FINAL_STATUSES : FU_RESULTS).find(r => r.key === key) || {}).label || key;
const validResult = (step, key) =>
  (step === 'final' ? FINAL_STATUSES : FU_RESULTS).some(r => r.key === key);

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const CANCELLED = ['cancelled', 'compliance_cancelled'];
// Policies that can still have a first monthly: sold and standing, or already
// cancelled (shown so the sheet's Status column is complete; nothing is due).
const LIST_STATUSES = ['closed_won', 'open', 'pending_review', ...CANCELLED];

// 'YYYY-MM-DD' +/- n days, as a string. UTC maths on a bare date is exact.
const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

// The state of every step of one policy on `today`.
//   done     -- logged
//   na       -- not needed: the customer already agreed, or the policy is cancelled
//   upcoming -- its day has not come
//   due      -- inside its window and not logged: call now
//   missed   -- its window passed without a call
// A follow-up's window runs from its own day up to the day before the next
// one's; the last one runs through the monthly date itself. The final status
// is due from the monthly date on, and never "missed" -- it is still owed.
function stepStates(monthlyDate, done, today, saleStatus) {
  const out = {};
  if (!ISO_DAY.test(String(monthlyDate || ''))) {
    STEPS.forEach(s => { out[s] = { state: done[s] ? 'done' : 'na', due: null }; });
    return out;
  }
  const cancelled = CANCELLED.includes(saleStatus);
  let agreed = false;
  FOLLOW_UPS.forEach((f, i) => {
    const due = addDays(monthlyDate, -f.days);
    const next = FOLLOW_UPS[i + 1];
    const windowEnd = next ? addDays(monthlyDate, -next.days - 1) : monthlyDate;
    let state;
    if (done[f.step]) state = 'done';
    else if (agreed || cancelled) state = 'na';
    else if (today < due) state = 'upcoming';
    else if (today <= windowEnd) state = 'due';
    else state = 'missed';
    out[f.step] = { state, due };
    if (done[f.step]?.result === 'agreed') agreed = true;
  });
  out.final = {
    due: monthlyDate,
    state: done.final ? 'done' : cancelled ? 'na' : today >= monthlyDate ? 'due' : 'upcoming',
  };
  return out;
}
const needsAction = (states) => STEPS.some(s => states[s].state === 'due');

const SALE_COLS = 'id, customer_name, customer_phone, client_name, status, sale_date, reference_no, policy_number, company_id, monthly_date:form_data->>Monthly_Date';

// Every policy whose first monthly date is in [from, to], with its steps.
// clients: null = every client; [] = nothing (never an unfiltered query).
async function listFirstMonthly({ clients = null, from, to, today, client = '', search = '' }) {
  if (Array.isArray(clients) && clients.length === 0) return [];
  const sales = [];
  for (let p = 0; p < 10; p++) {
    let q = excludePostDate(supabaseAdmin.from('sales').select(SALE_COLS))
      .in('status', LIST_STATUSES)
      .gte('form_data->>Monthly_Date', from).lte('form_data->>Monthly_Date', to);
    if (Array.isArray(clients)) q = q.in('client_name', clients);
    if (client) q = q.eq('client_name', client);
    if (search) {
      const digits = search.replace(/\D/g, '');
      const safe = search.replace(/[%,()"\\]/g, ' ').trim();
      if (digits.length >= 4 && digits.length === search.replace(/[\s()+.-]/g, '').length) q = q.ilike('customer_phone', `%${digits}%`);
      else if (safe) q = q.or(`customer_name.ilike.%${safe}%,reference_no.ilike.%${safe}%,policy_number.ilike.%${safe}%`);
    }
    const { data, error } = await q
      .order('form_data->>Monthly_Date', { ascending: true }).order('id', { ascending: true })
      .range(p * 1000, p * 1000 + 999);
    if (error) throw new Error(error.message);
    sales.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  // A free-text Monthly_Date ("15th") sorts inside an ISO range by accident.
  const rows = sales.filter(s => ISO_DAY.test(String(s.monthly_date || '')));

  const stepsBy = {};
  const ids = rows.map(r => r.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabaseAdmin.from('first_monthly_steps')
      .select('id, sale_id, step, result, note, agent_id, done_at').in('sale_id', ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
    (data || []).forEach(s => { (stepsBy[s.sale_id] = stepsBy[s.sale_id] || {})[s.step] = s; });
  }

  return rows.map(r => {
    const done = stepsBy[r.id] || {};
    const states = stepStates(r.monthly_date, done, today, r.status);
    const steps = {};
    STEPS.forEach(s => {
      const d = done[s];
      steps[s] = {
        ...states[s],
        result: d?.result || null,
        result_label: d ? labelOf(s, d.result) : null,
        note: d?.note || null,
        agent_id: d?.agent_id || null,
        done_at: d?.done_at || null,
      };
    });
    return { ...r, steps, needs_action: needsAction(states) };
  });
}

module.exports = {
  FOLLOW_UPS, STEPS, FU_RESULTS, FINAL_STATUSES, LIST_STATUSES,
  labelOf, validResult, addDays, stepStates, needsAction, listFirstMonthly,
};

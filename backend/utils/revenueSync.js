// ============================================================================
// utils/revenueSync.js -- CRM sales into the books (mig 317). DESIRED-STATE.
//
// For one company: work out what its books SHOULD hold for every sale since
// go-live, read what they DO hold, and fix only the difference:
//   should hold, doesn't         -> post
//   holds, shouldn't             -> reverse (with the reason in words)
//   holds a different amount     -> reverse + re-post (one transaction)
//   same                         -> leave alone
// Every entry is keyed (company, source_type, source_id, source_event) -- the
// mig 315 idempotency key -- so two runs can never double-book a sale.
//
// A sale the worker CANNOT price (no rate card line, no exchange rate, no
// account) is listed as a problem and its existing entries are left exactly as
// they are: a missing rate must never silently reverse revenue already booked.
// Switching a company OFF stops the worker; it does not undo anything.
//
// See mig 317 for which entries each book gets and when a sale counts.
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const logger = require('./logger');
const { runWithContext } = require('./requestContext');
const { isPostDateDispo } = require('./postDate');
const { cents, money, postingRules, createPostedEntry, reverseEntry, fxConverter } = require('./ledger');

const EVENTS = ['sale.earned', 'sale.collected', 'partner.cost', 'partner.paid', 'partner.income', 'partner.received'];
// source_type / source_event per posting event (the journal key).
const KEY = {
  'sale.earned':      ['sale', 'earned'],
  'sale.collected':   ['sale', 'collected'],
  'partner.cost':     ['partner_fee', 'cost'],
  'partner.paid':     ['partner_fee', 'paid'],
  'partner.income':   ['partner_fee', 'income'],
  'partner.received': ['partner_fee', 'received'],
};
const EVENT_OF = Object.fromEntries(Object.entries(KEY).map(([ev, [t, e]]) => [t + '|' + e, ev]));

const DEFAULTS = {
  closer_enabled: false, fronter_enabled: false, go_live: '2026-06-01',
  recognize_on: 'approved', rate_currency: 'USD',
};
const MAX_ACTIONS_PER_RUN = 3000;
const running = new Set();   // one run per company at a time, in this process

const lc = (s) => String(s || '').trim().toLowerCase();
const day = (ts) => (ts ? String(ts).slice(0, 10) : null);
const today = () => new Date().toISOString().slice(0, 10);

async function getSettings(companyId) {
  const { data } = await supabaseAdmin.from('revenue_settings').select('*').eq('company_id', companyId).maybeSingle();
  return { ...DEFAULTS, company_id: companyId, ...(data || {}), is_default: !data };
}

// Most specific, then most recent line that was in force on the day.
function pickRate(rates, kind, { client, plan, partner, onDay }) {
  const inForce = rates.filter(r => r.kind === kind && r.effective_from <= onDay);
  let cands;
  if (kind === 'client') {
    cands = inForce.filter(r => lc(r.client_name) === lc(client) && (!r.plan || lc(r.plan) === lc(plan)));
    cands.sort((a, b) => (b.plan ? 1 : 0) - (a.plan ? 1 : 0) || (b.effective_from > a.effective_from ? 1 : -1));
  } else if (kind === 'partner_cost') {
    cands = inForce.filter(r => r.partner_company_id === partner);
    cands.sort((a, b) => (b.effective_from > a.effective_from ? 1 : -1));
  } else {
    cands = inForce.filter(r => !r.partner_company_id || r.partner_company_id === partner);
    cands.sort((a, b) => (b.partner_company_id ? 1 : 0) - (a.partner_company_id ? 1 : 0) || (b.effective_from > a.effective_from ? 1 : -1));
  }
  return cands[0] || null;
}
const amountOf = (rate, dp) => (rate.basis === 'flat' ? cents(rate.value) : Math.round(cents(dp) * Number(rate.value) / 100));

async function pagedSales(build) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await build().range(offset, offset + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  return out;
}

const SALE_COLS = 'id, reference_no, company_id, closer_id, client_name, plan, down_payment, status, '
  + 'payout_status, payout_updated_at, paid_to_partner, sale_date, closer_disposition';

// Is the sale earned under this company's rule? (mig 317 header)
function earnedState(s, recognizeOn) {
  if (isPostDateDispo(s.closer_disposition) && s.status !== 'closed_won') return { earned: false, why: 'a post-date, not charged yet' };
  if (!(Number(s.down_payment) > 0)) return { earned: false, why: 'no down payment' };
  if (s.payout_status === 'reverted') return { earned: false, why: 'DP reverted' };
  if (recognizeOn === 'dp_paid') return s.payout_status === 'paid' ? { earned: true } : { earned: false, why: 'DP not paid yet' };
  if (s.status === 'closed_won' || s.payout_status === 'paid') return { earned: true };
  return { earned: false, why: s.status === 'cancelled' ? 'cancelled before the client paid' : 'not approved (' + s.status + ')' };
}

// Work out the plan. Never writes. Returns { desired, live, actions, summary }.
async function planCompany(companyId, { sides } = {}) {
  const settings = await getSettings(companyId);
  const want = sides || { closer: settings.closer_enabled, fronter: settings.fronter_enabled };
  const [{ data: rates }, rules, conv, { data: members }, { data: companies }] = await Promise.all([
    supabaseAdmin.from('revenue_rates').select('*').eq('company_id', companyId),
    postingRules(companyId, EVENTS),
    fxConverter(companyId, settings.rate_currency),
    supabaseAdmin.from('user_company_roles').select('user_id').eq('company_id', companyId),
    supabaseAdmin.from('companies').select('id, name'),
  ]);
  const memberIds = [...new Set((members || []).map(m => m.user_id))];
  const memberSet = new Set(memberIds);
  const coName = Object.fromEntries((companies || []).map(c => [c.id, c.name]));

  const desired = new Map();   // key -> { event, sale_id, amount (rate-currency cents), date, memo, lines }
  const unknown = new Set();   // keys we cannot price: never reversed
  const problems = { no_rate: {}, no_partner_rate: {}, no_fx: new Set(), no_account: new Set() };

  const keyOf = (event, s) => { const [t, e] = KEY[event]; return t + '|' + s.id + '|' + e; };
  const put = (event, s, amount, onDay, memo) => {
    const key = keyOf(event, s);
    const rule = rules[event];
    if (!rule?.debit || !rule?.credit) { problems.no_account.add(event); unknown.add(key); return; }
    const raw = [
      { account_id: rule.debit.id, debit: money(amount), credit: 0, description: memo },
      { account_id: rule.credit.id, debit: 0, credit: money(amount), description: memo },
    ];
    const c = conv.convert(raw, onDay);
    if (c.error) { problems.no_fx.add(c.missing_rate || onDay); unknown.add(key); return; }
    desired.set(key, { event, sale_id: s.id, amount, date: onDay, memo, lines: c.lines });
  };

  // -- Closer side: the client pays us; we owe the fronter company its cut.
  if (want.closer && memberIds.length) {
    const sales = [];
    for (let i = 0; i < memberIds.length; i += 150) {
      const chunk = memberIds.slice(i, i + 150);
      sales.push(...await pagedSales(() => supabaseAdmin.from('sales').select(SALE_COLS)
        .in('closer_id', chunk).gte('sale_date', settings.go_live).order('id')));
    }
    for (const s of sales) {
      const st = earnedState(s, settings.recognize_on);
      if (!st.earned) continue;
      const paidOn = day(s.payout_updated_at) || s.sale_date;
      const earnedOn = settings.recognize_on === 'dp_paid' ? paidOn : s.sale_date;
      const ref = s.reference_no || s.id.slice(0, 8);
      const rate = pickRate(rates || [], 'client', { client: s.client_name, plan: s.plan, onDay: earnedOn });
      if (!rate) {
        // Grouped the way rates match: "NASC-Essential Plan" and "Nasc-essential
        // Plan" are one line (the first spelling seen is shown).
        const g = lc(s.client_name) + '|' + lc(s.plan);
        const hit = (problems.no_rate[g] = problems.no_rate[g] || { what: (s.client_name || 'No client') + ' | ' + (s.plan || 'no plan'), sales: 0 });
        hit.sales += 1;
        unknown.add(keyOf('sale.earned', s)); unknown.add(keyOf('sale.collected', s));
      } else {
        const amt = amountOf(rate, s.down_payment);
        const what = 'Sale ' + ref + ' -- ' + (s.client_name || 'client') + (s.plan ? ' / ' + s.plan : '');
        if (amt > 0) {
          put('sale.earned', s, amt, earnedOn, what);
          if (s.payout_status === 'paid') put('sale.collected', s, amt, paidOn, 'Paid: ' + what);
        }
      }
      // The fronter company's cut -- only when another company found the customer.
      if (s.company_id && s.company_id !== companyId) {
        const prate = pickRate(rates || [], 'partner_cost', { partner: s.company_id, onDay: s.sale_date });
        if (!prate) {
          const k = coName[s.company_id] || s.company_id;
          problems.no_partner_rate[k] = (problems.no_partner_rate[k] || 0) + 1;
          unknown.add(keyOf('partner.cost', s)); unknown.add(keyOf('partner.paid', s));
        } else {
          const pamt = amountOf(prate, s.down_payment);
          const what = (coName[s.company_id] || 'Partner') + ' cut of sale ' + ref;
          if (pamt > 0) {
            put('partner.cost', s, pamt, s.sale_date, what);
            if (s.paid_to_partner === true) put('partner.paid', s, pamt, paidOn, 'Paid: ' + what);
          }
        }
      }
    }
  }

  // -- Fronter side: our own sales, closed by another company, earn us a fee.
  if (want.fronter) {
    const own = await pagedSales(() => supabaseAdmin.from('sales').select(SALE_COLS)
      .eq('company_id', companyId).gte('sale_date', settings.go_live).order('id'));
    for (const s of own) {
      if (!s.closer_id || memberSet.has(s.closer_id)) continue;   // closed in-house: no partner fee
      const st = earnedState(s, settings.recognize_on);
      if (!st.earned) continue;
      const ref = s.reference_no || s.id.slice(0, 8);
      const rate = pickRate(rates || [], 'partner_income', { onDay: s.sale_date });
      if (!rate) {
        problems.no_partner_rate['Our fee as a partner'] = (problems.no_partner_rate['Our fee as a partner'] || 0) + 1;
        unknown.add(keyOf('partner.income', s)); unknown.add(keyOf('partner.received', s));
        continue;
      }
      const amt = amountOf(rate, s.down_payment);
      if (amt <= 0) continue;
      const what = 'Partner fee on sale ' + ref;
      put('partner.income', s, amt, s.sale_date, what);
      if (s.paid_to_partner === true) put('partner.received', s, amt, day(s.payout_updated_at) || s.sale_date, 'Received: ' + what);
    }
  }

  // -- What the books hold now.
  const live = new Map();   // key -> { id, entry_no, amount (orig cents), date }
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabaseAdmin.from('journal_entries')
      .select('id, entry_no, entry_date, source_type, source_id, source_event, journal_entry_lines(debit, orig_amount, orig_currency)')
      .eq('company_id', companyId).in('source_type', ['sale', 'partner_fee']).eq('status', 'posted')
      .is('reversal_of', null).is('reversed_by', null).order('id').range(offset, offset + 999);
    if (error) throw new Error(error.message);
    for (const e of data || []) {
      if (!EVENT_OF[e.source_type + '|' + e.source_event]) continue;
      const amount = (e.journal_entry_lines || []).reduce((sum, l) =>
        sum + (Number(l.debit) > 0 ? cents(l.orig_currency ? l.orig_amount : l.debit) : 0), 0);
      live.set(e.source_type + '|' + e.source_id + '|' + e.source_event, { id: e.id, entry_no: e.entry_no, amount, date: e.entry_date });
    }
    if ((data || []).length < 1000) break;
  }
  const eventOfKey = (key) => { const [t, , e] = key.split('|'); return EVENT_OF[t + '|' + e]; };

  // -- The difference.
  const actions = [];
  for (const [key, d] of desired) {
    const l = live.get(key);
    if (!l) actions.push({ op: 'post', key, ...d });
    else if (l.amount !== d.amount) actions.push({ op: 'repost', key, entry_id: l.id, entry_no: l.entry_no, was: l.amount, ...d });
  }
  for (const [key, l] of live) {
    if (desired.has(key) || unknown.has(key)) continue;
    actions.push({ op: 'reverse', key, entry_id: l.id, entry_no: l.entry_no, amount: l.amount, event: eventOfKey(key), sale_id: key.split('|')[1] });
  }

  // -- Per month, per event: should be vs in the books (rate currency).
  const months = {};
  const bump = (m, ev, field, amt) => {
    const row = (months[m] = months[m] || {});
    const cell = (row[ev] = row[ev] || { should: 0, booked: 0 });
    cell[field] += amt;
  };
  for (const d of desired.values()) bump(d.date.slice(0, 7), d.event, 'should', d.amount);
  for (const [key, l] of live) bump(String(l.date).slice(0, 7), eventOfKey(key), 'booked', l.amount);

  const count = (op) => actions.filter(a => a.op === op).length;
  return {
    settings, sides: want, book_currency: conv.book, rate_currency: settings.rate_currency,
    desired, live, actions,
    summary: {
      should_hold: desired.size, holds: live.size,
      to_post: count('post'), to_repost: count('repost'), to_reverse: count('reverse'),
      problems: {
        no_rate: Object.values(problems.no_rate).sort((a, b) => b.sales - a.sales),
        no_partner_rate: Object.entries(problems.no_partner_rate).map(([k, n]) => ({ what: k, sales: n })).sort((a, b) => b.sales - a.sales),
        no_fx: [...problems.no_fx].sort().slice(0, 20),
        no_account: [...problems.no_account],
      },
      months: Object.entries(months).sort().map(([month, evs]) => ({
        month,
        events: Object.fromEntries(Object.entries(evs).map(([ev, v]) => [ev, { should: money(v.should), booked: money(v.booked) }])),
      })),
    },
  };
}

// The sale as it is now, for the reversal memo.
async function salesNow(saleIds) {
  const out = {};
  for (let i = 0; i < saleIds.length; i += 150) {
    const { data } = await supabaseAdmin.from('sales').select('id, status, payout_status, paid_to_partner, down_payment, sale_date, closer_disposition')
      .in('id', saleIds.slice(i, i + 150));
    for (const s of data || []) out[s.id] = s;
  }
  return out;
}

// Apply the plan. Returns the summary with what was done.
async function runCompany(companyId, { userId = null, force = false } = {}) {
  if (running.has(companyId)) return { error: 'A run for this company is already in progress' };
  running.add(companyId);
  try {
    return await runWithContext({ actorId: userId, source: 'revenue-sync' }, async () => {
      const plan = await planCompany(companyId);
      if (!force && !plan.settings.closer_enabled && !plan.settings.fronter_enabled) {
        return { skipped: 'Sales into the books is switched off for this company' };
      }
      const done = { posted: 0, reposted: 0, reversed: 0, failed: 0, errors: [] };
      const reverseIds = [...new Set(plan.actions.filter(a => a.op === 'reverse').map(a => a.sale_id))];
      const now = reverseIds.length ? await salesNow(reverseIds) : {};

      for (const a of plan.actions.slice(0, MAX_ACTIONS_PER_RUN)) {
        const [t, e] = KEY[a.event] || [];
        let r;
        if (a.op === 'post') {
          r = await createPostedEntry({ companyId, userId, entryDate: a.date, memo: a.memo, sourceType: t, sourceId: a.sale_id, sourceEvent: e, lines: a.lines });
          if (!r.error) done.posted += 1;
        } else if (a.op === 'repost') {
          r = await reverseEntry({
            entryId: a.entry_id, companyId, date: a.date,
            reason: 'Amount changed from ' + money(a.was) + ' to ' + money(a.amount) + ' ' + plan.rate_currency + ' (down payment or rate edited)',
            replacement: { entryDate: a.date, memo: a.memo, sourceType: t, sourceId: a.sale_id, sourceEvent: e, lines: a.lines },
          });
          if (!r.error) done.reposted += 1;
        } else {
          const s = now[a.sale_id];
          const why = !s ? 'the sale no longer exists'
            : (a.event === 'partner.paid' || a.event === 'partner.received') ? 'Paid to Partner was unticked'
            : a.event === 'sale.collected' ? 'DP Status is no longer paid (' + (s.payout_status || 'none') + ')'
            : earnedState(s, plan.settings.recognize_on).why || 'it no longer counts';
          r = await reverseEntry({ entryId: a.entry_id, companyId, reason: 'Sale ' + a.sale_id.slice(0, 8) + ': ' + why, date: today() });
          if (!r.error) done.reversed += 1;
        }
        if (r?.error) { done.failed += 1; if (done.errors.length < 10) done.errors.push(a.event + ' ' + a.sale_id.slice(0, 8) + ': ' + r.error); }
      }
      const summary = { ...plan.summary, done, left: Math.max(0, plan.actions.length - MAX_ACTIONS_PER_RUN), at: new Date().toISOString() };
      await supabaseAdmin.from('revenue_settings').upsert({
        company_id: companyId, last_run_at: summary.at, last_run_summary: summary,
      }, { onConflict: 'company_id' });
      if (done.posted || done.reposted || done.reversed || done.failed) {
        logger.info('ACCOUNTING', 'revenue sync ' + companyId + ': ' + JSON.stringify(done).slice(0, 300));
      }
      return summary;
    });
  } finally {
    running.delete(companyId);
  }
}

// The hourly job: only companies that switched it on.
async function runAllEnabled() {
  const { data, error } = await supabaseAdmin.from('revenue_settings').select('company_id')
    .or('closer_enabled.eq.true,fronter_enabled.eq.true');
  if (error) { logger.warn('JOBS', 'revenue sync: ' + error.message); return; }
  for (const { company_id } of data || []) {
    try { await runCompany(company_id); } catch (e) { logger.warn('JOBS', 'revenue sync ' + company_id + ': ' + e.message); }
  }
}

module.exports = { planCompany, runCompany, runAllEnabled, getSettings, earnedState, pickRate, amountOf, EVENTS, DEFAULTS };

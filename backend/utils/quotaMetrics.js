// ============================================================================
// quotaMetrics — the ONE counter behind every quota number, at all three tiers
// (member allocation, team quota, company roll-up). Given a set of quota rows
// it returns each one's live `actual` from the same query, so a member's card,
// their lead's allocation table and the admin's team report can never disagree.
//
// WHY A CATALOG, NOT A HARDCODED PAIR
// The measurement layer already disagreed with itself before this existed:
//
//   metric      teamMetrics.js        stats.js /agent-performance   spiffMetrics.js
//   transfers   !vicidial_pending     !vicidial_pending             status='completed'
//   sales       closed_won|sold ONLY  ALL statuses (won = approved) closed_won|sold
//
// Measured on one real team over 2026-07-01..29: transfers agreed exactly
// (857 = 857) but "sales" read 35 vs 38 for the same 13 people — a definition
// gap, not a scoping bug. A quota of "50 sales" was therefore ambiguous by ~8%.
// So the ambiguity is named instead of resolved by fiat: `sales_won` and
// `sales_submitted` are two catalog entries and the admin picks one.
//
// spiffMetrics is deliberately left alone. Its transfers rule (status =
// 'completed') is narrower than ours, but changing it would move the numbers
// under live SPIFF campaigns mid-flight. Quotas and SPIFFs are separate
// instruments; only quota numbers are defined here.
//
// SIDE AWARENESS
// A fronter company is judged on leads generated, a closer company on deals
// closed, so the attribution COLUMN depends on the company type — the same
// isCloserSideScope rule the rest of the shell uses. Never a role-name list.
//
// COUNTING
// Never `.select()` a row set and take `.length` — PostgREST silently caps at
// 1,000/page on this project, which has already produced one production
// undercount. Every read here pages with .range() until short, exactly like
// stats.js /agent-performance.
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const { etDateToUtcStart, etDateToUtcEnd } = require('./etUtils');
const logger = require('./logger');

// ── Catalog ─────────────────────────────────────────────────────────────────
// `source` picks the table; `fronterCol`/`closerCol` pick the attribution
// column for the company's side; `won` narrows to compliance-approved rows;
// `sumField` makes it a money metric instead of a row count.
const BUILT_IN = [
  {
    key: 'transfers', label: 'Transfers', unit: 'count',
    hint: 'Leads sent (fronter side) or leads received (closer side). Excludes VICIdial pending rows.',
    source: 'transfers', fronterCol: 'created_by', closerCol: 'assigned_closer_id',
  },
  {
    key: 'sales_won', label: 'Sales — approved', unit: 'count',
    hint: 'Sales that survived compliance (closed_won / sold). Matches the team report.',
    source: 'sales', fronterCol: 'fronter_id', closerCol: 'closer_id', won: true,
  },
  {
    key: 'sales_submitted', label: 'Sales — submitted', unit: 'count',
    hint: 'Every sale written in the window, any status — including pending review and cancelled.',
    source: 'sales', fronterCol: 'fronter_id', closerCol: 'closer_id',
  },
  {
    key: 'revenue', label: 'Revenue (MRR)', unit: 'money',
    hint: 'Sum of monthly payment on approved sales.',
    source: 'sales', fronterCol: 'fronter_id', closerCol: 'closer_id', won: true, sumField: 'monthly_payment',
  },
  {
    key: 'callbacks', label: 'Callbacks completed', unit: 'count',
    hint: 'Callbacks the member marked completed in the window.',
    source: 'callbacks', fronterCol: 'user_id', closerCol: 'user_id',
  },
];

const WON_STATUSES = ['closed_won', 'sold'];   // same set as teamMetrics.WON / spiffMetrics.CLOSED_LIKE

// Operator-defined metrics live in business_config so a new quota kind needs no
// migration. A custom entry may only REMAP an existing source — it can't invent
// a new table — so a typo can never produce a silently-zero quota.
async function getCatalog(companyId) {
  const custom = [];
  try {
    const { data } = await supabaseAdmin
      .from('business_config').select('value').eq('key', 'quota.metrics').maybeSingle();
    const rows = Array.isArray(data?.value) ? data.value : (data?.value?.metrics || []);
    for (const r of rows) {
      const base = BUILT_IN.find(b => b.key === r.base_key);
      if (!r?.key || !base) continue;                       // unknown base → ignore, never guess
      if (BUILT_IN.some(b => b.key === r.key)) continue;    // never shadow a built-in
      custom.push({ ...base, key: r.key, label: r.label || r.key, hint: r.hint || base.hint, custom: true });
    }
  } catch { /* config table unreachable → built-ins only */ }
  return [...BUILT_IN, ...custom];
}

async function resolveMetric(key, companyId) {
  return (await getCatalog(companyId)).find(m => m.key === key) || null;
}

// ── Paged read (PostgREST caps a page at 1000) ──────────────────────────────
const PAGE = 1000, MAX_PAGES = 40;
async function fetchAll(build) {
  const out = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const { data, error } = await build().range(p * PAGE, p * PAGE + PAGE - 1);
    if (error) { logger.warn('QUOTA_METRICS', error.message); break; }
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

// Count one (metric, window) for a set of member ids → { byUser, total }.
// `total` is the sum over the members in scope, which is what a TEAM quota is
// measured against — a team's number is its people's numbers, nothing else.
async function countWindow({ metric, userIds, companyId, closerSide, from, to }) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const byUser = {};
  ids.forEach(id => { byUser[id] = 0; });
  if (!ids.length || !metric) return { byUser, total: 0 };

  const col = closerSide ? metric.closerCol : metric.fronterCol;
  const add = (id, n) => { if (id && byUser[id] != null) byUser[id] += n; };

  try {
    if (metric.source === 'transfers') {
      // created_at is an instant, so the ET business day must be converted —
      // a naive YYYY-MM-DD compare pulls in a slice of the neighbouring day.
      const rows = await fetchAll(() => {
        let q = supabaseAdmin.from('transfers').select(col)
          .neq('vicidial_pending', true).in(col, ids);
        // Closer-side rows are scoped by assigned_closer_id across the company's
        // members, not by transfers.company_id — the same rule agent-performance
        // uses, because a closer works leads that belong to a fronter company.
        if (!closerSide && companyId) q = q.eq('company_id', companyId);
        if (from) q = q.gte('created_at', etDateToUtcStart(from));
        if (to)   q = q.lte('created_at', etDateToUtcEnd(to));
        return q;
      });
      rows.forEach(r => add(r[col], 1));
    } else if (metric.source === 'sales') {
      // sale_date is already the ET business day → compare as a plain date.
      const sel = metric.sumField ? `${col}, ${metric.sumField}` : col;
      const rows = await fetchAll(() => {
        let q = supabaseAdmin.from('sales').select(sel).in(col, ids);
        if (!closerSide && companyId) q = q.eq('company_id', companyId);
        if (metric.won) q = q.in('status', WON_STATUSES);
        if (from) q = q.gte('sale_date', from);
        if (to)   q = q.lte('sale_date', to);
        return q;
      });
      rows.forEach(r => add(r[col], metric.sumField ? (Number(r[metric.sumField]) || 0) : 1));
    } else if (metric.source === 'callbacks') {
      const rows = await fetchAll(() => {
        let q = supabaseAdmin.from('callbacks').select(col)
          .eq('status', 'completed').in(col, ids);
        if (companyId) q = q.eq('company_id', companyId);
        if (from) q = q.gte('callback_at', etDateToUtcStart(from));
        if (to)   q = q.lte('callback_at', etDateToUtcEnd(to));
        return q;
      });
      rows.forEach(r => add(r[col], 1));
    }
  } catch (e) {
    logger.warn('QUOTA_METRICS', `countWindow ${metric.key} failed: ${e.message}`);
    return { byUser, total: 0 };   // a broken counter must not 500 a report page
  }

  const total = Object.values(byUser).reduce((a, b) => a + b, 0);
  return { byUser, total: metric.sumField ? Math.round(total * 100) / 100 : total };
}

// ── Public: attach live attainment to a list of quota rows ──────────────────
// Quotas sharing a (metric, window, team) are counted in ONE query — a lead who
// gave eight people the same weekly transfer target costs one read, not eight.
//
// TEAM-tier rows (user_id NULL) measure the whole member set; MEMBER-tier rows
// measure that one person out of the same result, so a team's actual is always
// exactly the sum of its members' actuals — the two can't drift apart.
async function attachAttainment(quotas, { companyId, closerSide, memberIdsByTeam }) {
  const rows = quotas || [];
  if (!rows.length) return [];

  const groups = new Map();   // `${metric}|${from}|${to}|${team}` → quota rows
  for (const q of rows) {
    const k = `${q.metric}|${q.starts_at}|${q.ends_at}|${q.team_id}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(q);
  }

  const catalog = await getCatalog(companyId);
  const out = [];
  for (const [, group] of groups) {
    const q0 = group[0];
    const metric = catalog.find(m => m.key === q0.metric);
    const ids = memberIdsByTeam?.[q0.team_id] || [];
    const { byUser, total } = metric
      ? await countWindow({ metric, userIds: ids, companyId, closerSide, from: q0.starts_at, to: q0.ends_at })
      : { byUser: {}, total: 0 };

    for (const q of group) {
      const actual = q.user_id ? (byUser[q.user_id] || 0) : total;
      const target = Number(q.target_value) || 0;
      out.push({
        ...q,
        metric_label: metric?.label || q.metric,
        metric_unit:  metric?.unit || 'count',
        metric_known: !!metric,          // false → the catalog entry was removed; UI says so rather than showing 0
        actual,
        // A zero target can't produce a percentage; the UI renders "—" for null
        // rather than 0%, which would read as total failure.
        pct: target > 0 ? Math.round((actual / target) * 1000) / 10 : null,
        remaining: Math.max(0, target - actual),
      });
    }
  }
  // Preserve the caller's ordering (grouping shuffled it).
  const byId = Object.fromEntries(out.map(r => [r.id, r]));
  return rows.map(r => byId[r.id]).filter(Boolean);
}

// ── Milestone ladder (mig 218) ──────────────────────────────────────────────
// Attach each quota's reward ladder, resolved against its LIVE actual. One
// query for every quota in the batch — a company report with 40 quotas costs
// one read, not 40.
//
// Earned is deliberately live (`actual >= threshold`), not a stored award: the
// operator chose that. It means a cancelled sale can drop someone back below a
// line they had crossed, which is why the notifier keys on a permanent dedup
// key — the prize can un-earn on screen, but nobody is congratulated twice.
//
// `next_milestone` is the ladder's real job: not "you are at 61%" but "40 more
// and you hit the $100". That is the number that changes what someone does today.
async function attachMilestones(quotas) {
  const rows = quotas || [];
  if (!rows.length) return rows;
  const ids = [...new Set(rows.map(q => q.id).filter(Boolean))];
  if (!ids.length) return rows;

  let all = [];
  try {
    const { data, error } = await supabaseAdmin.from('quota_milestones')
      .select('*').in('quota_id', ids).eq('is_active', true)
      .order('threshold', { ascending: true });
    if (error) throw new Error(error.message);
    all = data || [];
  } catch (e) {
    // A missing table (migration not yet applied) or a failed read must never
    // take the quota report down with it — the ladder is an enhancement.
    logger.warn('QUOTA_METRICS', `milestones unavailable: ${e.message}`);
    return rows.map(q => ({ ...q, milestones: [], milestones_earned: 0, next_milestone: null }));
  }

  const byQuota = {};
  all.forEach(m => { (byQuota[m.quota_id] = byQuota[m.quota_id] || []).push(m); });

  return rows.map(q => {
    const target = Number(q.target_value) || 0;
    const actual = Number(q.actual) || 0;
    const list = (byQuota[q.id] || []).map(m => {
      // Percent resolves against THIS quota's target, so one "50%" milestone
      // means the right number on every member allocation it is copied to.
      const at = m.threshold_kind === 'percent'
        ? (target * Number(m.threshold)) / 100
        : Number(m.threshold);
      const resolved = Math.round(at * 100) / 100;
      return {
        id: m.id,
        threshold_kind: m.threshold_kind,
        threshold: Number(m.threshold),
        at: resolved,                                  // absolute, whatever the kind
        label: m.label || null,
        reward_amount: m.reward_amount == null ? null : Number(m.reward_amount),
        reward_description: m.reward_description || null,
        notify_earner: m.notify_earner, notify_lead: m.notify_lead, notify_managers: m.notify_managers,
        earned: resolved > 0 && actual >= resolved,
        remaining: Math.max(0, Math.round((resolved - actual) * 100) / 100),
        pct: resolved > 0 ? Math.round((actual / resolved) * 1000) / 10 : null,
      };
    }).sort((a, b) => a.at - b.at);

    const next = list.find(m => !m.earned) || null;
    return {
      ...q,
      milestones: list,
      milestones_earned: list.filter(m => m.earned).length,
      next_milestone: next,
    };
  });
}

// Period helpers — 'day' | 'week' | 'month' collapse to explicit date bounds so
// the stored row is always an unambiguous window and nothing re-derives "this
// month" at read time (which would silently move an old quota's goalposts).
function periodBounds(kind, anchorIso) {
  const anchor = anchorIso ? new Date(`${anchorIso}T12:00:00Z`) : new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  if (kind === 'day') return { starts_at: iso(anchor), ends_at: iso(anchor) };
  if (kind === 'week') {
    const dow = (anchor.getUTCDay() + 6) % 7;                     // Monday = 0
    const s = new Date(anchor); s.setUTCDate(s.getUTCDate() - dow);
    const e = new Date(s);      e.setUTCDate(e.getUTCDate() + 6);
    return { starts_at: iso(s), ends_at: iso(e) };
  }
  const s = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const e = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
  return { starts_at: iso(s), ends_at: iso(e) };
}

// ── Daily activity series + per-member roll-up ──────────────────────────────
// One pass per source table for the WHOLE member set, bucketed by day AND by
// member. Feeds every chart from the same rows the quota counter uses, so a
// bar and the number above it can never disagree.
//
// Side-aware for the same reason attainment is: on a fronter company a person's
// sale credit is fronter_id (the lead they sent that closed), on a closer
// company it is closer_id (the deal they closed). Measured on production, all
// four existing teams are fronter teams, and reading sales through closer_id
// made every one of them report 0 sales / $0 gross while they had in fact
// produced 73 approved deals — which is exactly why half the charts were blank.
//
// `sales_submitted` is every sale written in the window; `sales_won` is the
// compliance-approved subset. Both are returned so a chart can show the
// approval funnel rather than implying one number is "the" sales figure.
async function activitySeries({ userIds, companyId, closerSide, from, to }) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const blankDay = (date) => ({ date, transfers: 0, sales_submitted: 0, sales_won: 0, sales_cancelled: 0, revenue: 0, gross: 0, callbacks: 0 });
  const blankMember = (id) => ({ user_id: id, transfers: 0, sales_submitted: 0, sales_won: 0, sales_cancelled: 0, revenue: 0, gross: 0, callbacks: 0 });

  // Buckets span the REQUESTED range, not whatever the data covers, so a quiet
  // day is a visible gap instead of vanishing and making the line look smooth.
  const days = new Map();
  if (from && to) {
    let cur = Date.parse(`${from}T00:00:00Z`);
    const end = Date.parse(`${to}T00:00:00Z`);
    let guard = 0;
    while (cur <= end && guard++ < 400) {
      const k = new Date(cur).toISOString().slice(0, 10);
      days.set(k, blankDay(k));
      cur += 86400000;
    }
  }
  const byMember = {};
  ids.forEach(id => { byMember[id] = blankMember(id); });
  if (!ids.length) return { days: [...days.values()], members: [], totals: blankMember(null) };

  const tCol = closerSide ? 'assigned_closer_id' : 'created_by';
  const sCol = closerSide ? 'closer_id' : 'fronter_id';
  const hit = (dayKey, member, field, amount = 1) => {
    const d = days.get(dayKey); if (d) d[field] += amount;
    const m = byMember[member]; if (m) m[field] += amount;
  };

  try {
    const transfers = await fetchAll(() => {
      let q = supabaseAdmin.from('transfers').select(`${tCol}, created_at`)
        .neq('vicidial_pending', true).in(tCol, ids);
      if (!closerSide && companyId) q = q.eq('company_id', companyId);
      if (from) q = q.gte('created_at', etDateToUtcStart(from));
      if (to)   q = q.lte('created_at', etDateToUtcEnd(to));
      return q;
    });
    transfers.forEach(r => hit(String(r.created_at || '').slice(0, 10), r[tCol], 'transfers'));

    const sales = await fetchAll(() => {
      let q = supabaseAdmin.from('sales')
        .select(`${sCol}, status, sale_date, monthly_payment, down_payment`).in(sCol, ids);
      if (!closerSide && companyId) q = q.eq('company_id', companyId);
      if (from) q = q.gte('sale_date', from);
      if (to)   q = q.lte('sale_date', to);
      return q;
    });
    sales.forEach(r => {
      const day = String(r.sale_date || '').slice(0, 10);
      hit(day, r[sCol], 'sales_submitted');
      if (WON_STATUSES.includes(r.status)) {
        hit(day, r[sCol], 'sales_won');
        hit(day, r[sCol], 'revenue', Number(r.monthly_payment) || 0);
        hit(day, r[sCol], 'gross',   Number(r.down_payment)    || 0);
      } else if (r.status === 'cancelled') {
        hit(day, r[sCol], 'sales_cancelled');
      }
    });

    const callbacks = await fetchAll(() => {
      let q = supabaseAdmin.from('callbacks').select('user_id, callback_at')
        .eq('status', 'completed').in('user_id', ids);
      if (companyId) q = q.eq('company_id', companyId);
      if (from) q = q.gte('callback_at', etDateToUtcStart(from));
      if (to)   q = q.lte('callback_at', etDateToUtcEnd(to));
      return q;
    });
    callbacks.forEach(r => hit(String(r.callback_at || '').slice(0, 10), r.user_id, 'callbacks'));
  } catch (e) {
    logger.warn('QUOTA_METRICS', `activitySeries failed: ${e.message}`);
  }

  const members = Object.values(byMember);
  const totals = members.reduce((t, m) => {
    for (const k of ['transfers', 'sales_submitted', 'sales_won', 'sales_cancelled', 'revenue', 'gross', 'callbacks']) t[k] += m[k];
    return t;
  }, blankMember(null));
  const round = (o) => { o.revenue = Math.round(o.revenue * 100) / 100; o.gross = Math.round(o.gross * 100) / 100; return o; };
  members.forEach(round); round(totals);
  [...days.values()].forEach(round);

  // A rate with a zero denominator is undefined, not 0 — "0% approval" for
  // someone with no sales yet reads as failure rather than "nothing to judge".
  const rate = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
  totals.conversion = rate(totals.sales_won, totals.transfers);
  totals.approval   = rate(totals.sales_won, totals.sales_submitted);
  members.forEach(m => {
    m.conversion = rate(m.sales_won, m.transfers);
    m.approval   = rate(m.sales_won, m.sales_submitted);
  });

  return { days: [...days.values()], members, totals };
}

module.exports = { BUILT_IN, WON_STATUSES, getCatalog, resolveMetric, countWindow, attachAttainment, attachMilestones, periodBounds, activitySeries };

// ============================================================================
// utils/companyReport.js -- the arithmetic behind Company Reports (mig 332).
//
// Pure: no database, no request. app_company_agent_report() does the counting
// in SQL; this turns its raw counters into what the screen shows -- rates,
// ranks, best partner, top earner -- and applies the per-viewer rules (money,
// QA visibility, placeholder accounts). Kept pure so every rule here is tested
// without a database (companyReport.test.js).
//
// RULES THAT LIVE HERE AND NOWHERE ELSE
// - A rate with a zero denominator is null ("--"), never 0: a fronter who sent
//   no leads has not converted 0% of them.
// - PLACEHOLDER accounts (business_config reports.company.placeholder_users,
//   e.g. the Onyx login sales were punched to before agents had logins) stay in
//   every total and on the table, labelled, and are NEVER ranked, never "top
//   earner", never anyone's "best partner".
// - A sale with no fronter is UNATTRIBUTED (user_id null) -- one labelled row,
//   never zero sales for a real person, never ranked.
// - Post-dates are already out of sold/money in SQL; `post_dates` is shown on
//   its own and never added back into anything here.
// ============================================================================

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 400;

// The metrics the "top earner" may be ranked by. Money-only on purpose: the
// question it answers is "who makes the company the most money".
const EARNER_METRICS = ['dp_sold', 'dp_active', 'est_collected', 'monthly_active'];

// Every money field on an agent row / totals / pair. Stripped for viewers
// without view_financial_data.
const MONEY_FIELDS = ['dp_sold', 'dp_active', 'monthly_active', 'est_collected', 'avg_deal', 'dp', 'earner_value'];
const QA_FIELDS = ['qa_n', 'qa_avg', 'qa_pass', 'qa_pass_rate'];

const DEFAULT_CONFIG = Object.freeze({
  placeholder_users: [],
  earner_metric: 'dp_sold',
  best_partner_min: 5,
  hidden_metrics: [],
  show_inactive: false,
});

const rate = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const num = (v) => (v == null ? 0 : Number(v) || 0);

// ── dates ───────────────────────────────────────────────────────────────────
function isoDay(d) { return d.toISOString().slice(0, 10); }
function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDay(d);
}

// Inclusive US-Eastern dates. Default: the last 30 days ending today (ET).
function parseRange(from, to, todayEt) {
  const today = todayEt || isoDay(new Date());
  const t = DAY_RE.test(String(to || '')) ? String(to) : today;
  const f = DAY_RE.test(String(from || '')) ? String(from) : addDays(t, -29);
  if (Number.isNaN(Date.parse(`${f}T00:00:00Z`)) || Number.isNaN(Date.parse(`${t}T00:00:00Z`))) {
    return { error: 'Dates must be YYYY-MM-DD.' };
  }
  if (f > t) return { error: 'The start date is after the end date.' };
  const days = Math.round((Date.parse(`${t}T00:00:00Z`) - Date.parse(`${f}T00:00:00Z`)) / 86400000) + 1;
  if (days > MAX_DAYS + 1) return { error: `A report covers at most ${MAX_DAYS} days.` };
  return { from: f, to: t, days };
}

// ── settings ────────────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sanitizeConfig(input) {
  const c = input && typeof input === 'object' ? input : {};
  const ids = Array.isArray(c.placeholder_users) ? c.placeholder_users : [];
  const hidden = Array.isArray(c.hidden_metrics) ? c.hidden_metrics : [];
  const min = Number.parseInt(c.best_partner_min, 10);
  return {
    placeholder_users: [...new Set(ids.map(String).filter(id => UUID_RE.test(id)))].slice(0, 200),
    earner_metric: EARNER_METRICS.includes(c.earner_metric) ? c.earner_metric : DEFAULT_CONFIG.earner_metric,
    best_partner_min: Number.isFinite(min) ? Math.min(Math.max(min, 1), 500) : DEFAULT_CONFIG.best_partner_min,
    hidden_metrics: [...new Set(hidden.map(String).filter(k => /^[a-z0-9_]{1,40}$/.test(k)))].slice(0, 100),
    show_inactive: c.show_inactive === true,
  };
}

// ── derived per-agent fields ───────────────────────────────────────────────
function derive(a, days) {
  return {
    ...a,
    conversion:     rate(num(a.xfer_sold), num(a.transfers)),
    stick_rate:     rate(num(a.active), num(a.sold)),
    cancel_rate:    rate(num(a.cancelled), num(a.sold)),
    daily_avg:      days > 0 ? Math.round((num(a.transfers) / days) * 10) / 10 : null,
    per_active_day: num(a.days_active) > 0 ? Math.round((num(a.transfers) / num(a.days_active)) * 10) / 10 : null,
    avg_deal:       num(a.sold) > 0 ? round2(num(a.dp_sold) / num(a.sold)) : null,
    cb_completion:  rate(num(a.cb_completed), num(a.cb_total)),
    qa_pass_rate:   rate(num(a.qa_pass), num(a.qa_n)),
    sales_per_day:  days > 0 ? Math.round((num(a.sold) / days) * 100) / 100 : null,
  };
}

// Best partner of one agent, three ways. A pair below `min` transfers is too
// small to call anyone's best RATE -- one lucky sale is not a pattern -- but for
// "most sales" / "most money" the count IS the evidence.
function bestPartners(pairs, min, excluded) {
  const ok = pairs.filter(p => !excluded.has(p.partner));
  if (!ok.length) return null;
  const pick = (list, key) => list.slice().sort((x, y) => (y[key] - x[key]) || (y.dp - x.dp) || (y.transfers - x.transfers))[0] || null;
  const bySold = pick(ok.filter(p => p.sold > 0), 'sold');
  const byMoney = pick(ok.filter(p => p.dp > 0), 'dp');
  const sampled = ok.filter(p => p.transfers >= min).map(p => ({ ...p, rate: rate(p.sold, p.transfers) }));
  const byRate = sampled.filter(p => p.sold > 0).sort((x, y) => (y.rate - x.rate) || (y.sold - x.sold))[0] || null;
  return { by_sold: bySold, by_money: byMoney, by_rate: byRate };
}

// ── the whole report ────────────────────────────────────────────────────────
/**
 * @param raw  app_company_agent_report() result
 * @param cfg  reports.company settings (sanitized here)
 * @param opts { canFin, showQa, companyNames: {id: name} }
 */
function buildReport(raw, cfg, opts = {}) {
  const config = sanitizeConfig(cfg);
  const canFin = !!opts.canFin;
  const showQa = opts.showQa !== false;
  const companyNames = opts.companyNames || {};
  const days = num(raw?.range?.days) || 1;
  const placeholders = new Set(config.placeholder_users);
  const people = raw?.people || {};

  // decode the positional arrays (column order: see mig 332)
  const pairsByAgent = new Map();
  for (const [agent, partner, partnerCo, transfers, sold, dp] of raw?.pairs || []) {
    const p = {
      partner, name: people[partner] || 'Unknown', partner_company_id: partnerCo || null,
      partner_company: partnerCo ? (companyNames[partnerCo] || null) : null,
      transfers: num(transfers), sold: num(sold), dp: round2(dp),
      placeholder: placeholders.has(partner),
    };
    const k = agent || '';
    if (!pairsByAgent.has(k)) pairsByAgent.set(k, []);
    pairsByAgent.get(k).push(p);
  }
  const dispoByAgent = new Map();
  const dispoTotals = new Map();
  for (const [agent, label, n] of raw?.dispositions || []) {
    const k = agent || '';
    if (!dispoByAgent.has(k)) dispoByAgent.set(k, []);
    dispoByAgent.get(k).push({ label, n: num(n) });
    dispoTotals.set(label, (dispoTotals.get(label) || 0) + num(n));
  }
  const boxByAgent = new Map();
  const boxTotals = new Map();
  for (const [agent, provider, box, n] of raw?.boxes || []) {
    const k = agent || '';
    const entry = { dialer_provider: provider || null, dialer_box: box || null };
    if (!boxByAgent.has(k)) boxByAgent.set(k, []);
    boxByAgent.get(k).push({ ...entry, n: num(n) });
    const bk = `${entry.dialer_provider}|${entry.dialer_box}`;
    const b = boxTotals.get(bk) || { ...entry, n: 0 };
    b.n += num(n);
    boxTotals.set(bk, b);
  }
  const seriesByAgent = new Map();
  const companySeries = new Map();
  for (const [agent, d, x, s, dp] of raw?.daily || []) {
    const k = agent || '';
    if (!seriesByAgent.has(k)) seriesByAgent.set(k, []);
    seriesByAgent.get(k).push({ d, x: num(x), s: num(s), dp: round2(dp) });
    const c = companySeries.get(d) || { d, x: 0, s: 0, dp: 0 };
    c.x += num(x); c.s += num(s); c.dp = round2(c.dp + num(dp));
    companySeries.set(d, c);
  }

  // Without money the ORDER must not be a money order either: rank by sales.
  const earnerKey = canFin ? config.earner_metric : 'sold';

  let agents = (raw?.agents || []).map((a) => {
    const k = a.user_id || '';
    const dispo = (dispoByAgent.get(k) || []).sort((x, y) => y.n - x.n);
    const total = dispo.reduce((t, d) => t + d.n, 0);
    const row = derive(a, days);
    return {
      ...row,
      name: a.user_id ? (a.name || 'Unknown') : 'Unattributed',
      unattributed: !a.user_id,
      placeholder: !!(a.user_id && placeholders.has(a.user_id)),
      earner_value: num(a[earnerKey]),
      dispositions: dispo.map(d => ({ ...d, pct: rate(d.n, total) })),
      top_disposition: dispo[0] ? { ...dispo[0], pct: rate(dispo[0].n, total) } : null,
      boxes: (boxByAgent.get(k) || []).sort((x, y) => y.n - x.n),
      partners: (pairsByAgent.get(k) || []).sort((x, y) => (y.sold - x.sold) || (y.transfers - x.transfers)),
      best: bestPartners(pairsByAgent.get(k) || [], config.best_partner_min, placeholders),
      series: (seriesByAgent.get(k) || []).sort((x, y) => (x.d < y.d ? -1 : 1)),
    };
  });

  // Inactive members with nothing in the window are noise unless asked for;
  // anyone with activity always shows (history belongs to whoever did it).
  const hasActivity = (a) => a.transfers || a.sold || a.post_dates || a.cb_total || a.qa_n;
  if (!config.show_inactive) agents = agents.filter(a => hasActivity(a) || a.is_member_active);

  // Rank: real, attributed people only.
  const rankable = (a) => !a.placeholder && !a.unattributed;
  const ranked = agents.filter(rankable).sort((x, y) =>
    (y.earner_value - x.earner_value) || (y.sold - x.sold) || (y.transfers - x.transfers));
  ranked.forEach((a, i) => { a.rank = i + 1; });
  const labelled = agents.filter(a => !rankable(a));
  labelled.forEach((a) => { a.rank = null; });
  // table order: ranked people first, then the labelled rows at the bottom
  agents = [...ranked, ...labelled];

  const top = ranked.find(a => a.earner_value > 0) || null;
  const leaders = {
    earner: top ? { user_id: top.user_id, name: top.name, value: top.earner_value, metric: earnerKey } : null,
    most_sold: pickLeader(ranked, 'sold'),
    most_transfers: pickLeader(ranked, 'transfers'),
    best_conversion: pickLeader(ranked.filter(a => a.transfers >= config.best_partner_min), 'conversion'),
    best_stick: pickLeader(ranked.filter(a => a.sold >= config.best_partner_min), 'stick_rate'),
  };

  // Company-level partner board: every partner summed over all agents.
  const partnerBoard = new Map();
  for (const list of pairsByAgent.values()) {
    for (const p of list) {
      const b = partnerBoard.get(p.partner) || { partner: p.partner, name: p.name, partner_company: p.partner_company, placeholder: p.placeholder, transfers: 0, sold: 0, dp: 0 };
      b.transfers += p.transfers; b.sold += p.sold; b.dp = round2(b.dp + p.dp);
      partnerBoard.set(p.partner, b);
    }
  }
  const partners = [...partnerBoard.values()]
    .map(p => ({ ...p, rate: rate(p.sold, p.transfers) }))
    .sort((x, y) => (y.sold - x.sold) || (y.transfers - x.transfers));

  const t = raw?.totals || {};
  const totals = {
    ...t,
    conversion:    rate(num(t.xfer_sold), num(t.transfers)),
    stick_rate:    rate(num(t.active), num(t.sold)),
    cancel_rate:   rate(num(t.cancelled), num(t.sold)),
    avg_deal:      num(t.sold) > 0 ? round2(num(t.dp_sold) / num(t.sold)) : null,
    daily_avg:     Math.round((num(t.transfers) / days) * 10) / 10,
    cb_completion: rate(num(t.cb_completed), num(t.cb_total)),
    qa_pass_rate:  rate(num(t.qa_pass), num(t.qa_n)),
    agents_active: agents.filter(a => !a.unattributed && (a.transfers || a.sold)).length,
  };

  const dispositions = [...dispoTotals.entries()]
    .map(([label, n]) => ({ label, n, pct: rate(n, num(t.transfers)) }))
    .sort((x, y) => y.n - x.n);
  const boxes = [...boxTotals.values()].sort((x, y) => y.n - x.n);
  const series = fillDays(raw?.range?.from, raw?.range?.to, companySeries);

  let out = {
    side: raw?.side || null,
    company: raw?.company || null,
    range: raw?.range || null,
    config: { earner_metric: earnerKey, best_partner_min: config.best_partner_min, hidden_metrics: config.hidden_metrics, show_inactive: config.show_inactive },
    totals, leaders, agents, partners, dispositions, boxes, series,
    can_see_money: canFin, can_see_qa: showQa,
  };
  if (!canFin) {
    // "top earner" is a money ranking; without money it names the most sales
    out.leaders.earner = out.leaders.most_sold ? { ...out.leaders.most_sold } : null;
    // A money RANKING leaks money even with the amounts stripped.
    out.agents.forEach((a) => { if (a.best) a.best.by_money = null; });
    out = stripFields(out, MONEY_FIELDS);
  }
  if (!showQa) out = stripFields(out, QA_FIELDS);
  return out;
}

function pickLeader(list, key) {
  const best = list.filter(a => a[key] != null && a[key] > 0)
    .sort((x, y) => (y[key] - x[key]) || (y.sold - x.sold))[0];
  return best ? { user_id: best.user_id, name: best.name, value: best[key], metric: key } : null;
}

// Every day in the range, zeros included, so a chart never skips a quiet day.
function fillDays(from, to, map) {
  if (!from || !to) return [...map.values()];
  const out = [];
  for (let d = from, guard = 0; d <= to && guard < MAX_DAYS + 2; d = addDays(d, 1), guard++) {
    out.push(map.get(d) || { d, x: 0, s: 0, dp: 0 });
  }
  return out;
}

// Deep delete of the named keys (agent rows, nested partners, totals, series).
function stripFields(value, keys) {
  if (Array.isArray(value)) return value.map(v => stripFields(v, keys));
  if (value && typeof value === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(value)) {
      if (keys.includes(k)) continue;
      o[k] = stripFields(v, keys);
    }
    return o;
  }
  return value;
}

// ── "All companies" ─────────────────────────────────────────────────────────
function buildOverview(rows, cfg, opts = {}) {
  const config = sanitizeConfig(cfg);
  const placeholders = new Set(config.placeholder_users);
  const key = config.earner_metric;
  const canFin = !!opts.canFin;
  const list = (rows || []).map((r) => {
    const t = r.totals || {};
    const agents = (r.agents || []).filter(a => a.user_id && !placeholders.has(a.user_id));
    const sortKey = canFin ? key : 'sold';
    const top = agents.slice().sort((x, y) => (num(y[sortKey]) - num(x[sortKey])) || (num(y.sold) - num(x.sold)))[0];
    const row = {
      company: r.company, side: r.side,
      agents_active: num(r.agents_active),
      transfers: num(t.transfers), xfer_sold: num(t.xfer_sold), sold: num(t.sold), active: num(t.active),
      cancelled: num(t.cancelled), post_dates: num(t.post_dates), unattributed: num(t.unattributed),
      dp_sold: num(t.dp_sold), dp_active: num(t.dp_active), est_collected: num(t.est_collected), monthly_active: num(t.monthly_active),
      conversion: rate(num(t.xfer_sold), num(t.transfers)),
      stick_rate: rate(num(t.active), num(t.sold)),
      cb_completion: rate(num(t.cb_completed), num(t.cb_total)),
      qa_avg: t.qa_avg ?? null, qa_n: num(t.qa_n),
      top_agent: top && num(top[sortKey]) > 0
        ? { user_id: top.user_id, name: top.name || 'Unknown', value: num(top[sortKey]), metric: sortKey }
        : null,
    };
    return canFin ? row : stripFields(row, MONEY_FIELDS);
  });

  // Every agent of every company in one list -- "whose agent is on top".
  // Ranked WITHIN a side: a fronter's sale and a closer's sale are the same
  // sale seen from two ends, so one ladder mixing both would count it twice.
  const rankKey = canFin ? key : 'sold';
  let agents = [];
  for (const r of rows || []) {
    for (const a of r.agents || []) {
      agents.push({
        ...a,
        company_id: r.company?.id || null, company: r.company?.name || null, side: r.side,
        name: a.user_id ? (a.name || 'Unknown') : 'Unattributed',
        placeholder: !!(a.user_id && placeholders.has(a.user_id)),
        unattributed: !a.user_id,
        conversion: rate(num(a.xfer_sold), num(a.transfers)),
        stick_rate: rate(num(a.active), num(a.sold)),
      });
    }
  }
  for (const side of ['fronter', 'closer']) {
    agents.filter(a => a.side === side && !a.placeholder && !a.unattributed)
      .sort((x, y) => (num(y[rankKey]) - num(x[rankKey])) || (num(y.sold) - num(x.sold)) || (num(y.transfers) - num(x.transfers)))
      .forEach((a, i) => { a.rank = i + 1; });
  }
  agents.forEach((a) => { if (a.rank === undefined) a.rank = null; });
  agents.sort((x, y) => (x.rank == null) - (y.rank == null) || (x.rank || 0) - (y.rank || 0));
  if (!canFin) agents = stripFields(agents, MONEY_FIELDS);

  return { companies: list, agents, earner_metric: rankKey, can_see_money: canFin };
}

// ── who can see the reports, and why (User Control Center + Access list) ────
const REPORT_PERMS = ['view_company_reports', 'view_fronter_stats', 'view_closer_stats', 'view_reports'];
const ESTATE_LEVELS = new Set(['compliance_manager']);

/**
 * Describe one person's Company Reports access from plain data. Mirrors
 * resolveScope()/canSeeMoney() in routes/companyReports.js -- change one,
 * change both (companyReport.test.js pins the cases).
 *
 * @param memberships [{ company_id, company, level, perms: string[] }]  active
 *        memberships, perms already = role grants + user grants - revokes
 * @param override    user_report_access row or null
 * @param companies   [{ id, name }] every active company (for "all" + names)
 */
function effectiveAccess({ memberships = [], override = null, companies = [] }) {
  const o = override || {};
  const name = Object.fromEntries(companies.map(c => [c.id, c.name]));
  const picked = Array.isArray(o.company_ids) && o.company_ids.length ? o.company_ids : null;
  const estate = memberships.some(m => ESTATE_LEVELS.has(m.level));
  const has = (m, p) => (m.perms || []).includes(p);
  const list = (ids) => ids.map(id => ({ id, name: name[id] || 'Unknown company' }));

  let canView; let viewSource; let visible;   // visible: null = every company
  if (o.can_view === false) { canView = false; viewSource = 'person'; visible = []; }
  else if (o.can_view === true) { canView = true; viewSource = 'person'; visible = picked || memberships.map(m => m.company_id); }
  else if (estate) { canView = true; viewSource = 'estate'; visible = picked; }
  else {
    visible = memberships.filter(m => REPORT_PERMS.some(p => has(m, p))).map(m => m.company_id);
    canView = visible.length > 0; viewSource = canView ? 'role' : 'none';
  }

  let amounts; let amountsSource = 'role';
  if (!canView) { amounts = false; }
  else if (typeof o.show_amounts === 'boolean') { amounts = o.show_amounts; amountsSource = 'person'; }
  else if (estate) { amounts = memberships.some(m => ESTATE_LEVELS.has(m.level) && has(m, 'view_financial_data')); }
  else {
    const byCo = new Map(memberships.map(m => [m.company_id, has(m, 'view_financial_data')]));
    const flags = (visible || []).map(id => byCo.get(id) === true);
    amounts = flags.length && flags.every(Boolean) ? true : flags.some(Boolean) ? 'some' : false;
  }

  return {
    can_view: canView,
    view_source: viewSource,
    companies: visible === null ? 'all' : list([...new Set(visible)]),
    amounts,
    amounts_source: amountsSource,
    estate,
  };
}

module.exports = {
  effectiveAccess, REPORT_PERMS,
  parseRange, sanitizeConfig, buildReport, buildOverview, stripFields, rate,
  EARNER_METRICS, MONEY_FIELDS, QA_FIELDS, DEFAULT_CONFIG, MAX_DAYS,
};

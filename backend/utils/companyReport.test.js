// ============================================================================
// companyReport.test.js -- the arithmetic and per-viewer rules of Company
// Reports (utils/companyReport.js). The counting itself is SQL (mig 332) and
// was reconciled against independent queries when it shipped; these pin what
// the JS layer does with the counters.
// ============================================================================
const {
  parseRange, sanitizeConfig, buildReport, buildOverview,
} = require('./companyReport');

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';   // real fronter
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';   // real fronter
const P = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';   // placeholder ("Onyx")
const C1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';  // closer
const C2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';  // closer

const agent = (over) => ({
  user_id: null, name: null, is_member_active: true, transfers: 0, xfer_sold: 0, sold: 0, active: 0,
  cancelled: 0, in_review: 0, post_dates: 0, dp_sold: 0, dp_active: 0, monthly_active: 0, est_collected: 0,
  cb_total: 0, cb_completed: 0, qa_n: 0, qa_avg: null, qa_pass: 0, days_active: 0, ...over,
});

function raw(over = {}) {
  return {
    side: 'fronter',
    company: { id: 'co', name: 'Onyx', type: 'fronter' },
    range: { from: '2026-09-01', to: '2026-09-10', days: 10 },
    totals: { transfers: 40, xfer_sold: 6, sold: 9, active: 6, cancelled: 3, post_dates: 4,
              dp_sold: 900, dp_active: 600, cb_total: 10, cb_completed: 5, qa_n: 0 },
    agents: [
      agent({ user_id: A, name: 'Ann', transfers: 20, xfer_sold: 4, sold: 3, active: 3, dp_sold: 300, dp_active: 300, days_active: 5, cb_total: 4, cb_completed: 1, post_dates: 2 }),
      agent({ user_id: B, name: 'Bob', transfers: 10, xfer_sold: 2, sold: 2, active: 1, cancelled: 1, dp_sold: 200, dp_active: 100 }),
      // the placeholder carries the MOST money -- and must still never rank
      agent({ user_id: P, name: 'Onyx', transfers: 10, sold: 3, active: 1, cancelled: 2, dp_sold: 350, dp_active: 100 }),
      agent({ user_id: null, sold: 1, active: 1, dp_sold: 50, dp_active: 50 }),
      agent({ user_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', name: 'Silent', transfers: 0 }),
    ],
    pairs: [
      [A, C1, null, 12, 3, 300], [A, C2, null, 6, 1, 90], [A, P, null, 2, 2, 999],
      [B, C1, null, 4, 2, 200],
    ],
    people: { [C1]: 'Cara', [C2]: 'Carl', [P]: 'Onyx' },
    dispositions: [[A, 'Not Interested', 12], [A, 'Sale', 4], [A, 'No outcome yet', 4], [B, 'Sale', 2]],
    boxes: [[A, 'vicidial', 'WTI', 20]],
    daily: [[A, '2026-09-02', 5, 1, 100], [B, '2026-09-02', 2, 1, 100]],
    ...over,
  };
}

const cfg = { placeholder_users: [P], earner_metric: 'dp_sold', best_partner_min: 5 };

describe('parseRange', () => {
  test('defaults to the 30 days ending today', () => {
    expect(parseRange(undefined, undefined, '2026-09-29')).toEqual({ from: '2026-08-31', to: '2026-09-29', days: 30 });
  });
  test('rejects a backwards range and anything over 400 days', () => {
    expect(parseRange('2026-09-10', '2026-09-01').error).toBeTruthy();
    expect(parseRange('2024-01-01', '2026-09-01').error).toBeTruthy();
  });
  test('garbage dates fall back rather than reaching SQL', () => {
    expect(parseRange("2026-09-01'; drop", '2026-09-10', '2026-09-29').from).toBe('2026-08-12');
  });
});

describe('sanitizeConfig', () => {
  test('drops non-uuid placeholders, unknown earner metrics and silly sample sizes', () => {
    const c = sanitizeConfig({ placeholder_users: ['x', P, P], earner_metric: 'transfers', best_partner_min: 99999 });
    expect(c.placeholder_users).toEqual([P]);
    expect(c.earner_metric).toBe('dp_sold');
    expect(c.best_partner_min).toBe(500);
  });
});

describe('buildReport', () => {
  const r = buildReport(raw(), cfg, { canFin: true, showQa: true });
  const byId = Object.fromEntries(r.agents.map(a => [a.user_id || 'null', a]));

  test('placeholder and unattributed rows are listed, labelled, and never ranked', () => {
    expect(byId[P].placeholder).toBe(true);
    expect(byId[P].rank).toBeNull();
    expect(byId.null.unattributed).toBe(true);
    expect(byId.null.name).toBe('Unattributed');
    expect(byId.null.rank).toBeNull();
    // ranked people first, labelled rows last
    expect(r.agents.slice(-2).every(a => a.rank === null)).toBe(true);
  });

  test('top earner is the best REAL agent even when the placeholder earned more', () => {
    expect(r.leaders.earner).toMatchObject({ user_id: A, value: 300, metric: 'dp_sold' });
    expect(byId[A].rank).toBe(1);
    expect(byId[B].rank).toBe(2);
  });

  test('totals are the SQL totals, not a re-sum of ranked agents (placeholder money stays in)', () => {
    expect(r.totals.dp_sold).toBe(900);
    expect(r.totals.sold).toBe(9);
  });

  test('post-dates are reported on their own and never added to sold', () => {
    expect(byId[A].post_dates).toBe(2);
    expect(byId[A].sold).toBe(3);
    expect(r.totals.post_dates).toBe(4);
    expect(r.totals.sold).toBe(9);
  });

  test('rates: transfer-cohort conversion, stick rate, null on a zero denominator', () => {
    expect(byId[A].conversion).toBe(20);        // 4 / 20
    expect(byId[B].stick_rate).toBe(50);        // 1 active / 2 sold
    expect(byId[A].cb_completion).toBe(25);
    expect(byId[A].daily_avg).toBe(2);          // 20 transfers / 10 days
    expect(byId[A].per_active_day).toBe(4);     // 20 / 5 active days
    const silent = r.agents.find(a => a.name === 'Silent');
    expect(silent.conversion).toBeNull();
    expect(silent.stick_rate).toBeNull();
    expect(r.totals.conversion).toBe(15);       // 6 / 40
  });

  test('best partner: never the placeholder; rate needs the minimum sample', () => {
    const best = byId[A].best;
    expect(best.by_sold.partner).toBe(C1);      // P had 2 sales + $999 but is excluded
    expect(best.by_money.partner).toBe(C1);
    expect(best.by_rate.partner).toBe(C1);      // C2 has 6 >= 5 transfers but 16.7% < 25%
    // B's only partner has 4 transfers (< 5): no best RATE, but still most sales
    expect(byId[B].best.by_rate).toBeNull();
    expect(byId[B].best.by_sold.partner).toBe(C1);
  });

  test('dispositions ranked with shares; company daily series has every day', () => {
    expect(byId[A].top_disposition).toMatchObject({ label: 'Not Interested', n: 12, pct: 60 });
    expect(r.series).toHaveLength(10);
    expect(r.series.find(d => d.d === '2026-09-02')).toMatchObject({ x: 7, s: 2, dp: 200 });
    expect(r.series.find(d => d.d === '2026-09-03')).toMatchObject({ x: 0, s: 0 });
  });

  test('inactive silent members are hidden unless show_inactive', () => {
    const withInactive = raw();
    withInactive.agents.push(agent({ user_id: '99999999-9999-4999-8999-999999999999', name: 'Gone', is_member_active: false }));
    expect(buildReport(withInactive, cfg, { canFin: true }).agents.some(a => a.name === 'Gone')).toBe(false);
    expect(buildReport(withInactive, { ...cfg, show_inactive: true }, { canFin: true }).agents.some(a => a.name === 'Gone')).toBe(true);
  });
});

describe('viewer without view_financial_data', () => {
  const r = buildReport(raw(), cfg, { canFin: false, showQa: true });
  const json = JSON.stringify(r);

  test('no money field survives anywhere', () => {
    for (const k of ['dp_sold', 'dp_active', 'est_collected', 'monthly_active', 'avg_deal', 'dp', 'earner_value']) {
      expect(json).not.toContain(`"${k}"`);
    }
  });

  test('ranking and top earner fall back to sales, and the money ranking is gone', () => {
    expect(r.leaders.earner.metric).toBe('sold');
    expect(r.agents[0].user_id).toBe(A);    // 3 sold, ahead of B's 2
    expect(r.agents.every(a => !a.best || a.best.by_money === null)).toBe(true);
  });
});

describe('agent-level viewer with qa.agent_scores off', () => {
  test('no QA field survives', () => {
    const withQa = raw();
    withQa.agents[0].qa_n = 3; withQa.agents[0].qa_avg = 71; withQa.agents[0].qa_pass = 2;
    const json = JSON.stringify(buildReport(withQa, cfg, { canFin: true, showQa: false }));
    for (const k of ['qa_n', 'qa_avg', 'qa_pass', 'qa_pass_rate']) expect(json).not.toContain(`"${k}"`);
  });
});

describe('buildOverview', () => {
  const rows = [{
    company: { id: 'co', name: 'Onyx' }, side: 'fronter', agents_active: 2,
    totals: { transfers: 40, xfer_sold: 6, sold: 9, active: 6, dp_sold: 900 },
    agents: [{ user_id: P, name: 'Onyx', sold: 3, dp_sold: 350 }, { user_id: A, name: 'Ann', sold: 3, dp_sold: 300 }],
  }];
  test('top agent skips the placeholder', () => {
    expect(buildOverview(rows, cfg, { canFin: true }).companies[0].top_agent).toMatchObject({ user_id: A, value: 300 });
  });
  test('without money: no amounts, top agent by sales', () => {
    const o = buildOverview(rows, cfg, { canFin: false });
    expect(o.companies[0].dp_sold).toBeUndefined();
    expect(o.companies[0].top_agent.metric).toBe('sold');
  });
});

describe('buildOverview: agents across companies', () => {
  const rows = [
    { company: { id: 'c1', name: 'Wave' }, side: 'fronter', totals: {},
      agents: [{ user_id: A, name: 'Ann', sold: 5, dp_sold: 500, transfers: 50, xfer_sold: 5, active: 4 },
               { user_id: P, name: 'Onyx', sold: 9, dp_sold: 900, transfers: 9 }] },
    { company: { id: 'c2', name: 'Mejor' }, side: 'fronter', totals: {},
      agents: [{ user_id: B, name: 'Bob', sold: 7, dp_sold: 700, transfers: 40, xfer_sold: 7, active: 7 }] },
    { company: { id: 'c3', name: 'Vertex' }, side: 'closer', totals: {},
      agents: [{ user_id: C1, name: 'Cara', sold: 12, dp_sold: 1200, transfers: 60, xfer_sold: 12, active: 10 }] },
  ];
  const o = buildOverview(rows, cfg, { canFin: true });
  const byId = Object.fromEntries(o.agents.map(a => [a.user_id, a]));

  test('ranks fronters across companies, each tagged with their company; closers on their own ladder', () => {
    expect(byId[B]).toMatchObject({ rank: 1, company: 'Mejor', side: 'fronter' });
    expect(byId[A]).toMatchObject({ rank: 2, company: 'Wave' });
    expect(byId[C1]).toMatchObject({ rank: 1, side: 'closer' });
    expect(byId[A].conversion).toBe(10);
  });
  test('the placeholder is listed but never ranked, even with the most money', () => {
    expect(byId[P].placeholder).toBe(true);
    expect(byId[P].rank).toBeNull();
  });
  test('without money: ranked by sales, no amounts', () => {
    const n = buildOverview(rows, cfg, { canFin: false });
    expect(JSON.stringify(n.agents)).not.toContain('"dp_sold"');
    expect(n.earner_metric).toBe('sold');
  });
});

describe('effectiveAccess', () => {
  const { effectiveAccess } = require('./companyReport');
  const companies = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const fm = { company_id: 'a', level: 'fronter_manager', perms: ['view_fronter_stats'] };
  const admin = { company_id: 'a', level: 'company_admin', perms: ['view_company_reports', 'view_financial_data'] };
  const comp = { company_id: 'a', level: 'compliance_manager', perms: ['view_financial_data'] };
  const fronter = { company_id: 'a', level: 'fronter', perms: [] };

  test('role decides when nothing is set for the person', () => {
    expect(effectiveAccess({ memberships: [fm], companies })).toMatchObject({ can_view: true, view_source: 'role', amounts: false });
    expect(effectiveAccess({ memberships: [admin], companies })).toMatchObject({ can_view: true, amounts: true });
    expect(effectiveAccess({ memberships: [fronter], companies })).toMatchObject({ can_view: false, view_source: 'none' });
  });
  test('compliance sees every company', () => {
    expect(effectiveAccess({ memberships: [comp], companies })).toMatchObject({ can_view: true, companies: 'all', amounts: true, view_source: 'estate' });
  });
  test('the person\'s switches beat the role both ways', () => {
    expect(effectiveAccess({ memberships: [admin], override: { can_view: false }, companies }).can_view).toBe(false);
    expect(effectiveAccess({ memberships: [admin], override: { show_amounts: false }, companies })).toMatchObject({ amounts: false, amounts_source: 'person' });
    expect(effectiveAccess({ memberships: [fronter], override: { can_view: true, show_amounts: true }, companies })).toMatchObject({ can_view: true, amounts: true });
    expect(effectiveAccess({ memberships: [fronter], override: { can_view: true, company_ids: ['b'] }, companies }).companies).toEqual([{ id: 'b', name: 'B' }]);
  });
});

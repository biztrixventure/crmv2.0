// ============================================================================
// utils/payrollSuggestions.js -- what each person on a payroll run has earned
// from commission plans and SPIFF prizes in the run's pay period (mig 318).
//
// SUGGESTIONS, never payments: the run screen shows these next to what the run
// holds and HR applies them (routes/hr/payroll.js /apply-suggestions). Always
// recomputed here from the CRM -- an amount sent by a browser is never trusted.
//
//   Commission  per active plan: the person's counting sales in the period
//               (closed by them, or passed on by them), below `min_sales` =
//               nothing, per sale or a percent of the down payment (converted
//               with the exchange rate at the period end -- never guessed).
//               A sale counts under the same rule the books use
//               (revenueSync.earnedState): approved or DP-paid, not reverted,
//               never an un-charged post-date.
//   SPIFF       campaigns that END inside the period and target this company:
//               anyone at or over the target wins the prize (auto campaigns
//               read the same numbers as the leaderboard, manual ones read the
//               entered scores).
//
// Applying keeps what HR typed by hand: the new commission is
//   current - previously applied from plans + suggested
// (and the same for SPIFF in the bonus), so applying twice changes nothing
// and a manual adjustment survives a re-apply.
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const { cents, money, fxConverter } = require('./ledger');
const { earnedState } = require('./revenueSync');
const { getProgress } = require('./spiffMetrics');

async function allSalesFor(column, userIds, from, to) {
  const out = [];
  for (let i = 0; i < userIds.length; i += 150) {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabaseAdmin.from('sales')
        .select('id, closer_id, fronter_id, sale_date, down_payment, status, payout_status, closer_disposition')
        .in(column, userIds.slice(i, i + 150)).gte('sale_date', from).lte('sale_date', to)
        .order('id').range(offset, offset + 999);
      if (error) throw new Error(error.message);
      out.push(...(data || []));
      if ((data || []).length < 1000) break;
    }
  }
  return out;
}

async function suggestForRun(runId, companyId) {
  const { data: run } = await supabaseAdmin.from('hr_payroll_runs')
    .select('id, company_id, name, status, currency, hr_pay_periods(start_date, end_date)')
    .eq('id', runId).eq('company_id', companyId).maybeSingle();
  if (!run) return { error: 'Payroll run not found', status: 404 };
  const from = run.hr_pay_periods?.start_date;
  const to = run.hr_pay_periods?.end_date;
  if (!from || !to) return { error: 'This run has no pay period dates', status: 422 };

  const { data: entries } = await supabaseAdmin.from('hr_payroll_entries')
    .select('id, employee_id, commission_amount, bonus_amount, earnings_detail, hr_employees(id, user_id, first_name, last_name)')
    .eq('run_id', run.id);
  const people = (entries || []).filter(e => e.hr_employees?.user_id);
  const userIds = [...new Set(people.map(e => e.hr_employees.user_id))];

  const [{ data: plans }, { data: roles }, { data: campaigns }] = await Promise.all([
    supabaseAdmin.from('hr_commission_plans').select('*').eq('company_id', companyId).eq('is_active', true)
      .lte('effective_from', to),
    userIds.length
      ? supabaseAdmin.from('user_company_roles').select('user_id, custom_roles(level)').eq('company_id', companyId).in('user_id', userIds)
      : { data: [] },
    supabaseAdmin.from('spiff_campaigns').select('*').neq('status', 'draft')
      .gte('ends_at', from + 'T00:00:00Z').lte('ends_at', to + 'T23:59:59Z'),
  ]);
  const livePlans = (plans || []).filter(p => !p.effective_to || p.effective_to >= from);
  const levelsOf = {};
  for (const r of roles || []) {
    const lvl = r.custom_roles?.level ? String(r.custom_roles.level) : null;
    if (lvl) (levelsOf[r.user_id] = levelsOf[r.user_id] || new Set()).add(lvl);
  }

  const needCloser = livePlans.some(p => p.applies_to === 'closer');
  const needFronter = livePlans.some(p => p.applies_to === 'fronter');
  const [closed, fronted] = await Promise.all([
    needCloser && userIds.length ? allSalesFor('closer_id', userIds, from, to) : [],
    needFronter && userIds.length ? allSalesFor('fronter_id', userIds, from, to) : [],
  ]);

  // Converters for dp_percent plans, one per currency, rate at the period end.
  const converters = {};
  for (const cur of [...new Set(livePlans.filter(p => p.basis === 'dp_percent').map(p => p.dp_currency))]) {
    converters[cur] = await fxConverter(companyId, cur);
  }

  // SPIFF winners per campaign that targets this company.
  const spiffWins = {};   // user_id -> [{ campaign, value, target, reward }]
  for (const c of campaigns || []) {
    const cos = c.target_company_ids || [];
    if (cos.length && !cos.includes(companyId)) continue;
    let valueByUser = {};
    if (c.metric_source && c.metric_source !== 'manual') {
      valueByUser = (await getProgress(c))?.valueByUser || {};
    } else {
      const { data: rows } = await supabaseAdmin.from('spiff_entries').select('user_id, value').eq('campaign_id', c.id);
      for (const r of rows || []) valueByUser[r.user_id] = Number(r.value || 0);
    }
    for (const uid of userIds) {
      const v = Number(valueByUser[uid] || 0);
      if (Number(c.target_value) > 0 && v >= Number(c.target_value)) {
        (spiffWins[uid] = spiffWins[uid] || []).push({
          campaign_id: c.id, campaign: c.title, value: v, target: Number(c.target_value), reward: Number(c.reward_amount || 0),
        });
      }
    }
  }

  const rows = [];
  for (const e of people) {
    const uid = e.hr_employees.user_id;
    const problems = [];
    const lines = [];
    let commissionC = 0;
    for (const p of livePlans) {
      if ((p.role_levels || []).length && !(p.role_levels.some(l => levelsOf[uid]?.has(l)))) continue;
      const pool = p.applies_to === 'closer' ? closed.filter(s => s.closer_id === uid) : fronted.filter(s => s.fronter_id === uid);
      const counting = pool.filter(s => s.sale_date >= p.effective_from && (!p.effective_to || s.sale_date <= p.effective_to)
        && earnedState(s, p.counts_on).earned);
      if (!counting.length) continue;
      if (counting.length < p.min_sales) {
        lines.push({ plan_id: p.id, plan: p.name, sales: counting.length, amount: 0, note: `below the minimum of ${p.min_sales}` });
        continue;
      }
      let amountC;
      let note;
      if (p.basis === 'per_sale') {
        amountC = counting.length * cents(p.amount);
        note = `${counting.length} x ${money(cents(p.amount))} ${run.currency}`;
      } else {
        const dpC = counting.reduce((t, s) => t + cents(s.down_payment), 0);
        const inDp = Math.round(dpC * Number(p.amount) / 100);
        const conv = converters[p.dp_currency].convert([{ debit: money(inDp), credit: 0 }], to);
        if (conv.error) { problems.push(conv.error); continue; }
        amountC = cents(conv.lines[0].debit);
        note = `${Number(p.amount)}% of ${money(dpC)} ${p.dp_currency} down payments`;
      }
      commissionC += amountC;
      lines.push({ plan_id: p.id, plan: p.name, sales: counting.length, amount: money(amountC), note });
    }
    const wins = spiffWins[uid] || [];
    const spiffC = wins.reduce((t, w) => t + cents(w.reward), 0);
    const prev = e.earnings_detail || {};
    rows.push({
      entry_id: e.id,
      employee_id: e.employee_id,
      name: [e.hr_employees.first_name, e.hr_employees.last_name].filter(Boolean).join(' ') || 'Unnamed',
      current: { commission: Number(e.commission_amount || 0), bonus: Number(e.bonus_amount || 0) },
      applied_before: { commission: Number(prev.commission?.amount || 0), spiff: Number(prev.spiff?.amount || 0) },
      commission: { amount: money(commissionC), lines },
      spiff: { amount: money(spiffC), lines: wins },
      problems,
    });
  }
  return {
    run: { id: run.id, name: run.name, status: run.status, currency: run.currency },
    period: { start_date: from, end_date: to },
    plans: livePlans.length,
    rows,
    totals: {
      commission: money(rows.reduce((t, r) => t + cents(r.commission.amount), 0)),
      spiff: money(rows.reduce((t, r) => t + cents(r.spiff.amount), 0)),
    },
  };
}

// New values for one entry: keep whatever HR typed on top of the last applied
// suggestion (see header). Never below zero.
function appliedValues(row, { commission = true, spiff = true } = {}) {
  const out = {};
  if (commission) {
    out.commission_amount = money(Math.max(0, cents(row.current.commission) - cents(row.applied_before.commission) + cents(row.commission.amount)));
  }
  if (spiff) {
    out.bonus_amount = money(Math.max(0, cents(row.current.bonus) - cents(row.applied_before.spiff) + cents(row.spiff.amount)));
  }
  return out;
}

module.exports = { suggestForRun, appliedValues };

// ============================================================================
// dailyPerformance — ONE definition of "how did this day go".
//
// Used for the calendar's day panel, for the snapshot a lock freezes, and for
// the per-team breakdown inside a project lock. One function for all three on
// purpose: a project row and its team rows have to be computed the same way,
// or a manager signs off a company total that does not match the teams under
// it and neither number gets believed again.
//
// `memberIds === null` means the WHOLE COMPANY (every team plus anyone on no
// team). An array scopes to those people — that is the team case, resolved by
// teamMetrics.resolveTeamMemberIds so nested teams roll up.
//
// DATE ANCHORS, deliberately different per entity and the same as everywhere
// else in the app:
//   transfers → created_at, an ET business day converted to UTC bounds
//   sales     → sale_date, a bare DATE, the business day the deal happened
// Anchoring sales on created_at instead would put a bulk upload of an old
// workbook entirely on the day it was uploaded.
//
// Post-dates are excluded from every sale counter (excludePostDate): an
// un-charged post-date is a reminder, not a sale, and must not sit inside a
// figure someone is about to finalise.
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const { etDateToUtcStart, etDateToUtcEnd } = require('./etUtils');
const { excludePostDate } = require('./postDate');
const { isCloserSideScope } = require('../models/helpers');
const logger = require('./logger');

// PostgREST silently returns an EMPTY result once an .in() carries more than
// ~100-150 uuids, so a big roster has to be chunked. Same reason and same size
// as utils/teamMetrics.
const ID_CHUNK = 100;
const chunk = (arr) => {
  const out = [];
  for (let i = 0; i < arr.length; i += ID_CHUNK) out.push(arr.slice(i, i + ID_CHUNK));
  return out;
};

const rate = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

/**
 * @param companyId  the company the day belongs to
 * @param date       'YYYY-MM-DD' (ET calendar day)
 * @param memberIds  null = whole company; array = only these people (a team)
 * @param role       caller's role — decides which side of the pipeline the
 *                   company-wide transfer count keys on, exactly as
 *                   /stats/overview does it
 * @returns { transfers, sales, approved, cancelled, pending, conversion, approval }
 */
async function dailyPerformance({ companyId, date, memberIds = null, role = null }) {
  const blank = {
    transfers: 0, sales: 0, approved: 0, cancelled: 0, pending: 0,
    conversion: null, approval: null,
  };
  if (!companyId || !date) return blank;
  // A team with no members is a real, answerable state: zero, not "everyone".
  if (Array.isArray(memberIds) && memberIds.length === 0) return blank;

  const dayStart = etDateToUtcStart(date);
  const dayEnd   = etDateToUtcEnd(date);

  try {
    const closerSide = await isCloserSideScope(role, companyId);

    // ── company member ids, resolved once and only when needed ───────────
    // A closer company's transfers and sales are reached through its people,
    // never through company_id: transfers carry the FRONTER's company_id.
    let coIds = null;
    const companyMemberIds = async () => {
      if (coIds) return coIds;
      const { data } = await supabaseAdmin
        .from('user_company_roles').select('user_id')
        .eq('company_id', companyId).eq('is_active', true);
      coIds = [...new Set((data || []).map(u => u.user_id).filter(Boolean))];
      return coIds;
    };

    // ── transfers ────────────────────────────────────────────────────────
    // Same two exclusions the rest of the app applies: a VICIdial row still
    // pending from the dialer is not a transfer yet, and a dialer ghost
    // (mig 271) never was one.
    const xferBase = () => supabaseAdmin.from('transfers')
      .select('id', { count: 'exact', head: true })
      .neq('vicidial_pending', true)
      .eq('dialer_ghost', false)
      .gte('created_at', dayStart)
      .lte('created_at', dayEnd);

    let transfers = 0;
    if (memberIds) {
      // A team's transfers are the ones its people SENT or WORKED — one .or()
      // per chunk covering both columns, as teamMetrics does it.
      for (const ids of chunk(memberIds)) {
        const r = await xferBase().or(`created_by.in.(${ids.join(',')}),assigned_closer_id.in.(${ids.join(',')})`);
        transfers += r.count || 0;
      }
    } else if (closerSide) {
      const ids = await companyMemberIds();
      if (!ids.length) return blank;
      for (const c of chunk(ids)) {
        const r = await xferBase().in('assigned_closer_id', c);
        transfers += r.count || 0;
      }
    } else {
      const r = await xferBase().eq('company_id', companyId);
      transfers = r.count || 0;
    }

    // ── sales ────────────────────────────────────────────────────────────
    const saleBase = (status) => {
      let q = excludePostDate(
        supabaseAdmin.from('sales').select('id', { count: 'exact', head: true }),
      ).eq('sale_date', date);
      if (status) q = q.eq('status', status);
      return q;
    };

    const countSales = async (status) => {
      // Team: credited through either leg — the fronter who sourced it or the
      // closer who closed it, matching how teamMetrics attributes a sale.
      if (memberIds) {
        let n = 0;
        for (const ids of chunk(memberIds)) {
          const r = await saleBase(status)
            .or(`closer_id.in.(${ids.join(',')}),fronter_id.in.(${ids.join(',')})`);
          n += r.count || 0;
        }
        return n;
      }
      if (closerSide) {
        const ids = await companyMemberIds();
        if (!ids.length) return 0;
        let n = 0;
        for (const c of chunk(ids)) { const r = await saleBase(status).in('closer_id', c); n += r.count || 0; }
        return n;
      }
      const r = await saleBase(status).eq('company_id', companyId);
      return r.count || 0;
    };

    const [sales, approved, cancelled, pending] = await Promise.all([
      countSales(null), countSales('closed_won'), countSales('cancelled'), countSales('pending_review'),
    ]);

    return {
      transfers, sales, approved, cancelled, pending,
      // Sales per transfer, and approvals per sale. Null rather than 0 on a
      // zero denominator — "no leads today" is not "0% conversion".
      conversion: rate(sales, transfers),
      approval:   rate(approved, sales),
    };
  } catch (e) {
    logger.warn('DAILY_PERF', `dailyPerformance failed for ${date}: ${e.message}`);
    return blank;
  }
}

module.exports = { dailyPerformance };

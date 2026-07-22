// ============================================================================
// egressGuard — ONE enforcement path for every data-egress surface (CSV/Excel
// exports + client-portal recording playback). Used by the egressAudit
// middleware (list-endpoint exports) AND called directly by dedicated stream
// routes (data-analyzer export, batch re-export, portal recording).
//
// Resolution: role → company → user, MOST-SPECIFIC ROW WINS (user beats company
// beats role) for a given action_type; a NULL field in the chosen row = that
// limit is unlimited. Mirrors the 3-tier flag pattern. No matching row anywhere
// = fully unlimited (governance is opt-in; nothing changes until configured).
//
// Every allow AND every deny is written to export_audit_log — superadmin sees
// blocked attempts too. Schema: migration 167.
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const logger = require('./logger');
const { resolveGovernance } = require('./readonlyGovernance');

const LIMIT_FIELDS = ['max_rows_per_export', 'max_exports_per_day', 'max_recording_minutes_per_day'];

// Resolve the caller's effective numeric limits for an action_type (+ optional
// data AREA). Returns { max_rows_per_export, max_exports_per_day,
// max_recording_minutes_per_day } with null = unlimited. Never throws
// (fail-OPEN → unlimited) so a governance outage can never block a legit export.
//
// dataset (area) dimension (mig 209): a row with a matching `dataset` beats the
// catch-all (dataset IS NULL = "all areas") within the same scope tier, and a
// more-specific SCOPE (user > company > role) always wins over a broader one.
async function resolveEgressLimits({ userId, companyId, role, actionType, dataset }) {
  try {
    const scopes = [];
    if (role)      scopes.push(['role', String(role)]);
    if (companyId) scopes.push(['company', String(companyId)]);
    if (userId)    scopes.push(['user', String(userId)]);
    if (!scopes.length) return emptyLimits();

    const orClause = scopes.map(([t, id]) => `and(scope_type.eq.${t},scope_id.eq.${id})`).join(',');
    // select('*') (not a named `dataset`) so this stays backward-compatible
    // BEFORE mig 209 adds the column: pre-migration rows simply have no dataset
    // key → treated as the catch-all (dataset == null), exactly the old behavior.
    // Naming `dataset` in the select would 400 until the column exists and
    // fail-open-lift every configured limit in the deploy window.
    const { data, error } = await supabaseAdmin
      .from('egress_limits')
      .select('*')
      .eq('action_type', actionType)
      .or(orClause);
    if (error || !data?.length) return emptyLimits();

    // Keep only rows that apply to this area: the catch-all (dataset null) OR an
    // exact area match. Then rank: scope tier dominates; within a tier, a
    // dataset-specific row beats the catch-all.
    const rows = data.filter(r => r.dataset == null || (dataset && r.dataset === dataset));
    if (!rows.length) return emptyLimits();
    const rank = { user: 3, company: 2, role: 1 };
    const score = (r) => rank[r.scope_type] * 2 + (r.dataset ? 1 : 0);
    const chosen = rows.sort((a, b) => score(b) - score(a))[0];
    return {
      max_rows_per_export:           chosen.max_rows_per_export ?? null,
      max_exports_per_day:           chosen.max_exports_per_day ?? null,
      max_recording_minutes_per_day: chosen.max_recording_minutes_per_day ?? null,
    };
  } catch (e) {
    logger.warn('EGRESS', `resolveEgressLimits failed (fail-open): ${e.message}`);
    return emptyLimits();
  }
}
const emptyLimits = () => ({ max_rows_per_export: null, max_exports_per_day: null, max_recording_minutes_per_day: null });

// Today's usage for this user+action from the audit log (allowed rows only).
// Returns { exports: N, minutes: M }. Index: idx_eal_enforce.
async function usageToday({ userId, actionType }) {
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const { data } = await supabaseAdmin
    .from('export_audit_log')
    .select('duration_seconds')
    .eq('user_id', userId)
    .eq('action_type', actionType)
    .eq('status', 'allowed')
    .gte('created_at', startOfDay.toISOString());
  const rows = data || [];
  const seconds = rows.reduce((s, r) => s + (r.duration_seconds || 0), 0);
  return { exports: rows.length, minutes: Math.round(seconds / 60) };
}

// Write one audit row (fire-and-forget; never throws).
async function logEgress(entry) {
  try {
    await supabaseAdmin.from('export_audit_log').insert({
      user_id:        entry.userId || null,
      company_id:     entry.companyId || null,
      role_level:     entry.role || null,
      action_type:    entry.actionType,
      dataset:        entry.dataset || null,
      surface:        entry.surface || null,
      status:         entry.status || 'allowed',
      deny_reason:    entry.denyReason || null,
      row_count:      Number.isFinite(entry.rowCount) ? entry.rowCount : null,
      duration_seconds: Number.isFinite(entry.durationSeconds) ? entry.durationSeconds : null,
      filters_applied: entry.filters || null,
    });
  } catch (e) {
    logger.warn('EGRESS', `logEgress failed: ${e.message}`);
  }
}

// THE decision + log. Returns { allowed, message, limit }. Logs allow OR deny.
//   rowCount        — rows this CSV export will emit (csv_export)
//   durationSeconds — clip length being played (recording_listen)
async function enforceEgress({ user, actionType, dataset, surface, rowCount, durationSeconds, filters }) {
  const ctx = {
    userId: user?.id, companyId: user?.company_id, role: user?.role,
    actionType, dataset, surface, rowCount, durationSeconds, filters,
  };
  const limits = await resolveEgressLimits(ctx);

  const deny = async (reason, limit) => {
    await logEgress({ ...ctx, status: 'denied', denyReason: reason });
    return { allowed: false, message: reason, limit };
  };

  // 0) readonly_admin governance gate — the superadmin can turn exports OFF for
  //    this RO globally (can_export=false) or for THIS data area. Hard block,
  //    logged as a denial so the activity/egress audit sees the attempt.
  if (user?.role === 'readonly_admin') {
    try {
      const gov = await resolveGovernance(user.id);
      const areaOff = dataset && gov.export && gov.export[dataset] === false;
      if (gov.flags?.can_export === false || areaOff) {
        return deny('Exports are disabled for your account for this data area.', 0);
      }
    } catch (e) {
      // fail-open like the rest of the guard — a governance read outage never
      // blocks a legitimate export.
      logger.warn('EGRESS', `RO export gate failed (fail-open): ${e.message}`);
    }
  }

  // 1) row cap (csv) — checked against the FULL export size before draining.
  if (actionType === 'csv_export' && limits.max_rows_per_export != null
      && Number.isFinite(rowCount) && rowCount > limits.max_rows_per_export) {
    return deny(
      `This export has ${rowCount.toLocaleString()} rows but your limit is ${limits.max_rows_per_export.toLocaleString()}. Narrow the filters (e.g. a date range) and try again.`,
      limits.max_rows_per_export);
  }

  // 2) daily count / minutes — running total from the audit log.
  if (limits.max_exports_per_day != null || limits.max_recording_minutes_per_day != null) {
    const used = await usageToday({ userId: ctx.userId, actionType });
    if (actionType === 'csv_export' && limits.max_exports_per_day != null
        && used.exports >= limits.max_exports_per_day) {
      return deny(
        `You've reached your daily export limit (${limits.max_exports_per_day}). It resets at midnight.`,
        limits.max_exports_per_day);
    }
    if (actionType === 'recording_listen' && limits.max_recording_minutes_per_day != null) {
      const thisMin = Math.round((durationSeconds || 0) / 60);
      if (used.minutes + thisMin > limits.max_recording_minutes_per_day) {
        return deny(
          `Daily recording-playback limit reached (${limits.max_recording_minutes_per_day} min). It resets at midnight.`,
          limits.max_recording_minutes_per_day);
      }
    }
  }

  // allow → log it (this is the authoritative "an export happened" record).
  await logEgress({ ...ctx, status: 'allowed' });
  return { allowed: true, limit: null, limits };
}

module.exports = { resolveEgressLimits, usageToday, logEgress, enforceEgress };

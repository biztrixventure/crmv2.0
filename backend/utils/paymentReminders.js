// ============================================================================
// utils/paymentReminders.js — Monthly Payment retention workflow.
//
// Active policies bill monthly on the sale's day-of-month. This module:
//   • computes each active sale's NEXT monthly-due date (clamped for short months)
//   • the scheduler scan upserts a payment_followups row per (sale, due cycle)
//     and fires reminder notifications at the configured day-offsets
//   • closers mark the outcome (collected / at-risk); at-risk soft-notifies
//     compliance for a possible cancellation.
//
// All superadmin-configurable via business_config:
//   payment_reminder.enabled         (bool, default true)
//   payment_reminder.window_days     (int,  default 7)   — how far ahead to surface
//   payment_reminder.reminder_offsets(int[], default [7,3,1]) — days-before to notify
//   payment_reminder.notify_roles    (str[], default ['closer']) — extra recipients
//                                     ('closer_manager','compliance_manager')
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const { getConfig } = require('./businessConfig');
const notifications = require('./notificationService');
const logger = require('./logger');

const CFG = 'payment_reminder';

// ── pure date math ──────────────────────────────────────────────────────────

/** Parse 'YYYY-MM-DD' (or ISO) to a UTC date-only Date at 00:00. */
function toDateOnly(value) {
  if (!value) return null;
  const s = String(value).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

/** Days in a given month (year, monthIndex 0-11). */
function daysInMonth(year, monthIdx) { return new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate(); }

/**
 * Next monthly payment due date (UTC date-only) for a sale, on/after `from`.
 * Payment recurs on the sale's day-of-month, clamped to the target month's length
 * (sold on the 31st → bills on the 30th/28th in shorter months).
 * Returns a Date or null.
 */
function nextPaymentDue(saleDate, from = new Date()) {
  const sd = toDateOnly(saleDate);
  if (!sd) return null;
  const today = toDateOnly(from.toISOString());
  const day = sd.getUTCDate();

  for (let i = 0; i < 13; i++) {                       // this month + next 12
    const y = today.getUTCFullYear();
    const mo = today.getUTCMonth() + i;
    const yr = y + Math.floor(mo / 12);
    const mIdx = ((mo % 12) + 12) % 12;
    const d = Math.min(day, daysInMonth(yr, mIdx));
    const cand = new Date(Date.UTC(yr, mIdx, d));
    if (cand >= today) return cand;
  }
  return null;
}

/** Whole days from `from` (date-only) to `due` (date-only). */
function daysUntil(due, from = new Date()) {
  const a = toDateOnly(from.toISOString());
  return Math.round((due - a) / 86400000);
}

const isoDate = (d) => d.toISOString().slice(0, 10);

// ── config ──────────────────────────────────────────────────────────────────
async function settings() {
  return {
    enabled:     await getConfig(null, `${CFG}.enabled`, true),
    windowDays:  parseInt(await getConfig(null, `${CFG}.window_days`, 7), 10) || 7,
    offsets:     await getConfig(null, `${CFG}.reminder_offsets`, [7, 3, 1]),
    notifyRoles: await getConfig(null, `${CFG}.notify_roles`, ['closer']),
  };
}

// Active policy = closed_won, not superseded. (pending_review intentionally out.)
const ACTIVE = (q) => q.eq('status', 'closed_won').is('superseded_by', null);

// ── scan + notify (called by the scheduler, daily-ish) ───────────────────────
async function runPaymentReminderScan() {
  const cfg = await settings();
  if (!cfg.enabled) return { scanned: 0, due: 0, notified: 0, skipped: 'disabled' };

  const today = new Date();
  const horizon = Math.max(cfg.windowDays, ...(Array.isArray(cfg.offsets) ? cfg.offsets : [0]), 0);

  // Active sales with a sale_date + a monthly payment.
  const { data: sales, error } = await ACTIVE(
    supabaseAdmin.from('sales')
      .select('id, company_id, closer_id, customer_uuid, customer_name, sale_date, monthly_payment')
  ).not('sale_date', 'is', null).limit(20000);
  if (error) { logger.warn('PAY_REMINDER', `scan query failed: ${error.message}`); return { error: error.message }; }

  let due = 0, notified = 0;
  const offsets = (Array.isArray(cfg.offsets) ? cfg.offsets : [7, 3, 1]).map(Number).filter(n => n >= 0);

  for (const s of (sales || [])) {
    const nextDue = nextPaymentDue(s.sale_date, today);
    if (!nextDue) continue;
    const d = daysUntil(nextDue, today);
    if (d < 0 || d > horizon) continue;               // outside the look-ahead
    due++;
    const dueStr = isoDate(nextDue);

    // Upsert the followup row for this cycle (status preserved if it exists).
    await supabaseAdmin.from('payment_followups')
      .upsert({
        sale_id: s.id, company_id: s.company_id, closer_id: s.closer_id,
        customer_uuid: s.customer_uuid, due_date: dueStr, status: 'pending',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'sale_id,due_date', ignoreDuplicates: true })
      .then(() => {}, () => {});

    // Fire reminders at the configured offsets (dedupKey makes each fire once).
    if (offsets.includes(d) && s.closer_id) {
      const recipients = new Set([s.closer_id]);
      const extraLevels = (cfg.notifyRoles || []).filter(r => r !== 'closer');
      if (extraLevels.length && s.company_id) {
        const mgrs = await notifications.getUserIdsByLevel(s.company_id, extraLevels).catch(() => []);
        (mgrs || []).forEach(id => recipients.add(id));
      }
      await notifications.notifyUsers([...recipients], {
        companyId: s.company_id,
        type: 'payment_reminder',
        title: d === 0 ? 'Monthly payment due today' : `Monthly payment due in ${d} day${d === 1 ? '' : 's'}`,
        message: `${s.customer_name || 'A customer'} — call to confirm their monthly payment (due ${dueStr}).`,
        data: { sale_id: s.id, due_date: dueStr, customer_uuid: s.customer_uuid },
        dedupKey: `payment_reminder:${s.id}:${dueStr}:${d}`,
      }).then(() => { notified++; }, () => {});
    }
  }

  logger.info('PAY_REMINDER', `scan: ${(sales || []).length} active, ${due} due within ${horizon}d, ${notified} notified`);
  return { scanned: (sales || []).length, due, notified };
}

module.exports = {
  toDateOnly, daysInMonth, nextPaymentDue, daysUntil, isoDate,
  settings, runPaymentReminderScan, ACTIVE, CFG,
};

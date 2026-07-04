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
 * Pull the billing day-of-month (1-31) the closer wrote in the payment-due note,
 * e.g. "Monthly payments will be on the 3rd of each month" → 3. The note is the
 * real monthly date; sale_date is only the fallback. Returns null if none found.
 */
function billingDayFromNote(note) {
  if (!note) return null;
  const s = String(note);
  // 1) ordinal: "3rd", "15th"
  let m = s.match(/\b([0-3]?\d)\s*(?:st|nd|rd|th)\b/i);
  // 2) "on (the) 20"
  if (!m) m = s.match(/\bon\s+(?:the\s+)?([0-3]?\d)\b/i);
  // 3) any bare 1-31
  if (!m) m = s.match(/\b([0-3]?\d)\b/);
  const day = m ? parseInt(m[1], 10) : null;
  return (day != null && day >= 1 && day <= 31) ? day : null;
}

/**
 * Next monthly payment due date (UTC date-only) for a sale, on/after `from`.
 * Bills on `billingDay` when given (the closer's stated monthly date), else the
 * sale's day-of-month — clamped to the target month's length (the 31st → 30th/28th
 * in shorter months). Returns a Date or null.
 */
function nextPaymentDue(saleDate, from = new Date(), billingDay = null) {
  const sd = toDateOnly(saleDate);
  if (!sd) return null;
  const today = toDateOnly(from.toISOString());
  const day = (billingDay != null && billingDay >= 1 && billingDay <= 31) ? billingDay : sd.getUTCDate();

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

/**
 * Resolve the superadmin's target month. 'current' → this month; 'YYYY-MM' → that
 * month. Returns the month index + inclusive date bounds + a label.
 */
function resolveMonth(target) {
  let y, mIdx;
  const m = /^(\d{4})-(\d{2})$/.exec(String(target || '').trim());
  if (m) { y = +m[1]; mIdx = +m[2] - 1; }
  else { const now = new Date(); y = now.getUTCFullYear(); mIdx = now.getUTCMonth(); }
  const start = new Date(Date.UTC(y, mIdx, 1));
  const end = new Date(Date.UTC(y, mIdx + 1, 0));
  return { year: y, monthIdx: mIdx, start: isoDate(start), end: isoDate(end), label: `${y}-${String(mIdx + 1).padStart(2, '0')}` };
}

/**
 * The monthly due date for a sale WITHIN a specific month (the billing day, or
 * sale's day-of-month, clamped to that month's length). Returns null if it would
 * fall before the sale existed (a sale made mid-month whose first cycle is later).
 */
function dueInMonth(saleDate, year, monthIdx, billingDay = null) {
  const sd = toDateOnly(saleDate);
  if (!sd) return null;
  const day = (billingDay != null && billingDay >= 1 && billingDay <= 31) ? billingDay : sd.getUTCDate();
  const clamped = Math.min(day, daysInMonth(year, monthIdx));
  const due = new Date(Date.UTC(year, monthIdx, clamped));
  return due < sd ? null : due;
}

// ── config ──────────────────────────────────────────────────────────────────
async function settings() {
  return {
    enabled:     await getConfig(null, `${CFG}.enabled`, true),
    windowDays:  parseInt(await getConfig(null, `${CFG}.window_days`, 7), 10) || 7,
    offsets:     await getConfig(null, `${CFG}.reminder_offsets`, [7, 3, 1]),
    notifyRoles: await getConfig(null, `${CFG}.notify_roles`, ['closer']),
    targetMonth: await getConfig(null, `${CFG}.target_month`, 'current'),
  };
}

// Active policy = closed_won, not superseded. (pending_review intentionally out.)
const ACTIVE = (q) => q.eq('status', 'closed_won').is('superseded_by', null);

// ── scan + notify (month-based; called by the scheduler ~3h) ─────────────────
// For the superadmin's TARGET MONTH, every active policy with a monthly payment
// gets ONE follow-up on its monthly due date in that month, and each closer gets
// ONE summary notification ("N customers to collect this month"). The goal: make
// at least one monthly collection call per active customer that month.
async function runPaymentReminderScan() {
  const cfg = await settings();
  if (!cfg.enabled) return { scanned: 0, due: 0, notified: 0, skipped: 'disabled' };
  const { year, monthIdx, label } = resolveMonth(cfg.targetMonth);

  // Active policies with a monthly payment.
  const { data: sales, error } = await ACTIVE(
    supabaseAdmin.from('sales')
      .select('id, company_id, closer_id, customer_uuid, customer_name, sale_date, monthly_payment, payment_due_note')
  ).not('sale_date', 'is', null).limit(50000);
  if (error) { logger.warn('PAY_REMINDER', `scan query failed: ${error.message}`); return { error: error.message }; }

  const now = new Date().toISOString();
  const rows = [];
  const byCloser = new Map();   // closer_id → { companyId, count }
  for (const s of (sales || [])) {
    // only policies that actually carry a monthly payment
    if (s.monthly_payment == null || +s.monthly_payment <= 0) continue;
    const due = dueInMonth(s.sale_date, year, monthIdx, billingDayFromNote(s.payment_due_note));
    if (!due) continue;
    rows.push({ sale_id: s.id, company_id: s.company_id, closer_id: s.closer_id, customer_uuid: s.customer_uuid, due_date: isoDate(due), status: 'pending', updated_at: now });
    if (s.closer_id) { const c = byCloser.get(s.closer_id) || { companyId: s.company_id, count: 0 }; c.count++; byCloser.set(s.closer_id, c); }
  }

  // Bulk upsert (ignoreDuplicates → existing collected/at_risk rows are preserved).
  for (let i = 0; i < rows.length; i += 1000) {
    await supabaseAdmin.from('payment_followups')
      .upsert(rows.slice(i, i + 1000), { onConflict: 'sale_id,due_date', ignoreDuplicates: true })
      .then(() => {}, (e) => logger.warn('PAY_REMINDER', `upsert chunk: ${e?.message}`));
  }

  // One summary notification per closer for the month (deduped).
  let notified = 0;
  for (const [closerId, { companyId, count }] of byCloser) {
    const recipients = new Set([closerId]);
    const extraLevels = (cfg.notifyRoles || []).filter(r => r !== 'closer');
    if (extraLevels.length && companyId) {
      const mgrs = await notifications.getUserIdsByLevel(companyId, extraLevels).catch(() => []);
      (mgrs || []).forEach(id => recipients.add(id));
    }
    await notifications.notifyUsers([...recipients], {
      companyId, type: 'payment_reminder',
      title: `Monthly payments to collect — ${label}`,
      message: `You have ${count} customer${count === 1 ? '' : 's'} to call this month for their monthly payment.`,
      data: { month: label, count },
      dedupKey: `payment_reminder:${closerId}:${label}`,
    }).then(() => { notified++; }, () => {});
  }

  logger.info('PAY_REMINDER', `scan ${label}: ${(sales || []).length} active, ${rows.length} due this month, ${notified} closers notified`);
  return { scanned: (sales || []).length, due: rows.length, notified, month: label };
}

module.exports = {
  toDateOnly, daysInMonth, nextPaymentDue, billingDayFromNote, daysUntil, isoDate,
  resolveMonth, dueInMonth, settings, runPaymentReminderScan, ACTIVE, CFG,
};

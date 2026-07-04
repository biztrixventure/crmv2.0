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

/** Date N whole months before `from` (UTC date-only). Used as the recency cutoff. */
function monthsAgo(n, from = new Date()) {
  const d = toDateOnly(from.toISOString());
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, d.getUTCDate()));
}

// ── config ──────────────────────────────────────────────────────────────────
async function settings() {
  const wm = parseInt(await getConfig(null, `${CFG}.window_months`, 2), 10);
  return {
    enabled:      await getConfig(null, `${CFG}.enabled`, true),
    // recency window: only sales CLOSED within the last N months are chased for a
    // monthly payment (default 2). Clamped 1..12.
    windowMonths: Math.max(1, Math.min(Number.isFinite(wm) ? wm : 2, 12)),
    notifyRoles:  await getConfig(null, `${CFG}.notify_roles`, ['closer']),
  };
}

// Active policy = closed_won, not superseded. (pending_review intentionally out.)
const ACTIVE = (q) => q.eq('status', 'closed_won').is('superseded_by', null);

// ── scan + notify (recency-window based; called by the scheduler ~3h) ─────────
// Only RECENTLY CLOSED policies (sale_date within the last windowMonths) get a
// follow-up on their upcoming monthly due date, and each closer gets ONE summary
// notification. Goal: chase recent closers for their monthly payment — 2025/old
// policies drop out.
async function runPaymentReminderScan() {
  const cfg = await settings();
  if (!cfg.enabled) return { scanned: 0, due: 0, notified: 0, skipped: 'disabled' };
  const today = new Date();
  const cutoff = isoDate(monthsAgo(cfg.windowMonths, today));   // sale_date >= this

  // Active policies closed within the recency window, with a monthly payment.
  const { data: sales, error } = await ACTIVE(
    supabaseAdmin.from('sales')
      .select('id, company_id, closer_id, customer_uuid, customer_name, sale_date, monthly_payment, payment_due_note')
  ).gte('sale_date', cutoff).limit(50000);
  if (error) { logger.warn('PAY_REMINDER', `scan query failed: ${error.message}`); return { error: error.message }; }

  const now = new Date().toISOString();
  const rows = [];
  const byCloser = new Map();   // closer_id → { companyId, count }
  for (const s of (sales || [])) {
    if (s.monthly_payment == null || +s.monthly_payment <= 0) continue;
    const due = nextPaymentDue(s.sale_date, today, billingDayFromNote(s.payment_due_note));   // next monthly due on/after today
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

  // One summary notification per closer (deduped per calendar month).
  const monthTag = isoDate(today).slice(0, 7);
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
      title: 'Monthly payments to collect',
      message: `You have ${count} recent customer${count === 1 ? '' : 's'} to call for their monthly payment.`,
      data: { count, window_months: cfg.windowMonths },
      dedupKey: `payment_reminder:${closerId}:${monthTag}`,
    }).then(() => { notified++; }, () => {});
  }

  logger.info('PAY_REMINDER', `scan: ${(sales || []).length} active since ${cutoff}, ${rows.length} due, ${notified} closers notified`);
  return { scanned: (sales || []).length, due: rows.length, notified, cutoff };
}

module.exports = {
  toDateOnly, daysInMonth, nextPaymentDue, billingDayFromNote, daysUntil, isoDate,
  monthsAgo, settings, runPaymentReminderScan, ACTIVE, CFG,
};

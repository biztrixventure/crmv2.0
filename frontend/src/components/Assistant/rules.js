/**
 * rules — the mascot's rule-based "intelligence" (no AI). Each rule:
 *   id        unique key (used for cooldown + ignore suppression)
 *   priority  higher wins when several match
 *   kind      'alert' | 'tip' | 'happy'  (drives mascot animation)
 *   cond(d)   pure predicate over the behavior snapshot
 *   message   short, friendly, slightly funny line
 *   action?   { label, goto?, target? }  optional CTA (navigate / highlight element)
 *
 * Add rules freely — they're plain objects, evaluated top-down by priority.
 */
export const RULES = [
  {
    id: 'idle_long', priority: 90, kind: 'alert',
    cond: (d) => d.idleTime > 600,
    message: "Still there? I'll take a nap 😴 (mute me anytime).",
  },
  {
    id: 'missed_callbacks', priority: 80, kind: 'alert',
    cond: (d) => d.missedCallbacks > 3,
    message: "👀 You're ignoring callbacks… they miss you too.",
    action: { label: 'Open callbacks', target: '[data-assistant="callbacks"]' },
  },
  {
    id: 'idle_mid', priority: 60, kind: 'tip',
    cond: (d) => d.idleTime > 180 && d.idleTime <= 600,
    message: "You there? The CRM is getting lonely 😄",
  },
  {
    id: 'lead_note_hint', priority: 55, kind: 'tip',
    cond: (d) => (d.page === 'leads' || d.page === 'transfers') && !d.recentTypes.includes('note_added'),
    message: "Opened a lead? Drop a note so future-you remembers 👀",
    action: { label: 'Add note', target: '[data-assistant="add-note"]' },
  },
  {
    id: 'sales_create_hint', priority: 50, kind: 'tip',
    cond: (d) => d.page === 'sales',
    message: "That 'Create' button? Yeah… click it. Trust me 😏",
    action: { label: 'Show me', target: '[data-assistant="create-sale"]' },
  },
  {
    id: 'productive', priority: 40, kind: 'happy',
    cond: (d) => d.eventsToday >= 40 && d.idleTime < 60,
    message: "You're on fire today 🚀 keep it rolling.",
  },
  {
    id: 'welcome', priority: 10, kind: 'tip',
    cond: (d) => (d.pageVisits?.dashboard || 0) <= 1 && d.page === 'dashboard',
    message: "Hey! I'm Trix 🐾 — I'll nudge you when something needs love. Drag me anywhere.",
  },
];

const DAY = 24 * 60 * 60 * 1000;

/**
 * Pick the best tip to show, or null. Respects: a global min-gap (no spam),
 * 24h suppression of ignored tips, and never repeating the immediately-previous
 * tip. `sessionShown` is a Set of ids already shown this session.
 */
export function pickTip(data, { now = Date.now(), minGapMs = 30000, sessionShown = new Set() } = {}) {
  if (now - (data.lastTipAt || 0) < minGapMs) return null;       // don't spam

  const candidates = RULES
    .filter(r => {
      if (typeof r.cond !== 'function' || !r.cond(data)) return false;
      const ignoredAt = data.ignoredTips?.[r.id];
      if (ignoredAt && now - ignoredAt < DAY) return false;        // user dismissed it recently
      if (r.id === data.lastTipId) return false;                   // don't repeat back-to-back
      if (sessionShown.has(r.id) && r.kind !== 'alert') return false; // show non-alerts once/session
      return true;
    })
    .sort((a, b) => b.priority - a.priority);

  return candidates[0] || null;
}

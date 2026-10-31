// ============================================================================
// liveEvents — the notification that already arrived, told to the screen.
//
// A new notification reaches the browser INSTANTLY: useNotifications holds an
// open Supabase Realtime channel on `notifications` filtered to this user, and
// `notifications` is in the supabase_realtime publication, so the INSERT lands
// as a websocket frame. The bell has always been live.
//
// The LISTS were not. Every one of them loads on mount and then only when
// somebody presses Refresh — so a closer submitting a sale rang compliance's
// bell while the queue behind it stayed exactly as it was, and the row only
// appeared on a manual refresh. That is the whole bug.
//
// THIS ADDS NO POLLING AND NO REQUESTS OF ITS OWN. It is a few bytes of
// in-process pub/sub over an event the browser was handed for free. One list
// fetch happens per real event — the same fetch the Refresh button has always
// made — and nothing happens at all on a quiet floor.
// ============================================================================

// The sale's trip through the CRM, as notification types. Named here ONCE so a
// list cannot subscribe to a type the service stopped sending, or miss one it
// started: these are the values notificationService.js emits.
export const SALE_EVENTS = [
  'sale_pending_review',    // a closer finished a sale -> compliance + company_admin
  'sale_approved',          // compliance approved it   -> back to the closer
  'sale_needs_revision',    // compliance returned it   -> back to the closer
  'compliance_updated',     // compliance edited it
];

// Lead-side equivalents, for the transfer lists.
export const TRANSFER_EVENTS = [
  'transfer_created', 'transfer_assigned', 'transfer_edited', 'transfer_rejected',
];

const subscribers = new Set();

// Called by useNotifications for every realtime notification. Wrapped per
// subscriber: a list whose reload throws must not stop the next one from
// hearing the same event, and must never reach the notification handler — the
// bell matters more than any list.
export function publishLive(notification) {
  const type = notification?.type;
  if (!type) return;
  for (const fn of [...subscribers]) {
    try { fn(type, notification); } catch { /* one deaf list, not a broken bell */ }
  }
}

export function subscribeLive(fn) {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}

// Test/diagnostic only.
export const liveSubscriberCount = () => subscribers.size;

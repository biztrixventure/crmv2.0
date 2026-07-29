/**
 * Resolve a notification (in-app row OR OS push `data`) to a focus target the
 * shells understand: { kind, id, ref }.
 *
 *   kind  — 'transfer' | 'sale' | 'callback' | 'number' | 'chat' | 'email'
 *           | 'batch' | 'qa' | 'url'
 *   id    — the entity id to open + highlight
 *   ref   — a human label (reference no / customer / phone) for context
 *
 * Key-based first (robust to a missing `type`), type-prefix as a fallback.
 *
 * KEEP THIS IN SYNC WITH frontend/public/sw.js. The service worker carries a
 * hand-copied mirror of this mapping because it cannot import from the app
 * bundle, and the two drifting apart is how a notification ends up pointing
 * somewhere the app does not go. The sw.js copy names this file in its own
 * comment for the same reason.
 */
export function resolveNotificationTarget(n) {
  if (!n) return null;
  const d = n.data || {};
  const type = String(n.type || d.type || '').toLowerCase();

  // An explicit url on the payload wins over everything. Nothing sends one
  // today, but it is the escape hatch for a notification that points at a page
  // rather than at a record, and honouring it costs one branch.
  if (d.url) return { kind: 'url', id: null, url: String(d.url), ref: null };

  // Order matters: the most specific id wins.
  if (d.callback_id || type.includes('callback_due') || type === 'callback') {
    return { kind: 'callback', id: d.callback_id || null, ref: d.customer_name || d.phone_number || null };
  }
  if (d.callback_number_id || type === 'number_claimable') {
    return { kind: 'number', id: d.callback_number_id || null, ref: d.phone_number || null };
  }
  // QA ahead of sale/transfer: a QA row carries its own assignment id, and
  // `qa_new_transfer` also carries a transfer_id — but a QA agent wants the
  // review they were assigned, not the raw transfer record behind it.
  if (d.assignment_id || type.startsWith('qa_assignment') || type === 'qa_review') {
    return { kind: 'qa', id: d.assignment_id || null, ref: d.work_type || null };
  }
  if (d.sale_id || type.startsWith('sale')) {
    return { kind: 'sale', id: d.sale_id || null, ref: d.reference_no || d.customer_name || null };
  }
  if (d.transfer_id || type.startsWith('transfer')) {
    // The duplicate-event alerts (transfer_refresh / _reengaged / _sale_overlap)
    // legitimately have no transfer_id — they are about a PHONE that keeps
    // coming back, not about one record. They still resolve to the transfers
    // tab, and `ref` carries the phone so the landing has some context.
    return { kind: 'transfer', id: d.transfer_id || null, ref: d.customer_name || d.phone || null };
  }
  if (d.conversation_id || d.chat_id || type.includes('chat') || type.includes('message')) {
    return { kind: 'chat', id: d.conversation_id || d.chat_id || null, ref: null };
  }
  if (d.email_id || d.thread_id || d.kind === 'internal_email' || type.startsWith('email')) {
    return { kind: 'email', id: d.email_id || d.thread_id || null, ref: null };
  }
  if (d.batch_id || d.kind === 'distribution_batch' || type.startsWith('batch')) {
    return { kind: 'batch', id: d.batch_id || null, ref: null };
  }
  return null;
}

/** Build a cold-open deep link the service worker can hand to openWindow(). */
export function focusDeepLink(target, base = '/dashboard') {
  if (!target || !target.kind) return base;
  if (target.kind === 'url') return target.url || base;
  const sp = new URLSearchParams();
  sp.set('fkind', target.kind);
  if (target.id) sp.set('fid', String(target.id));
  return `${base}?${sp.toString()}`;
}

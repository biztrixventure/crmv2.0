/**
 * Resolve a notification (in-app row OR OS push `data`) to a focus target the
 * shells understand: { kind, id, ref }.
 *
 *   kind  — 'transfer' | 'sale' | 'callback' | 'number' | 'chat'
 *   id    — the entity id to open + highlight
 *   ref   — a human label (reference no / customer) for context (optional)
 *
 * Key-based first (robust to missing `type`), type-prefix as a fallback. Every
 * notification carries its entity id in `data` (see backend notificationService
 * + callbackScheduler), so this works for both the bell and the service worker.
 */
export function resolveNotificationTarget(n) {
  if (!n) return null;
  const d = n.data || {};
  const type = String(n.type || d.type || '').toLowerCase();

  // Order matters: most specific id wins.
  if (d.callback_id || type.includes('callback_due') || type === 'callback') {
    return { kind: 'callback', id: d.callback_id || null, ref: d.customer_name || d.phone_number || null };
  }
  if (d.callback_number_id || type === 'number_claimable') {
    return { kind: 'number', id: d.callback_number_id || null, ref: d.phone_number || null };
  }
  if (d.sale_id || type.startsWith('sale')) {
    return { kind: 'sale', id: d.sale_id || null, ref: d.reference_no || d.customer_name || null };
  }
  if (d.transfer_id || type.startsWith('transfer')) {
    return { kind: 'transfer', id: d.transfer_id || null, ref: d.customer_name || null };
  }
  if (d.conversation_id || d.chat_id || type.includes('chat') || type.includes('message')) {
    return { kind: 'chat', id: d.conversation_id || d.chat_id || null, ref: null };
  }
  return null;
}

/** Build a cold-open deep link the service worker can hand to openWindow(). */
export function focusDeepLink(target, base = '/dashboard') {
  if (!target || !target.kind) return base;
  const sp = new URLSearchParams();
  sp.set('fkind', target.kind);
  if (target.id) sp.set('fid', String(target.id));
  return `${base}?${sp.toString()}`;
}

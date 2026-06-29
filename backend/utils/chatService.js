/**
 * Chat Service
 * Shared helpers for the chat routes:
 *   - find-or-create a DM between two users (deterministic dm_key, race-safe)
 *   - fire Web Push to a conversation's recipients (offline delivery)
 *   - write moderation audit-log rows
 *
 * Mirrors the fire-and-forget style of notificationService.js: push is best
 * effort (.catch swallowed) and never blocks the request.
 */

const { supabaseAdmin } = require('../config/database');
const logger = require('./logger');
const { sendPushToUsers } = require('./pushService');

// Deterministic DM key — sorted so (a,b) and (b,a) collapse to one conversation.
function buildDmKey(userA, userB) {
  return [userA, userB].sort().join(':');
}

/**
 * Find the existing DM between two users or create it (with both members).
 * Race-safe: a concurrent insert hitting the unique dm_key is recovered by
 * re-selecting the row.
 */
async function findOrCreateDM(creatorId, otherId) {
  if (!otherId || otherId === creatorId) {
    throw new Error('A DM needs two distinct users');
  }
  const dmKey = buildDmKey(creatorId, otherId);

  const existing = await supabaseAdmin
    .from('conversations').select('*').eq('dm_key', dmKey).maybeSingle();
  if (existing.data) {
    await ensureMembers(existing.data.id, [creatorId, otherId]);
    return existing.data;
  }

  const { data: conv, error } = await supabaseAdmin
    .from('conversations')
    .insert({ type: 'dm', dm_key: dmKey, created_by: creatorId })
    .select().single();

  if (error) {
    // Lost the race — another request created the same DM. Re-select it.
    const retry = await supabaseAdmin
      .from('conversations').select('*').eq('dm_key', dmKey).maybeSingle();
    if (retry.data) {
      await ensureMembers(retry.data.id, [creatorId, otherId]);
      return retry.data;
    }
    throw new Error(error.message);
  }

  await ensureMembers(conv.id, [creatorId, otherId]);
  return conv;
}

// Upsert membership rows (ignoring duplicates) for a set of users.
async function ensureMembers(conversationId, userIds, memberRole = 'member') {
  const rows = [...new Set(userIds)].map(uid => ({
    conversation_id: conversationId,
    user_id: uid,
    member_role: memberRole,
  }));
  if (!rows.length) return;
  await supabaseAdmin
    .from('conversation_members')
    .upsert(rows, { onConflict: 'conversation_id,user_id', ignoreDuplicates: true });
}

/**
 * Notify a conversation's other members of a new message via Web Push.
 *
 * We push to every member except the sender; the OS/browser shows it only when
 * the recipient isn't actively looking, and the `tag` collapses repeats per
 * conversation. (True presence-based suppression would need a shared presence
 * store that survives multiple server instances; pushing to all non-senders is
 * the same reliable approach used by notificationService.js.)
 */
async function pushNewMessage({ conversationId, senderId, senderName, body, memberIds }) {
  const recipients = (memberIds || []).filter(id => id && id !== senderId);
  if (!recipients.length) return;
  const preview = (body || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  sendPushToUsers(recipients, {
    title: senderName || 'New message',
    body:  preview || 'Sent you a message',
    tag:   `chat_${conversationId}`,
    data:  { conversation_id: conversationId, type: 'chat' },
  }).catch(() => {});
}

/**
 * Create (or revive) pending invites for a set of users to a group.
 * Skips users who are already members. Re-inviting a declined user flips it back
 * to pending. Returns the number of invites created/revived.
 */
async function createInvites(conversationId, inviterId, inviteeIds) {
  const ids = [...new Set((inviteeIds || []).filter(Boolean))].filter(id => id !== inviterId);
  if (!ids.length) return 0;

  // Exclude users who are already members.
  const { data: existingMembers } = await supabaseAdmin
    .from('conversation_members').select('user_id')
    .eq('conversation_id', conversationId).in('user_id', ids);
  const memberSet = new Set((existingMembers || []).map(m => m.user_id));
  const targets = ids.filter(id => !memberSet.has(id));
  if (!targets.length) return 0;

  const rows = targets.map(invitee_id => ({
    conversation_id: conversationId,
    invitee_id,
    inviter_id: inviterId,
    status: 'pending',
    created_at: new Date().toISOString(),
    responded_at: null,
  }));
  // Upsert so a previously declined/accepted invite is re-opened as pending.
  await supabaseAdmin
    .from('conversation_invites')
    .upsert(rows, { onConflict: 'conversation_id,invitee_id', ignoreDuplicates: false });
  return targets.length;
}

/** Web Push to users @mentioned in a message (best-effort, never blocks). */
function pushMentions({ conversationId, senderId, senderName, convTitle, mentionIds, body }) {
  const recipients = (mentionIds || []).filter(id => id && id !== senderId);
  if (!recipients.length) return;
  const where = convTitle ? ` in ${convTitle}` : '';
  const preview = (body || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  sendPushToUsers(recipients, {
    title: `${senderName || 'Someone'} mentioned you${where}`,
    body:  preview || 'You were mentioned in a message',
    tag:   `chat_mention_${conversationId}`,
    data:  { conversation_id: conversationId, type: 'chat_mention' },
  }).catch(() => {});
}

// Pretty role label from a role level, e.g. "closer_manager" → "Closer Manager".
const labelize = (s) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

/**
 * Resolve a set of user ids to display cards { id, name, role, company }.
 * Picks the user's most-recent active company assignment for role/company.
 * Returns a Map keyed by user id.
 */
async function getUserCards(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;

  const [profilesRes, rolesRes] = await Promise.all([
    supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', ids),
    supabaseAdmin
      .from('user_company_roles')
      .select('user_id, created_at, custom_roles(level, name), companies(name)')
      .in('user_id', ids)
      .eq('is_active', true)
      .order('created_at', { ascending: false }),
  ]);

  const roleByUser = {};
  (rolesRes.data || []).forEach(r => { if (!roleByUser[r.user_id]) roleByUser[r.user_id] = r; });

  (profilesRes.data || []).forEach(p => {
    const name = `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'User';
    const r = roleByUser[p.user_id];
    map.set(p.user_id, {
      id:      p.user_id,
      name,
      role:    labelize(r?.custom_roles?.level || r?.custom_roles?.name || ''),
      company: r?.companies?.name || '',
    });
  });
  // Users with a role row but no profile row still get a card.
  Object.values(roleByUser).forEach(r => {
    if (!map.has(r.user_id)) {
      map.set(r.user_id, { id: r.user_id, name: 'User', role: labelize(r.custom_roles?.level || ''), company: r.companies?.name || '' });
    }
  });
  return map;
}

/**
 * Searchable global user directory for the new-chat picker.
 * Filters (all optional, combinable): `q` (name), `companyId`, `role` (level).
 * When companyId/role is set we resolve through user_company_roles so the list
 * reflects company membership + role; otherwise we scan profiles by name.
 * Returns up to `limit` user cards.
 */
async function searchDirectory({ q, limit = 50, excludeId, companyId, role } = {}) {
  const nameFilter = (list) => {
    const s = (q || '').trim().toLowerCase();
    return s ? list.filter(c => (c.name || '').toLowerCase().includes(s)) : list;
  };

  // Company and/or role filter → start from active role assignments.
  if (companyId || role) {
    let rq = supabaseAdmin
      .from('user_company_roles')
      .select('user_id, company_id, custom_roles(level)')
      .eq('is_active', true);
    if (companyId) rq = rq.eq('company_id', companyId);
    const { data: rows } = await rq;
    let filtered = rows || [];
    if (role) filtered = filtered.filter(r => r.custom_roles?.level === role);
    const ids = [...new Set(filtered.map(r => r.user_id))].filter(id => id !== excludeId);
    if (!ids.length) return [];
    const cards = await getUserCards(ids);
    const list = nameFilter(ids.map(id => cards.get(id)).filter(Boolean));
    return list.sort((a, b) => (a.name || '').localeCompare(b.name || '')).slice(0, limit);
  }

  // Default: name scan over profiles.
  let query = supabaseAdmin
    .from('user_profiles')
    .select('user_id, first_name, last_name')
    .order('first_name', { ascending: true })
    .limit(limit);
  if (q && q.trim()) {
    const s = q.trim().replace(/[%,]/g, '');
    query = query.or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%`);
  }
  const { data: profiles } = await query;
  let ids = (profiles || []).map(p => p.user_id).filter(id => id !== excludeId);
  if (!ids.length) return [];

  // Hide DEACTIVATED users from chat search: a user is inactive if they have
  // company assignments but none is_active. Users with no assignments at all
  // (e.g. env-level superadmin) stay searchable.
  const { data: asn } = await supabaseAdmin
    .from('user_company_roles').select('user_id, is_active').in('user_id', ids);
  const state = new Map();
  (asn || []).forEach(a => {
    const s = state.get(a.user_id) || { any: false, active: false };
    s.any = true; if (a.is_active) s.active = true;
    state.set(a.user_id, s);
  });
  ids = ids.filter(id => { const s = state.get(id); return !s || !s.any || s.active; });
  if (!ids.length) return [];

  const cards = await getUserCards(ids);
  return ids.map(id => cards.get(id)).filter(Boolean);
}

/** Append a row to the moderation audit trail. Never throws. */
async function logModeration({ actorId, action, targetUserId, targetConversationId, targetMessageId, detail }) {
  try {
    await supabaseAdmin.from('chat_moderation_log').insert({
      actor_id:               actorId || null,
      action,
      target_user_id:         targetUserId || null,
      target_conversation_id: targetConversationId || null,
      target_message_id:      targetMessageId || null,
      detail:                 detail || null,
    });
  } catch (err) {
    logger.warn('CHAT', `Moderation log write failed: ${err.message}`);
  }
}

module.exports = {
  buildDmKey,
  findOrCreateDM,
  ensureMembers,
  pushNewMessage,
  pushMentions,
  createInvites,
  logModeration,
  getUserCards,
  searchDirectory,
};

/**
 * Chat Admin — superadmin moderation & oversight (mounted at /api/chat/admin).
 * Every route is gated by isSuperAdmin() and operates through supabaseAdmin
 * (service role → bypasses RLS). RLS is never widened for superadmin; their
 * power comes from these server-side, audited routes. Each mutating action is
 * written to chat_moderation_log.
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');
const { getUserCards, searchDirectory, logModeration, ensureMembers, pushNewMessage } = require('../utils/chatService');

const router = express.Router();

// Gate the whole router.
router.use(asyncHandler(async (req, res, next) => {
  if (!(await isSuperAdmin(req.user.id))) return res.status(403).json({ error: 'Superadmin access required' });
  next();
}));

const startOfTodayUtc = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString(); };

// ── GET /overview — global stats + leaderboards ───────────────────────────────
router.get('/overview', asyncHandler(async (req, res) => {
  const todayStart = startOfTodayUtc();
  const weekStart  = new Date(Date.now() - 7 * 86400000).toISOString();

  const [convCount, dmCount, groupCount, bcastCount, msgTotal, msgToday, msg7d, bannedCount, lockedCount, todaySenders, week] = await Promise.all([
    supabaseAdmin.from('conversations').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('conversations').select('id', { count: 'exact', head: true }).eq('type', 'dm'),
    supabaseAdmin.from('conversations').select('id', { count: 'exact', head: true }).eq('type', 'group'),
    supabaseAdmin.from('conversations').select('id', { count: 'exact', head: true }).eq('type', 'broadcast'),
    supabaseAdmin.from('messages').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    supabaseAdmin.from('messages').select('id', { count: 'exact', head: true }).is('deleted_at', null).gte('created_at', todayStart),
    supabaseAdmin.from('messages').select('id', { count: 'exact', head: true }).is('deleted_at', null).gte('created_at', weekStart),
    supabaseAdmin.from('chat_user_settings').select('user_id', { count: 'exact', head: true }).eq('is_chat_banned', true),
    supabaseAdmin.from('conversations').select('id', { count: 'exact', head: true }).eq('is_locked', true),
    supabaseAdmin.from('messages').select('sender_id').gte('created_at', todayStart).limit(8000),
    supabaseAdmin.from('messages').select('sender_id, conversation_id').is('deleted_at', null).gte('created_at', weekStart).limit(12000),
  ]);

  const activeUsers = new Set((todaySenders.data || []).map(m => m.sender_id).filter(Boolean)).size;

  // 7-day leaderboards
  const senderTally = {}, roomTally = {};
  (week.data || []).forEach(m => {
    if (m.sender_id) senderTally[m.sender_id] = (senderTally[m.sender_id] || 0) + 1;
    if (m.conversation_id) roomTally[m.conversation_id] = (roomTally[m.conversation_id] || 0) + 1;
  });
  const topSenderIds = Object.entries(senderTally).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topRoomIds   = Object.entries(roomTally).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const cards = await getUserCards(topSenderIds.map(([id]) => id));
  let roomTitles = {};
  if (topRoomIds.length) {
    const { data: rooms } = await supabaseAdmin.from('conversations').select('id, title, type').in('id', topRoomIds.map(([id]) => id));
    (rooms || []).forEach(r => { roomTitles[r.id] = r.title || (r.type === 'dm' ? 'Direct message' : r.type); });
  }

  res.json({
    total_conversations: convCount.count || 0,
    dm_count: dmCount.count || 0, group_count: groupCount.count || 0, broadcast_count: bcastCount.count || 0,
    total_messages: msgTotal.count || 0,
    messages_today: msgToday.count || 0,
    messages_7d: msg7d.count || 0,
    active_users_today: activeUsers,
    banned_users: bannedCount.count || 0,
    locked_rooms: lockedCount.count || 0,
    top_senders: topSenderIds.map(([id, count]) => ({ id, count, name: cards.get(id)?.name || 'User', role: cards.get(id)?.role || '', company: cards.get(id)?.company || '' })),
    top_rooms: topRoomIds.map(([id, count]) => ({ id, count, title: roomTitles[id] || 'Conversation' })),
  });
}));

// ── GET /conversations — ALL conversations (paginated, searchable) ────────────
router.get('/conversations', asyncHandler(async (req, res) => {
  const page  = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
  const from  = (page - 1) * limit;
  const q     = (req.query.q || '').trim();
  const type  = ['dm', 'group', 'broadcast'].includes(req.query.type) ? req.query.type : null;
  const lockedOnly = req.query.locked === 'true';
  const applyFilters = (query) => {
    if (type) query = query.eq('type', type);
    if (lockedOnly) query = query.eq('is_locked', true);
    return query;
  };

  let convs = [];
  if (q) {
    // Match on room title OR on a participant's name/company.
    const [titleRes, dirCards] = await Promise.all([
      supabaseAdmin.from('conversations').select('*').ilike('title', `%${q.replace(/[%,]/g, '')}%`),
      searchDirectory({ q, limit: 100 }),
    ]);
    const matchUserIds = dirCards.map(c => c.id);
    let memberConvIds = [];
    if (matchUserIds.length) {
      const { data: mc } = await supabaseAdmin
        .from('conversation_members').select('conversation_id').in('user_id', matchUserIds);
      memberConvIds = [...new Set((mc || []).map(m => m.conversation_id))];
    }
    const idSet = new Set([...(titleRes.data || []).map(c => c.id), ...memberConvIds]);
    if (idSet.size) {
      const { data } = await applyFilters(supabaseAdmin.from('conversations').select('*').in('id', [...idSet]))
        .order('last_message_at', { ascending: false }).range(from, from + limit);
      convs = data || [];
    }
  } else {
    const { data } = await applyFilters(supabaseAdmin.from('conversations').select('*'))
      .order('last_message_at', { ascending: false }).range(from, from + limit);
    convs = data || [];
  }

  const hasMore = convs.length > limit;
  convs = convs.slice(0, limit);
  const convIds = convs.map(c => c.id);

  // Members + last message per conversation.
  const { data: allMembers } = convIds.length
    ? await supabaseAdmin.from('conversation_members').select('conversation_id, user_id').in('conversation_id', convIds)
    : { data: [] };
  const membersByConv = {};
  const userIds = new Set();
  (allMembers || []).forEach(m => {
    (membersByConv[m.conversation_id] = membersByConv[m.conversation_id] || []).push(m.user_id);
    userIds.add(m.user_id);
  });
  const cards = await getUserCards([...userIds]);

  const enriched = await Promise.all(convs.map(async (c) => {
    const { count } = await supabaseAdmin.from('messages')
      .select('id', { count: 'exact', head: true }).eq('conversation_id', c.id);
    const memberCards = (membersByConv[c.id] || []).map(id => cards.get(id)).filter(Boolean);
    return {
      id: c.id, type: c.type, title: c.title, is_locked: c.is_locked,
      created_at: c.created_at, last_message_at: c.last_message_at,
      message_count: count || 0,
      members: memberCards,
    };
  }));

  res.json({ conversations: enriched, page, has_more: hasMore });
}));

// ── GET /conversations/:id/messages — read ANY history ────────────────────────
router.get('/conversations/:id/messages', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 40, 100);
  let q = supabaseAdmin.from('messages')
    .select('id, conversation_id, sender_id, body, created_at, edited_at, deleted_at, deleted_by')
    .eq('conversation_id', req.params.id)
    .order('created_at', { ascending: false }).limit(limit + 1);
  if (req.query.before) q = q.lt('created_at', req.query.before);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const hasMore = (data || []).length > limit;
  const page = (data || []).slice(0, limit);
  const cards = await getUserCards(page.flatMap(m => [m.sender_id, m.deleted_by]));

  const messages = page.reverse().map(m => ({
    id: m.id, conversation_id: m.conversation_id, sender_id: m.sender_id,
    sender_name: cards.get(m.sender_id)?.name || 'User',
    body: m.body,                       // shown even if deleted, for moderation
    deleted: !!m.deleted_at,
    deleted_by_name: m.deleted_by ? (cards.get(m.deleted_by)?.name || 'Moderator') : null,
    edited: !!m.edited_at, created_at: m.created_at,
  }));

  res.json({ messages, has_more: hasMore, next_cursor: page.length ? page[0].created_at : null });
}));

// ── GET /conversations/:id — room detail + members (roles, mute, read state) ──
router.get('/conversations/:id', asyncHandler(async (req, res) => {
  const { data: conv } = await supabaseAdmin.from('conversations').select('*').eq('id', req.params.id).maybeSingle();
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  const [{ data: members }, { count: messageCount }] = await Promise.all([
    supabaseAdmin.from('conversation_members').select('user_id, member_role, is_muted, last_read_at, joined_at').eq('conversation_id', conv.id),
    supabaseAdmin.from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conv.id),
  ]);
  const cards = await getUserCards((members || []).map(m => m.user_id));

  res.json({
    conversation: { ...conv, message_count: messageCount || 0 },
    members: (members || []).map(m => ({ ...m, ...(cards.get(m.user_id) || { id: m.user_id, name: 'User' }) })),
  });
}));

// ── PATCH /conversations/:id/members/:userId/mute — mute/unmute in a room ─────
router.patch('/conversations/:id/members/:userId/mute', asyncHandler(async (req, res) => {
  const next = typeof req.body.is_muted === 'boolean' ? req.body.is_muted : true;
  const { data, error } = await supabaseAdmin.from('conversation_members')
    .update({ is_muted: next }).eq('conversation_id', req.params.id).eq('user_id', req.params.userId).select('user_id').maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Member not found in this conversation' });

  await logModeration({ actorId: req.user.id, action: next ? 'mute_member' : 'unmute_member', targetUserId: req.params.userId, targetConversationId: req.params.id });
  res.json({ user_id: req.params.userId, is_muted: next });
}));

// ── DELETE /conversations/:id/members/:userId — remove a member from a room ───
router.delete('/conversations/:id/members/:userId', asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from('conversation_members')
    .delete().eq('conversation_id', req.params.id).eq('user_id', req.params.userId);
  if (error) return res.status(500).json({ error: error.message });

  await logModeration({ actorId: req.user.id, action: 'remove_member', targetUserId: req.params.userId, targetConversationId: req.params.id });
  res.json({ message: 'removed' });
}));

// ── GET /messages/search?q= — global message content search ───────────────────
router.get('/messages/search', asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ results: [] });

  const { data, error } = await supabaseAdmin.from('messages')
    .select('id, conversation_id, sender_id, body, created_at')
    .ilike('body', `%${q.replace(/[%,]/g, '')}%`)
    .is('deleted_at', null)
    .order('created_at', { ascending: false }).limit(50);
  if (error) return res.status(500).json({ error: error.message });

  const rows = data || [];
  const cards = await getUserCards(rows.map(m => m.sender_id));
  const convIds = [...new Set(rows.map(m => m.conversation_id))];
  let titles = {};
  if (convIds.length) {
    const { data: convs } = await supabaseAdmin.from('conversations').select('id, title, type').in('id', convIds);
    (convs || []).forEach(c => { titles[c.id] = { title: c.title || (c.type === 'dm' ? 'Direct message' : c.type), type: c.type }; });
  }

  res.json({
    results: rows.map(m => ({
      id: m.id, conversation_id: m.conversation_id, body: m.body, created_at: m.created_at,
      sender_name: cards.get(m.sender_id)?.name || 'User',
      conversation_title: titles[m.conversation_id]?.title || 'Conversation',
      conversation_type: titles[m.conversation_id]?.type || null,
    })),
  });
}));

// ── DELETE /messages/:id — remove any message ─────────────────────────────────
router.delete('/messages/:id', asyncHandler(async (req, res) => {
  const { data: msg } = await supabaseAdmin.from('messages').select('id, conversation_id').eq('id', req.params.id).maybeSingle();
  if (!msg) return res.status(404).json({ error: 'Message not found' });

  const { error } = await supabaseAdmin.from('messages')
    .update({ deleted_at: new Date().toISOString(), deleted_by: req.user.id }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });

  await logModeration({ actorId: req.user.id, action: 'delete_message', targetMessageId: msg.id, targetConversationId: msg.conversation_id });
  res.json({ message: 'deleted' });
}));

// ── PATCH /conversations/:id/lock — freeze/unfreeze ───────────────────────────
router.patch('/conversations/:id/lock', asyncHandler(async (req, res) => {
  const { data: conv } = await supabaseAdmin.from('conversations').select('id, is_locked, title').eq('id', req.params.id).maybeSingle();
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  const next = typeof req.body.is_locked === 'boolean' ? req.body.is_locked : !conv.is_locked;
  const { error } = await supabaseAdmin.from('conversations').update({ is_locked: next, updated_at: new Date().toISOString() }).eq('id', conv.id);
  if (error) return res.status(500).json({ error: error.message });

  await logModeration({ actorId: req.user.id, action: next ? 'lock_room' : 'unlock_room', targetConversationId: conv.id, detail: { title: conv.title } });
  res.json({ conversation: { id: conv.id, is_locked: next } });
}));

// ── DELETE /conversations/:id — delete a room ─────────────────────────────────
router.delete('/conversations/:id', asyncHandler(async (req, res) => {
  const { data: conv } = await supabaseAdmin.from('conversations').select('id, type, title').eq('id', req.params.id).maybeSingle();
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  const { error } = await supabaseAdmin.from('conversations').delete().eq('id', conv.id);
  if (error) return res.status(500).json({ error: error.message });

  await logModeration({ actorId: req.user.id, action: 'delete_room', targetConversationId: conv.id, detail: { type: conv.type, title: conv.title } });
  res.json({ message: 'deleted' });
}));

// ── GET /users — all users with ban/mute status ───────────────────────────────
router.get('/users', asyncHandler(async (req, res) => {
  const cards = await searchDirectory({ q: req.query.q, limit: 200 });
  const ids = cards.map(c => c.id);
  const settingsMap = {};
  if (ids.length) {
    const { data: settings } = await supabaseAdmin
      .from('chat_user_settings').select('user_id, is_chat_banned, ban_reason, banned_at').in('user_id', ids);
    (settings || []).forEach(s => { settingsMap[s.user_id] = s; });
  }
  res.json({
    users: cards.map(c => ({
      ...c,
      is_chat_banned: !!settingsMap[c.id]?.is_chat_banned,
      ban_reason:     settingsMap[c.id]?.ban_reason || null,
      banned_at:      settingsMap[c.id]?.banned_at || null,
    })),
  });
}));

// ── POST /users/:id/ban ───────────────────────────────────────────────────────
router.post('/users/:id/ban', asyncHandler(async (req, res) => {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin.from('chat_user_settings').upsert({
    user_id: req.params.id, is_chat_banned: true,
    banned_by: req.user.id, banned_at: now, ban_reason: (req.body.reason || '').trim() || null, updated_at: now,
  }, { onConflict: 'user_id' });
  if (error) return res.status(500).json({ error: error.message });

  await logModeration({ actorId: req.user.id, action: 'ban_user', targetUserId: req.params.id, detail: { reason: req.body.reason || null } });
  res.json({ message: 'banned' });
}));

// ── POST /users/:id/unban ─────────────────────────────────────────────────────
router.post('/users/:id/unban', asyncHandler(async (req, res) => {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin.from('chat_user_settings').upsert({
    user_id: req.params.id, is_chat_banned: false, ban_reason: null, banned_at: null, updated_at: now,
  }, { onConflict: 'user_id' });
  if (error) return res.status(500).json({ error: error.message });

  await logModeration({ actorId: req.user.id, action: 'unban_user', targetUserId: req.params.id });
  res.json({ message: 'unbanned' });
}));

// Resolve broadcast recipients by audience.
async function resolveBroadcastTargets({ target_type, target_company_ids, target_roles }) {
  let q = supabaseAdmin.from('user_company_roles').select('user_id, company_id, custom_roles(level)').eq('is_active', true);
  if (target_type === 'company' && target_company_ids?.length) q = q.in('company_id', target_company_ids);
  const { data } = await q;
  let rows = data || [];
  if (target_type === 'role' && target_roles?.length) {
    rows = rows.filter(r => target_roles.includes(r.custom_roles?.level));
  }
  return [...new Set(rows.map(r => r.user_id).filter(Boolean))];
}

// ── POST /broadcast — message ALL / by company / by role ──────────────────────
router.post('/broadcast', [
  body('message').isString().trim().notEmpty().isLength({ max: 4000 }),
  body('target_type').optional().isIn(['all', 'company', 'role']),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errs.array() });

  const targetType = req.body.target_type || 'all';
  const targets = await resolveBroadcastTargets({
    target_type: targetType,
    target_company_ids: req.body.target_company_ids,
    target_roles: req.body.target_roles,
  });
  const recipients = targets.filter(id => id !== req.user.id);
  if (!recipients.length) return res.status(400).json({ error: 'No recipients matched' });

  const title = (req.body.title || '').trim() || 'Announcement';
  const { data: conv, error } = await supabaseAdmin
    .from('conversations').insert({ type: 'broadcast', title, created_by: req.user.id }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  await ensureMembers(conv.id, [req.user.id], 'admin');
  await ensureMembers(conv.id, recipients, 'member');

  const { data: msg } = await supabaseAdmin
    .from('messages').insert({ conversation_id: conv.id, sender_id: req.user.id, body: req.body.message.trim() }).select().single();

  const cards = await getUserCards([req.user.id]);
  pushNewMessage({ conversationId: conv.id, senderId: req.user.id, senderName: cards.get(req.user.id)?.name || 'Announcement', body: req.body.message, memberIds: [req.user.id, ...recipients] });

  await logModeration({ actorId: req.user.id, action: 'broadcast', targetConversationId: conv.id, detail: { target_type: targetType, recipients: recipients.length } });
  res.status(201).json({ conversation_id: conv.id, message_id: msg?.id, recipients: recipients.length });
}));

// ── GET /moderation-log — audit trail ─────────────────────────────────────────
router.get('/moderation-log', asyncHandler(async (req, res) => {
  const page  = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 40, 100);
  const from  = (page - 1) * limit;

  const { data, error } = await supabaseAdmin
    .from('chat_moderation_log').select('*')
    .order('created_at', { ascending: false }).range(from, from + limit);
  if (error) return res.status(500).json({ error: error.message });

  const hasMore = (data || []).length > limit;
  const rows = (data || []).slice(0, limit);
  const cards = await getUserCards(rows.flatMap(r => [r.actor_id, r.target_user_id]));

  res.json({
    log: rows.map(r => ({
      ...r,
      actor_name:  cards.get(r.actor_id)?.name || 'System',
      target_name: r.target_user_id ? (cards.get(r.target_user_id)?.name || 'User') : null,
    })),
    page, has_more: hasMore,
  });
}));

// ── PATCH /feature — enable/disable chat per company ──────────────────────────
router.patch('/feature', [
  body('company_id').isUUID(),
  body('is_enabled').isBoolean(),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errs.array() });

  const { company_id, is_enabled } = req.body;
  const now = new Date().toISOString();
  const updates = is_enabled
    ? { is_enabled: true,  enabled_at: now,  enabled_by: req.user.id, disabled_at: null, disabled_by: null, updated_at: now }
    : { is_enabled: false, disabled_at: now, disabled_by: req.user.id, updated_at: now };

  const { data, error } = await supabaseAdmin
    .from('company_feature_flags')
    .upsert({ company_id, feature_key: 'chat', ...updates }, { onConflict: 'company_id,feature_key' })
    .select().single();
  if (error) return res.status(400).json({ error: error.message });

  await logModeration({ actorId: req.user.id, action: 'feature_toggle', detail: { company_id, is_enabled } });
  res.json({ flag: data });
}));

module.exports = router;

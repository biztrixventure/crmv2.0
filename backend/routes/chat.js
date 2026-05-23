/**
 * Chat — user-facing endpoints (membership enforced server-side).
 *
 *   GET    /chat/conversations               — my conversations + last msg + unread
 *   POST   /chat/conversations               — create group OR find-or-create DM
 *   GET    /chat/conversations/:id/messages   — paginated history (cursor on created_at)
 *   POST   /chat/conversations/:id/messages   — send a message (rejects banned/muted/locked)
 *   PATCH  /chat/conversations/:id/read        — mark conversation read
 *   PATCH  /chat/messages/:id                  — edit own message
 *   DELETE /chat/messages/:id                  — soft-delete own message
 *   GET    /chat/users                         — searchable global user directory
 *   GET    /chat/me                            — my chat ban/mute status (banner)
 *
 * All routes run behind authMiddleware + requireFeature('chat') (mounted in server.js).
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { findOrCreateDM, ensureMembers, pushNewMessage, getUserCards, searchDirectory } = require('../utils/chatService');

const router = express.Router();

const MAX_BODY = 4000;

// ── shared helpers ────────────────────────────────────────────────────────────
async function getMembership(conversationId, userId) {
  const { data } = await supabaseAdmin
    .from('conversation_members')
    .select('conversation_id, user_id, member_role, is_muted, last_read_at')
    .eq('conversation_id', conversationId).eq('user_id', userId).maybeSingle();
  return data || null;
}

async function isBanned(userId) {
  const { data } = await supabaseAdmin
    .from('chat_user_settings').select('is_chat_banned').eq('user_id', userId).maybeSingle();
  return !!data?.is_chat_banned;
}

// Resolve a conversation's display title for a given viewer (DM → other member).
function titleFor(conv, memberCards, viewerId) {
  if (conv.type !== 'dm') return conv.title || (conv.type === 'broadcast' ? 'Announcement' : 'Group');
  const other = memberCards.find(c => c.id !== viewerId);
  return other?.name || 'Direct message';
}

// ── GET /chat/me — ban/mute status for the banner ─────────────────────────────
router.get('/me', asyncHandler(async (req, res) => {
  const { data } = await supabaseAdmin
    .from('chat_user_settings')
    .select('is_chat_banned, ban_reason')
    .eq('user_id', req.user.id).maybeSingle();
  res.json({ is_chat_banned: !!data?.is_chat_banned, ban_reason: data?.ban_reason || null });
}));

// ── GET /chat/users — global directory for the new-chat picker ────────────────
router.get('/users', asyncHandler(async (req, res) => {
  const users = await searchDirectory({ q: req.query.q, excludeId: req.user.id, limit: 50 });
  res.json({ users });
}));

// ── GET /chat/conversations ───────────────────────────────────────────────────
router.get('/conversations', asyncHandler(async (req, res) => {
  const uid = req.user.id;

  const { data: myMemberships } = await supabaseAdmin
    .from('conversation_members')
    .select('conversation_id, last_read_at, is_muted')
    .eq('user_id', uid);

  const convIds = (myMemberships || []).map(m => m.conversation_id);
  if (!convIds.length) return res.json({ conversations: [] });

  const myMap = {};
  (myMemberships || []).forEach(m => { myMap[m.conversation_id] = m; });

  const [{ data: convs }, { data: allMembers }] = await Promise.all([
    supabaseAdmin.from('conversations').select('*').in('id', convIds)
      .order('last_message_at', { ascending: false }).limit(100),
    supabaseAdmin.from('conversation_members').select('conversation_id, user_id').in('conversation_id', convIds),
  ]);

  const membersByConv = {};
  const allUserIds = new Set();
  (allMembers || []).forEach(m => {
    (membersByConv[m.conversation_id] = membersByConv[m.conversation_id] || []).push(m.user_id);
    allUserIds.add(m.user_id);
  });
  const cards = await getUserCards([...allUserIds]);

  // Last message + unread count per conversation (parallel; few rows each).
  const enriched = await Promise.all((convs || []).map(async (conv) => {
    const myMem = myMap[conv.id] || {};
    const memberCards = (membersByConv[conv.id] || []).map(id => cards.get(id)).filter(Boolean);

    const lastMsgQ = supabaseAdmin
      .from('messages').select('id, body, created_at, sender_id, deleted_at')
      .eq('conversation_id', conv.id).order('created_at', { ascending: false }).limit(1).maybeSingle();

    let unreadQ = supabaseAdmin
      .from('messages').select('id', { count: 'exact', head: true })
      .eq('conversation_id', conv.id).is('deleted_at', null).neq('sender_id', uid);
    if (myMem.last_read_at) unreadQ = unreadQ.gt('created_at', myMem.last_read_at);

    const [{ data: lastMsg }, { count: unread }] = await Promise.all([lastMsgQ, unreadQ]);

    return {
      id: conv.id,
      type: conv.type,
      title: titleFor(conv, memberCards, uid),
      is_locked: conv.is_locked,
      is_muted: myMem.is_muted || false,
      last_message_at: conv.last_message_at,
      unread: unread || 0,
      members: memberCards,
      other: conv.type === 'dm' ? memberCards.find(c => c.id !== uid) || null : null,
      last_message: lastMsg
        ? { body: lastMsg.deleted_at ? null : lastMsg.body, created_at: lastMsg.created_at, sender_id: lastMsg.sender_id, deleted: !!lastMsg.deleted_at }
        : null,
    };
  }));

  res.json({ conversations: enriched });
}));

// ── POST /chat/conversations — DM (find-or-create) or group ───────────────────
router.post('/conversations', [
  body('type').isIn(['dm', 'group']),
  body('member_ids').isArray({ min: 1 }),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errs.array() });
  if (await isBanned(req.user.id)) return res.status(403).json({ error: 'You are banned from chat' });

  const uid = req.user.id;
  const memberIds = [...new Set(req.body.member_ids.filter(Boolean))];

  if (req.body.type === 'dm') {
    const other = memberIds.find(id => id !== uid);
    if (!other) return res.status(400).json({ error: 'A DM needs another user' });
    const conv = await findOrCreateDM(uid, other);
    return res.status(201).json({ conversation: conv });
  }

  // group
  const others = memberIds.filter(id => id !== uid);
  if (!others.length) return res.status(400).json({ error: 'A group needs at least one other member' });
  const title = (req.body.title || '').trim() || 'Group';

  const { data: conv, error } = await supabaseAdmin
    .from('conversations').insert({ type: 'group', title, created_by: uid }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  await ensureMembers(conv.id, [uid], 'admin');
  await ensureMembers(conv.id, others, 'member');
  res.status(201).json({ conversation: conv });
}));

// ── GET /chat/conversations/:id/messages — paginated history ──────────────────
router.get('/conversations/:id/messages', asyncHandler(async (req, res) => {
  const membership = await getMembership(req.params.id, req.user.id);
  if (!membership) return res.status(403).json({ error: 'Not a member of this conversation' });

  const limit = Math.min(parseInt(req.query.limit, 10) || 30, 50);
  let q = supabaseAdmin
    .from('messages')
    .select('id, conversation_id, sender_id, body, created_at, edited_at, deleted_at')
    .eq('conversation_id', req.params.id)
    .order('created_at', { ascending: false })
    .limit(limit + 1);
  if (req.query.before) q = q.lt('created_at', req.query.before);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const hasMore = (data || []).length > limit;
  const page = (data || []).slice(0, limit);
  const cards = await getUserCards(page.map(m => m.sender_id));

  // Reactions for this page, grouped per message as [{ emoji, user_ids }].
  const ids = page.map(m => m.id);
  const reactionsByMsg = {};
  if (ids.length) {
    const { data: rx } = await supabaseAdmin
      .from('message_reactions').select('message_id, user_id, emoji').in('message_id', ids);
    (rx || []).forEach(r => {
      (reactionsByMsg[r.message_id] = reactionsByMsg[r.message_id] || {});
      (reactionsByMsg[r.message_id][r.emoji] = reactionsByMsg[r.message_id][r.emoji] || []).push(r.user_id);
    });
  }

  // Return chronological (oldest → newest) for straightforward rendering.
  const messages = page.reverse().map(m => ({
    id: m.id,
    conversation_id: m.conversation_id,
    sender_id: m.sender_id,
    sender_name: cards.get(m.sender_id)?.name || 'User',
    body: m.deleted_at ? null : m.body,
    deleted: !!m.deleted_at,
    edited: !!m.edited_at,
    created_at: m.created_at,
    reactions: Object.entries(reactionsByMsg[m.id] || {}).map(([emoji, user_ids]) => ({ emoji, user_ids })),
  }));

  res.json({ messages, has_more: hasMore, next_cursor: page.length ? page[0].created_at : null });
}));

// ── POST /chat/messages/:id/react — toggle an emoji reaction ──────────────────
router.post('/messages/:id/react', [
  body('emoji').isString().trim().notEmpty().isLength({ max: 16 }),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'Invalid emoji' });

  const { data: msg } = await supabaseAdmin
    .from('messages').select('id, conversation_id').eq('id', req.params.id).maybeSingle();
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  if (!(await getMembership(msg.conversation_id, req.user.id))) return res.status(403).json({ error: 'Not a member of this conversation' });

  const emoji = req.body.emoji.trim();
  const { data: existing } = await supabaseAdmin
    .from('message_reactions').select('message_id')
    .eq('message_id', msg.id).eq('user_id', req.user.id).eq('emoji', emoji).maybeSingle();

  let reacted;
  if (existing) {
    await supabaseAdmin.from('message_reactions').delete().eq('message_id', msg.id).eq('user_id', req.user.id).eq('emoji', emoji);
    reacted = false;
  } else {
    await supabaseAdmin.from('message_reactions').insert({ message_id: msg.id, user_id: req.user.id, emoji });
    reacted = true;
  }
  res.json({ message_id: msg.id, emoji, reacted });
}));

// ── POST /chat/conversations/:id/messages — send ──────────────────────────────
router.post('/conversations/:id/messages', [
  body('body').isString().trim().notEmpty().isLength({ max: MAX_BODY }),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'Message is empty or too long' });

  const convId = req.params.id;
  const uid = req.user.id;

  const [membership, { data: conv }, banned] = await Promise.all([
    getMembership(convId, uid),
    supabaseAdmin.from('conversations').select('id, is_locked, type').eq('id', convId).maybeSingle(),
    isBanned(uid),
  ]);

  if (!membership || !conv) return res.status(403).json({ error: 'Not a member of this conversation' });
  if (banned)            return res.status(403).json({ error: 'You are banned from chat' });
  if (conv.is_locked)    return res.status(403).json({ error: 'This room is locked' });
  if (membership.is_muted) return res.status(403).json({ error: 'You are muted in this conversation' });
  // Broadcasts are one-way: only an admin member (the superadmin who sent it) may post.
  if (conv.type === 'broadcast' && membership.member_role !== 'admin') {
    return res.status(403).json({ error: 'This is a broadcast announcement — replies are disabled.' });
  }

  const { data: msg, error } = await supabaseAdmin
    .from('messages')
    .insert({ conversation_id: convId, sender_id: uid, body: req.body.body.trim() })
    .select('id, conversation_id, sender_id, body, created_at, edited_at, deleted_at').single();
  if (error) return res.status(500).json({ error: error.message });

  // Sender card + member ids for push (fire-and-forget).
  const { data: members } = await supabaseAdmin
    .from('conversation_members').select('user_id').eq('conversation_id', convId);
  const memberIds = (members || []).map(m => m.user_id);
  const cards = await getUserCards([uid]);
  const senderName = cards.get(uid)?.name || 'New message';

  pushNewMessage({ conversationId: convId, senderId: uid, senderName, body: msg.body, memberIds });

  res.status(201).json({
    message: {
      id: msg.id, conversation_id: msg.conversation_id, sender_id: msg.sender_id,
      sender_name: senderName, body: msg.body, deleted: false, edited: false, created_at: msg.created_at,
    },
  });
}));

// ── PATCH /chat/conversations/:id/read ────────────────────────────────────────
router.patch('/conversations/:id/read', asyncHandler(async (req, res) => {
  const membership = await getMembership(req.params.id, req.user.id);
  if (!membership) return res.status(403).json({ error: 'Not a member of this conversation' });

  const { error } = await supabaseAdmin
    .from('conversation_members')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'ok' });
}));

// ── PATCH /chat/messages/:id — edit own message ───────────────────────────────
router.patch('/messages/:id', [
  body('body').isString().trim().notEmpty().isLength({ max: MAX_BODY }),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'Message is empty or too long' });

  const { data: existing } = await supabaseAdmin
    .from('messages').select('id, sender_id, deleted_at').eq('id', req.params.id).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Message not found' });
  if (existing.sender_id !== req.user.id) return res.status(403).json({ error: 'You can only edit your own messages' });
  if (existing.deleted_at) return res.status(400).json({ error: 'Cannot edit a deleted message' });

  const { data, error } = await supabaseAdmin
    .from('messages')
    .update({ body: req.body.body.trim(), edited_at: new Date().toISOString() })
    .eq('id', req.params.id).select('id, conversation_id, sender_id, body, created_at, edited_at').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: { ...data, deleted: false, edited: true } });
}));

// ── DELETE /chat/messages/:id — soft-delete own message ───────────────────────
router.delete('/messages/:id', asyncHandler(async (req, res) => {
  const { data: existing } = await supabaseAdmin
    .from('messages').select('id, sender_id').eq('id', req.params.id).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Message not found' });
  if (existing.sender_id !== req.user.id) return res.status(403).json({ error: 'You can only delete your own messages' });

  const { error } = await supabaseAdmin
    .from('messages')
    .update({ deleted_at: new Date().toISOString(), deleted_by: req.user.id })
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'deleted' });
}));

module.exports = router;

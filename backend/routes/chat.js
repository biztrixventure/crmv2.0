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
const { findOrCreateDM, ensureMembers, pushNewMessage, pushMentions, createInvites, getUserCards, searchDirectory } = require('../utils/chatService');

const router = express.Router();

const MAX_BODY = 4000;
const MAX_HTML = 40000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;   // 10MB
const ATTACH_BUCKET = 'chat-attachments';

// Defence-in-depth server-side scrub. The authoritative XSS control is the
// client rendering every message through DOMPurify, but we still strip the
// obvious script/handler vectors before persisting.
function scrubHtml(html) {
  if (!html || typeof html !== 'string') return null;
  return html
    .replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/<\s*\/?(iframe|object|embed|link|meta|style|form)[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '')
    .slice(0, MAX_HTML);
}

// Normalize a client-supplied attachments array into trusted rows. URLs are
// restricted to http(s) so a crafted javascript:/data: link can't be rendered.
function cleanAttachments(input) {
  if (!Array.isArray(input)) return null;
  const out = input.slice(0, 10).map(a => ({
    url:  String(a?.url || '').slice(0, 2000),
    name: String(a?.name || 'file').slice(0, 255),
    type: String(a?.type || '').slice(0, 120),
    size: Number(a?.size) || 0,
    kind: a?.kind === 'image' ? 'image' : 'file',
  })).filter(a => /^https?:\/\//i.test(a.url));
  return out.length ? out : null;
}

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
    .select('conversation_id, last_read_at, is_muted, member_role')
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
      description: conv.description || null,
      image_url: conv.image_url || null,
      only_admins_post: !!conv.only_admins_post,
      is_locked: conv.is_locked,
      is_muted: myMem.is_muted || false,
      my_role: myMem.member_role || 'member',
      last_message_at: conv.last_message_at,
      unread: unread || 0,
      members: memberCards,
      other: conv.type === 'dm' ? memberCards.find(c => c.id !== uid) || null : null,
      last_message: lastMsg
        ? { body: lastMsg.deleted_at ? null : lastMsg.body, created_at: lastMsg.created_at, sender_id: lastMsg.sender_id, deleted: !!lastMsg.deleted_at }
        : null,
    };
  }));

  // A DM only belongs in the recent list once it has at least one message — a
  // freshly-clicked-but-unspoken DM stays hidden until someone actually sends.
  // (Groups/broadcasts are deliberately created, so they always show.)
  const visible = enriched.filter(c => !(c.type === 'dm' && !c.last_message));

  res.json({ conversations: visible });
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

  // group — the creator is the sole admin; everyone else is INVITED, not added.
  // They join only after accepting their invite.
  const others = memberIds.filter(id => id !== uid);
  const title = (req.body.title || '').trim() || 'Group';

  const { data: conv, error } = await supabaseAdmin
    .from('conversations').insert({ type: 'group', title, created_by: uid }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  await ensureMembers(conv.id, [uid], 'admin');
  const invited = await createInvites(conv.id, uid, others);
  res.status(201).json({ conversation: conv, invited });
}));

// ── POST /chat/conversations/:id/invites — admin invites users to a group ──────
router.post('/conversations/:id/invites', [
  body('invitee_ids').isArray({ min: 1 }),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'invitee_ids array required' });

  const convId = req.params.id;
  const [membership, { data: conv }] = await Promise.all([
    getMembership(convId, req.user.id),
    supabaseAdmin.from('conversations').select('id, type').eq('id', convId).maybeSingle(),
  ]);
  if (!membership || !conv) return res.status(403).json({ error: 'Not a member of this conversation' });
  if (conv.type !== 'group') return res.status(400).json({ error: 'Only groups support invites' });
  if (membership.member_role !== 'admin') return res.status(403).json({ error: 'Only the group admin can invite members' });

  const invited = await createInvites(convId, req.user.id, req.body.invitee_ids);
  res.status(201).json({ invited });
}));

// ── GET /chat/invites — my pending group invitations ──────────────────────────
router.get('/invites', asyncHandler(async (req, res) => {
  const { data: invites } = await supabaseAdmin
    .from('conversation_invites')
    .select('id, conversation_id, inviter_id, created_at')
    .eq('invitee_id', req.user.id).eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (!invites?.length) return res.json({ invites: [] });

  const convIds = [...new Set(invites.map(i => i.conversation_id))];
  const [{ data: convs }, cards] = await Promise.all([
    supabaseAdmin.from('conversations').select('id, title, type').in('id', convIds),
    getUserCards(invites.map(i => i.inviter_id)),
  ]);
  const convById = Object.fromEntries((convs || []).map(c => [c.id, c]));

  res.json({
    invites: invites
      .filter(i => convById[i.conversation_id])               // skip deleted groups
      .map(i => ({
        id: i.id,
        conversation_id: i.conversation_id,
        group_title: convById[i.conversation_id]?.title || 'Group',
        inviter_name: cards.get(i.inviter_id)?.name || 'Someone',
        created_at: i.created_at,
      })),
  });
}));

// ── POST /chat/invites/:id/accept — join the group ────────────────────────────
router.post('/invites/:id/accept', asyncHandler(async (req, res) => {
  const { data: invite } = await supabaseAdmin
    .from('conversation_invites').select('*').eq('id', req.params.id).maybeSingle();
  if (!invite || invite.invitee_id !== req.user.id) return res.status(404).json({ error: 'Invite not found' });
  if (invite.status !== 'pending') return res.status(400).json({ error: 'Invite already handled' });

  await ensureMembers(invite.conversation_id, [req.user.id], 'member');
  await supabaseAdmin.from('conversation_invites')
    .update({ status: 'accepted', responded_at: new Date().toISOString() }).eq('id', invite.id);

  const { data: conv } = await supabaseAdmin
    .from('conversations').select('*').eq('id', invite.conversation_id).maybeSingle();
  res.json({ conversation: conv });
}));

// ── POST /chat/invites/:id/decline ────────────────────────────────────────────
router.post('/invites/:id/decline', asyncHandler(async (req, res) => {
  const { data: invite } = await supabaseAdmin
    .from('conversation_invites').select('id, invitee_id, status').eq('id', req.params.id).maybeSingle();
  if (!invite || invite.invitee_id !== req.user.id) return res.status(404).json({ error: 'Invite not found' });

  await supabaseAdmin.from('conversation_invites')
    .update({ status: 'declined', responded_at: new Date().toISOString() }).eq('id', invite.id);
  res.json({ message: 'declined' });
}));

// ── POST /chat/upload — base64 file → Supabase Storage → public URL ───────────
router.post('/upload', [
  body('data').isString().notEmpty(),
  body('name').isString().trim().notEmpty(),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'data and name are required' });
  if (await isBanned(req.user.id)) return res.status(403).json({ error: 'You are banned from chat' });

  // Accept either a bare base64 string or a data URL.
  const raw = req.body.data.includes(',') ? req.body.data.split(',').pop() : req.body.data;
  let buffer;
  try { buffer = Buffer.from(raw, 'base64'); } catch { return res.status(400).json({ error: 'Invalid file data' }); }
  if (!buffer.length)               return res.status(400).json({ error: 'Empty file' });
  if (buffer.length > MAX_FILE_BYTES) return res.status(400).json({ error: 'File exceeds the 10MB limit' });

  const type = String(req.body.type || 'application/octet-stream').slice(0, 120);
  const safeName = req.body.name.replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'file';
  const path = `${req.user.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}`;

  const { error: upErr } = await supabaseAdmin.storage
    .from(ATTACH_BUCKET).upload(path, buffer, { contentType: type, upsert: false });
  if (upErr) return res.status(500).json({ error: upErr.message });

  const { data: pub } = supabaseAdmin.storage.from(ATTACH_BUCKET).getPublicUrl(path);
  res.status(201).json({
    attachment: {
      url: pub.publicUrl, name: req.body.name.slice(0, 255), type, size: buffer.length,
      kind: type.startsWith('image/') ? 'image' : 'file',
    },
  });
}));

// ── GET /chat/conversations/:id — group detail (members + roles + settings) ───
router.get('/conversations/:id', asyncHandler(async (req, res) => {
  const convId = req.params.id;
  const membership = await getMembership(convId, req.user.id);
  if (!membership) return res.status(403).json({ error: 'Not a member of this conversation' });

  const [{ data: conv }, { data: memberRows }] = await Promise.all([
    supabaseAdmin.from('conversations').select('*').eq('id', convId).maybeSingle(),
    supabaseAdmin.from('conversation_members').select('user_id, member_role, joined_at')
      .eq('conversation_id', convId).order('joined_at', { ascending: true }),
  ]);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  const cards = await getUserCards((memberRows || []).map(m => m.user_id));
  const members = (memberRows || []).map(m => ({
    ...(cards.get(m.user_id) || { id: m.user_id, name: 'User', role: '', company: '' }),
    member_role: m.member_role,
    joined_at: m.joined_at,
  }));

  res.json({
    conversation: {
      id: conv.id, type: conv.type, title: conv.title,
      description: conv.description || null, image_url: conv.image_url || null,
      only_admins_post: !!conv.only_admins_post, is_locked: conv.is_locked,
      my_role: membership.member_role, created_by: conv.created_by, members,
    },
  });
}));

// ── PATCH /chat/conversations/:id — admin edits name/description/logo/policy ───
router.patch('/conversations/:id', asyncHandler(async (req, res) => {
  const convId = req.params.id;
  const [membership, { data: conv }] = await Promise.all([
    getMembership(convId, req.user.id),
    supabaseAdmin.from('conversations').select('id, type').eq('id', convId).maybeSingle(),
  ]);
  if (!membership || !conv) return res.status(403).json({ error: 'Not a member of this conversation' });
  if (conv.type !== 'group') return res.status(400).json({ error: 'Only groups can be edited' });
  if (membership.member_role !== 'admin') return res.status(403).json({ error: 'Only the group admin can change group settings' });

  const updates = { updated_at: new Date().toISOString() };
  if (req.body.title       !== undefined) updates.title            = String(req.body.title).trim().slice(0, 120) || 'Group';
  if (req.body.description !== undefined) updates.description      = req.body.description ? String(req.body.description).slice(0, 1000) : null;
  if (req.body.image_url   !== undefined) updates.image_url        = req.body.image_url ? String(req.body.image_url).slice(0, 2000) : null;
  if (req.body.only_admins_post !== undefined) updates.only_admins_post = req.body.only_admins_post === true;

  const { data, error } = await supabaseAdmin
    .from('conversations').update(updates).eq('id', convId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ conversation: data });
}));

// ── DELETE /chat/conversations/:id — admin deletes the group for everyone ──────
router.delete('/conversations/:id', asyncHandler(async (req, res) => {
  const convId = req.params.id;
  const [membership, { data: conv }] = await Promise.all([
    getMembership(convId, req.user.id),
    supabaseAdmin.from('conversations').select('id, type').eq('id', convId).maybeSingle(),
  ]);
  if (!membership || !conv) return res.status(403).json({ error: 'Not a member of this conversation' });
  if (conv.type !== 'group') return res.status(400).json({ error: 'Only groups can be deleted' });
  if (membership.member_role !== 'admin') return res.status(403).json({ error: 'Only the group admin can delete the group' });

  // ON DELETE CASCADE clears members, messages, reactions and invites.
  const { error } = await supabaseAdmin.from('conversations').delete().eq('id', convId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'deleted' });
}));

// ── POST /chat/conversations/:id/leave — leave a group (admin succession) ─────
router.post('/conversations/:id/leave', asyncHandler(async (req, res) => {
  const convId = req.params.id;
  const uid = req.user.id;
  const [membership, { data: conv }] = await Promise.all([
    getMembership(convId, uid),
    supabaseAdmin.from('conversations').select('id, type').eq('id', convId).maybeSingle(),
  ]);
  if (!membership || !conv) return res.status(403).json({ error: 'Not a member of this conversation' });
  if (conv.type !== 'group') return res.status(400).json({ error: 'Only groups can be left' });

  await supabaseAdmin.from('conversation_members').delete()
    .eq('conversation_id', convId).eq('user_id', uid);

  // Admin succession: promote a remaining member so the group always has an admin.
  if (membership.member_role === 'admin') {
    const { data: remaining } = await supabaseAdmin
      .from('conversation_members').select('user_id, member_role, joined_at')
      .eq('conversation_id', convId).order('joined_at', { ascending: true });

    if (!remaining?.length) {
      // Last person out — remove the empty group entirely.
      await supabaseAdmin.from('conversations').delete().eq('id', convId);
      return res.json({ left: true, deleted: true });
    }
    if (!remaining.some(m => m.member_role === 'admin')) {
      // Designated successor (if a valid remaining member) else the longest-standing one.
      const pick = remaining.find(m => m.user_id === req.body?.new_admin_id) || remaining[0];
      await supabaseAdmin.from('conversation_members')
        .update({ member_role: 'admin' }).eq('conversation_id', convId).eq('user_id', pick.user_id);
    }
  }
  res.json({ left: true });
}));

// ── DELETE /chat/conversations/:id/members/:userId — admin removes a member ───
router.delete('/conversations/:id/members/:userId', asyncHandler(async (req, res) => {
  const { id: convId, userId } = req.params;
  const [membership, { data: conv }] = await Promise.all([
    getMembership(convId, req.user.id),
    supabaseAdmin.from('conversations').select('id, type').eq('id', convId).maybeSingle(),
  ]);
  if (!membership || !conv) return res.status(403).json({ error: 'Not a member of this conversation' });
  if (conv.type !== 'group') return res.status(400).json({ error: 'Only group members can be removed' });
  if (membership.member_role !== 'admin') return res.status(403).json({ error: 'Only the group admin can remove members' });
  if (userId === req.user.id) return res.status(400).json({ error: 'Use “Leave group” to remove yourself' });

  await supabaseAdmin.from('conversation_members').delete()
    .eq('conversation_id', convId).eq('user_id', userId);
  // Drop any stale pending invite so they can be re-invited cleanly.
  await supabaseAdmin.from('conversation_invites').delete()
    .eq('conversation_id', convId).eq('invitee_id', userId);
  res.json({ message: 'removed' });
}));

// ── POST /chat/conversations/:id/members/:userId/promote — make co-admin ──────
router.post('/conversations/:id/members/:userId/promote', asyncHandler(async (req, res) => {
  const { id: convId, userId } = req.params;
  const membership = await getMembership(convId, req.user.id);
  if (!membership) return res.status(403).json({ error: 'Not a member of this conversation' });
  if (membership.member_role !== 'admin') return res.status(403).json({ error: 'Only an admin can promote members' });

  const target = await getMembership(convId, userId);
  if (!target) return res.status(404).json({ error: 'That user is not a member' });

  await supabaseAdmin.from('conversation_members')
    .update({ member_role: 'admin' }).eq('conversation_id', convId).eq('user_id', userId);
  res.json({ message: 'promoted' });
}));

// ── GET /chat/conversations/:id/messages — paginated history ──────────────────
router.get('/conversations/:id/messages', asyncHandler(async (req, res) => {
  const membership = await getMembership(req.params.id, req.user.id);
  if (!membership) return res.status(403).json({ error: 'Not a member of this conversation' });

  const limit = Math.min(parseInt(req.query.limit, 10) || 30, 50);
  let q = supabaseAdmin
    .from('messages')
    .select('id, conversation_id, sender_id, body, body_html, attachments, mentions, created_at, edited_at, deleted_at')
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
    body_html: m.deleted_at ? null : (m.body_html || null),
    attachments: m.deleted_at ? null : (m.attachments || null),
    mentions: m.mentions || null,
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
// Accepts plain `body`, rich `body_html`, `attachments[]`, and `mentions[]`.
// A message is valid if it has any text OR at least one attachment.
router.post('/conversations/:id/messages', [
  body('body').optional({ nullable: true }).isString().isLength({ max: MAX_BODY }),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'Message text is too long' });

  const convId = req.params.id;
  const uid = req.user.id;

  const text        = (req.body.body || '').trim();
  const html        = scrubHtml(req.body.body_html);
  const attachments = cleanAttachments(req.body.attachments);
  const mentions    = Array.isArray(req.body.mentions)
    ? [...new Set(req.body.mentions.filter(id => typeof id === 'string'))].slice(0, 50)
    : null;

  if (!text && !attachments) return res.status(400).json({ error: 'Message is empty' });

  const [membership, { data: conv }, banned] = await Promise.all([
    getMembership(convId, uid),
    supabaseAdmin.from('conversations').select('id, is_locked, type, title, only_admins_post').eq('id', convId).maybeSingle(),
    isBanned(uid),
  ]);

  if (!membership || !conv) return res.status(403).json({ error: 'Not a member of this conversation' });
  if (banned)            return res.status(403).json({ error: 'You are banned from chat' });
  if (conv.is_locked)    return res.status(403).json({ error: 'This room is locked' });
  if (membership.is_muted) return res.status(403).json({ error: 'You are muted in this conversation' });
  // Group "only admins can post" policy.
  if (conv.type === 'group' && conv.only_admins_post && membership.member_role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can post in this group' });
  }
  // Broadcasts are one-way: only an admin member (the superadmin who sent it) may post.
  if (conv.type === 'broadcast' && membership.member_role !== 'admin') {
    return res.status(403).json({ error: 'This is a broadcast announcement — replies are disabled.' });
  }

  const { data: msg, error } = await supabaseAdmin
    .from('messages')
    .insert({ conversation_id: convId, sender_id: uid, body: text || null, body_html: html, attachments, mentions })
    .select('id, conversation_id, sender_id, body, body_html, attachments, mentions, created_at, edited_at, deleted_at').single();
  if (error) return res.status(500).json({ error: error.message });

  // Sender card + member ids for push (fire-and-forget).
  const { data: members } = await supabaseAdmin
    .from('conversation_members').select('user_id').eq('conversation_id', convId);
  const memberIds = (members || []).map(m => m.user_id);
  const cards = await getUserCards([uid]);
  const senderName = cards.get(uid)?.name || 'New message';
  const preview = text || (attachments ? `📎 ${attachments.length} attachment${attachments.length > 1 ? 's' : ''}` : '');

  pushNewMessage({ conversationId: convId, senderId: uid, senderName, body: preview, memberIds });
  if (mentions?.length) {
    pushMentions({ conversationId: convId, senderId: uid, senderName, convTitle: conv.title, mentionIds: mentions, body: preview });
  }

  res.status(201).json({
    message: {
      id: msg.id, conversation_id: msg.conversation_id, sender_id: msg.sender_id,
      sender_name: senderName, body: msg.body, body_html: msg.body_html, attachments: msg.attachments,
      mentions: msg.mentions, deleted: false, edited: false, created_at: msg.created_at,
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

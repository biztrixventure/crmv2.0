/**
 * Guest (outsider) chat — PUBLIC, token-authenticated (no Supabase session).
 * Mounted at /api/guest WITHOUT authMiddleware. The token in the URL IS the
 * credential. A guest is tied to exactly ONE conversation, sees messages only
 * from joined_at onward, and can send plain TEXT only. Superadmin can disable
 * the guest (every route 403s) and re-enable it (same token works again).
 */
const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { getPseudoNames } = require('../utils/pseudonym');

const router = express.Router();
const MAX_BODY = 4000;

// Token → guest row (or null). Token is a long random hex string.
async function resolveGuest(token) {
  if (!token || String(token).length < 16) return null;
  const { data } = await supabaseAdmin.from('chat_guests').select('*').eq('token', token).maybeSingle();
  return data || null;
}

// Messages the guest may see: this conversation, only from joined_at onward,
// oldest→newest. Resolves both internal-user and other-guest sender names.
async function guestMessages(guest, { after } = {}) {
  let q = supabaseAdmin.from('messages')
    .select('id, sender_id, guest_id, body, created_at, edited_at, deleted_at')
    .eq('conversation_id', guest.conversation_id)
    .gte('created_at', guest.joined_at)
    .order('created_at', { ascending: true })
    .limit(200);
  if (after) q = q.gt('created_at', after);
  const { data } = await q;
  const rows = data || [];

  const userIds  = [...new Set(rows.map(m => m.sender_id).filter(Boolean))];
  const guestIds = [...new Set(rows.map(m => m.guest_id).filter(Boolean))];
  // Pseudonyms only — guests never see a real closer/agent name.
  const pseudo = await getPseudoNames(userIds);
  const guestNames = {};
  if (guestIds.length) {
    const { data: gs } = await supabaseAdmin.from('chat_guests').select('id, name').in('id', guestIds);
    (gs || []).forEach(x => { guestNames[x.id] = x.name; });
  }
  return rows.map(m => ({
    id: m.id,
    sender_name: m.guest_id ? (guestNames[m.guest_id] || 'Guest') : (pseudo.get(m.sender_id) || 'Agent'),
    is_guest: !!m.guest_id,
    is_me: m.guest_id === guest.id,
    body: m.deleted_at ? null : m.body,
    deleted: !!m.deleted_at,
    edited: !!m.edited_at,
    created_at: m.created_at,
  }));
}

// GET /api/guest/:token — the guest's whole view (their group + recent messages).
router.get('/:token', asyncHandler(async (req, res) => {
  const guest = await resolveGuest(req.params.token);
  if (!guest)            return res.status(404).json({ error: 'not_found' });
  if (!guest.is_active)  return res.status(403).json({ error: 'disabled', message: 'This chat link has been disabled.' });

  const { data: conv } = await supabaseAdmin
    .from('conversations').select('id, title, is_locked').eq('id', guest.conversation_id).maybeSingle();
  if (!conv) return res.status(404).json({ error: 'not_found' });

  supabaseAdmin.from('chat_guests').update({ last_seen_at: new Date().toISOString() }).eq('id', guest.id).then(() => {}, () => {});
  const messages = await guestMessages(guest);
  res.json({
    guest:        { id: guest.id, name: guest.name },
    conversation: { id: conv.id, title: conv.title || 'Group chat', locked: !!conv.is_locked },
    messages,
  });
}));

// GET /api/guest/:token/poll?after=ISO — new messages since `after` (polling).
router.get('/:token/poll', asyncHandler(async (req, res) => {
  const guest = await resolveGuest(req.params.token);
  if (!guest)           return res.status(404).json({ error: 'not_found' });
  if (!guest.is_active) return res.status(403).json({ error: 'disabled' });
  res.json({ messages: await guestMessages(guest, { after: req.query.after }) });
}));

// POST /api/guest/:token/messages — send a TEXT message as the guest.
router.post('/:token/messages', [
  body('body').isString().trim().notEmpty().isLength({ max: MAX_BODY }),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'Message is empty or too long' });

  const guest = await resolveGuest(req.params.token);
  if (!guest)           return res.status(404).json({ error: 'not_found' });
  if (!guest.is_active) return res.status(403).json({ error: 'disabled', message: 'This chat link has been disabled.' });

  const { data: conv } = await supabaseAdmin
    .from('conversations').select('id, is_locked').eq('id', guest.conversation_id).maybeSingle();
  if (!conv)          return res.status(404).json({ error: 'not_found' });
  if (conv.is_locked) return res.status(403).json({ error: 'locked', message: 'This room is locked.' });

  const text = req.body.body.trim();
  const { data: msg, error } = await supabaseAdmin
    .from('messages')
    .insert({ conversation_id: guest.conversation_id, sender_id: null, guest_id: guest.id, body: text })
    .select('id, created_at').single();
  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json({ message: {
    id: msg.id, sender_name: guest.name, is_guest: true, is_me: true,
    body: text, deleted: false, edited: false, created_at: msg.created_at,
  }});
}));

module.exports = router;

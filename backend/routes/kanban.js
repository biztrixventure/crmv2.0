/**
 * Kanban task boards — temporary, no-login collaboration (kan.bn-style).
 *
 * Mounted at /api/kanban WITHOUT global authMiddleware. Two surfaces:
 *   • Admin (superadmin): create / list / rename / delete boards. These routes
 *     carry authMiddleware + superOnly per-route.
 *   • Public (anyone with the link): the board's share_token IS the credential
 *     — view + edit columns, cards, tags, images. No account. Each writer sends
 *     their display name (author), which is stamped onto what they create.
 *
 * All DB access is via the service-role client; the token is validated in code.
 */
const express = require('express');
const crypto = require('crypto');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { authMiddleware } = require('../middleware/authMiddleware');
const { isSuperAdmin } = require('../models/helpers');

const router = express.Router();

const clip = (s, n) => (s == null ? null : String(s).slice(0, n));
const cleanName = (s) => clip(String(s || '').trim(), 60) || 'Anonymous';
const cleanTags = (t) => Array.isArray(t) ? t.map(x => clip(String(x).trim(), 40)).filter(Boolean).slice(0, 20) : [];

// ── admin guard ───────────────────────────────────────────────────────────────
const superOnly = asyncHandler(async (req, res, next) => {
  if (!(await isSuperAdmin(req.user.id))) return res.status(403).json({ error: 'Superadmin only' });
  next();
});

// ── token → board (public credential) ─────────────────────────────────────────
async function boardByToken(token) {
  if (!token || String(token).length < 10) return null;
  const { data } = await supabaseAdmin.from('kanban_boards').select('*').eq('share_token', token).maybeSingle();
  return data || null;
}
// resolve the board for a public request, or 404. Attaches req.board.
const withBoard = asyncHandler(async (req, res, next) => {
  const board = await boardByToken(req.params.token);
  if (!board) return res.status(404).json({ error: 'Board not found' });
  if (board.archived) return res.status(410).json({ error: 'This board has been archived' });
  req.board = board;
  next();
});

// ════════════════════════ ADMIN (superadmin) ════════════════════════════════
// Create a board (seeds three starter columns) and return its share link token.
router.post('/boards', authMiddleware, superOnly, asyncHandler(async (req, res) => {
  const title = clip(String(req.body?.title || '').trim(), 120) || 'Untitled board';
  const share_token = crypto.randomBytes(18).toString('base64url');   // ~24 chars, URL-safe
  const { data: board, error } = await supabaseAdmin.from('kanban_boards')
    .insert({ title, share_token, created_by: req.user.id }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  const cols = ['To do', 'In progress', 'Done'].map((t, i) => ({ board_id: board.id, title: t, position: i }));
  await supabaseAdmin.from('kanban_columns').insert(cols);
  res.status(201).json({ board });
}));

// List boards (with card counts) for the admin manager.
router.get('/boards', authMiddleware, superOnly, asyncHandler(async (req, res) => {
  const { data: boards } = await supabaseAdmin.from('kanban_boards')
    .select('*').order('created_at', { ascending: false });
  const ids = (boards || []).map(b => b.id);
  const counts = {};
  if (ids.length) {
    const { data: cards } = await supabaseAdmin.from('kanban_cards').select('board_id').in('board_id', ids);
    for (const c of (cards || [])) counts[c.board_id] = (counts[c.board_id] || 0) + 1;
  }
  res.json({ boards: (boards || []).map(b => ({ ...b, card_count: counts[b.id] || 0 })) });
}));

router.patch('/boards/:id', authMiddleware, superOnly, asyncHandler(async (req, res) => {
  const patch = { updated_at: new Date().toISOString() };
  if (req.body?.title !== undefined) patch.title = clip(String(req.body.title).trim(), 120) || 'Untitled board';
  if (req.body?.archived !== undefined) patch.archived = !!req.body.archived;
  const { data, error } = await supabaseAdmin.from('kanban_boards').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ board: data });
}));

router.delete('/boards/:id', authMiddleware, superOnly, asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from('kanban_boards').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

// ════════════════════════ PUBLIC (share token) ══════════════════════════════
// Full board snapshot: board + columns + cards (NO image bytes — only a count).
router.get('/b/:token', withBoard, asyncHandler(async (req, res) => {
  const boardId = req.board.id;
  const [{ data: columns }, { data: cards }, { data: atts }] = await Promise.all([
    supabaseAdmin.from('kanban_columns').select('*').eq('board_id', boardId).order('position', { ascending: true }),
    supabaseAdmin.from('kanban_cards').select('id, column_id, title, description, tags, position, created_by_name, created_at, updated_at').eq('board_id', boardId).order('position', { ascending: true }),
    supabaseAdmin.from('kanban_attachments').select('card_id').eq('board_id', boardId),
  ]);
  const attCount = {};
  for (const a of (atts || [])) attCount[a.card_id] = (attCount[a.card_id] || 0) + 1;
  res.json({
    board: { id: req.board.id, title: req.board.title },
    columns: columns || [],
    cards: (cards || []).map(c => ({ ...c, attachment_count: attCount[c.id] || 0 })),
  });
}));

// ── columns ──
router.post('/b/:token/columns', withBoard, asyncHandler(async (req, res) => {
  const title = clip(String(req.body?.title || '').trim(), 80) || 'New list';
  const { data: last } = await supabaseAdmin.from('kanban_columns').select('position').eq('board_id', req.board.id).order('position', { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await supabaseAdmin.from('kanban_columns')
    .insert({ board_id: req.board.id, title, position: (last?.position ?? -1) + 1 }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ column: data });
}));

router.patch('/b/:token/columns/:id', withBoard, asyncHandler(async (req, res) => {
  const patch = {};
  if (req.body?.title !== undefined) patch.title = clip(String(req.body.title).trim(), 80) || 'List';
  if (req.body?.position !== undefined) patch.position = Number(req.body.position) || 0;
  const { data, error } = await supabaseAdmin.from('kanban_columns').update(patch).eq('id', req.params.id).eq('board_id', req.board.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ column: data });
}));

router.delete('/b/:token/columns/:id', withBoard, asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from('kanban_columns').delete().eq('id', req.params.id).eq('board_id', req.board.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

// ── cards ──
router.post('/b/:token/cards', withBoard, asyncHandler(async (req, res) => {
  const { column_id } = req.body || {};
  if (!column_id) return res.status(400).json({ error: 'column_id required' });
  const title = clip(String(req.body?.title || '').trim(), 300) || 'New task';
  const { data: last } = await supabaseAdmin.from('kanban_cards').select('position').eq('column_id', column_id).order('position', { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await supabaseAdmin.from('kanban_cards').insert({
    board_id: req.board.id, column_id, title,
    description: clip(req.body?.description, 20000),
    tags: cleanTags(req.body?.tags),
    position: (last?.position ?? -1) + 1,
    created_by_name: cleanName(req.body?.author_name),
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ card: { ...data, attachment_count: 0 } });
}));

router.patch('/b/:token/cards/:id', withBoard, asyncHandler(async (req, res) => {
  const patch = { updated_at: new Date().toISOString() };
  if (req.body?.title !== undefined)       patch.title = clip(String(req.body.title).trim(), 300) || 'Task';
  if (req.body?.description !== undefined)  patch.description = clip(req.body.description, 20000);
  if (req.body?.tags !== undefined)         patch.tags = cleanTags(req.body.tags);
  if (req.body?.column_id !== undefined)    patch.column_id = req.body.column_id;
  if (req.body?.position !== undefined)     patch.position = Number(req.body.position) || 0;
  const { data, error } = await supabaseAdmin.from('kanban_cards').update(patch).eq('id', req.params.id).eq('board_id', req.board.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ card: data });
}));

router.delete('/b/:token/cards/:id', withBoard, asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from('kanban_cards').delete().eq('id', req.params.id).eq('board_id', req.board.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

// Bulk reorder after a drag: { moves: [{ id, column_id, position }, ...] }.
router.put('/b/:token/reorder', withBoard, asyncHandler(async (req, res) => {
  const moves = Array.isArray(req.body?.moves) ? req.body.moves.slice(0, 500) : [];
  for (const m of moves) {
    if (!m?.id) continue;
    await supabaseAdmin.from('kanban_cards')
      .update({ column_id: m.column_id, position: Number(m.position) || 0 })
      .eq('id', m.id).eq('board_id', req.board.id);
  }
  res.json({ ok: true });
}));

// ── attachments (images + annotations, stored as base64 data URLs) ──
// The grid list ships only the small thumbnail (thumb_url) — never the full
// bytes — so a card with several screenshots opens fast. Full image is fetched
// on demand (lightbox / annotate) via GET …/attachments/:id/full.
router.get('/b/:token/cards/:id/attachments', withBoard, asyncHandler(async (req, res) => {
  const { data } = await supabaseAdmin.from('kanban_attachments')
    .select('id, name, thumb_url, data_url, created_by_name, created_at').eq('card_id', req.params.id).order('created_at', { ascending: true });
  const attachments = (data || []).map(a => ({
    id: a.id, name: a.name, created_by_name: a.created_by_name, created_at: a.created_at,
    thumb_url: a.thumb_url || a.data_url,        // fall back to full for pre-thumb rows
  }));
  res.json({ attachments });
}));

// Full-resolution image for one attachment (lazy — only when opened/annotated).
router.get('/b/:token/attachments/:id/full', withBoard, asyncHandler(async (req, res) => {
  const { data } = await supabaseAdmin.from('kanban_attachments')
    .select('id, name, data_url').eq('id', req.params.id).eq('board_id', req.board.id).maybeSingle();
  if (!data) return res.status(404).json({ error: 'Not found' });
  res.json({ attachment: data });
}));

const isImg = (u) => /^data:image\/(png|jpe?g|webp|gif);base64,/.test(String(u || ''));

router.post('/b/:token/cards/:id/attachments', withBoard, asyncHandler(async (req, res) => {
  const data_url = String(req.body?.data_url || '');
  const thumb_url = req.body?.thumb_url ? String(req.body.thumb_url) : null;
  if (!isImg(data_url)) return res.status(400).json({ error: 'A base64 image data URL is required' });
  if (data_url.length > 12 * 1024 * 1024) return res.status(413).json({ error: 'Image too large (max ~9 MB)' });
  const { data, error } = await supabaseAdmin.from('kanban_attachments').insert({
    card_id: req.params.id, board_id: req.board.id,
    name: clip(req.body?.name, 200), data_url, thumb_url: isImg(thumb_url) ? thumb_url : null,
    created_by_name: cleanName(req.body?.author_name),
  }).select('id, name, thumb_url, created_by_name, created_at').single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ attachment: { ...data, thumb_url: data.thumb_url || null } });
}));

// Replace an attachment's image in place (annotation save over the same image).
router.put('/b/:token/attachments/:id', withBoard, asyncHandler(async (req, res) => {
  const data_url = String(req.body?.data_url || '');
  const thumb_url = req.body?.thumb_url ? String(req.body.thumb_url) : null;
  if (!isImg(data_url)) return res.status(400).json({ error: 'A base64 image data URL is required' });
  if (data_url.length > 12 * 1024 * 1024) return res.status(413).json({ error: 'Image too large (max ~9 MB)' });
  const patch = { data_url };
  if (isImg(thumb_url)) patch.thumb_url = thumb_url;
  const { data, error } = await supabaseAdmin.from('kanban_attachments')
    .update(patch).eq('id', req.params.id).eq('board_id', req.board.id)
    .select('id, name, thumb_url, created_by_name, created_at').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ attachment: data });
}));

router.delete('/b/:token/attachments/:id', withBoard, asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from('kanban_attachments').delete().eq('id', req.params.id).eq('board_id', req.board.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

module.exports = router;

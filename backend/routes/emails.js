/**
 * Internal email — CRM users mailing each other (no external addresses).
 *
 *   GET    /emails/users               — recipient directory (chat's searchDirectory)
 *   POST   /emails/upload              — base64 attachment → Supabase Storage (chat pattern)
 *   POST   /emails/send                — send (single thread OR bulk fan-out), converts drafts
 *   POST   /emails/drafts              — create draft   (recipients stay in jsonb until send)
 *   PUT    /emails/drafts/:id          — update draft
 *   DELETE /emails/drafts/:id          — discard draft
 *   GET    /emails/folders/:folder     — inbox | sent | drafts | trash (paginated, filtered)
 *   GET    /emails/threads/:id         — full conversation (BCC-safe recipient lists)
 *   GET    /emails/unread-count        — badge count
 *   PATCH  /emails/read                — mark my copies read
 *   PATCH  /emails/:id/folder          — move my copy inbox↔trash (recipient or sender copy)
 *   GET    /emails/templates           — tiered templates (mine/company/global — mig 155 model)
 *   POST   /emails/templates[/mine] …  — template CRUD (same permission model as note_shortcodes)
 *   GET/PUT /emails/signature          — my signature
 *
 * BCC RULE: recipient rows are ONLY ever emitted through visibleRecipients() —
 * the sender sees all rows; a recipient sees to/cc rows plus their OWN row.
 * No endpoint returns email_recipients raw.
 *
 * Realtime: new mail fires notifyUsers → the notifications table INSERT is
 * realtime-published (mig 105 kept it), so clients get the event live and
 * refetch. Email tables are deliberately NOT in the publication (disk-IO).
 *
 * Mounted at /api/emails (authMiddleware + readonlyGuard + requireFeature('internal_email')).
 * Schema: migration 164.
 */
const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');
const { searchDirectory, getUserCards } = require('../utils/chatService');
const notifications = require('../utils/notificationService');
const logger = require('../utils/logger');

const router = express.Router();

const MAX_HTML = 100000;
const MAX_SUBJECT = 300;
const MAX_FILE_BYTES = 10 * 1024 * 1024;   // 10MB (chat's cap)
const ATTACH_BUCKET = 'email-attachments';
const PAGE_MAX = 100;

// Same manager set as note_shortcodes — the spec is "mirror that model exactly".
const MANAGER_ROLES = new Set(['superadmin', 'fronter_manager', 'operations_manager', 'company_admin']);
const canManageTemplates = (req) => MANAGER_ROLES.has(req.user.role);

// ── HTML scrub + attachment whitelist (copied from chat.js — defence in depth;
//    the authoritative XSS control is DOMPurify at render) ────────────────────
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
const stripTags = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// THE BCC rule, in one place. sender sees everything; a recipient sees to/cc
// rows + their own row only (so a BCC'd user sees themselves, nobody else does).
function visibleRecipients(rows, viewerId, senderId) {
  const all = rows || [];
  if (viewerId === senderId) return all;
  return all.filter(r => r.kind !== 'bcc' || r.user_id === viewerId);
}

// Dedupe + sanitize the to/cc/bcc id arrays: a user appears once, with the
// most-visible kind winning (to > cc > bcc); the sender is never a recipient.
function normalizeRecipients(body, senderId) {
  const seen = new Map();
  for (const kind of ['to', 'cc', 'bcc']) {
    const ids = Array.isArray(body[kind]) ? body[kind] : [];
    for (const id of ids) {
      if (typeof id !== 'string' || !id || id === senderId) continue;
      if (!seen.has(id)) seen.set(id, kind);
    }
  }
  return [...seen.entries()].map(([user_id, kind]) => ({ user_id, kind }));
}

// May `uid` post into this thread? = they sent or received something in it.
async function isThreadMember(threadId, uid) {
  const { data: mine } = await supabaseAdmin.from('emails')
    .select('id').eq('thread_id', threadId).eq('sender_id', uid).limit(1);
  if (mine && mine.length) return true;
  const { data: ids } = await supabaseAdmin.from('emails').select('id').eq('thread_id', threadId).limit(200);
  if (!ids || !ids.length) return false;
  const { data: r } = await supabaseAdmin.from('email_recipients')
    .select('id').eq('user_id', uid).in('email_id', ids.map(e => e.id)).limit(1);
  return !!(r && r.length);
}

// ── directory (recipient picker) ──────────────────────────────────────────────
router.get('/users', asyncHandler(async (req, res) => {
  const users = await searchDirectory({
    q: req.query.q, excludeId: req.user.id, limit: 50,
    companyId: req.query.company_id || null, role: req.query.role || null,
  });
  res.json({ users });
}));

// ── attachment upload (chat's exact base64 → bucket flow) ─────────────────────
router.post('/upload', asyncHandler(async (req, res) => {
  const { name, type, data } = req.body || {};
  if (!data || typeof data !== 'string') return res.status(400).json({ error: 'No file data' });
  const b64 = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data;
  let buffer;
  try { buffer = Buffer.from(b64, 'base64'); } catch { return res.status(400).json({ error: 'Bad file data' }); }
  if (!buffer.length) return res.status(400).json({ error: 'Empty file' });
  if (buffer.length > MAX_FILE_BYTES) return res.status(400).json({ error: 'File exceeds the 10MB limit' });
  const safeName = String(name || 'file').replace(/[^\w.\-]+/g, '_').slice(0, 120);
  const path = `${req.user.id}/${Date.now()}_${safeName}`;
  const contentType = String(type || 'application/octet-stream').slice(0, 120);
  const { error: upErr } = await supabaseAdmin.storage
    .from(ATTACH_BUCKET).upload(path, buffer, { contentType, upsert: false });
  if (upErr) return res.status(500).json({ error: upErr.message });
  const { data: pub } = supabaseAdmin.storage.from(ATTACH_BUCKET).getPublicUrl(path);
  res.status(201).json({ attachment: {
    url: pub.publicUrl, name: safeName, type: contentType, size: buffer.length,
    kind: contentType.startsWith('image/') ? 'image' : 'file',
  } });
}));

// ── send ──────────────────────────────────────────────────────────────────────
// Single mode: one email + one bulk recipient insert (to/cc/bcc).
// Bulk mode (fan-out): N emails (own thread each, shared bulk_group_id) — each
// recipient sees ONLY themselves; replies come back to the sender individually.
// Write path is set-based: 1 emails insert + 1 recipients insert, never a loop.
router.post('/send', asyncHandler(async (req, res) => {
  const me = req.user.id;
  const subject = String(req.body.subject || '').trim().slice(0, MAX_SUBJECT);
  const bodyHtml = scrubHtml(req.body.body_html);
  const bodyText = String(req.body.body_text || '').trim().slice(0, 20000) || stripTags(bodyHtml).slice(0, 20000);
  const attachments = cleanAttachments(req.body.attachments);
  const recips = normalizeRecipients(req.body, me);
  const bulk = !!req.body.bulk;

  if (!recips.length) return res.status(400).json({ error: 'Add at least one recipient' });
  if (!subject && !bodyText && !attachments) return res.status(400).json({ error: 'Email is empty' });
  if (recips.length > 500) return res.status(400).json({ error: 'Too many recipients (max 500)' });

  // recipients must be real users (one set-based check)
  const ids = recips.map(r => r.user_id);
  const { data: profs } = await supabaseAdmin.from('user_profiles').select('user_id').in('user_id', ids);
  const known = new Set((profs || []).map(p => p.user_id));
  const bad = ids.filter(id => !known.has(id));
  if (bad.length) return res.status(400).json({ error: `Unknown recipient(s): ${bad.length}` });

  const now = new Date().toISOString();
  const cards = await getUserCards([me]);
  const senderName = cards.get(me)?.name || 'A colleague';
  const preview = (bodyText || subject || 'New message').slice(0, 140);

  // Reply/forward → into an existing thread (must be a member).
  let threadId = req.body.thread_id || null;
  const replyTo = req.body.reply_to_email_id || null;
  if (threadId && !bulk) {
    if (!(await isThreadMember(threadId, me))) return res.status(403).json({ error: 'Not part of that conversation' });
  } else {
    threadId = null;   // bulk always fans out into fresh threads
  }

  let sentEmails = [];
  if (bulk && recips.length > 1) {
    // ── fan-out: N threads + N emails + N recipient rows, three bulk statements ──
    const bulkGroupId = require('crypto').randomUUID();
    const { data: threads, error: tErr } = await supabaseAdmin.from('email_threads')
      .insert(recips.map(() => ({ subject, created_by: me, last_email_at: now }))).select('id');
    if (tErr) return res.status(500).json({ error: tErr.message });
    const { data: rows, error: eErr } = await supabaseAdmin.from('emails').insert(recips.map((r, i) => ({
      thread_id: threads[i].id, sender_id: me, company_id: req.user.company_id || null,
      subject, body_html: bodyHtml, body_text: bodyText, attachments,
      status: 'sent', bulk_group_id: bulkGroupId, sent_at: now,
    }))).select('id, thread_id');
    if (eErr) return res.status(500).json({ error: eErr.message });
    const { error: rErr } = await supabaseAdmin.from('email_recipients').insert(rows.map((e, i) => ({
      email_id: e.id, user_id: recips[i].user_id, kind: 'to', sent_at: now,
    })));
    if (rErr) return res.status(500).json({ error: rErr.message });
    sentEmails = rows;
    notifications.notifyUsers(ids, {
      type: 'email_received', title: `New mail: ${subject || '(no subject)'}`,
      message: `${senderName} — ${preview}`, companyId: req.user.company_id || null,
      data: { kind: 'internal_email', bulk_group_id: bulkGroupId }, dedupBase: `email_${bulkGroupId}`,
    }).catch(() => {});
  } else {
    // ── single email (group visibility per to/cc/bcc) ──
    if (!threadId) {
      const { data: th, error: tErr } = await supabaseAdmin.from('email_threads')
        .insert({ subject, created_by: me, last_email_at: now }).select('id').single();
      if (tErr) return res.status(500).json({ error: tErr.message });
      threadId = th.id;
    } else {
      await supabaseAdmin.from('email_threads').update({ last_email_at: now }).eq('id', threadId);
    }
    const { data: email, error: eErr } = await supabaseAdmin.from('emails').insert({
      thread_id: threadId, sender_id: me, company_id: req.user.company_id || null,
      reply_to_email_id: replyTo, is_forward: !!req.body.is_forward,
      subject, body_html: bodyHtml, body_text: bodyText, attachments, status: 'sent', sent_at: now,
    }).select('id, thread_id').single();
    if (eErr) return res.status(500).json({ error: eErr.message });
    const { error: rErr } = await supabaseAdmin.from('email_recipients')
      .insert(recips.map(r => ({ email_id: email.id, user_id: r.user_id, kind: r.kind, sent_at: now })));
    if (rErr) return res.status(500).json({ error: rErr.message });
    sentEmails = [email];
    notifications.notifyUsers(ids, {
      type: 'email_received', title: `New mail: ${subject || '(no subject)'}`,
      message: `${senderName} — ${preview}`, companyId: req.user.company_id || null,
      data: { kind: 'internal_email', email_id: email.id, thread_id: threadId }, dedupBase: `email_${email.id}`,
    }).catch(() => {});
  }

  // Sending a draft consumes it.
  if (req.body.draft_id) {
    await supabaseAdmin.from('emails').delete().eq('id', req.body.draft_id).eq('sender_id', me).eq('status', 'draft');
  }
  logger.success('EMAIL', `${me} sent ${sentEmails.length} email(s) to ${ids.length} recipient(s)${bulk ? ' [bulk]' : ''}`);
  res.status(201).json({ ok: true, emails: sentEmails, bulk: bulk && recips.length > 1 });
}));

// ── drafts (recipients live in draft_recipients jsonb until send) ─────────────
function draftPatch(body) {
  return {
    subject: String(body.subject || '').trim().slice(0, MAX_SUBJECT),
    body_html: scrubHtml(body.body_html),
    body_text: String(body.body_text || '').trim().slice(0, 20000) || stripTags(scrubHtml(body.body_html)).slice(0, 20000),
    attachments: cleanAttachments(body.attachments),
    draft_recipients: {
      to:  Array.isArray(body.to)  ? body.to.filter(x => typeof x === 'string').slice(0, 500)  : [],
      cc:  Array.isArray(body.cc)  ? body.cc.filter(x => typeof x === 'string').slice(0, 500)  : [],
      bcc: Array.isArray(body.bcc) ? body.bcc.filter(x => typeof x === 'string').slice(0, 500) : [],
    },
    updated_at: new Date().toISOString(),
  };
}
router.post('/drafts', asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin.from('emails')
    .insert({ ...draftPatch(req.body), sender_id: req.user.id, company_id: req.user.company_id || null, status: 'draft' })
    .select('id').single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ draft: data });
}));
router.put('/drafts/:id', asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin.from('emails').update(draftPatch(req.body))
    .eq('id', req.params.id).eq('sender_id', req.user.id).eq('status', 'draft').select('id').maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Draft not found' });
  res.json({ draft: data });
}));
router.delete('/drafts/:id', asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from('emails').delete()
    .eq('id', req.params.id).eq('sender_id', req.user.id).eq('status', 'draft');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

// ── folder lists ──────────────────────────────────────────────────────────────
// inbox/trash read email_recipients (user_id, folder, sent_at DESC — the 164
// index); sent/drafts read emails by sender. Page-1-only exact count.
router.get('/folders/:folder', asyncHandler(async (req, res) => {
  const me = req.user.id;
  const folder = String(req.params.folder);
  const limit  = Math.min(parseInt(req.query.limit, 10) || 25, PAGE_MAX);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const q = String(req.query.q || '').trim().replace(/[%,()]/g, ' ').trim();
  const wantCount = offset === 0 ? 'exact' : undefined;

  const decorate = async (emailRows, myRcptByEmail) => {
    // one names query for the page's senders + visible recipients
    const rcptRows = emailRows.length
      ? (await supabaseAdmin.from('email_recipients')
          .select('email_id, user_id, kind, read_at').in('email_id', emailRows.map(e => e.id))).data || []
      : [];
    const byEmail = new Map();
    rcptRows.forEach(r => { const a = byEmail.get(r.email_id) || []; a.push(r); byEmail.set(r.email_id, a); });
    const nameIds = new Set(emailRows.map(e => e.sender_id).filter(Boolean));
    emailRows.forEach(e => visibleRecipients(byEmail.get(e.id), me, e.sender_id).forEach(r => nameIds.add(r.user_id)));
    // drafts carry recipients in jsonb — resolve those names too so compose reopens with chips
    emailRows.forEach(e => { if (e.status === 'draft' && e.draft_recipients) ['to', 'cc', 'bcc'].forEach(k => (e.draft_recipients[k] || []).forEach(id => nameIds.add(id))); });
    const cards = await getUserCards([...nameIds]);
    const named = (ids) => (ids || []).map(id => ({ id, name: cards.get(id)?.name || 'User' }));
    return emailRows.map(e => {
      const vis = visibleRecipients(byEmail.get(e.id), me, e.sender_id)
        .map(r => ({ user_id: r.user_id, kind: r.kind, name: cards.get(r.user_id)?.name || 'User' }));
      const mine = myRcptByEmail?.get(e.id) || null;
      return {
        id: e.id, thread_id: e.thread_id, subject: e.subject,
        preview: (e.body_text || '').slice(0, 160),
        sender_id: e.sender_id, sender_name: cards.get(e.sender_id)?.name || 'User',
        sent_at: e.sent_at || e.updated_at, attachments_count: Array.isArray(e.attachments) ? e.attachments.length : 0,
        bulk_group_id: e.bulk_group_id || null, status: e.status,
        recipients: vis, read: mine ? !!mine.read_at : true, kind: mine?.kind || null,
        draft_recipients: e.status === 'draft' && e.draft_recipients ? {
          to: named(e.draft_recipients.to), cc: named(e.draft_recipients.cc), bcc: named(e.draft_recipients.bcc),
        } : undefined,
        body_html: e.status === 'draft' ? e.body_html : undefined,   // drafts reopen in compose
      };
    });
  };

  if (folder === 'inbox' || folder === 'trash') {
    let query = supabaseAdmin.from('email_recipients')
      .select('email_id, kind, read_at, sent_at, emails!inner(id, thread_id, sender_id, subject, body_text, attachments, bulk_group_id, sent_at, status, updated_at)', { count: wantCount })
      .eq('user_id', me).eq('folder', folder)
      .order('sent_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (req.query.unread === '1') query = query.is('read_at', null);
    if (req.query.date_from) query = query.gte('sent_at', req.query.date_from);
    if (req.query.date_to)   query = query.lte('sent_at', `${req.query.date_to}T23:59:59.999Z`);
    if (q) query = query.or(`subject.ilike.%${q}%,body_text.ilike.%${q}%`, { foreignTable: 'emails' });
    const { data, error, count } = await query;
    if (error) return res.status(500).json({ error: error.message });
    const myMap = new Map((data || []).map(r => [r.email_id, r]));
    const rows = await decorate((data || []).map(r => r.emails), myMap);
    // TRASH also carries my trashed SENT copies (union, merged by date).
    if (folder === 'trash') {
      const { data: sentTrash } = await supabaseAdmin.from('emails')
        .select('id, thread_id, sender_id, subject, body_text, attachments, bulk_group_id, sent_at, status, updated_at')
        .eq('sender_id', me).eq('status', 'sent').eq('sender_folder', 'trash')
        .order('sent_at', { ascending: false }).range(0, limit - 1);
      const extra = await decorate(sentTrash || [], null);
      const seen = new Set(rows.map(r => r.id));
      extra.forEach(r => { if (!seen.has(r.id)) rows.push({ ...r, sender_copy: true }); });
      rows.sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at));
    }
    return res.json({ items: rows.slice(0, limit), total: offset === 0 ? (count || rows.length) : null, limit, offset });
  }

  if (folder === 'sent' || folder === 'drafts') {
    let query = supabaseAdmin.from('emails')
      .select('id, thread_id, sender_id, subject, body_text, body_html, attachments, bulk_group_id, draft_recipients, sent_at, status, updated_at', { count: wantCount })
      .eq('sender_id', me)
      .eq('status', folder === 'drafts' ? 'draft' : 'sent')
      .order(folder === 'drafts' ? 'updated_at' : 'sent_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (folder === 'sent') query = query.eq('sender_folder', 'sent');
    if (req.query.date_from) query = query.gte('sent_at', req.query.date_from);
    if (req.query.date_to)   query = query.lte('sent_at', `${req.query.date_to}T23:59:59.999Z`);
    if (q) query = query.or(`subject.ilike.%${q}%,body_text.ilike.%${q}%`);
    const { data, error, count } = await query;
    if (error) return res.status(500).json({ error: error.message });
    const rows = await decorate(data || [], null);
    return res.json({ items: rows, total: offset === 0 ? (count || 0) : null, limit, offset });
  }

  return res.status(400).json({ error: 'folder must be inbox|sent|drafts|trash' });
}));

// ── thread view (BCC-safe) ────────────────────────────────────────────────────
router.get('/threads/:id', asyncHandler(async (req, res) => {
  const me = req.user.id;
  const { data: thread } = await supabaseAdmin.from('email_threads').select('*').eq('id', req.params.id).maybeSingle();
  if (!thread) return res.status(404).json({ error: 'Thread not found' });
  const { data: all } = await supabaseAdmin.from('emails')
    .select('id, thread_id, sender_id, reply_to_email_id, is_forward, subject, body_html, body_text, attachments, sent_at, status')
    .eq('thread_id', thread.id).eq('status', 'sent').order('sent_at', { ascending: true });
  const emails = all || [];
  const { data: rcpt } = emails.length
    ? await supabaseAdmin.from('email_recipients').select('email_id, user_id, kind, read_at').in('email_id', emails.map(e => e.id))
    : { data: [] };
  const byEmail = new Map();
  (rcpt || []).forEach(r => { const a = byEmail.get(r.email_id) || []; a.push(r); byEmail.set(r.email_id, a); });

  // visibility: I must be the sender or a recipient of at least one email
  const mine = emails.filter(e => e.sender_id === me || (byEmail.get(e.id) || []).some(r => r.user_id === me));
  if (!mine.length) return res.status(403).json({ error: 'Not part of that conversation' });

  const nameIds = new Set();
  mine.forEach(e => { nameIds.add(e.sender_id); visibleRecipients(byEmail.get(e.id), me, e.sender_id).forEach(r => nameIds.add(r.user_id)); });
  const cards = await getUserCards([...nameIds].filter(Boolean));

  res.json({
    thread: { id: thread.id, subject: thread.subject, last_email_at: thread.last_email_at },
    emails: mine.map(e => ({
      id: e.id, sender_id: e.sender_id, sender_name: cards.get(e.sender_id)?.name || 'User',
      reply_to_email_id: e.reply_to_email_id, is_forward: e.is_forward,
      subject: e.subject, body_html: e.body_html, body_text: e.body_text,
      attachments: e.attachments || [], sent_at: e.sent_at,
      recipients: visibleRecipients(byEmail.get(e.id), me, e.sender_id)
        .map(r => ({ user_id: r.user_id, kind: r.kind, name: cards.get(r.user_id)?.name || 'User' })),
      mine: e.sender_id === me,
    })),
  });
}));

// ── unread badge ──────────────────────────────────────────────────────────────
router.get('/unread-count', asyncHandler(async (req, res) => {
  const { count } = await supabaseAdmin.from('email_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', req.user.id).eq('folder', 'inbox').is('read_at', null);
  res.json({ unread: count || 0 });
}));

// ── read + folder moves (my copies only) ─────────────────────────────────────
router.patch('/read', asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body.email_ids) ? req.body.email_ids.filter(x => typeof x === 'string').slice(0, 200) : [];
  if (!ids.length) return res.status(400).json({ error: 'email_ids required' });
  const { error } = await supabaseAdmin.from('email_recipients')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', req.user.id).in('email_id', ids).is('read_at', null);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

router.patch('/:id/folder', asyncHandler(async (req, res) => {
  const me = req.user.id;
  const folder = req.body.folder === 'trash' ? 'trash' : 'inbox';
  // my recipient copy?
  const { data: r } = await supabaseAdmin.from('email_recipients')
    .select('id').eq('email_id', req.params.id).eq('user_id', me).maybeSingle();
  if (r) {
    const { error } = await supabaseAdmin.from('email_recipients').update({ folder }).eq('id', r.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, copy: 'recipient' });
  }
  // my sender copy? (inbox → restore to 'sent')
  const { data: e, error } = await supabaseAdmin.from('emails')
    .update({ sender_folder: folder === 'trash' ? 'trash' : 'sent' })
    .eq('id', req.params.id).eq('sender_id', me).eq('status', 'sent').select('id').maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!e) return res.status(404).json({ error: 'Not your email' });
  res.json({ ok: true, copy: 'sender' });
}));

// ── templates — note_shortcodes' exact tier model with name/subject/body ──────
const tierOf = (r) => (r.owner_user_id ? 'mine' : (r.company_id ? 'company' : 'global'));
function templatePatch(body) {
  const p = {};
  if (body.name !== undefined)      p.name = String(body.name).trim().slice(0, 80);
  if (body.subject !== undefined)   p.subject = String(body.subject).trim().slice(0, MAX_SUBJECT);
  if (body.body_html !== undefined) p.body_html = scrubHtml(body.body_html) || '';
  if (body.sort_order !== undefined && Number.isFinite(+body.sort_order)) p.sort_order = +body.sort_order;
  return p;
}
router.get('/templates', asyncHandler(async (req, res) => {
  const me = req.user.id;
  const companyId = req.user.company_id || null;
  const orParts = [`owner_user_id.eq.${me}`];
  orParts.push(companyId
    ? `and(owner_user_id.is.null,or(company_id.is.null,company_id.eq.${companyId}))`
    : `and(owner_user_id.is.null,company_id.is.null)`);
  const { data, error } = await supabaseAdmin.from('email_templates')
    .select('*').or(orParts.join(',')).order('sort_order', { ascending: true }).order('name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ templates: (data || []).map(r => ({ ...r, tier: tierOf(r) })) });
}));
router.post('/templates/mine', asyncHandler(async (req, res) => {
  const p = templatePatch(req.body);
  if (!p.name || (!p.subject && !p.body_html)) return res.status(400).json({ error: 'name and subject/body are required' });
  const { data: existing } = await supabaseAdmin.from('email_templates')
    .select('id').eq('owner_user_id', req.user.id).eq('name', p.name).maybeSingle();
  let row, error;
  if (existing) ({ data: row, error } = await supabaseAdmin.from('email_templates')
    .update({ ...p, updated_at: new Date().toISOString() }).eq('id', existing.id).select().single());
  else ({ data: row, error } = await supabaseAdmin.from('email_templates')
    .insert({ ...p, owner_user_id: req.user.id, company_id: null, created_by: req.user.id }).select().single());
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ template: { ...row, tier: 'mine' } });
}));
router.delete('/templates/mine/:id', asyncHandler(async (req, res) => {
  const { data: existing } = await supabaseAdmin.from('email_templates').select('owner_user_id').eq('id', req.params.id).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.owner_user_id !== req.user.id) return res.status(403).json({ error: 'Not your template' });
  const { error } = await supabaseAdmin.from('email_templates').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));
router.post('/templates', asyncHandler(async (req, res) => {
  if (!canManageTemplates(req)) return res.status(403).json({ error: 'Not allowed' });
  const p = templatePatch(req.body);
  if (!p.name || (!p.subject && !p.body_html)) return res.status(400).json({ error: 'name and subject/body are required' });
  const sa = await isSuperAdmin(req.user.id);
  const company_id = sa ? (req.body.company_id || null) : (req.user.company_id || null);
  const { data, error } = await supabaseAdmin.from('email_templates')
    .insert({ ...p, company_id, created_by: req.user.id }).select().single();
  if (error) return res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'That name already exists for this scope' : error.message });
  res.status(201).json({ template: { ...data, tier: tierOf(data) } });
}));
router.put('/templates/:id', asyncHandler(async (req, res) => {
  if (!canManageTemplates(req)) return res.status(403).json({ error: 'Not allowed' });
  const { data: existing } = await supabaseAdmin.from('email_templates').select('company_id, owner_user_id').eq('id', req.params.id).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.owner_user_id) return res.status(403).json({ error: 'Personal template — owner manages it' });
  const sa = await isSuperAdmin(req.user.id);
  if (!sa && existing.company_id !== (req.user.company_id || null)) return res.status(403).json({ error: 'Out of scope' });
  const { data, error } = await supabaseAdmin.from('email_templates')
    .update({ ...templatePatch(req.body), updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
  if (error) return res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'That name already exists for this scope' : error.message });
  res.json({ template: { ...data, tier: tierOf(data) } });
}));
router.delete('/templates/:id', asyncHandler(async (req, res) => {
  if (!canManageTemplates(req)) return res.status(403).json({ error: 'Not allowed' });
  const { data: existing } = await supabaseAdmin.from('email_templates').select('company_id, owner_user_id').eq('id', req.params.id).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.owner_user_id) return res.status(403).json({ error: 'Personal template — owner manages it' });
  const sa = await isSuperAdmin(req.user.id);
  if (!sa && existing.company_id !== (req.user.company_id || null)) return res.status(403).json({ error: 'Out of scope' });
  const { error } = await supabaseAdmin.from('email_templates').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

// ── signature (own only) ──────────────────────────────────────────────────────
router.get('/signature', asyncHandler(async (req, res) => {
  const { data } = await supabaseAdmin.from('email_signatures').select('body_html, updated_at').eq('user_id', req.user.id).maybeSingle();
  res.json({ signature: data?.body_html || '', updated_at: data?.updated_at || null });
}));
router.put('/signature', asyncHandler(async (req, res) => {
  const body_html = scrubHtml(req.body.body_html) || '';
  const { error } = await supabaseAdmin.from('email_signatures')
    .upsert({ user_id: req.user.id, body_html, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, signature: body_html });
}));

module.exports = router;

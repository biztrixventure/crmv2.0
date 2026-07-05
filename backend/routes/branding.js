// ============================================================================
// /branding — white-label branding + SEO + social-preview (Open Graph) config.
//
//   GET  /api/branding          PUBLIC — current branding (code defaults + saved
//                               overrides). The frontend meta-injection server
//                               and the SPA both read this tokenless; it's all
//                               public metadata anyway.
//   PUT  /api/branding          superadmin — save the branding object.
//   POST /api/branding/upload   superadmin — upload favicon/logo/og image (base64
//                               JSON body) to the public `branding` Storage
//                               bucket, returns the public URL.
//
// Storage: values live in business_config global key `branding` (mig 068). No new
// migration needed. Images live in a public Supabase Storage bucket `branding`.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');
const { getConfig, setConfig } = require('../utils/businessConfig');
const logger = require('../utils/logger');

const BUCKET = 'branding';

// Code defaults mirror the original hardcoded index.html so a fresh install looks
// exactly like today until an admin changes anything.
const DEFAULTS = {
  site_name:        'BizTrix CRM',
  tab_title:        'BizTrix CRM - Customer Relationship Management',
  meta_description: 'BizTrix CRM - Modern Customer Relationship Management platform for managing leads, sales, and team performance.',
  meta_keywords:    '',
  theme_color:      '#6E5838',
  favicon_url:      '/favicon.svg',
  logo_url:         '',
  // Social link preview (Open Graph / Twitter). Empty og_* fall back to the
  // page title/description at render time.
  og_title:         '',
  og_description:   '',
  og_image_url:     '',
  og_url:           '',
  og_type:          'website',
  twitter_card:     'summary_large_image',
  twitter_site:     '',
};

// Only these keys are accepted from a PUT (ignore anything else).
const FIELDS = Object.keys(DEFAULTS);

async function loadBranding() {
  const saved = await getConfig(null, 'branding', {});
  return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) };
}

// ── PUBLIC GET ────────────────────────────────────────────────────────────────
const publicGet = asyncHandler(async (req, res) => {
  const branding = await loadBranding();
  // let CDNs / crawlers cache briefly; still fresh within a minute of a change
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ branding });
});

// ── ADMIN (mounted behind authMiddleware) ──────────────────────────────────────
const adminRouter = express.Router();

const superOnly = asyncHandler(async (req, res, next) => {
  if (await isSuperAdmin(req.user.id)) return next();
  return res.status(403).json({ error: 'Superadmin only' });
});

const str = (v, max = 2000) => (v == null ? '' : String(v)).slice(0, max);

adminRouter.put('/', superOnly, asyncHandler(async (req, res) => {
  const body = req.body || {};
  const current = await loadBranding();
  const next = { ...current };
  for (const k of FIELDS) {
    if (k in body) next[k] = str(body[k], k === 'meta_description' || k === 'og_description' ? 400 : 2000);
  }
  await setConfig('global', 'branding', next, req.user.id);
  res.json({ ok: true, branding: next });
}));

// ensure the public bucket exists (idempotent) — created lazily on first upload
async function ensureBucket() {
  try {
    const { data } = await supabaseAdmin.storage.getBucket(BUCKET);
    if (data) return;
  } catch { /* not found → create */ }
  const { error } = await supabaseAdmin.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: '5MB',
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/webp', 'image/gif'],
  });
  if (error && !/already exists/i.test(error.message || '')) throw new Error(error.message);
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/webp': 'webp', 'image/gif': 'gif' };

// base64 JSON upload (avoids a multipart dep). 8mb JSON cap covers a 5MB image.
adminRouter.post('/upload', express.json({ limit: '8mb' }), superOnly, asyncHandler(async (req, res) => {
  const kind = ['favicon', 'logo', 'og_image'].includes(req.body?.kind) ? req.body.kind : null;
  const contentType = str(req.body?.content_type, 100);
  const dataB64 = req.body?.data_base64;
  if (!kind || !contentType || !dataB64) return res.status(400).json({ error: 'kind, content_type, data_base64 required' });
  const ext = EXT[contentType];
  if (!ext) return res.status(400).json({ error: `Unsupported image type: ${contentType}` });

  let buf;
  try { buf = Buffer.from(String(dataB64).replace(/^data:[^,]+,/, ''), 'base64'); }
  catch { return res.status(400).json({ error: 'Invalid base64' }); }
  if (!buf.length || buf.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Image must be 1 byte – 5 MB' });

  try { await ensureBucket(); }
  catch (e) { logger.error('BRANDING', `bucket: ${e.message}`); return res.status(500).json({ error: `Storage bucket error: ${e.message}` }); }

  // stable path per kind so re-uploads overwrite (upsert) and old links keep working
  const path = `${kind}-${Date.now()}.${ext}`;
  const { error: upErr } = await supabaseAdmin.storage.from(BUCKET).upload(path, buf, { contentType, upsert: true });
  if (upErr) { logger.error('BRANDING', `upload: ${upErr.message}`); return res.status(500).json({ error: upErr.message }); }

  const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
  res.json({ ok: true, url: pub.publicUrl, kind });
}));

module.exports = { publicGet, adminRouter, loadBranding, DEFAULTS };

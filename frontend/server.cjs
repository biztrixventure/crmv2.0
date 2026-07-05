// ============================================================================
// Frontend production server — serves the static Vite build AND injects
// branding / SEO / Open-Graph meta tags into index.html per request, so social
// crawlers (WhatsApp / Facebook / Twitter / iMessage / LinkedIn — none of which
// run JS) get real link previews driven by the admin Branding settings.
//
// Replaces `vite preview`. It reads branding from the backend's PUBLIC
// GET /api/branding (tokenless), caches it for 60s, and — critically — falls
// back to the untouched index.html if anything fails, so branding problems can
// NEVER take the site down.
// ============================================================================
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const DIST = path.join(__dirname, 'dist');
const INDEX = path.join(DIST, 'index.html');
const template = fs.readFileSync(INDEX, 'utf8');
const PORT = process.env.PORT || 4173;

// HTML-attribute escape.
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ── branding cache (single global object; refreshed at most once / 60s) ─────────
let cache = { at: 0, branding: null };
async function getBranding(apiBase) {
  if (cache.branding && Date.now() - cache.at < 60_000) return cache.branding;
  try {
    const r = await fetch(`${apiBase}/branding`, { signal: AbortSignal.timeout(3000) });
    if (r.ok) {
      const j = await r.json();
      if (j && j.branding) cache = { at: Date.now(), branding: j.branding };
    }
  } catch { /* keep last-good (or null) → fallback to plain template */ }
  return cache.branding;
}

function metaBlock(b, reqUrl) {
  const title   = esc(b.tab_title || b.site_name || 'CRM');
  const desc    = esc(b.meta_description || '');
  const ogTitle = esc(b.og_title || b.tab_title || b.site_name || '');
  const ogDesc  = esc(b.og_description || b.meta_description || '');
  const ogImg   = esc(b.og_image_url || '');
  const ogUrl   = esc(b.og_url || reqUrl || '');
  const favicon = esc(b.favicon_url || '/favicon.svg');
  const tags = [
    `<title>${title}</title>`,
    `<meta name="description" content="${desc}" />`,
    b.meta_keywords ? `<meta name="keywords" content="${esc(b.meta_keywords)}" />` : '',
    `<meta name="theme-color" content="${esc(b.theme_color || '#6E5838')}" />`,
    `<link rel="icon" href="${favicon}" />`,
    `<meta property="og:type" content="${esc(b.og_type || 'website')}" />`,
    b.site_name ? `<meta property="og:site_name" content="${esc(b.site_name)}" />` : '',
    `<meta property="og:title" content="${ogTitle}" />`,
    `<meta property="og:description" content="${ogDesc}" />`,
    ogUrl ? `<meta property="og:url" content="${ogUrl}" />` : '',
    ogImg ? `<meta property="og:image" content="${ogImg}" />` : '',
    `<meta name="twitter:card" content="${esc(b.twitter_card || 'summary_large_image')}" />`,
    b.twitter_site ? `<meta name="twitter:site" content="${esc(b.twitter_site)}" />` : '',
    `<meta name="twitter:title" content="${ogTitle}" />`,
    `<meta name="twitter:description" content="${ogDesc}" />`,
    ogImg ? `<meta name="twitter:image" content="${ogImg}" />` : '',
  ].filter(Boolean).join('\n    ');
  return tags;
}

// Strip the bits we manage from the base template, then inject the fresh set.
function render(b, reqUrl) {
  let html = template
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<meta\s+name="description"[^>]*>/i, '')
    .replace(/<meta\s+name="theme-color"[^>]*>/i, '')
    .replace(/<link\s+rel="icon"[^>]*>/i, '');
  return html.replace('</head>', `    ${metaBlock(b, reqUrl)}\n  </head>`);
}

// Static assets first (js/css/svg/images). index:false so we control index.html.
app.use(express.static(DIST, { index: false, maxAge: '1h', setHeaders: (res, p) => {
  if (p.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
} }));

// SPA fallback — every non-asset route returns index.html with injected meta.
app.get('*', async (req, res) => {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.get('host');
  // Absolute VITE_API_URL wins; else assume /api is proxied on the same host
  // (their Coolify setup: crm.example.com/api → backend).
  const env = (process.env.VITE_API_URL || '').replace(/\/$/, '');
  const apiBase = /^https?:\/\//i.test(env) ? env : `${proto}://${host}/api`;

  let b = null;
  try { b = await getBranding(apiBase); } catch { /* fallthrough */ }

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-cache');
  if (!b) return res.send(template);          // hard fallback — never break
  try { res.send(render(b, `${proto}://${host}${req.originalUrl}`)); }
  catch { res.send(template); }
});

app.listen(PORT, '0.0.0.0', () => console.log(`[branding-server] serving dist on :${PORT}`));

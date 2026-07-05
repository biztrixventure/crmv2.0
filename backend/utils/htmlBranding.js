// ============================================================================
// htmlBranding — injects branding / SEO / Open-Graph meta into the SPA's
// index.html at serve time, so social crawlers (WhatsApp/FB/Twitter/iMessage —
// none run JS) get real link previews. Used by server.js's SPA fallback in the
// single-service deploy (the backend serves the frontend build).
//
// Template is cached in-process; branding comes from loadBranding() (which has
// its own 60s cache), so per-request cost is just a few string replaces.
// ============================================================================
const fs = require('fs');
const path = require('path');

let _tpl = null;
function template(distPath) {
  if (_tpl != null) return _tpl;
  try { _tpl = fs.readFileSync(path.join(distPath, 'index.html'), 'utf8'); }
  catch { _tpl = ''; }
  return _tpl;
}

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function metaBlock(b, reqUrl) {
  const title   = esc(b.tab_title || b.site_name || 'CRM');
  const desc    = esc(b.meta_description || '');
  const ogTitle = esc(b.og_title || b.tab_title || b.site_name || '');
  const ogDesc  = esc(b.og_description || b.meta_description || '');
  const ogImg   = esc(b.og_image_url || '');
  const ogUrl   = esc(b.og_url || reqUrl || '');
  const favicon = esc(b.favicon_url || '/favicon.svg');
  return [
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
}

// Returns branded HTML, or '' if the template is missing / branding is null
// (caller then falls back to a plain sendFile — injection must never break serve).
function renderIndex(distPath, branding, reqUrl) {
  const tpl = template(distPath);
  if (!tpl || !branding) return '';
  const html = tpl
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<meta\s+name="description"[^>]*>/i, '')
    .replace(/<meta\s+name="theme-color"[^>]*>/i, '')
    .replace(/<link\s+rel="icon"[^>]*>/i, '');
  return html.replace('</head>', `    ${metaBlock(branding, reqUrl)}\n  </head>`);
}

module.exports = { renderIndex, template };

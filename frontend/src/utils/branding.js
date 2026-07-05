// Client-side branding applier. The frontend server injects meta into the HTML
// for the initial load + crawlers; this keeps the live SPA (browser tab title,
// favicon, theme-color) correct during client navigation and updates instantly
// after an admin saves, without a reload.
import client from '../api/client';

export async function fetchBranding() {
  const r = await client.get('branding');
  return r.data?.branding || null;
}

function upsertMeta(attr, name, content) {
  if (content == null) return;
  let el = document.head.querySelector(`meta[${attr}="${name}"]`);
  if (!el) { el = document.createElement('meta'); el.setAttribute(attr, name); document.head.appendChild(el); }
  el.setAttribute('content', content);
}

export function applyBranding(b) {
  if (!b) return;
  if (b.tab_title || b.site_name) document.title = b.tab_title || b.site_name;
  upsertMeta('name', 'description', b.meta_description || '');
  if (b.meta_keywords) upsertMeta('name', 'keywords', b.meta_keywords);
  if (b.theme_color) upsertMeta('name', 'theme-color', b.theme_color);
  if (b.favicon_url) {
    let link = document.head.querySelector('link[rel="icon"]');
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    link.href = b.favicon_url;
  }
}

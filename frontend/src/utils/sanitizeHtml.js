// Light HTML sanitizer for superadmin-authored announcement bodies.
// Strips executable/embed tags, inline event handlers, and javascript: URLs.
// (Authors are trusted superadmins; this is defense-in-depth before render.)
export function sanitizeHtml(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,link,meta,base').forEach(n => n.remove());
  doc.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(attr => {
      const name = attr.name.toLowerCase();
      const val = (attr.value || '').trim();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(val)) el.removeAttribute(attr.name);
    });
  });
  return doc.body.innerHTML;
}

// Plain-text version (for list previews / truncation).
export function stripHtml(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

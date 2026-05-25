import DOMPurify from 'dompurify';
import client from '../api/client';

// Allowlist for rich chat messages: formatting, lists, links, images, and the
// mention chip (<span class="bsx-mention" data-uid>). This is the authoritative
// XSS control — every message is purified at render time, even ones that bypass
// the editor and hit the API directly.
const PURIFY_CONFIG = {
  ALLOWED_TAGS: ['b', 'strong', 'i', 'em', 'u', 'a', 'br', 'p', 'div', 'span', 'ul', 'ol', 'li', 'img', 'blockquote', 'code', 'pre'],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'class', 'data-uid'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|data:image\/|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
};

// Force links to open safely in a new tab.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('href')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer nofollow');
  }
});

export const sanitizeChatHtml = (html) => DOMPurify.sanitize(html || '', PURIFY_CONFIG);

// True when HTML carries no visible content (no text, no image).
export const isHtmlEmpty = (html) => {
  if (!html) return true;
  const el = document.createElement('div');
  el.innerHTML = html;
  if (el.querySelector('img')) return false;
  return !el.textContent.trim();
};

// Plain-text preview from HTML (for the message `body` / search / push).
export const htmlToText = (html) => {
  if (!html) return '';
  const el = document.createElement('div');
  el.innerHTML = html;
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
};

// Extract mentioned user ids from the mention chips in the editor HTML.
export const extractMentions = (html) => {
  if (!html) return [];
  const el = document.createElement('div');
  el.innerHTML = html;
  return [...new Set([...el.querySelectorAll('span.bsx-mention[data-uid]')].map(n => n.getAttribute('data-uid')).filter(Boolean))];
};

export const MAX_ATTACH_BYTES = 10 * 1024 * 1024; // 10MB

// Read a File as a base64 data URL.
const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

// Upload a File through the backend → Supabase Storage. Returns attachment meta
// { url, name, type, size, kind }. Throws Error with a friendly message.
export const uploadChatFile = async (file) => {
  if (file.size > MAX_ATTACH_BYTES) throw new Error('File exceeds the 10MB limit');
  const data = await fileToDataUrl(file);
  const res = await client.post('chat/upload', { data, name: file.name, type: file.type });
  return res.data.attachment;
};

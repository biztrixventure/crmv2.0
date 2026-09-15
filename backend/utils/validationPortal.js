// ============================================================================
// utils/validationPortal.js -- submit a dialer's IP-validation form the way a
// browser would, whatever the form looks like.
//
// A VICIdial/ViciBox box only lets an IP talk to it after someone logs in on
// its validation page, which whitelists the address that submitted. The CRM
// does that from the server so the server's own IP gets whitelisted.
//
// WHY THIS IS GENERIC. The old validator hardcoded the form: it always sent the
// user as `userid` and read only the password field's name from the page. That
// held while every box ran the same page. The flexodialer box's new page
// (valid8.php, measured 2026-09-15) disguises the USER field's name too
// ("Jzr87Cp8XqJY"), posts to a different file, and says "Login Validated for IP
// x.x.x.x" instead of "success" -- so the old code sent the user under a name
// the page ignores and then reported failure even when it worked.
//
// So instead of knowing any page, this reads the page it is given: finds the
// form that asks for a password, fills the visible text field with the user and
// the password field with the password, and sends EVERY other field back exactly
// as the page set it. That last part matters:
//   - both pages carry an empty hidden field literally named "password" -- a
//     decoy a bot fills in. A browser sends it empty, so this does too;
//   - a CSRF token or session field, if a page ever adds one, rides along
//     untouched, and so does any cookie the page sets.
// Measured against both page generations in the live fleet: the old index.php
// forms (userid + disguised password) and the new valid8.php form.
//
// Pure except for the HTTP calls, so the parsing is testable on saved HTML.
// ============================================================================
const axios = require('axios');

const TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 3;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) BizTrixCRM-validator';

// Words a validation page uses when it worked, and when it did not. Checked on
// the page that comes BACK from the submit, never on the empty form.
const OK_RE   = /\b(validated|success(ful(ly)?)?|whitelisted|authori[sz]ed|access granted)\b/i;
const FAIL_RE = /\b(invalid|incorrect|denied|failed|not valid|wrong|bad password|login error)\b/i;
// "Login Validated for<br>IP 103.189.195.102" -- the address the dialer opened.
const IP_RE   = /validated\s+for\s*(?:<br\s*\/?>\s*)?ip\s*([0-9]{1,3}(?:\.[0-9]{1,3}){3})/i;

// ── tiny HTML reading, enough for a login form ───────────────────────────────

function attrsOf(tag) {
  const out = {};
  const body = tag.replace(/^<\s*[a-z0-9]+/i, '').replace(/\/?>$/, '');
  const re = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(body))) {
    const val = m[2] ?? m[3] ?? m[4] ?? '';
    out[m[1].toLowerCase()] = decodeEntities(val);
  }
  return out;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

const textOf = (html) => decodeEntities(String(html || '')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/<[^>]+>/g, ' '))
  .replace(/\s+/g, ' ')
  .trim();

const USER_HINT = /user|login|agent|uid|id$|name/i;
const TEXTISH = new Set(['', 'text', 'email', 'tel', 'number', 'search']);

/**
 * Read the login form out of a validation page.
 * Returns null when the page has no form asking for a password.
 */
function parseLoginForm(html, pageUrl) {
  const src = String(html || '');
  const forms = [...src.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)].map(m => m[0]);
  // Some pages never close the form; treat the rest of the page as its body.
  if (!forms.length) {
    const open = src.match(/<form\b[^>]*>[\s\S]*/i);
    if (open) forms.push(open[0]);
  }

  for (const form of forms) {
    const formAttrs = attrsOf(form.match(/<form\b[^>]*>/i)[0]);
    const inputs = [...form.matchAll(/<input\b[^>]*>/gi)].map(m => attrsOf(m[0]));
    const buttons = [...form.matchAll(/<button\b[^>]*>/gi)].map(m => ({ ...attrsOf(m[0]), _button: true }));

    const pass = inputs.find(i => (i.type || '').toLowerCase() === 'password' && i.name);
    if (!pass) continue;

    const texts = inputs.filter(i => TEXTISH.has((i.type || '').toLowerCase()) && i.name);
    // Prefer a field that says it is the user; a fully disguised page gives no
    // hint, and then the one visible text field IS the user field.
    const user = texts.find(i => USER_HINT.test(`${i.name} ${i.id || ''} ${i.placeholder || ''}`)) || texts[0] || null;

    // Everything else goes back exactly as the page set it.
    const carry = [];
    for (const i of inputs) {
      const type = (i.type || '').toLowerCase();
      if (!i.name || i === pass || i === user) continue;
      if (type === 'submit' || type === 'button' || type === 'image' || type === 'reset' || type === 'file') continue;
      if ((type === 'checkbox' || type === 'radio') && !('checked' in i)) continue;
      carry.push([i.name, i.value ?? '']);
    }
    // The button a person would press, if it is named -- some pages check it.
    const submit = [...inputs, ...buttons].find(i =>
      (i._button ? (i.type || 'submit').toLowerCase() === 'submit' : (i.type || '').toLowerCase() === 'submit') && i.name);

    const action = new URL(formAttrs.action || '', pageUrl).toString();
    return {
      action,
      method: (formAttrs.method || 'post').toLowerCase(),
      userField: user?.name || null,
      passField: pass.name,
      carry,
      submit: submit ? [submit.name, submit.value ?? 'Submit'] : null,
    };
  }
  return null;
}

/** What the page that came back from the submit says. */
function readOutcome(html) {
  const text = textOf(html);
  const ipMatch = String(html || '').match(IP_RE);
  const okMatch = text.match(OK_RE);
  const failMatch = text.match(FAIL_RE);
  // The sentence around whichever word decided it, for the admin screen.
  const around = (m) => {
    if (!m) return null;
    const at = m.index;
    return text.slice(Math.max(0, at - 60), at + 80).trim();
  };
  return {
    said_success: !!(ipMatch || okMatch) && !failMatch,
    said_failure: !!failMatch,
    validated_ip: ipMatch ? ipMatch[1] : null,
    message: around(failMatch || okMatch) || (text ? text.slice(0, 160) : null),
  };
}

// ── cookies: whatever the page sets, send back ───────────────────────────────
function mergeCookies(jar, res) {
  const set = res.headers?.['set-cookie'];
  for (const c of (Array.isArray(set) ? set : set ? [set] : [])) {
    const pair = String(c).split(';')[0];
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}
const cookieHeader = (jar) => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

/**
 * GET the validation page, fill its form, submit it, follow any redirect with
 * the cookies it set, and report what the dialer said.
 */
async function submitValidationForm({ url, userid, password }) {
  const jar = new Map();
  const headers = () => ({ 'User-Agent': UA, ...(jar.size ? { Cookie: cookieHeader(jar) } : {}) });

  const page = await axios.get(url, {
    timeout: TIMEOUT_MS, responseType: 'text', validateStatus: () => true, headers: headers(),
  });
  mergeCookies(jar, page);
  if (page.status >= 400) {
    return { submitted: false, status: page.status, error: `validation page answered HTTP ${page.status}` };
  }

  const form = parseLoginForm(page.data, url);
  if (!form) return { submitted: false, status: page.status, error: 'no login form with a password field on that page' };
  if (!form.userField) return { submitted: false, status: page.status, error: 'the login form has no user field' };

  const fields = [...form.carry, [form.userField, userid], [form.passField, password]];
  if (form.submit) fields.push(form.submit);
  const body = fields.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v ?? '')}`).join('&');

  let res = form.method === 'get'
    ? await axios.get(`${form.action}${form.action.includes('?') ? '&' : '?'}${body}`, {
        timeout: TIMEOUT_MS, responseType: 'text', maxRedirects: 0, validateStatus: () => true, headers: headers(),
      })
    : await axios.post(form.action, body, {
        timeout: TIMEOUT_MS, responseType: 'text', maxRedirects: 0, validateStatus: () => true,
        headers: { ...headers(), 'Content-Type': 'application/x-www-form-urlencoded', Referer: url },
      });
  mergeCookies(jar, res);

  // A page that redirects after the post shows its message on the next page.
  for (let i = 0; i < MAX_REDIRECTS && res.status >= 300 && res.status < 400 && res.headers?.location; i += 1) {
    const next = new URL(res.headers.location, form.action).toString();
    res = await axios.get(next, {
      timeout: TIMEOUT_MS, responseType: 'text', maxRedirects: 0, validateStatus: () => true, headers: headers(),
    });
    mergeCookies(jar, res);
  }

  return {
    submitted: res.status < 400,
    status: res.status,
    ...readOutcome(res.data),
    // Never the password: only which fields the page asked for, so a changed
    // page is diagnosable from the admin screen.
    form: { action: form.action, user_field: form.userField, pass_field: form.passField },
  };
}

module.exports = { submitValidationForm, parseLoginForm, readOutcome };

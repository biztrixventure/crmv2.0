// ============================================================================
// dialers/client.js — outbound HTTP to a dialer's own API.
//
// The webhook is how a dialer tells the CRM something. This is how the CRM asks
// the dialer something: fetch the recording that was not ready at hangup, pull
// an agent roster, verify a token actually works before anyone waits for a call
// that never arrives.
//
// It is configuration-driven for the same reason the mapping is: CallTools,
// the next dialer and an in-house API all differ in where the key goes and what
// the path looks like, and none of that is worth a new file each time.
//
//   auth.type = 'bearer'  Authorization: Bearer <token>
//               'header'  <header_name>: <token>
//               'basic'   Authorization: Basic base64(user:pass)
//               'query'   ?<query_param>=<token>
//               'none'
//
// Paths are templates: '/api/v1/calls/{call_id}/' with { call_id } filled in.
//
// Every call here is BEST EFFORT and bounded. A dialer API that hangs must not
// hold a poller tick or an admin page open — the timeout is short, failures
// come back as { ok:false, error } and are never thrown at the caller.
// ============================================================================

const axios = require('axios');
const logger = require('../logger');
const { withPreset } = require('./accounts');
const { getPath } = require('./mapping');

const DEFAULT_TIMEOUT = 12000;

function authHeaders(account) {
  const auth = account.auth || {};
  const token = auth.token || auth.key || auth.secret || '';
  switch (String(auth.type || 'none').toLowerCase()) {
    case 'bearer':
      return token ? { [auth.header_name || 'Authorization']: `Bearer ${token}` } : {};
    // Django REST Framework's TokenAuthentication — `Authorization: Token <key>`.
    // CallTools speaks this (verified against east-3.calltools.io), and so does
    // most of the Python-backed world, so it is worth its own name rather than
    // making an operator paste "Token abc..." into a field labelled "token".
    case 'token':
      return token ? { [auth.header_name || 'Authorization']: `Token ${token}` } : {};
    case 'header':
      return token ? { [auth.header_name || 'X-API-Key']: token } : {};
    case 'basic': {
      const user = auth.user || '';
      const pass = auth.pass || auth.password || '';
      if (!user && !pass) return {};
      return { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` };
    }
    default:
      return {};
  }
}

function authParams(account) {
  const auth = account.auth || {};
  if (String(auth.type || '').toLowerCase() !== 'query') return {};
  const token = auth.token || auth.key || auth.secret || '';
  return token ? { [auth.query_param || 'key']: token } : {};
}

const fillTemplate = (tpl, vars) =>
  String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(vars[k] == null ? '' : String(vars[k])));

/**
 * One GET against the dialer's API.
 * @returns {{ ok:boolean, status:number|null, data:any, error:string|null, url:string }}
 */
async function apiGet(rawAccount, pathTemplate, { vars = {}, params = {}, timeout = DEFAULT_TIMEOUT } = {}) {
  const account = withPreset(rawAccount);
  const base = String(account.base_url || '').replace(/\/+$/, '');
  const path = fillTemplate(pathTemplate, vars);
  if (!base && !/^https?:\/\//i.test(path)) {
    return { ok: false, status: null, data: null, error: 'no base_url configured', url: '' };
  }
  const url = /^https?:\/\//i.test(path) ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`;
  try {
    const r = await axios.get(url, {
      headers: { Accept: 'application/json', ...authHeaders(account) },
      params: { ...authParams(account), ...params },
      timeout,
      // A 4xx is an ANSWER (bad token, gone, forbidden) and the caller needs to
      // see which one — throwing would collapse them all into "request failed".
      validateStatus: () => true,
    });
    const ok = r.status >= 200 && r.status < 300;
    return {
      ok, status: r.status, data: r.data, url,
      error: ok ? null : `HTTP ${r.status}${typeof r.data === 'string' ? `: ${r.data.slice(0, 200)}` : ''}`,
    };
  } catch (e) {
    return { ok: false, status: null, data: null, url, error: e.message };
  }
}

// Fetch the audio itself, with the account's credentials attached. Used by the
// QA media proxy when a provider's recording URL is not publicly readable.
async function fetchAudio(rawAccount, url, { timeout = 120000 } = {}) {
  const account = withPreset(rawAccount);
  const r = await axios.get(url, {
    responseType: 'arraybuffer',
    headers: authHeaders(account),
    params: authParams(account),
    timeout,
  });
  return Buffer.from(r.data);
}

// Ask the dialer for one call, and read the recording link out of it. Both the
// path and the field are per-account settings, so a tenant whose API differs
// needs a settings edit, not a code change.
async function recordingForCall(rawAccount, callId) {
  const account = withPreset(rawAccount);
  const api = (account.settings || {}).api || {};
  const pathTpl = api.call_path;
  if (!pathTpl || !callId) return { ok: false, url: null, error: 'no call_path configured or no call id on the row' };

  const res = await apiGet(account, pathTpl, { vars: { call_id: callId, id: callId } });
  if (!res.ok) return { ok: false, url: null, error: res.error };

  const field = api.recording_url_field || 'recording_url';
  // Accept a list of candidate fields as readily as one, and fall back to the
  // obvious spellings so a working integration does not hinge on guessing the
  // field name right on the first try.
  const candidates = [].concat(field, ['recording_url', 'recording', 'recording_link', 'audio_url', 'data.recording_url']);
  for (const f of candidates) {
    const v = getPath(res.data, f);
    if (v && typeof v === 'string' && /^https?:\/\//i.test(v)) {
      return { ok: true, url: v, error: null, raw: res.data };
    }
  }
  return { ok: false, url: null, error: 'call found but it carries no recording link yet', raw: res.data };
}

// "Does this token work?" — the admin page's Test button. A configured
// test_path is used when present; otherwise the call path with a dummy id is
// enough to tell 401 (bad token) from 404 (token fine, that call does not
// exist), which is the distinction the operator actually needs.
async function testConnection(rawAccount) {
  const account = withPreset(rawAccount);
  const api = (account.settings || {}).api || {};
  const path = api.test_path || api.call_path || '/';
  const res = await apiGet(account, path, { vars: { call_id: '0', id: '0' }, timeout: 8000 });
  const status = res.status;
  if (res.ok) return { ok: true, status, message: 'Connected — the API answered.' };
  if (status === 401 || status === 403) return { ok: false, status, message: 'Rejected the credentials (401/403). Check the API token and its permissions.' };
  if (status === 404) return { ok: true, status, message: 'Credentials accepted (404 = that test id does not exist, which is expected).' };
  if (status) return { ok: false, status, message: `The API answered HTTP ${status}.` };
  logger.warn('DIALER_API', `test failed for ${account.name}: ${res.error}`);
  return { ok: false, status: null, message: res.error || 'No answer from the API.' };
}

module.exports = { apiGet, fetchAudio, recordingForCall, testConnection, authHeaders, authParams, fillTemplate };

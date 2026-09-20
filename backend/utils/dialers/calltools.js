// ============================================================================
// dialers/calltools.js — the CallTools-shaped operations the generic layer
// cannot express.
//
// Everything about READING a call is generic (mapping.js + client.js). What is
// not generic is SETTING THE DIALER UP: CallTools keeps its dispositions, its
// agents and its outbound webhooks behind product-specific endpoints, and an
// operator should not have to open two admin panels and copy ids between them.
// So the CRM does it: pick the transfer dispositions from the real list, pull
// the real agent roster, and create the automation + HTTP request that points
// back at this CRM.
//
// Shape of a CallTools webhook (all verified against a live tenant):
//   httprequests/     the request itself — url, method, content type, body of
//                     merge fields
//   automations/      trigger_model + a condition set
//   webhookactions/   joins one automation to one httprequest
//                     (NOT /api/actions/, which is read-only)
//
// The merge vocabulary for a "Call Disposition" trigger is the
// historicalcalldisposition model: app_user (the AGENT, as a uuid),
// phone_number, call_uuid, disposition, contact, campaign, queue. Customer
// detail comes from the contact model. Neither is documented publicly; both
// were read off the tenant's own API.
// ============================================================================

const axios = require('axios');
const logger = require('../logger');
const { apiGet, authHeaders } = require('./client');
const { withPreset } = require('./accounts');

const TIMEOUT = 15000;

// POST/PUT/PATCH with the account's credentials. Kept here rather than in
// client.js because client.js is deliberately read-only — nothing generic
// should be able to write into someone's dialer.
async function apiWrite(account, method, path, body) {
  const acct = withPreset(account);
  const base = String(acct.base_url || '').replace(/\/+$/, '');
  if (!base) return { ok: false, status: null, data: null, error: 'no base_url configured' };
  const url = `${base}${path.startsWith('/') ? '' : '/'}${path}`;
  try {
    const r = await axios({
      method,
      url,
      data: body,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeaders(acct) },
      timeout: TIMEOUT,
      validateStatus: () => true,
    });
    const ok = r.status >= 200 && r.status < 300;
    return {
      ok, status: r.status, data: r.data,
      error: ok ? null : `HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 300)}`,
    };
  } catch (e) {
    return { ok: false, status: null, data: null, error: e.message };
  }
}

// ── what the dialer knows ───────────────────────────────────────────────────

// The agent-selectable dispositions. These are what an operator picks from when
// saying "these mean the call was transferred" — typing them by hand is how you
// end up with "XFER Transferred" configured against "XFER Transfered" in the
// dialer and no transfers for a week.
async function remoteDispositions(account) {
  const res = await apiGet(account, '/api/calldispositions/', { params: { limit: 200 } });
  if (!res.ok) return { ok: false, error: res.error, dispositions: [] };
  const rows = (res.data && res.data.results) || [];
  return {
    ok: true,
    error: null,
    dispositions: rows.map(r => ({
      id: r.id,
      name: r.name,
      hangs_up: !!r.hang_up_call,
      no_contact: !!r.no_contact,
    })),
  };
}

// The dialer's own people. `app_user` is the id the webhook actually sends;
// `username` is what a human recognises and, in this estate, is also the
// VICIdial agent id — so both are offered for linking.
async function remoteAgents(account) {
  const res = await apiGet(account, '/api/users/', { params: { limit: 500 } });
  if (!res.ok) return { ok: false, error: res.error, agents: [] };
  const rows = (res.data && res.data.results) || [];
  return {
    ok: true,
    error: null,
    agents: rows.map(r => ({
      external_id: r.app_user || r.username,     // what arrives on the webhook
      username: r.username || null,              // what a human recognises
      name: r.full_name || `${r.first_name || ''} ${r.last_name || ''}`.trim() || r.username,
      email: r.email || null,
      extension: r.extension || null,
      is_agent: !!r.is_agent,
      is_manager: !!r.is_manager,
    })),
  };
}

// ── the webhook the dialer fires at us ──────────────────────────────────────

const WIRING_NAME = 'BizTrix CRM - XFER webhook';
const AUTOMATION_NAME = 'BizTrix CRM - send XFER to CRM';

// The body the automation posts. Flat keys, so the CRM-side mapping stays
// one-to-one and a human reading either side can see the other.
function webhookBody(dispoLabel) {
  return {
    dispo: dispoLabel,
    leg: 'fronter',
    agent: '{{%locals[historicalcalldisposition][app_user]}}',
    phone: '{{%locals[historicalcalldisposition][phone_number]}}',
    call_id: '{{%locals[historicalcalldisposition][call_uuid]}}',
    code: '{{%locals[historicalcalldisposition][contact]}}',
    campaign: '{{%locals[historicalcalldisposition][campaign]}}',
    call_at: '{{%locals[historicalcalldisposition][created_on]}}',
    queue: '{{%locals[historicalcalldisposition][queue]}}',
    first: '{{%locals[contact][first_name]}}',
    last: '{{%locals[contact][last_name]}}',
    address: '{{%locals[contact][address]}}',
    city: '{{%locals[contact][city]}}',
    state: '{{%locals[contact][state]}}',
    zip: '{{%locals[contact][zip_code]}}',
    car_make: '{{%locals[contact][make]}}',
    car_model: '{{%locals[contact][model]}}',
    car_year: '{{%locals[contact][year]}}',
  };
}

// What is currently wired, so the admin page shows the truth rather than what
// the CRM last intended.
async function readWiring(account, hookUrl) {
  const [reqs, autos] = await Promise.all([
    apiGet(account, '/api/httprequests/', { params: { limit: 100 } }),
    apiGet(account, '/api/automations/', { params: { limit: 200 } }),
  ]);
  if (!reqs.ok) return { ok: false, error: reqs.error, wired: false };

  const requests = ((reqs.data && reqs.data.results) || [])
    .filter(r => String(r.url || '').includes('/api/dialer/hook/'));
  const mine = (hookUrl && requests.find(r => String(r.url || '').startsWith(hookUrl))) || requests[0] || null;

  let automation = null, action = null;
  if (mine) {
    const acts = await apiGet(account, '/api/webhookactions/', { params: { limit: 200 } });
    action = ((acts.data && acts.data.results) || []).find(a => a.http_request === mine.id) || null;
    if (action) automation = ((autos.data && autos.data.results) || []).find(a => a.id === action.automation) || null;
  }

  return {
    ok: true,
    error: null,
    wired: !!(mine && action && automation),
    dry_run: !!(mine && /[?&]dry=1/.test(mine.url || '')),
    active: automation ? !!automation.active : false,
    request: mine ? { id: mine.id, url: mine.url, method: mine.request_type, content_type: mine.content_type, body: mine.body } : null,
    action: action ? { id: action.id, active: action.active } : null,
    automation: automation
      ? { id: automation.id, name: automation.name, active: automation.active, condition_set: automation.condition_set }
      : null,
  };
}

/**
 * Create (or update) the whole chain so a transfer in CallTools reaches the CRM.
 * Idempotent by construction: an existing request/automation for this hook URL
 * is UPDATED rather than duplicated, because a second automation on the same
 * disposition would post every transfer twice.
 */
async function provisionWiring(account, { hookUrl, dispositionIds, dispositionLabel, dryRun = true }) {
  if (!hookUrl) return { ok: false, error: 'no webhook URL' };
  const ids = (dispositionIds || []).map(Number).filter(Number.isFinite);
  if (!ids.length) return { ok: false, error: 'pick at least one transfer disposition first' };

  const url = dryRun ? `${hookUrl}?dry=1` : hookUrl;
  const existing = await readWiring(account, hookUrl);

  const requestBody = {
    name: `${WIRING_NAME}${dryRun ? ' (dry run)' : ' (LIVE)'}`,
    description: dryRun
      ? 'Maps and logs in the CRM; writes nothing. Turn off dry run to create real transfers.'
      : 'Creates the pending transfer in the CRM.',
    url,
    trigger_model: 'Call Disposition',
    request_type: 'Post',
    content_type: 'Application Json',
    headers: {},
    body: webhookBody(dispositionLabel || 'XFER'),
  };

  let reqId = existing.request && existing.request.id;
  if (reqId) {
    const r = await apiWrite(account, 'put', `/api/httprequests/${reqId}/`, { id: reqId, ...requestBody });
    if (!r.ok) return { ok: false, error: `updating the webhook: ${r.error}` };
  } else {
    const r = await apiWrite(account, 'post', '/api/httprequests/', requestBody);
    if (!r.ok) return { ok: false, error: `creating the webhook: ${r.error}` };
    reqId = r.data && r.data.id;
  }

  // One condition per chosen disposition, OR-ed — the shape CallTools' own
  // condition builder produces.
  const condition_set = {
    operator: 'and',
    child_sets: [{
      operator: 'or',
      child_sets: [],
      conditions: ids.map(id => ({
        operator: 'equals',
        value_left: '{{%locals[historicalcalldisposition][disposition_id]}}',
        value_right: id,
      })),
    }],
    conditions: [],
  };

  const automationBody = {
    name: AUTOMATION_NAME,
    description: 'Created by the BizTrix CRM Dialers page. Fires the CRM webhook when an agent marks a call transferred.',
    active: true,
    trigger_model: 'Call Disposition',
    connector_buttons: [],
    condition_set,
  };

  let autoId = existing.automation && existing.automation.id;
  if (autoId) {
    const a = await apiWrite(account, 'put', `/api/automations/${autoId}/`, { id: autoId, ...automationBody });
    if (!a.ok) return { ok: false, error: `updating the automation: ${a.error}` };
  } else {
    const a = await apiWrite(account, 'post', '/api/automations/', automationBody);
    if (!a.ok) return { ok: false, error: `creating the automation: ${a.error}` };
    autoId = a.data && a.data.id;
  }

  if (!existing.action) {
    // /api/actions/ is read-only; the writable endpoint is per action type.
    const act = await apiWrite(account, 'post', '/api/webhookactions/', {
      name: 'Post XFER to BizTrix CRM',
      description: '',
      active: true,
      automation: autoId,
      http_request: reqId,
    });
    if (!act.ok) return { ok: false, error: `linking the automation to the webhook: ${act.error}` };
  }

  logger.success('DIALER_WIRING', `CallTools ${account.name}: webhook ${reqId} + automation ${autoId} ${dryRun ? '(dry run)' : 'LIVE'}`);
  return { ok: true, error: null, request_id: reqId, automation_id: autoId, dry_run: dryRun, url };
}

// Turn the live webhook on or off without rebuilding anything.
async function setActive(account, { hookUrl, active }) {
  const w = await readWiring(account, hookUrl);
  if (!w.ok || !w.automation) return { ok: false, error: 'nothing is wired up yet' };
  const r = await apiWrite(account, 'patch', `/api/automations/${w.automation.id}/`, { active: !!active });
  return r.ok ? { ok: true, active: !!active } : { ok: false, error: r.error };
}

module.exports = { remoteDispositions, remoteAgents, readWiring, provisionWiring, setActive, webhookBody, apiWrite };

// ============================================================================
// dialers/normalize.js — one dialer payload in, one canonical call out.
//
// This is the only place that decides WHAT a webhook means. Everything after it
// (the bridge, the transfer logic, QA) sees the same shape whether the call came
// from VICIdial's token-substituted URL or CallTools' JSON.
//
// Three decisions are made here and nowhere else:
//
//  1. LEG — fronter or closer. A dialer does not know the CRM's two-sided
//     topology, so it is derived: an explicitly mapped `leg` wins, then the
//     account's leg_rules (match on campaign / queue / list), then the
//     account's default_leg.
//
//  2. EVENT TYPE — xfer (this call became a transfer), dispo (an outcome on an
//     existing lead) or call (record it for QA only). A mapped event_type wins;
//     otherwise a FRONTER call whose disposition is in the account's
//     xfer_dispos is an xfer and everything else is a dispo. This mirrors the
//     VICIdial XFER gate exactly, including its reason: the dialer fires on
//     EVERY disposition, and only the transfer ones may create a transfer.
//
//  3. CODE — the correlation key. A bare numeric lead id is only unique inside
//     one dialer, so the account's prefix is stamped onto it (CT88421), giving
//     the same globally-unique shape a VICIdial vendor_lead_code has. Without
//     this, two dialers both numbering leads from 1 would collide on the same
//     transfer — the exact failure migration 291 and boxForCode exist to
//     prevent on the VICIdial side.
// ============================================================================

const { applyMap, firstRule, isEmpty, toSeconds } = require('./mapping');
const { withPreset } = require('./accounts');
const { normPhone } = require('../uploadService');
const { CANONICAL_FIELDS } = require('./providers');

const CANONICAL_KEYS = new Set(CANONICAL_FIELDS.map(f => f.key));
const upper = (v) => String(v || '').trim().toUpperCase();

// Talk time is read through the SAME helper the `seconds` transform uses
// (mapping.js), so a mapping that carries the transform and one that does not
// can never disagree about what a duration means.

// Merge everything the request carried into one object to map against. Query
// first so a body field of the same name wins — a GET-style dialer puts
// everything in the query string, a JSON one in the body, and a few send both.
function mergePayload(req) {
  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
  const query = (req.query && typeof req.query === 'object') ? req.query : {};
  const merged = { ...query, ...body };
  // Keep the envelope addressable too, so a mapping can say "__query.agent" or
  // "__body.data.user.username" explicitly when the flat merge is ambiguous.
  return Object.assign(merged, { __query: query, __body: body });
}

function resolveLeg(account, payload, mapped) {
  const explicit = String(mapped.leg || '').trim().toLowerCase();
  if (explicit === 'fronter' || explicit === 'closer') return explicit;
  const rule = firstRule(payload, (account.settings || {}).leg_rules);
  const fromRule = String((rule && (rule.leg || rule.set)) || '').trim().toLowerCase();
  if (fromRule === 'fronter' || fromRule === 'closer') return fromRule;
  const def = String((account.settings || {}).default_leg || 'fronter').toLowerCase();
  return def === 'closer' ? 'closer' : 'fronter';
}

function resolveEventType(account, mapped, leg, dispo) {
  const explicit = String(mapped.event_type || '').trim().toLowerCase();
  if (['xfer', 'transfer'].includes(explicit)) return 'xfer';
  if (['dispo', 'disposition'].includes(explicit)) return 'dispo';
  if (['call', 'qa', 'log'].includes(explicit)) return 'call';

  const xferDispos = ((account.settings || {}).xfer_dispos || []).map(upper).filter(Boolean);
  if (leg === 'fronter' && dispo && xferDispos.includes(dispo)) return 'xfer';
  return 'dispo';
}

// A lead id the CRM can match on across the whole estate.
function resolveCode(account, mapped) {
  const raw = String(mapped.code || '').trim();
  if (!raw) return null;
  const prefix = upper(account.prefix);
  if (!prefix) return raw;
  if (raw.toUpperCase().startsWith(prefix)) return raw.toUpperCase();
  // Only a BARE id gets the prefix — an already-qualified code from another
  // system is left exactly as it arrived.
  return /^\d+$/.test(raw) ? `${prefix}${raw}` : raw;
}

/**
 * Turn a raw request into the canonical call.
 * Shape: { ok, reason, event_type, leg, agent, phone, normalized_phone, dispo,
 *          code, external_call_id, talk_time, call_at, term, recording_url,
 *          recording_id, customer{}, extras{}, mapped{}, payload{} }
 */
function normalizeEvent(rawAccount, req) {
  const account = withPreset(rawAccount);
  const payload = mergePayload(req);
  const mapped = applyMap(payload, account.field_map);

  const leg = resolveLeg(account, payload, mapped);
  const dispo = upper(mapped.dispo) || null;
  const event_type = resolveEventType(account, mapped, leg, dispo);
  const code = resolveCode(account, mapped);
  const phone = mapped.phone ? String(mapped.phone).trim() : null;

  // Anything mapped that is not a canonical field travels with the call and
  // ends up under form_data.dialer, visible to the closer and to QA. A dialer
  // that sends a custom "vehicle_vin" is not made to wait for a code change.
  const extras = {};
  for (const [k, v] of Object.entries(mapped)) if (!CANONICAL_KEYS.has(k)) extras[k] = v;

  const ignore = ((account.settings || {}).ignore_dispos || []).map(upper).filter(Boolean);
  const ignored = !!(dispo && ignore.includes(dispo));

  const out = {
    ok: true,
    reason: null,
    account_id: account.id,
    provider: account.provider,
    event_type: ignored ? 'ignored' : event_type,
    leg,
    agent: mapped.agent ? String(mapped.agent).trim() : null,
    phone,
    normalized_phone: phone ? (normPhone(phone) || null) : null,
    dispo,
    code,
    external_call_id: mapped.external_call_id ? String(mapped.external_call_id).trim() : null,
    // A dialer that sends everything as strings ("talk_time":"184") is the
    // norm, not the exception — a form-encoded webhook cannot send anything
    // else. Requiring the mapping to carry a transform for that meant the
    // duration was silently dropped (measured against CallTools' live payload),
    // and a QA row with no duration looks like a call that never connected.
    talk_time: toSeconds(mapped.talk_time),
    call_at: mapped.call_at || null,
    term: mapped.term ? upper(mapped.term) : null,
    recording_url: mapped.recording_url ? String(mapped.recording_url).trim() : null,
    recording_id: mapped.recording_id ? String(mapped.recording_id).trim() : null,
    customer: {
      first: mapped.first || null, last: mapped.last || null,
      address: mapped.address || null, city: mapped.city || null,
      state: mapped.state || null, zip: mapped.zip || null,
      email: mapped.email || null, alt_phone: mapped.alt_phone || null,
      comments: mapped.comments || null, list_id: mapped.list_id || null,
      campaign: mapped.campaign || null,
      car_make: mapped.car_make || null, car_model: mapped.car_model || null,
      car_year: mapped.car_year || null,
    },
    extras,
    mapped,
    payload,
  };

  // WHY A BAD EVENT IS NOT AN ERROR. A dialer that gets a 4xx/5xx retries, and
  // a mapping that is not finished yet would then be hammered by every agent on
  // the floor. An event that cannot be used is ACCEPTED, recorded with the
  // reason, and shown in the admin event log — which is also where the operator
  // goes to fix the mapping that caused it.
  if (ignored) { out.ok = false; out.reason = `disposition "${dispo}" is on the account's ignore list`; return out; }
  if (!out.agent) { out.ok = false; out.reason = 'no agent in the payload — map the "Agent id" field'; return out; }
  if (!out.phone && !out.code) { out.ok = false; out.reason = 'no customer phone and no lead code — nothing to match on'; return out; }
  return out;
}

// Which required fields this account's OWN mapping is missing.
//
// Deliberately NOT merged with the provider preset first: an account created
// from a preset already holds a copy of it, so a preset-merged check can never
// report a gap and the warning it drives would be decorative. What this catches
// is the case that actually happens — a mapping edited by hand, or an account
// built for a dialer whose preset does not know the field — and what the admin
// list adds on top of it is the honest evidence: which required fields failed
// to resolve on the calls that really arrived.
function mappingGaps(account) {
  const map = (account && account.field_map) || {};
  return CANONICAL_FIELDS.filter(f => f.required && isEmpty(map[f.key])).map(f => f.key);
}

module.exports = { normalizeEvent, mergePayload, mappingGaps, resolveLeg, resolveEventType, resolveCode };

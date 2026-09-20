// ============================================================================
// dialers/mapping.js — read ANY dialer's payload into the CRM's canonical call.
//
// Every dialer describes the same call differently. VICIdial substitutes tokens
// into a URL (--A--agent_user--B--), CallTools posts nested JSON, the next one
// will do something else again. Rather than write a parser per product, the
// SHAPE of the payload is configuration: dialer_accounts.field_map says where
// each canonical field lives, and this file is the one interpreter for it.
//
// A mapping value can be:
//   "call.agent.username"                     a path
//   ["user.username", "agent_id"]             first path that is non-empty wins
//   { path, paths, const, template, transform, transforms, map, default,
//     regex, group }                          everything else
//
// Paths accept dots and array indexes: "call.legs[0].agent.name". A path that
// does not resolve is simply empty — a mapping is never allowed to throw, and
// a half-mapped account must still produce whatever it CAN produce, because a
// webhook that 500s gets retried by the dialer for ever.
//
// transform (or transforms: [..] applied in order):
//   trim upper lower digits phone10 int float abs
//   seconds       ms -> s when the number looks like milliseconds (>= 100000)
//   ms_to_seconds always divide by 1000
//   iso           anything Date can parse -> ISO-8601 UTC
//   first_word last_words   split a full name
//   bool json string
// ============================================================================

// One value out of a payload by path. Returns undefined when any hop is absent.
function getPath(obj, path) {
  if (obj == null || !path) return undefined;
  const parts = String(path)
    .replace(/\[(\d+)\]/g, '.$1')   // a[0].b -> a.0.b
    .split('.')
    .filter(Boolean);
  let cur = obj;
  for (const part of parts) {
    if (cur == null) return undefined;
    // A JSON string nested inside the payload (dialers do this with "data")
    // is still addressable — parse it once, on demand.
    if (typeof cur === 'string') {
      try { cur = JSON.parse(cur); } catch { return undefined; }
    }
    if (typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

const isEmpty = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

// Flatten a payload to path -> scalar, for the mapping editor's field picker.
// Bounded: a runaway payload must not produce a 10k-key object in the UI.
function flatten(obj, { prefix = '', out = {}, depth = 0, maxKeys = 400 } = {}) {
  if (depth > 6 || Object.keys(out).length >= maxKeys) return out;
  if (obj == null) return out;
  if (typeof obj !== 'object') { out[prefix || 'value'] = obj; return out; }
  const entries = Array.isArray(obj)
    ? obj.slice(0, 10).map((v, i) => [`[${i}]`, v])
    : Object.entries(obj).slice(0, 200);
  for (const [k, v] of entries) {
    const key = Array.isArray(obj) ? `${prefix}${k}` : (prefix ? `${prefix}.${k}` : k);
    if (v && typeof v === 'object') flatten(v, { prefix: key, out, depth: depth + 1, maxKeys });
    else out[key] = v;
    if (Object.keys(out).length >= maxKeys) break;
  }
  return out;
}

// ── transforms ──────────────────────────────────────────────────────────────
const TRANSFORMS = {
  trim:   (v) => String(v).trim(),
  upper:  (v) => String(v).trim().toUpperCase(),
  lower:  (v) => String(v).trim().toLowerCase(),
  digits: (v) => String(v).replace(/\D/g, ''),
  phone10: (v) => {
    const d = String(v).replace(/\D/g, '');
    return d.length > 10 ? d.slice(-10) : d;
  },
  int:   (v) => { const n = parseInt(String(v).replace(/[^0-9.-]/g, ''), 10); return Number.isFinite(n) ? n : null; },
  float: (v) => { const n = parseFloat(String(v).replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : null; },
  abs:   (v) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.abs(n) : null; },
  // Talk time arrives as seconds on one dialer and milliseconds on the next.
  // A call is never 100000 seconds (27 hours), so that is the safe boundary.
  seconds: (v) => {
    const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(n)) return null;
    return Math.round(n >= 100000 ? n / 1000 : n);
  },
  ms_to_seconds: (v) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.round(n / 1000) : null; },
  // "2026-09-21 14:03:11" (CallTools documents its datetimes as UTC, with no
  // zone on the wire) must not be read as local time — that silently shifts
  // every call by the server's offset.
  iso: (v) => {
    if (v == null || v === '') return null;
    let s = String(v).trim();
    if (/^\d{10}$/.test(s)) return new Date(Number(s) * 1000).toISOString();
    if (/^\d{13}$/.test(s)) return new Date(Number(s)).toISOString();
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s)) s = s.replace(' ', 'T') + 'Z';
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  },
  first_word: (v) => String(v).trim().split(/\s+/)[0] || '',
  last_words: (v) => String(v).trim().split(/\s+/).slice(1).join(' '),
  bool: (v) => ['1', 'true', 'yes', 'y', 'on'].includes(String(v).trim().toLowerCase()),
  string: (v) => (v == null ? '' : String(v)),
  json: (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return v; } },
};

function applyTransforms(value, spec) {
  const list = []
    .concat(spec.transforms || [])
    .concat(spec.transform ? [spec.transform] : []);
  let out = value;
  for (const name of list) {
    const fn = TRANSFORMS[String(name)];
    if (!fn) continue;
    if (out === null || out === undefined) break;
    try { out = fn(out); } catch { out = null; }
  }
  return out;
}

// "{{contact.first_name}} {{contact.last_name}}" -> interpolated string.
function renderTemplate(tpl, payload) {
  return String(tpl).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, p) => {
    const v = getPath(payload, p);
    return isEmpty(v) ? '' : String(v);
  }).trim();
}

// Resolve ONE canonical field from the payload.
function resolveField(payload, spec) {
  if (spec === null || spec === undefined) return null;
  if (typeof spec === 'string') return resolveField(payload, { path: spec });
  if (Array.isArray(spec)) return resolveField(payload, { paths: spec });
  if (typeof spec !== 'object') return spec;

  let value;
  if ('const' in spec) value = spec.const;
  else if (spec.template) value = renderTemplate(spec.template, payload);
  else {
    const paths = [].concat(spec.paths || []).concat(spec.path ? [spec.path] : []);
    for (const p of paths) {
      const v = getPath(payload, p);
      if (!isEmpty(v)) { value = v; break; }
    }
  }

  if (!isEmpty(value) && spec.regex) {
    try {
      const group = spec.group == null ? 1 : spec.group;
      const m = new RegExp(spec.regex, spec.flags || '').exec(String(value));
      value = m ? (m[group] == null ? m[0] : m[group]) : null;
    } catch { /* a bad regex must not take the webhook down */ }
  }

  if (!isEmpty(value)) value = applyTransforms(value, spec);

  // A value map ("Sale" -> "SALE", "Queue 4" -> "closer"). Case-insensitive,
  // with "*" as the catch-all for anything present but unlisted.
  if (spec.map && !isEmpty(value)) {
    const key = String(value).trim().toLowerCase();
    const entry = Object.entries(spec.map).find(([k]) => String(k).trim().toLowerCase() === key);
    if (entry) value = entry[1];
    else if ('*' in spec.map) value = spec.map['*'];
  }

  if (isEmpty(value)) value = 'default' in spec ? spec.default : null;
  return value === undefined ? null : value;
}

// The whole canonical object. Unknown map keys are passed through untouched, so
// an account can carry extra fields the CRM does not know about yet (they land
// in form_data.dialer and are visible to QA).
function applyMap(payload, fieldMap) {
  const out = {};
  for (const [field, spec] of Object.entries(fieldMap || {})) {
    const v = resolveField(payload, spec);
    if (!isEmpty(v)) out[field] = v;
  }
  return out;
}

// A rule list: [{ when: {path, equals|contains|matches|in|exists}, ... }]
// Used for leg_rules / event_rules, where the answer depends on a queue name, a
// campaign, or a disposition rather than on one field being present.
function matchRule(payload, when) {
  if (!when) return true;
  const v = getPath(payload, when.path);
  const s = isEmpty(v) ? '' : String(v).trim().toLowerCase();
  if ('equals' in when)   return s === String(when.equals).trim().toLowerCase();
  if ('contains' in when) return s.includes(String(when.contains).trim().toLowerCase());
  if ('in' in when)       return (when.in || []).map(x => String(x).trim().toLowerCase()).includes(s);
  if ('matches' in when)  { try { return new RegExp(when.matches, 'i').test(s); } catch { return false; } }
  if ('exists' in when)   return when.exists ? !isEmpty(v) : isEmpty(v);
  return true;
}

function firstRule(payload, rules) {
  for (const r of (rules || [])) if (matchRule(payload, r.when)) return r;
  return null;
}

module.exports = {
  getPath, flatten, resolveField, applyMap, renderTemplate,
  matchRule, firstRule, isEmpty, TRANSFORMS,
  TRANSFORM_NAMES: Object.keys(TRANSFORMS),
};

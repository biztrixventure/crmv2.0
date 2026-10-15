// ============================================================================
// scratchpad.js — who may use the private spreadsheet and notepad.
//
// TWO LAYERS, AND THE PERSON'S OWN ROW ALWAYS WINS — deliberately the same
// shape as utils/customerLookup.js, because it is the same question and a
// superadmin should not have to learn a second mental model to answer it:
//
//   scratchpad.default_access   what EVERYONE gets      {sheet, note}
//   scratchpad.users            per-user override       {<uuid>: {sheet, note}}
//
// An absent key follows the default; an explicit `false` against an all-on
// default is how ONE person is shut out of a tool everybody else has.
//
// THE CODE FALLBACK IS ON HERE, and that is the one deliberate difference from
// customerLookup. That tool reaches a paid third party and leaks PII, so a
// fresh install must grant nothing. This one is a private notepad: it reads no
// customer data, calls nothing, and costs a row nobody else can see. Shipping
// it off by default would mean a superadmin granting it by hand sixty times to
// arrive at the obvious answer — which is the chore the two-layer design
// exists to kill.
// ============================================================================

const { supabaseAdmin } = require('../config/database');
const { getConfig, setConfig } = require('./businessConfig');

const KINDS = ['sheet', 'note'];

// ~1 MB, matching the CHECK constraint in mig 347. Enforced here too so a
// client gets a clean 413 with a reason instead of a raw 23514 from Postgres.
const MAX_BYTES = 1024 * 1024;

async function userMap() {
  const m = await getConfig(null, 'scratchpad.users', {});
  return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
}

async function defaultAccess() {
  const d = await getConfig(null, 'scratchpad.default_access', null);
  // No row configured yet => both on. See the header for why this differs
  // from customerLookup's all-off fallback.
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { sheet: true, note: true };
  return { sheet: d.sheet !== false, note: d.note !== false };
}

async function setDefaultAccess(patch, updatedBy) {
  const next = { ...(await defaultAccess()) };
  for (const k of KINDS) if (patch && patch[k] !== undefined) next[k] = !!patch[k];
  await setConfig('global', 'scratchpad.default_access', next, updatedBy);
  return next;
}

// What this person may actually open. `explicit` is what the admin UI needs to
// tell "following the default" apart from "deliberately off" — without it a
// toggle cannot show the difference and every user looks individually set.
async function accessFor(userId, { superadmin = false } = {}) {
  const [map, dflt] = await Promise.all([userMap(), defaultAccess()]);
  const row = map[userId] || {};
  const resolve = (k) => (superadmin ? true : (row[k] === undefined ? dflt[k] : !!row[k]));
  return {
    sheet: resolve('sheet'),
    note: resolve('note'),
    defaults: dflt,
    explicit: Object.fromEntries(KINDS.filter(k => row[k] !== undefined).map(k => [k, !!row[k]])),
  };
}

async function setAccess(userId, patch, updatedBy) {
  const [map, dflt] = await Promise.all([userMap(), defaultAccess()]);
  const row = { ...(map[userId] || {}) };
  for (const k of KINDS) if (patch && patch[k] !== undefined) row[k] = !!patch[k];
  // Drop a row that no longer says anything the default does not already say,
  // so the config does not grow a tombstone for every user ever toggled.
  const redundant = KINDS.every(k => row[k] === undefined || !!row[k] === !!dflt[k]);
  if (redundant) delete map[userId];
  else map[userId] = row;
  await setConfig('global', 'scratchpad.users', map, updatedBy);
  return row;
}

// ── the documents themselves ────────────────────────────────────────────────
// Every query scopes to the caller's own id. There is no path that takes a
// user id from the client, which is what makes this safe to leave policy-less
// behind the service role.

async function load(userId, kind) {
  const { data, error } = await supabaseAdmin
    .from('user_scratchpad').select('data, updated_at')
    .eq('user_id', userId).eq('kind', kind).maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function save(userId, kind, payload) {
  const bytes = Buffer.byteLength(JSON.stringify(payload ?? {}), 'utf8');
  if (bytes > MAX_BYTES) {
    const e = new Error('This document is too large to save. Trim it and try again.');
    e.tooLarge = true;
    throw e;
  }
  const { error } = await supabaseAdmin
    .from('user_scratchpad')
    .upsert({ user_id: userId, kind, data: payload ?? {}, updated_at: new Date().toISOString() },
            { onConflict: 'user_id,kind' });
  if (error) throw new Error(error.message);
  return { bytes };
}

module.exports = { KINDS, MAX_BYTES, accessFor, setAccess, defaultAccess, setDefaultAccess, load, save };

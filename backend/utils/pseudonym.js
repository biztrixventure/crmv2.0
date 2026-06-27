/**
 * Pseudonyms for users shown to EXTERNAL viewers (client recording portal +
 * guest chat). Returns the admin-set alias if present, else a stable, non-
 * identifying fallback derived from the user id — so a real name is NEVER
 * leaked, even before an alias is assigned. Internal views use real names.
 */
const { supabaseAdmin } = require('../config/database');

function autoPseudo(userId) {
  const hex = String(userId || '').replace(/[^a-f0-9]/gi, '').slice(0, 4).toUpperCase() || '0000';
  return `Agent ${hex}`;
}

// Map userId → external display name (alias || stable fallback).
async function getPseudoNames(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;
  const rows = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabaseAdmin
      .from('user_profiles').select('user_id, display_alias').in('user_id', ids.slice(i, i + 200));
    if (data) rows.push(...data);
  }
  const aliasById = Object.fromEntries(rows.map(p => [p.user_id, (p.display_alias || '').trim()]));
  for (const id of ids) map.set(id, aliasById[id] || autoPseudo(id));
  return map;
}

module.exports = { autoPseudo, getPseudoNames };

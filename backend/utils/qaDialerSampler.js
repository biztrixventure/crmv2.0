// ============================================================================
// utils/qaDialerSampler.js — RCM sampling from RAW dialer calls.
//
// The department's model:
//   TRA = the calls that are IN the CRM (a transfer means TRA — full coverage).
//   RCM = RANDOM calls of the users straight off the dialer — actual raw
//         recordings, NOT CRM records. This sampler implements that: it pulls a
//         day's raw recordings for the company's users, EXCLUDES numbers that
//         exist in the CRM (those are TRA territory — the sections stay
//         separate), groups redials, and randomly samples per the company's
//         qa.rcm.sample config.
//
// Sampled once per day (previous complete day; the `period` column = that day
// guards re-runs, so the hourly job short-circuits without touching the
// dialer). A weekly quota is spread evenly across days. Rows are created
// UNASSIGNED with a full recording_ref — the work-rules engine / coverage
// round-robin routes them right after (materializeCompany ordering).
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const logger = require('./logger');
const { listDayRecordings } = require('./dialerBoxes');

const onlyDigits = s => String(s || '').replace(/\D/g, '');
const tail10 = p => { const d = onlyDigits(p); return d.length >= 10 ? d.slice(-10) : d; };

// The company's dialer-mapped users, with each agent id's owner ROLE — covers
// decides which roles get sampled, and the recording's agent decides the
// assignment's subject_role (the user the review grades).
async function companyDialerAgents(companyId, covers) {
  const want = new Set((Array.isArray(covers) && covers.length ? covers : ['fronter'])
    .flatMap(r => r === 'closer' ? ['closer', 'closer_manager'] : ['fronter', 'fronter_manager']));
  const { data: ucr } = await supabaseAdmin.from('user_company_roles')
    .select('user_id, custom_roles(level)').eq('company_id', companyId).eq('is_active', true);
  const lvl = (cr) => Array.isArray(cr) ? cr[0]?.level : cr?.level;
  const roleByUid = {};
  for (const r of (ucr || [])) { const l = lvl(r.custom_roles); if (want.has(l)) roleByUid[r.user_id] = /closer/.test(l) ? 'closer' : 'fronter'; }
  const uids = Object.keys(roleByUid);
  if (!uids.length) return { ids: [], roleByAgent: {}, nameByAgent: {} };
  const { data: profs } = await supabaseAdmin.from('user_profiles')
    .select('user_id, first_name, last_name, vicidial_agent_ids').in('user_id', uids).not('vicidial_agent_ids', 'is', null);
  const ids = new Set(); const roleByAgent = {}; const nameByAgent = {};
  for (const p of (profs || [])) for (const a of (p.vicidial_agent_ids || [])) {
    const A = String(a).toUpperCase(); if (!A) continue;
    ids.add(A); roleByAgent[A] = roleByUid[p.user_id];
    const nm = `${p.first_name || ''} ${p.last_name || ''}`.trim();
    if (nm) nameByAgent[A] = nm;
  }
  return { ids: [...ids], roleByAgent, nameByAgent };
}

// Insert rows tolerating both the recording-unique guard (already-assigned
// clips) and a missing work_type column (mig 186 not applied yet).
async function insertRows(rows) {
  if (!rows.length) return 0;
  const tryInsert = async (list) => supabaseAdmin.from('qa_assignments').insert(list).select('id');
  let { data, error } = await tryInsert(rows);
  if (error && /work_type/i.test(error.message)) {
    const stripped = rows.map(({ work_type, ...rest }) => rest);   // eslint-disable-line no-unused-vars
    ({ data, error } = await tryInsert(stripped));
  }
  if (!error) return (data || []).length;
  if (!/duplicate key|unique/i.test(error.message)) { logger.warn('QA_RCM', `insert: ${error.message}`); return 0; }
  let n = 0;
  for (const row of rows) {
    let { error: e1 } = await supabaseAdmin.from('qa_assignments').insert(row);
    if (e1 && /work_type/i.test(e1.message)) { const { work_type, ...rest } = row; ({ error: e1 } = await supabaseAdmin.from('qa_assignments').insert(rest)); } // eslint-disable-line no-unused-vars
    if (!e1) n++;
  }
  return n;
}

// Sample the PREVIOUS complete day's raw dialer calls for one company.
// Returns the number of RCM tasks created (0 when already sampled today).
async function sampleRcmFromDialer(companyId, { covers, sample } = {}) {
  const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);   // yesterday UTC

  // one sample per day — if any dialer-random rows exist for this day, done.
  const { count: already } = await supabaseAdmin.from('qa_assignments')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', companyId).eq('source', 'dialer_random').eq('period', day);
  if (already > 0) return 0;

  const { ids, roleByAgent, nameByAgent } = await companyDialerAgents(companyId, covers);
  if (!ids.length) { logger.info('QA_RCM', `${companyId}: no dialer-mapped users to sample`); return 0; }

  const recs = await listDayRecordings({ date: day, agentIds: ids });
  if (!recs.length) return 0;

  // numbers that live in the CRM around that day are TRA territory — exclude,
  // so RCM stays purely the raw, non-CRM calls (sections separated).
  const { data: crm } = await supabaseAdmin.from('transfers')
    .select('normalized_phone').eq('company_id', companyId)
    .gte('created_at', `${day}T00:00:00Z`).lte('created_at', new Date(new Date(day).getTime() + 2 * 86400000).toISOString())
    .limit(5000);
  const crmTails = new Set((crm || []).map(t => tail10(t.normalized_phone)).filter(Boolean));

  // group redials: one candidate per (agent, phone); primary = longest clip
  const groups = new Map();
  for (const r of recs) {
    if (!r.recording_id) continue;
    const phone = tail10(r.phone);
    if (phone && crmTails.has(phone)) continue;                    // CRM number → TRA's job
    const key = (r.agent_user || '?') + '|' + (phone || 'rec:' + r.recording_id);
    const g = groups.get(key) || { agent_user: r.agent_user, phone: r.phone || null, parts: [] };
    g.parts.push(r);
    groups.set(key, g);
  }
  const pool = [...groups.values()];
  if (!pool.length) return 0;

  // quota per the company's sample config; weekly quotas spread across 7 days
  const mode = sample?.mode === 'fixed' ? 'fixed' : 'percentage';
  const value = Number.isFinite(+sample?.value) ? +sample.value : 10;
  const quota = mode === 'fixed'
    ? Math.max(1, sample?.period === 'week' ? Math.ceil(value / 7) : Math.round(value))
    : Math.max(1, Math.round(pool.length * value / 100));

  // RULE-AWARE sampling: if an active RCM rule restricts to specific users, the
  // sample MUST contain those users' calls (otherwise "listen to these 3 users"
  // routes nothing when the random draw happens to miss them). Collect the
  // dialer ids those rules target, take their calls FIRST, then fill the rest of
  // the quota with a random draw. No specific-user RCM rule → pure random (old
  // behaviour), since targetAgents stays empty.
  const targetAgents = new Set();
  try {
    const { data: rules } = await supabaseAdmin.from('qa_routing_rules')
      .select('subject_user_ids, work_types').eq('company_id', companyId).eq('is_active', true);
    const wantUids = [...new Set((rules || []).filter(r => (r.work_types || []).includes('rcm') && (r.subject_user_ids || []).length).flatMap(r => r.subject_user_ids))];
    if (wantUids.length) {
      const { data: tp } = await supabaseAdmin.from('user_profiles').select('vicidial_agent_ids').in('user_id', wantUids);
      for (const p of (tp || [])) for (const a of (p.vicidial_agent_ids || [])) targetAgents.add(String(a).toUpperCase());
    }
  } catch { /* no rules table yet → pure random */ }

  const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  let picked;
  if (targetAgents.size) {
    const isTarget = g => targetAgents.has(String(g.agent_user || '').toUpperCase());
    const targeted = shuffle(pool.filter(isTarget));
    const rest = shuffle(pool.filter(g => !isTarget(g)));
    picked = [...targeted, ...rest].slice(0, Math.min(quota, pool.length));
  } else {
    picked = shuffle(pool).slice(0, Math.min(quota, pool.length));
  }

  const cleanPart = (p) => ({ box_id: p.box_id, recording_id: String(p.recording_id), lead_id: p.lead_id || null, location: p.location || null, start_time: p.start_time || null, duration: p.duration ?? null, agent_user: p.agent_user || null });
  const rows = picked.map(g => {
    g.parts.sort((a, b) => (b.duration || 0) - (a.duration || 0));
    const primary = g.parts[0];
    return {
      company_id: companyId, method: 'rcm',
      subject_role: roleByAgent[String(g.agent_user || '').toUpperCase()] || 'fronter',
      work_type: 'rcm', source: 'dialer_random', status: 'pending', sampled: true, period: day,
      recording_ref: { ...cleanPart(primary), agent_name: nameByAgent[String(g.agent_user || '').toUpperCase()] || null, phone: g.phone, parts: g.parts.length > 1 ? g.parts.map(cleanPart) : undefined },
      recording_date: day, subject_agent: g.agent_user || null,
      customer_phone: g.phone || null,
    };
  });
  const n = await insertRows(rows);
  if (n) logger.info('QA_RCM', `${companyId}: sampled ${n}/${pool.length} raw dialer call(s) for ${day}`);
  return n;
}

module.exports = { sampleRcmFromDialer };

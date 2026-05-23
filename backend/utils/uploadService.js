const { supabaseAdmin } = require('../config/database');
const { etWallClockToUtc } = require('./etUtils');

// transfer_status values guaranteed to exist in the DB enum (migration 000).
// Anything else from the file falls back to 'pending' (same default the manual
// create flow uses), so a bad status string never breaks the insert.
const SAFE_STATUSES = ['pending', 'assigned', 'completed', 'cancelled'];

// Normalize a name for matching: trim, collapse spaces, lowercase.
const normName = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

// Normalize a CLI / phone number to its last 10 digits so "(555) 123-4567",
// "555-123-4567" and "5551234567" all compare equal.
const normPhone = (p) => String(p || '').replace(/\D/g, '').slice(-10);

const safeStatus = (s) => {
  const v = String(s || '').trim().toLowerCase();
  return SAFE_STATUSES.includes(v) ? v : 'pending';
};

// ============================================================================
// Reference data — every active company plus its fronter users, used both for
// the on-screen "valid names" guide and for resolving uploaded name strings to
// real company_id / fronter user_id values.
//
// Cached for 30s: a 2000-row upload validates in ~20 chunks; without the cache
// each chunk would re-query companies + all roles + profiles. The TTL is short
// enough that role/company edits are reflected within the same minute.
// ============================================================================
let _refCache = { data: null, at: 0 };
const REF_TTL_MS = 30000;

async function getReference({ fresh = false } = {}) {
  if (!fresh && _refCache.data && (Date.now() - _refCache.at) < REF_TTL_MS) return _refCache.data;
  const data = await loadReference();
  _refCache = { data, at: Date.now() };
  return data;
}

async function loadReference() {
  const { data: companies } = await supabaseAdmin
    .from('companies').select('id, name').eq('is_active', true).order('name');

  // Fronter = a user whose active role level is 'fronter'.
  const { data: roles } = await supabaseAdmin
    .from('user_company_roles')
    .select('user_id, company_id, custom_roles(level)')
    .eq('is_active', true);
  const fronterRoles = (roles || []).filter(r => r.custom_roles?.level === 'fronter');

  const ids = [...new Set(fronterRoles.map(r => r.user_id))];
  let profiles = {};
  if (ids.length) {
    const { data } = await supabaseAdmin
      .from('user_profiles').select('user_id, first_name, last_name').in('user_id', ids);
    (data || []).forEach(p => { profiles[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim(); });
  }

  const byCompany = {};
  fronterRoles.forEach(r => {
    (byCompany[r.company_id] ||= []).push({ user_id: r.user_id, name: profiles[r.user_id] || '' });
  });

  return (companies || []).map(c => ({
    id: c.id,
    name: c.name,
    fronters: (byCompany[c.id] || []).filter(f => f.name).sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

// Build fast lookup maps from reference data.
function buildIndex(reference) {
  const companyByName = new Map();        // normName -> { id, name }
  const fronterByKey  = new Map();        // `${companyId}|${normName}` -> [ {user_id, name} ]
  reference.forEach(co => {
    companyByName.set(normName(co.name), { id: co.id, name: co.name });
    co.fronters.forEach(f => {
      const key = `${co.id}|${normName(f.name)}`;
      (fronterByKey.get(key) || fronterByKey.set(key, []).get(key)).push(f);
    });
  });
  return { companyByName, fronterByKey };
}

// Resolve one row's company_name + fronter_name to real IDs.
// Returns { ok, company_id, company_name, fronter_user_id, fronter_name } or
// { ok:false, reason } where reason explains the mismatch for the Unmatched list.
function resolveRow(row, index) {
  const co = index.companyByName.get(normName(row.company_name));
  if (!co) return { ok: false, reason: `Company "${row.company_name}" not found` };

  const matches = index.fronterByKey.get(`${co.id}|${normName(row.fronter_name)}`) || [];
  if (matches.length === 0) return { ok: false, reason: `No fronter "${row.fronter_name}" in ${co.name}` };
  if (matches.length > 1)  return { ok: false, reason: `"${row.fronter_name}" matches multiple fronters in ${co.name}` };

  return { ok: true, company_id: co.id, company_name: co.name, fronter_user_id: matches[0].user_id, fronter_name: matches[0].name };
}

// ============================================================================
// DUPLICATE DETECTION (the critical part)
// ----------------------------------------------------------------------------
// For a chunk of resolved rows we classify each against EXISTING DB transfers:
//
//   TRUE DUPLICATE  — same CLI(phone) + same fronter + same company.
//                     → auto-skip (caller lists it, never inserts).
//   CONFLICT        — same CLI(phone) but a DIFFERENT fronter or company.
//                     → never auto-skip; surface existing vs incoming so the
//                       superadmin decides include/exclude per row.
//   CLEAN           — CLI not seen before → safe to insert.
//
// Phone matching is done on the NORMALIZED phone (last 10 digits) so formatting
// differences don't hide a duplicate. We look the chunk's phones up two ways:
//   (a) form_data.cli_number  — set on every prior BULK insert (already normalized)
//   (b) form_data.customer_phone / Phone — where MANUAL transfers keep the number
// then normalize whatever we get back in JS before comparing. The conflict scan
// is GLOBAL (across all companies), per the spec.
// ============================================================================
async function classifyChunk(resolvedRows) {
  const clean = [], trueDuplicates = [], conflicts = [];

  // Collect the normalized + raw phones present in this chunk.
  const normSet = new Set();
  const rawSet  = new Set();
  resolvedRows.forEach(r => {
    const n = normPhone(r.cli_number);
    if (n) normSet.add(n);
    if (r.cli_number) rawSet.add(String(r.cli_number).trim());
  });

  // Build phone -> [existing transfer summaries] from the DB.
  const existingByPhone = new Map();
  const addExisting = (t) => {
    const fd = t.form_data || {};
    const n = normPhone(fd.cli_number || fd.customer_phone || fd.Phone || fd.phone);
    if (!n) return;
    (existingByPhone.get(n) || existingByPhone.set(n, []).get(n)).push({
      id: t.id, company_id: t.company_id, created_by: t.created_by, form_data: fd, created_at: t.created_at,
    });
  };

  if (normSet.size) {
    // (a) prior bulk inserts — exact match on the normalized cli_number key.
    const { data: byCli } = await supabaseAdmin
      .from('transfers')
      .select('id, company_id, created_by, form_data, created_at')
      .in('form_data->>cli_number', [...normSet]);
    (byCli || []).forEach(addExisting);
  }

  if (rawSet.size) {
    // (b) manual transfers store the number raw under customer_phone / Phone.
    // Quote each value so spaces/punctuation can't break the PostgREST filter,
    // and drop characters that can't be safely quoted. Best-effort: the
    // cli_number path above already covers re-imported bulk rows reliably, so a
    // filter hiccup here must never abort the whole validation.
    const quoted = [...rawSet]
      .map(s => String(s).replace(/["\\(),]/g, '').trim())
      .filter(Boolean)
      .map(s => `"${s}"`);
    if (quoted.length) {
      try {
        const { data: byPhone } = await supabaseAdmin
          .from('transfers')
          .select('id, company_id, created_by, form_data, created_at')
          .or(`form_data->>customer_phone.in.(${quoted.join(',')}),form_data->>Phone.in.(${quoted.join(',')})`);
        (byPhone || []).forEach(addExisting);
      } catch { /* manual-phone dedup is best-effort; ignore malformed-filter errors */ }
    }
  }

  // Classify every resolved row.
  for (const row of resolvedRows) {
    if (!row || typeof row !== 'object') continue;
    const n = normPhone(row.cli_number);
    const matches = (n && existingByPhone.get(n)) || [];

    // TRUE DUPLICATE: an existing record has the SAME phone + fronter + company.
    const exactDup = matches.find(m => m.created_by === row.fronter_user_id && m.company_id === row.company_id);
    if (exactDup) { trueDuplicates.push({ ...row, reason: 'CLI + fronter + company already exist' }); continue; }

    // CONFLICT: same phone exists but under a different fronter/company.
    if (matches.length > 0) {
      const ex = matches[0];
      conflicts.push({
        incoming: row,
        existing: {
          id: ex.id,
          company_id: ex.company_id,
          fronter_user_id: ex.created_by,
          cli_number: normPhone(ex.form_data?.cli_number || ex.form_data?.customer_phone || ex.form_data?.Phone),
          created_at: ex.created_at,
        },
      });
      continue;
    }

    clean.push(row);
  }

  return { clean, trueDuplicates, conflicts };
}

// ============================================================================
// INSERT — build a transfer row identical in shape to a manual fronter create.
// Manual flow (routes/transfers.js POST) sets: company_id, created_by (the
// fronter), form_data, status ('pending' when no closer), assigned_to/closer
// null, and creates NO disposition/activity rows. We mirror that exactly and
// additionally stamp upload_batch_id + a normalized cli_number for dedup.
// created_at/updated_at come from the file (fallback now) so history is honored.
// ============================================================================
function buildTransferRow(row, batchId) {
  const cli = String(row.cli_number || '').trim();
  // Interpret the uploaded created_at as ET wall-clock so it displays exactly as
  // entered in the ET-based panels/dashboard (no midnight-UTC / prev-day drift).
  const createdAt = etWallClockToUtc(row.created_at) || new Date().toISOString();
  // form_data is built dynamically from the mapped form-config fields (same keys
  // a manual transfer uses), so the shape is identical to a fronter-created row.
  // cli_number (normalized) is added purely as the dedup key; transfer_date is
  // preserved alongside the form fields.
  return {
    company_id:         row.company_id,
    created_by:         row.fronter_user_id,   // the fronter — NOT the uploading superadmin
    assigned_to:        null,
    assigned_closer_id: null,
    status:             safeStatus(row.status),
    form_data: {
      ...(row.form_data || {}),
      cli_number:    normPhone(cli),
      transfer_date: row.transfer_date || row.form_data?.transfer_date || null,
    },
    upload_batch_id: batchId,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

async function insertApproved(rows, batchMeta, uploaderId) {
  // Re-check true duplicates at insert time (guards against a race between
  // validate and confirm). User-approved conflicts arrive pre-resolved in `rows`
  // and are NOT true dups, so only exact (phone+fronter+company) dups get dropped.
  const { trueDuplicates } = await classifyChunk(rows);
  const dupKeys = new Set(trueDuplicates.map(d => `${normPhone(d.cli_number)}|${d.fronter_user_id}|${d.company_id}`));
  const finalRows = rows.filter(r => !dupKeys.has(`${normPhone(r.cli_number)}|${r.fronter_user_id}|${r.company_id}`));

  const { data: batch, error: bErr } = await supabaseAdmin
    .from('upload_batches')
    .insert({
      kind:           'transfer',
      file_name:      batchMeta.file_name || null,
      uploaded_by:    uploaderId,
      total_rows:     batchMeta.total_rows || finalRows.length,
      inserted_count: 0,
      skipped_count:  batchMeta.skipped_count || 0,
      conflict_count: batchMeta.conflict_count || 0,
    })
    .select().single();
  if (bErr) throw new Error(bErr.message);

  let inserted = 0;
  // Insert in DB-side chunks of 100 to keep statements bounded.
  for (let i = 0; i < finalRows.length; i += 100) {
    const slice = finalRows.slice(i, i + 100).map(r => buildTransferRow(r, batch.id));
    const { data, error } = await supabaseAdmin.from('transfers').insert(slice).select('id');
    if (error) throw new Error(error.message);
    inserted += (data || []).length;
  }

  await supabaseAdmin.from('upload_batches').update({ inserted_count: inserted }).eq('id', batch.id);
  return { batch_id: batch.id, inserted, skipped: dupKeys.size };
}

module.exports = { getReference, buildIndex, resolveRow, classifyChunk, insertApproved, normPhone, normName };

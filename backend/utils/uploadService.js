const { supabaseAdmin } = require('../config/database');
const { etWallClockToUtc } = require('./etUtils');
const { titleCaseFormData } = require('./titleCase');
const { expandStateInFormData } = require('./stateMap');
const { stampActor } = require('./auditColumnGuard');

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

// Fields on transfers.form_data that can be safely overwritten by a re-upload.
// Excludes the dedup key (cli_number) and any derived value the bulk path adds.
const SKIP_FORM_DATA_KEYS = new Set(['cli_number']);

// Workflow-locked statuses: once a transfer is here, a re-upload of the source
// row never reverts the status. The closer has already touched it.
const STATUS_LOCKED = new Set(['assigned', 'completed', 'rejected', 'cancelled']);

// Diff incoming row against existing transfer. Returns [] when nothing actually
// changes — caller treats that as a no-op skip.
function diffTransfer(row, existing) {
  const changes = [];
  const exFD = existing.form_data || {};
  const inFD = row.form_data || {};
  for (const key of Object.keys(inFD)) {
    if (SKIP_FORM_DATA_KEYS.has(key)) continue;
    const inVal = inFD[key];
    if (inVal === null || inVal === undefined || String(inVal).trim() === '') continue; // never wipe with blanks
    if (String(inVal).trim() !== String(exFD[key] ?? '').trim()) {
      changes.push({ field: `form_data.${key}`, prev: exFD[key] ?? '', next: inVal });
    }
  }
  // status: only when DB row is still in a "movable" state.
  const newStatus = safeStatus(row.status);
  if (!STATUS_LOCKED.has(existing.status) && newStatus !== existing.status) {
    changes.push({ field: 'status', prev: existing.status, next: newStatus });
  }
  return changes;
}

// ============================================================================
// DUPLICATE DETECTION (the critical part)
// ----------------------------------------------------------------------------
// For a chunk of resolved rows we classify each against EXISTING DB transfers:
//
//   UPDATE          — same CLI(phone) + same fronter + same company. Re-upload
//                     of a lead that already exists. Diff is computed against
//                     the live row; identical rows surface as no-op skips so
//                     the user can see "nothing changed for these N records".
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
//
// REVERSIBILITY: every update appends an `edit_history` entry with per-field
// {from, to} and the batch_id, AND the audit_field_changes() trigger (mig 063)
// writes a row to `field_audit_log` per change. The bulk batch can be reverted
// by replaying edit_history.from values for that batch_id.
// ============================================================================
async function classifyChunk(resolvedRows) {
  const clean = [], updates = [], conflicts = [];

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

    // UPDATE: an existing record has the SAME phone + fronter + company.
    // Compute a diff vs the live row so the review screen shows exactly what
    // would change. An empty diff = identical row = no-op skip (the caller
    // tells the user "N records unchanged"), so the same file can be re-run
    // safely without thrashing edit_history.
    const exactDup = matches.find(m => m.created_by === row.fronter_user_id && m.company_id === row.company_id);
    if (exactDup) {
      const changes = diffTransfer(row, exactDup);
      updates.push({
        ...row,
        existing_id: exactDup.id,
        existing_created_at: exactDup.created_at,
        changes,
      });
      continue;
    }

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

  // trueDuplicates kept as [] for backwards compat w/ any cached frontend
  // bundle still expecting the old shape — they're rolled into updates now.
  return { clean, updates, conflicts, trueDuplicates: [] };
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
    // last_modified_by also attributes to the fronter; stamped via stampActor
    // in the route layer if the column exists (skipped pre-migration 063).
    assigned_to:        null,
    assigned_closer_id: null,
    status:             safeStatus(row.status),
    normalized_phone:   normPhone(cli) || null,
    form_data: {
      ...titleCaseFormData(expandStateInFormData(row.form_data || {})),
      cli_number:    normPhone(cli),
      transfer_date: row.transfer_date || row.form_data?.transfer_date || null,
    },
    upload_batch_id: batchId,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

// Apply per-row diff updates against existing transfers. Preserves created_at
// (never patched), appends an edit_history entry tagged with the batch_id, and
// the audit_field_changes() trigger writes per-field rows to field_audit_log —
// together those two journals make a bulk batch fully reversible.
async function applyUpdates(updates, batchId, uploaderId) {
  let updated = 0, unchanged = 0;
  for (const u of (updates || [])) {
    if (!u || !u.existing_id) { unchanged++; continue; }
    if (!Array.isArray(u.changes) || u.changes.length === 0) { unchanged++; continue; }

    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('transfers').select('form_data, status, edit_history').eq('id', u.existing_id).single();
    if (fetchErr || !existing) { unchanged++; continue; }

    const newFD = { ...(existing.form_data || {}) };
    let nextStatus = null;
    for (const c of u.changes) {
      if (c.field === 'status') nextStatus = c.next;
      else if (c.field && c.field.startsWith('form_data.')) {
        const k = c.field.slice('form_data.'.length);
        newFD[k] = c.next;
      }
    }

    const history = Array.isArray(existing.edit_history) ? existing.edit_history : [];
    const patch = {
      form_data:    titleCaseFormData(expandStateInFormData(newFD)),
      updated_at:   new Date().toISOString(),
      // created_at intentionally absent → preserved as-is.
      // assigned_closer_id / assigned_to / upload_batch_id intentionally absent.
      edit_history: [...history, {
        editor_id:  uploaderId,
        role:       'bulk_upload',
        action:     'bulk_update',
        batch_id:   batchId,
        changes:    u.changes.map(c => ({ field: c.field, from: c.prev, to: c.next })),
        edited_at:  new Date().toISOString(),
      }],
    };
    if (nextStatus) patch.status = nextStatus;

    const stamped = await stampActor('transfers', patch, uploaderId);
    const { error } = await supabaseAdmin.from('transfers').update(stamped).eq('id', u.existing_id);
    if (!error) updated++;
  }
  return { updated, unchanged };
}

async function insertApproved(rows, batchMeta, uploaderId, updates = []) {
  const { data: batch, error: bErr } = await supabaseAdmin
    .from('upload_batches')
    .insert({
      kind:           'transfer',
      file_name:      batchMeta.file_name || null,
      uploaded_by:    uploaderId,
      total_rows:     batchMeta.total_rows || (rows.length + (updates?.length || 0)),
      inserted_count: 0,
      skipped_count:  batchMeta.skipped_count || 0,
      conflict_count: batchMeta.conflict_count || 0,
    })
    .select().single();
  if (bErr) throw new Error(bErr.message);

  let inserted = 0;
  const failed = [];   // [{ reason, cli_number, fronter_name, company_name }]
  for (let i = 0; i < rows.length; i += 100) {
    const chunkRows = rows.slice(i, i + 100);
    const built = chunkRows.map(r => buildTransferRow(r, batch.id));
    const slice = await Promise.all(built.map(r => stampActor('transfers', r, r.created_by)));
    const { data, error } = await supabaseAdmin.from('transfers').insert(slice).select('id');
    if (!error) { inserted += (data || []).length; continue; }

    // The slice insert is atomic — a single rejected row aborts the whole
    // batch. Retry row-by-row so good rows still land and each failure carries
    // its real DB reason (instead of an opaque 500 that loses the entire file).
    for (let j = 0; j < slice.length; j++) {
      const { data: d1, error: e1 } = await supabaseAdmin.from('transfers').insert(slice[j]).select('id');
      if (!e1) { inserted += (d1 || []).length; continue; }
      const src = chunkRows[j] || {};
      failed.push({
        reason:       e1.message || 'Insert rejected by database',
        cli_number:   src.cli_number || null,
        fronter_name: src.fronter_name || null,
        company_name: src.company_name || null,
      });
    }
  }

  const updateResult = await applyUpdates(updates, batch.id, uploaderId);

  await supabaseAdmin.from('upload_batches')
    .update({
      inserted_count: inserted,
      skipped_count:  (batchMeta.skipped_count || 0) + failed.length,
      conflict_count: (batchMeta.conflict_count || 0) + updateResult.updated,
    })
    .eq('id', batch.id);
  return { batch_id: batch.id, inserted, updated: updateResult.updated, unchanged: updateResult.unchanged, skipped: 0, failed };
}

// ============================================================================
// DUPLICATE TRANSFER MERGE (intelligent cleanup)
// ----------------------------------------------------------------------------
// Same company + fronter + phone transferred more than once is almost always
// the SAME lead entered twice. These inflate dashboards and create upload
// ambiguity. We surface each group with full detail + a recommended keeper, and
// merge by REASSIGNING all child rows (sales, reviews, dispositions, …) to the
// keeper BEFORE deleting the duplicates — so nothing linked is lost (sales have
// ON DELETE CASCADE, so deleting without reassigning would destroy them).
// ============================================================================
const TRANSFER_PHONE_KEYS = ['customer_phone', 'Phone', 'phone', 'Mobile', 'PhoneNumber', 'phone_number', 'CellPhone', 'cli_number'];
const fdPhone = (fd) => { if (!fd) return ''; for (const k of TRANSFER_PHONE_KEYS) if (fd[k]) return fd[k]; return ''; };

async function findDuplicateTransferGroups() {
  let all = [], from = 0;
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from('transfers').select('id, company_id, created_by, status, created_at, form_data').range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data || !data.length) break;
    all = all.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }

  const groups = new Map();
  all.forEach(t => {
    const n = normPhone(fdPhone(t.form_data || {}));
    if (!n) return;
    const k = `${t.company_id}|${t.created_by}|${n}`;
    (groups.get(k) || groups.set(k, []).get(k)).push(t);
  });
  const dup = [...groups.entries()].filter(([, a]) => a.length > 1);
  if (!dup.length) return [];

  // sale counts per duplicate transfer (so we keep the "worked" one + show it)
  const allIds = dup.flatMap(([, a]) => a.map(t => t.id));
  const salesCount = {};
  for (let i = 0; i < allIds.length; i += 300) {
    const { data } = await supabaseAdmin.from('sales').select('transfer_id').in('transfer_id', allIds.slice(i, i + 300));
    (data || []).forEach(s => { salesCount[s.transfer_id] = (salesCount[s.transfer_id] || 0) + 1; });
  }

  const coIds = [...new Set(dup.map(([k]) => k.split('|')[0]))];
  const frIds = [...new Set(dup.map(([k]) => k.split('|')[1]))];
  const [{ data: cos }, { data: profs }] = await Promise.all([
    supabaseAdmin.from('companies').select('id, name').in('id', coIds),
    supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', frIds),
  ]);
  const coName = {}; (cos || []).forEach(c => { coName[c.id] = c.name; });
  const frName = {}; (profs || []).forEach(p => { frName[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim(); });
  const fd = (t) => t.form_data || {};

  return dup.map(([k, arr]) => {
    const [cid, uid, phone] = k.split('|');
    const transfers = arr.map(t => ({
      id: t.id, created_at: t.created_at, status: t.status,
      customer: `${fd(t).FirstName || fd(t).customer_name || ''} ${fd(t).LastName || ''}`.trim() || '—',
      car: `${fd(t).CarYear || fd(t).car_year || ''} ${fd(t).CarMake || fd(t).car_make || ''} ${fd(t).CarModel || fd(t).car_model || ''}`.trim() || '—',
      sales_count: salesCount[t.id] || 0,
    })).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    // Recommend keeping the one with the most linked sales, then the earliest.
    const recommended = [...transfers].sort((a, b) => b.sales_count - a.sales_count || (a.created_at < b.created_at ? -1 : 1))[0];
    return { key: k, company_id: cid, company_name: coName[cid] || cid, fronter_name: frName[uid] || '—', phone, transfers, recommended_keep_id: recommended.id };
  }).sort((a, b) => b.transfers.length - a.transfers.length);
}

async function mergeDuplicateTransfers(merges) {
  // Reassign in order; number_lists is SET NULL (safe) but we move it for
  // continuity. Each table is best-effort (a table may not exist on every env).
  const childTables = ['sales', 'call_reviews', 'call_dispositions', 'disposition_actions', 'number_lists'];
  let groupsMerged = 0, transfersRemoved = 0, salesReassigned = 0;

  for (const m of (merges || [])) {
    const keep = m?.keep_id;
    const remove = [...new Set((m?.remove_ids || []).filter(id => id && id !== keep))];
    if (!keep || !remove.length) continue;

    for (const tbl of childTables) {
      try {
        const { data } = await supabaseAdmin.from(tbl).update({ transfer_id: keep }).in('transfer_id', remove).select('id');
        if (tbl === 'sales') salesReassigned += (data || []).length;
      } catch { /* table absent on this env — skip */ }
    }
    const { error } = await supabaseAdmin.from('transfers').delete().in('id', remove);
    if (error) throw new Error(error.message);
    groupsMerged++;
    transfersRemoved += remove.length;
  }
  return { groups_merged: groupsMerged, transfers_removed: transfersRemoved, sales_reassigned: salesReassigned };
}

module.exports = {
  getReference, buildIndex, resolveRow, classifyChunk, insertApproved, normPhone, normName,
  findDuplicateTransferGroups, mergeDuplicateTransfers,
};

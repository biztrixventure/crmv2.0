const { supabaseAdmin } = require('../config/database');
const { etWallClockToUtc } = require('./etUtils');
const { normPhone, normName, getReference: getXferReference, buildIndex: buildXferIndex, resolveRow: resolveXferRow } = require('./uploadService');
const { titleCase, titleCaseFormData } = require('./titleCase');
const { expandStateInFormData } = require('./stateMap');

// Retry a Supabase read a few times with backoff. Transient timeouts/5xx on the
// heavy transfer/sales reads were intermittently failing a whole validation chunk
// (the route threw → the frontend marked all 100 rows "unmatched"), which is why
// re-running the same file would suddenly validate clean.
async function withRetry(fn, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) { lastErr = e; if (i < attempts - 1) await new Promise(r => setTimeout(r, 300 * (i + 1))); }
  }
  throw lastErr;
}

// Compact view of a transfer for the review screen (which one was matched +
// the alternatives when the phone had duplicates).
const summarizeTransfer = (t, salesByTransfer) => {
  const fd = t.form_data || {};
  return {
    id: t.id, created_at: t.created_at, status: t.status,
    customer: `${fd.FirstName || fd.customer_name || ''} ${fd.LastName || ''}`.trim() || '—',
    car: `${fd.CarYear || fd.car_year || ''} ${fd.CarMake || fd.car_make || ''} ${fd.CarModel || fd.car_model || ''}`.trim() || '—',
    sales_count: (salesByTransfer.get(t.id) || []).length,
  };
};

// Normalize an arbitrary spreadsheet date value to a Postgres-safe 'YYYY-MM-DD'
// (or null). Spreadsheets export dates in many shapes — ISO, M/D/Y, D/M/Y,
// Excel serial numbers — and a raw "13/05/2026" handed straight to a `date`
// column throws (month 13). Detect day-first vs month-first per value where the
// numbers make it unambiguous; the frontend already disambiguates the rest
// column-wide before sending. Returns null when it can't be parsed (caller then
// falls back to today) so a bad cell never aborts the whole upload.
function toIsoDate(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s || s === '-') return null;

  // ISO 'YYYY-MM-DD' (optionally with time) — already safe.
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // D/M/Y or M/D/Y with / . or - separators.
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/);
  if (m) {
    const a = +m[1], b = +m[2];
    let y = +m[3]; if (y < 100) y += 2000;
    let day, mon;
    if (a > 12 && b <= 12)      { day = a; mon = b; }   // unambiguously day-first
    else if (b > 12 && a <= 12) { mon = a; day = b; }   // unambiguously month-first
    else                        { mon = a; day = b; }   // ambiguous → month-first (frontend normalizes real files)
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
      return `${y}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return null;
  }

  // Excel serial number (days since 1899-12-30).
  if (/^\d{4,6}$/.test(s)) {
    const serial = +s;
    if (serial > 20000 && serial < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  }

  // Last resort: let the engine try (handles "May 20 2026", etc.).
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Generate a reference number like the manual flow (sales.js generateReferenceNo).
function generateReferenceNo() {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const num   = '0123456789';
  const r = (s, n) => Array.from({ length: n }, () => s[Math.floor(Math.random() * s.length)]).join('');
  return r(alpha, 3) + r(num, 4) + r(alpha, 3);
}

// transfer_status / sale_status enum values that exist live (verified against DB).
const SALE_STATUSES = ['open', 'sold', 'cancelled', 'follow_up', 'closed_won', 'closed_lost',
  'pending_review', 'needs_revision', 'compliance_cancelled', 'dispute', 'chargeback'];
// Statuses that represent a completed compliance review (an "outcome").
const REVIEWED = ['closed_won', 'closed_lost', 'needs_revision', 'compliance_cancelled', 'dispute', 'chargeback', 'sold', 'cancelled'];

// Default state when the file carries no compliance/status data: land in the
// compliance queue exactly like a closer submitting a finished sale for review.
const DEFAULT_STATUS = 'pending_review';

const safeStatus = (s) => {
  const v = String(s || '').trim().toLowerCase();
  return SALE_STATUSES.includes(v) ? v : DEFAULT_STATUS;
};

// Fields compared for the update diff, with display label + highlight category.
// status → "approval" (purple); compliance_* → "compliance" (blue); rest yellow.
const DIFF_FIELDS = [
  ['customer_name', 'Customer Name', 'normal'], ['customer_phone', 'Phone', 'normal'],
  ['customer_phone_2', 'Phone 2', 'normal'], ['customer_email', 'Email', 'normal'],
  ['customer_address', 'Address', 'normal'],
  ['car_year', 'Car Year', 'normal'], ['car_make', 'Car Make', 'normal'],
  ['car_model', 'Car Model', 'normal'], ['car_miles', 'Mileage', 'normal'], ['car_vin', 'VIN', 'normal'],
  ['plan', 'Plan', 'normal'], ['down_payment', 'Down Payment', 'normal'],
  ['monthly_payment', 'Monthly Payment', 'normal'], ['payment_due_note', 'Payment Due Note', 'normal'],
  ['reference_no', 'Reference No', 'normal'], ['client_name', 'Client', 'normal'],
  ['sale_date', 'Sale Date', 'normal'], ['closer_disposition', 'Disposition', 'normal'],
  ['status', 'Status (Approval)', 'approval'],
  ['compliance_note', 'Compliance Note', 'compliance'],
];

const cmp = (a, b) => String(a ?? '').trim() === String(b ?? '').trim();

// Phone can live under several form_data keys depending on the form config /
// how a transfer was created (FormBuilder default "Phone", manual "customer_phone",
// prior bulk inserts "cli_number"). Check them all so a key mismatch never hides
// an existing transfer.
const TRANSFER_PHONE_KEYS = ['customer_phone', 'Phone', 'phone', 'Mobile', 'PhoneNumber', 'phone_number', 'CellPhone', 'cli_number'];
const fdPhone = (fd) => {
  if (!fd) return '';
  for (const k of TRANSFER_PHONE_KEYS) if (fd[k]) return fd[k];
  return '';
};

// Fetch every transfer for a set of companies, paginating past Supabase's
// default 1000-row cap. Without this, busy companies silently lose transfers
// beyond row 1000 and their sales are wrongly reported as "no transfer".
async function fetchTransfersForCompanies(companyIds) {
  if (!companyIds.length) return [];
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await withRetry(() => supabaseAdmin
      .from('transfers').select('id, company_id, created_by, created_at, status, form_data')
      .in('company_id', companyIds).range(from, from + 999));
    if (error) throw new Error(error.message);
    if (!data || !data.length) break;
    all.push(...data);
    if (data.length < 1000) break;
  }
  return all;
}

// Per-company transfer cache (60s TTL). A single upload sends many validation
// chunks for the same companies; without this each chunk re-paginated EVERY
// transfer (thousands of rows), which was slow and gave transient errors more
// chances to fire. Now each company's transfers are fetched once per minute.
const TRANSFER_TTL = 60000;
const _coTransfers = new Map();   // company_id -> { data: [], at }

async function getTransfersForCompaniesCached(companyIds) {
  const ids = [...new Set(companyIds)];
  const now = Date.now();
  const out = [];
  const stale = [];
  for (const cid of ids) {
    const entry = _coTransfers.get(cid);
    if (entry && now - entry.at < TRANSFER_TTL) out.push(...entry.data);
    else stale.push(cid);
  }
  if (stale.length) {
    const fetched = await fetchTransfersForCompanies(stale);
    const byCo = {};
    stale.forEach(cid => { byCo[cid] = []; });
    fetched.forEach(t => { (byCo[t.company_id] = byCo[t.company_id] || []).push(t); });
    stale.forEach(cid => _coTransfers.set(cid, { data: byCo[cid] || [], at: Date.now() }));
    out.push(...fetched);
  }
  return out;
}

// ============================================================================
// Reference — companies (+ their fronters) and closers, for name→id resolution.
// Cached 30s (same rationale as the transfer uploader: many chunks per upload).
// ============================================================================
let _ref = { data: null, at: 0 };
async function getReference({ fresh = false } = {}) {
  if (!fresh && _ref.data && Date.now() - _ref.at < 30000) return _ref.data;

  const { data: companies } = await supabaseAdmin
    .from('companies').select('id, name, company_type').eq('is_active', true).order('name');

  const { data: roles } = await supabaseAdmin
    .from('user_company_roles')
    .select('user_id, company_id, custom_roles(level)')
    .eq('is_active', true);

  const fronterRoles = (roles || []).filter(r => r.custom_roles?.level === 'fronter');
  const closerRoles  = (roles || []).filter(r => r.custom_roles?.level === 'closer');

  const ids = [...new Set([...fronterRoles, ...closerRoles].map(r => r.user_id))];
  const names = {};
  if (ids.length) {
    const { data } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', ids);
    (data || []).forEach(p => { names[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim(); });
  }

  const frByCompany = {}, closers = [];
  fronterRoles.forEach(r => { (frByCompany[r.company_id] ||= []).push({ user_id: r.user_id, name: names[r.user_id] || '' }); });
  closerRoles.forEach(r => closers.push({ user_id: r.user_id, name: names[r.user_id] || '', company_id: r.company_id }));

  const data = {
    companies: (companies || []).map(c => ({
      id: c.id, name: c.name, company_type: c.company_type,
      fronters: (frByCompany[c.id] || []).filter(f => f.name),
    })),
    closers: closers.filter(c => c.name),
  };
  _ref = { data, at: Date.now() };
  return data;
}

function buildIndex(ref) {
  const companyByName = new Map();
  const fronterByKey  = new Map();   // companyId|normName -> [users]
  const closerByName  = new Map();   // normName -> [users]
  ref.companies.forEach(co => {
    companyByName.set(normName(co.name), { id: co.id, name: co.name });
    co.fronters.forEach(f => {
      const k = `${co.id}|${normName(f.name)}`;
      (fronterByKey.get(k) || fronterByKey.set(k, []).get(k)).push(f);
    });
  });
  ref.closers.forEach(c => {
    const k = normName(c.name);
    (closerByName.get(k) || closerByName.set(k, []).get(k)).push(c);
  });
  return { companyByName, fronterByKey, closerByName };
}

// Resolve a row's company / fronter / closer names → IDs.
function resolveRow(row, index) {
  const co = index.companyByName.get(normName(row.company_name));
  if (!co) return { ok: false, reason: `Company "${row.company_name}" not found` };

  const fr = index.fronterByKey.get(`${co.id}|${normName(row.fronter_name)}`) || [];
  if (fr.length === 0) return { ok: false, reason: `No fronter "${row.fronter_name}" in ${co.name}` };
  if (fr.length > 1)   return { ok: false, reason: `"${row.fronter_name}" matches multiple fronters in ${co.name}` };

  // Closer is optional; if a name is given it must resolve unambiguously.
  let closer_user_id = null;
  if (String(row.closer_name || '').trim()) {
    const cl = index.closerByName.get(normName(row.closer_name)) || [];
    if (cl.length === 0) return { ok: false, reason: `No closer "${row.closer_name}" found` };
    if (cl.length > 1)   return { ok: false, reason: `"${row.closer_name}" matches multiple closers` };
    closer_user_id = cl[0].user_id;
  }

  return { ok: true, company_id: co.id, company_name: co.name, fronter_user_id: fr[0].user_id, closer_user_id };
}

// Loose year|make|model key for comparing a sale row to a transfer/sale.
const ymmKey = (y, mk, md) => [y, mk, md].map(v => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ')).join('|');
const upper  = (v) => String(v || '').trim().toUpperCase();
// Flag a likely column shift in an uploaded row: a Car Year that isn't a real
// year, or a numeric Car Make (e.g. the year landed in the make column).
function carColumnWarning(row) {
  const year = String(row?.car_year ?? '').trim();
  const make = String(row?.car_make ?? '').trim();
  if (year) {
    const digits = year.replace(/\D/g, '');
    const n = parseInt(digits, 10);
    if (digits.length !== 4 || n < 1900 || n > 2100) return `Car Year "${year}" isn't a valid year — the car columns may be shifted in your file.`;
  }
  if (make && /^\d+(\.\d+)?$/.test(make)) return `Car Make "${make}" is a number — the car columns may be shifted in your file.`;
  return null;
}

const transferVin = (t) => upper(t.form_data?.VIN || t.form_data?.car_vin);
const transferYmm = (t) => ymmKey(t.form_data?.CarYear ?? t.form_data?.car_year, t.form_data?.CarMake ?? t.form_data?.car_make, t.form_data?.CarModel ?? t.form_data?.car_model);

// Duplicate transfers for the same phone are almost always the SAME lead entered
// twice. We pick deterministically: a real car/VIN match dominates; a transfer
// with no sale yet is preferred (so a genuine 2nd car lands on its own transfer);
// and the final tie-break favours the MOST RECENT transfer that was created on or
// before the sale date — i.e. the transfer that plausibly produced this sale —
// rather than blindly the latest (which could even post-date the sale) or the
// earliest. Falls back to earliest if none predates the sale, and to id for a
// fully stable order on re-runs.
function pickBestTransfer(row, candidates, salesByTransfer) {
  const saleVin  = upper(row.car_vin);
  const saleYmm  = ymmKey(row.car_year, row.car_make, row.car_model);
  const hasYmm   = !!saleYmm.replace(/\|/g, '');
  const saleDate = row.sale_date ? String(row.sale_date).slice(0, 10) : null;

  const scored = candidates.map(t => {
    let score = 0; const reasons = [];
    if (saleVin && transferVin(t) && saleVin === transferVin(t)) { score += 100; reasons.push('VIN'); }
    if (hasYmm && transferYmm(t) === saleYmm)                    { score += 40;  reasons.push('car'); }
    const hasSale = (salesByTransfer.get(t.id) || []).length > 0;
    if (!hasSale) score += 25;
    const created = (t.created_at || '').slice(0, 10);
    const onOrBefore = !!(saleDate && created && created <= saleDate);
    if (onOrBefore) score += 15;
    return { t, score, reasons, created, hasSale, onOrBefore };
  });
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Prefer transfers created on/before the sale date…
    if (saleDate && a.onOrBefore !== b.onOrBefore) return a.onOrBefore ? -1 : 1;
    if (saleDate && a.onOrBefore && b.onOrBefore) {
      // …and among those, the LATEST (closest to the sale) wins.
      if (a.created !== b.created) return a.created < b.created ? 1 : -1;
    } else if (a.created !== b.created) {
      // No qualifying date: fall back to the earliest for stability.
      return a.created < b.created ? -1 : 1;
    }
    return a.t.id < b.t.id ? -1 : 1;
  });
  const best = scored[0];
  const saleHasVehicle = !!(saleVin || hasYmm);
  const vehicleMatched = best.reasons.includes('VIN') || best.reasons.includes('car');
  // Human-readable reason for the review screen.
  const why = best.reasons.includes('VIN') ? 'matched by VIN'
    : best.reasons.includes('car')        ? 'matched by car (year/make/model)'
    : best.onOrBefore                     ? 'most recent transfer on/before the sale date'
    : best.hasSale                        ? 'earliest transfer' : 'earliest unused transfer';
  return { transfer: best.t, why, saleHasVehicle, vehicleMatched };
}

// Pick which existing sale on the chosen transfer this row updates (multi-car
// aware): reference_no → car_vin → year+make+model. If the row carries a
// distinguishing key but matches none of them, it's a DIFFERENT car → add as a
// new sale. Only when there's no key at all AND several sales exist is it a true
// ambiguity that needs a human.
function pickExistingSale(row, sales) {
  if (!sales || sales.length === 0) return { match: null };

  const ref = upper(row.reference_no);
  const vin = upper(row.car_vin);
  const ymm = ymmKey(row.car_year, row.car_make, row.car_model);
  const hasYmm = !!ymm.replace(/\|/g, '');

  if (ref) { const m = sales.find(s => upper(s.reference_no) === ref); if (m) return { match: m }; }
  if (vin) { const m = sales.find(s => upper(s.car_vin) === vin); if (m) return { match: m }; }
  if (hasYmm) { const m = sales.find(s => ymmKey(s.car_year, s.car_make, s.car_model) === ymm); if (m) return { match: m }; }

  // Has a distinguishing key but nothing matched → it's another car → new sale.
  if (ref || vin || hasYmm) return { match: null, newCar: sales.length };
  // No key to tell them apart: safe only when there's a single sale to update.
  if (sales.length === 1) return { match: sales[0] };
  return { ambiguous: true };
}

// Build the diff between an incoming row and an existing sale.
function diffSale(row, sale) {
  const changes = [];
  for (const [key, label, category] of DIFF_FIELDS) {
    // Only consider fields the file actually provided (don't wipe with blanks).
    const incoming = row[key];
    if (incoming === undefined || incoming === null || String(incoming).trim() === '') continue;
    if (!cmp(incoming, sale[key])) {
      changes.push({ field: key, label, category, prev: sale[key] ?? '', next: incoming });
    }
  }
  return changes;
}

// ============================================================================
// Classify a chunk of resolved-or-not rows against the live DB.
// Returns { newSales, updates, skipped, unmatched, ambiguous }.
// ============================================================================
async function classifyChunk(rows) {
  const index = buildIndex(await getReference());

  const resolved = [], unmatched = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') { unmatched.push({ reason: 'Empty or invalid row' }); continue; }
    const r = resolveRow(row, index);
    if (!r.ok) { unmatched.push({ ...row, reason: r.reason }); continue; }
    resolved.push({ ...row, _r: r });
  }

  // ── Transfer match ───────────────────────────────────────────────────────────
  // Primary key: company + fronter(created_by) + normalized phone. Fallback:
  // company + phone — so a transfer created by a DIFFERENT fronter than the sale
  // file states is still matched (a common real case) instead of falsely reported
  // "no transfer". Multiple company+phone hits stay ambiguous for manual review.
  const companyIds = [...new Set(resolved.map(r => r._r.company_id))];
  const xfers = await getTransfersForCompaniesCached(companyIds);

  const keyCFP = (cid, uid, phone) => `${cid}|${uid}|${normPhone(phone)}`;
  const keyCP  = (cid, phone) => `${cid}|${normPhone(phone)}`;
  const byCFP = new Map();
  const byCP  = new Map();
  xfers.forEach(t => {
    const ph = fdPhone(t.form_data || {});
    if (!normPhone(ph)) return;
    const kf = keyCFP(t.company_id, t.created_by, ph);
    const kp = keyCP(t.company_id, ph);
    (byCFP.get(kf) || byCFP.set(kf, []).get(kf)).push(t);
    (byCP.get(kp)  || byCP.set(kp, []).get(kp)).push(t);
  });

  // Resolve candidate transfer(s) per row, recording whether the fronter matched.
  const matchedTransferIds = [];
  resolved.forEach(r => {
    const exact = byCFP.get(keyCFP(r._r.company_id, r._r.fronter_user_id, r.cli_number)) || [];
    if (exact.length) { r._xfers = exact; r._mismatch = false; }
    else { r._xfers = byCP.get(keyCP(r._r.company_id, r.cli_number)) || []; r._mismatch = r._xfers.length > 0; }
    r._xfers.forEach(t => matchedTransferIds.push(t.id));
  });
  let salesByTransfer = new Map();
  if (matchedTransferIds.length) {
    const uniqIds = [...new Set(matchedTransferIds)];
    const sales = [];
    // Page through in id-batches with retry — large in() lists + transient errors
    // were another way a chunk could fail and get re-reported as unmatched.
    for (let i = 0; i < uniqIds.length; i += 300) {
      const slice = uniqIds.slice(i, i + 300);
      const { data, error } = await withRetry(() => supabaseAdmin
        .from('sales').select('*').in('transfer_id', slice));
      if (error) throw new Error(error.message);
      sales.push(...(data || []));
    }
    sales.forEach(s => { (salesByTransfer.get(s.transfer_id) || salesByTransfer.set(s.transfer_id, []).get(s.transfer_id)).push(s); });
  }

  const newSales = [], updates = [], skipped = [], ambiguous = [];
  for (const r of resolved) {
    const base = { ...r, company_id: r._r.company_id, fronter_user_id: r._r.fronter_user_id, closer_user_id: r._r.closer_user_id };
    const mismatch = r._mismatch;
    delete base._r; delete base._xfers; delete base._mismatch;
    if (!r._xfers || r._xfers.length === 0) {
      unmatched.push({ ...base, reason: `No transfer on file for ${r.cli_number || 'this phone'} in ${r.company_name}. Upload the transfer first, or check the phone / company / fronter spelling.` });
      continue;
    }

    // 1+ candidate transfers: auto-pick the best one (duplicates are the same
    // lead). Note how it was chosen so the review screen stays transparent.
    let transfer = r._xfers[0];
    const notes = [];
    if (mismatch) notes.push(`Matched by phone in ${r.company_name}; transfer's fronter differs from "${r.fronter_name}".`);
    if (r._xfers.length > 1) {
      const best = pickBestTransfer(r, r._xfers, salesByTransfer);
      transfer = best.transfer;
      if (best.saleHasVehicle && !best.vehicleMatched) {
        // The sale carries a vehicle, but it matched none of the duplicate
        // transfers — link to the best guess but flag it loudly for a human check.
        base.match_warning = true;
        notes.push(`⚠ This sale's vehicle doesn't match any of the ${r._xfers.length} transfers for this number. Linked to the ${best.why} — please verify, or pick the correct transfer below.`);
      } else {
        notes.push(`Linked to 1 of ${r._xfers.length} transfers for this number — ${best.why}. Change it below if needed.`);
      }
    }
    // Column-shift guard: flag implausible car data for a human to verify.
    const carWarn = carColumnWarning(r);
    if (carWarn) { base.match_warning = true; notes.push(`⚠ ${carWarn}`); }
    if (notes.length) base.match_note = notes.join(' ');

    // Expose what was matched + the alternatives so the review screen can show
    // (and let the user change) the auto-pick.
    base.chosen_transfer_id = transfer.id;
    base.matched_transfer = summarizeTransfer(transfer, salesByTransfer);
    if (r._xfers.length > 1) base.candidate_transfers = r._xfers.map(t => summarizeTransfer(t, salesByTransfer));

    const existing = salesByTransfer.get(transfer.id) || [];
    const pick = pickExistingSale(r, existing);

    if (pick.ambiguous) { ambiguous.push({ ...base, transfer_id: transfer.id, reason: `${existing.length} sales already exist on this transfer and the row has no Reference No / VIN / car to tell them apart — add one so the right sale is updated.` }); continue; }

    if (!pick.match) {
      if (pick.newCar) base.match_note = [base.match_note, `Added as a new car (${pick.newCar} other sale(s) already on this transfer).`].filter(Boolean).join(' ');
      newSales.push({ ...base, transfer_id: transfer.id });
      continue;
    }

    const changes = diffSale(r, pick.match);
    if (changes.length === 0) {
      skipped.push({ ...base, reason: 'Identical sale already exists' });
    } else {
      updates.push({ ...base, transfer_id: transfer.id, sale_id: pick.match.id, changes });
    }
  }

  return { newSales, updates, skipped, unmatched, ambiguous };
}

// Compliance/submission timestamps to mirror the manual workflow for a status.
function complianceState(status, row) {
  const now = new Date().toISOString();
  if (status === 'pending_review') return { submitted_for_review_at: etWallClockToUtc(row.submitted_for_review_at) || now, compliance_reviewed_at: null };
  if (REVIEWED.includes(status))    return { submitted_for_review_at: etWallClockToUtc(row.submitted_for_review_at) || now, compliance_reviewed_at: etWallClockToUtc(row.compliance_reviewed_at) || now };
  return { submitted_for_review_at: null, compliance_reviewed_at: null }; // open
}

// Build a sales row identical in shape to a manual closer-created sale.
function buildSaleRow(row, batchId) {
  const status = safeStatus(row.status);
  const cs = complianceState(status, row);
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
  return {
    transfer_id:        row.transfer_id,
    created_by:         row.closer_user_id,            // manual: created_by = the closer
    closer_id:          row.closer_user_id,
    fronter_id:         row.fronter_user_id,
    company_id:         row.company_id,                // inherited fronter company (like manual)
    status,
    customer_name:      titleCase(row.customer_name) || null,
    customer_phone:     row.customer_phone || row.cli_number || null,
    customer_phone_2:   row.customer_phone_2 || null,
    customer_email:     row.customer_email || null,
    customer_address:   row.customer_address || null,
    car_year:           int(row.car_year),
    car_make:           row.car_make || null,
    car_model:          row.car_model || null,
    car_miles:          int(row.car_miles),
    car_vin:            row.car_vin ? String(row.car_vin).toUpperCase() : null,
    plan:               row.plan || null,
    down_payment:       num(row.down_payment),
    monthly_payment:    num(row.monthly_payment),
    payment_due_note:   row.payment_due_note || null,
    reference_no:       (row.reference_no && String(row.reference_no).trim()) || generateReferenceNo(),
    client_name:        titleCase(row.client_name) || null,
    sale_date:          toIsoDate(row.sale_date) || new Date().toISOString().slice(0, 10),
    form_data:          row.form_data ? titleCaseFormData(expandStateInFormData(row.form_data)) : null,
    closer_disposition: row.closer_disposition || null,
    compliance_note:    row.compliance_note || null,
    submitted_for_review_at: cs.submitted_for_review_at,
    compliance_reviewed_at:  cs.compliance_reviewed_at,
    upload_batch_id:    batchId,
  };
}

// ============================================================================
// Confirm — insert new sales (tagged with batch) + apply confirmed updates.
// New inserts replicate manual side effects: "Sent to Compliance" disposition
// + transfer auto-complete. Updates append an edit_history entry, untagged.
// ============================================================================
async function confirmUpload({ newRows = [], updateRows = [], batchMeta = {} }, uploaderId) {
  const index = buildIndex(await getReference());

  // Create the batch first so inserted sales can reference it.
  const { data: batch, error: bErr } = await supabaseAdmin
    .from('upload_batches')
    .insert({
      kind: 'sale',
      file_name: batchMeta.file_name || null,
      uploaded_by: uploaderId,
      total_rows: (newRows.length + updateRows.length),
      inserted_count: 0,
      conflict_count: updateRows.length,
    })
    .select().single();
  if (bErr) throw new Error(bErr.message);

  // ── Inserts ────────────────────────────────────────────────────────────────
  let inserted = 0;
  const insertable = [];
  for (const row of newRows) {
    const r = resolveRow(row, index);
    if (!r.ok || !row.transfer_id) continue;
    insertable.push(buildSaleRow({ ...row, company_id: r.company_id, fronter_user_id: r.fronter_user_id, closer_user_id: r.closer_user_id }, batch.id));
  }
  for (let i = 0; i < insertable.length; i += 100) {
    const slice = insertable.slice(i, i + 100);
    const { data, error } = await supabaseAdmin.from('sales').insert(slice).select('id, transfer_id, company_id, closer_id, closer_disposition');
    if (error) throw new Error(error.message);
    inserted += (data || []).length;
    // Mirror manual side effects per inserted sale. The Supabase query builder is
    // a thenable but has no .catch — await in try/catch so a side-effect failure
    // is swallowed (and never aborts the upload) while still actually running.
    for (const s of (data || [])) {
      try {
        await supabaseAdmin.from('disposition_actions').insert({
          transfer_id: s.transfer_id, company_id: s.company_id, user_id: s.closer_id,
          disposition_name: 'Sent to Compliance', color: '#f59e0b',
          note: s.closer_disposition ? `Disposition: ${s.closer_disposition}` : 'Sale submitted to compliance (bulk upload)',
          setter_role: 'closer',
        });
      } catch { /* non-critical */ }
      // Complete the transfer AND stamp the closer who handled it, so the
      // fronter sees the closer's name (same field the manual flow now sets).
      const tUpd = { status: 'completed', updated_at: new Date().toISOString() };
      if (s.closer_id) { tUpd.assigned_closer_id = s.closer_id; tUpd.assigned_to = s.closer_id; }
      try {
        await supabaseAdmin.from('transfers').update(tUpd).eq('id', s.transfer_id);
      } catch { /* non-critical */ }
    }
  }

  // ── Updates ──────────────────────────────────────────────────────────────────
  let updated = 0;
  for (const row of updateRows) {
    if (!row.sale_id || !Array.isArray(row.changes) || !row.changes.length) continue;
    const { data: existing } = await supabaseAdmin.from('sales').select('edit_history').eq('id', row.sale_id).single();
    const history = Array.isArray(existing?.edit_history) ? existing.edit_history : [];
    const patch = { updated_at: new Date().toISOString() };
    row.changes.forEach(c => {
      if (['car_year', 'car_miles'].includes(c.field)) patch[c.field] = parseInt(c.next, 10) || null;
      else if (['down_payment', 'monthly_payment'].includes(c.field)) patch[c.field] = parseFloat(c.next) || null;
      else if (c.field === 'car_vin') patch[c.field] = String(c.next).toUpperCase();
      else if (c.field === 'sale_date') patch[c.field] = toIsoDate(c.next) || new Date().toISOString().slice(0, 10);
      else patch[c.field] = c.next;
    });
    patch.edit_history = [...history, {
      editor_id: uploaderId, role: 'bulk_upload', action: 'bulk_update',
      changes: row.changes.map(c => ({ field: c.field, from: c.prev, to: c.next })),
      edited_at: new Date().toISOString(),
    }];
    const { error } = await supabaseAdmin.from('sales').update(patch).eq('id', row.sale_id);
    if (!error) updated++;
  }

  await supabaseAdmin.from('upload_batches').update({ inserted_count: inserted }).eq('id', batch.id);
  return { batch_id: batch.id, inserted, updated };
}

// ============================================================================
// Create a transfer inline from an unmatched sale row, so the sale can attach
// without leaving the upload page. The sale's form_data already uses the same
// FormBuilder keys a fronter transfer uses (FirstName/Phone/CarYear/…), so we
// reuse it directly and just guarantee the phone keys for matching.
// ============================================================================
async function createTransferFromRow(row) {
  if (!row || typeof row !== 'object') return { ok: false, reason: 'Invalid row.' };
  const index = buildXferIndex(await getXferReference());
  const r = resolveXferRow(row, index); // company + fronter only (no closer needed)
  if (!r.ok) return { ok: false, reason: r.reason };

  const cli = String(row.cli_number || row.customer_phone || '').trim();
  if (!normPhone(cli)) return { ok: false, reason: 'This row has no usable phone number to key the transfer on.' };

  const fd = { ...(row.form_data || {}) };
  if (!fd.Phone) fd.Phone = cli;
  fd.cli_number = normPhone(cli);

  const { data, error } = await supabaseAdmin
    .from('transfers')
    .insert({ company_id: r.company_id, created_by: r.fronter_user_id, assigned_to: null, assigned_closer_id: null, status: 'pending', normalized_phone: normPhone(cli) || null, form_data: fd })
    .select('id, company_id, created_by, created_at, status, form_data').single();
  if (error) return { ok: false, reason: error.message };
  // Bust the transfer cache for this company so the immediate re-validation of
  // this row sees the transfer we just created.
  _coTransfers.delete(r.company_id);
  return { ok: true, transfer: data };
}

module.exports = { getReference, classifyChunk, confirmUpload, createTransferFromRow, SALE_STATUSES };

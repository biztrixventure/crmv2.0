// ============================================================================
// utils/extData.js -- the ONE shape of a sale and of a transfer for other apps.
//
// GET /api/ext/v1/sales rows and the `sale` inside every sale.* webhook are
// built here, so a receiver can treat a webhook as "this row changed" and the
// next poll as the same row. Same for transfers.
//
// No customer contact details unless asked for (pii=true, which the routes
// only pass for keys holding sales.read_pii / transfers.read_pii). People are
// given as { user_id, vicidial_agent_ids } -- the VICIdial user is how the
// HRMS and the QA platform know a person (uppercase, like hrmsSync).
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const { upper } = require('./integrations');

const SALE_COLS = [
  'id', 'company_id', 'status', 'sale_date', 'created_at', 'updated_at', 'reference_no', 'client_name', 'plan',
  'down_payment', 'monthly_payment', 'closer_id', 'fronter_id', 'vicidial_agent', 'transfer_id',
  'compliance_reviewed_at', 'cancellation_date', 'cancellation_reason_key', 'chargeback_date', 'chargeback_amount',
  'superseded_at',
].join(', ');
const SALE_PII_COLS = 'customer_name, customer_phone';

const TRANSFER_COLS = [
  'id', 'company_id', 'status', 'created_at', 'updated_at', 'created_by', 'vicidial_agent', 'vicidial_vendor_code',
  'latest_disposition',
].join(', ');
const TRANSFER_PII_COLS = 'form_data';

const CHUNK = 150;

async function inChunks(ids, fn) {
  const out = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await fn(ids.slice(i, i + CHUNK))));
  return out;
}

let _companies = { at: 0, map: new Map() };
/** id -> { id, name, slug }. Every company, cached a minute (there are few). */
async function companyMap() {
  if (Date.now() - _companies.at < 60_000) return _companies.map;
  const { data, error } = await supabaseAdmin.from('companies').select('id, name, slug');
  if (error) throw new Error(error.message);
  _companies = { at: Date.now(), map: new Map((data || []).map((c) => [c.id, { id: c.id, name: c.name, slug: c.slug || null }])) };
  return _companies.map;
}

/** user_id -> [VICIDIAL IDS] */
async function viciIdsOf(userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await inChunks(ids, async (part) => {
    const { data, error } = await supabaseAdmin.from('user_profiles').select('user_id, vicidial_agent_ids').in('user_id', part);
    if (error) throw new Error(error.message);
    return data || [];
  });
  return new Map(rows.map((p) => [p.user_id, [...new Set((p.vicidial_agent_ids || []).map(upper).filter(Boolean))]]));
}

const person = (userId, ids) => (userId ? { user_id: userId, vicidial_agent_ids: ids.get(userId) || [] } : null);

async function shapeSales(rows, { pii = false } = {}) {
  const [companies, ids] = await Promise.all([
    companyMap(),
    viciIdsOf(rows.flatMap((s) => [s.closer_id, s.fronter_id])),
  ]);
  return rows.map((s) => {
    const out = {
      id: s.id,
      company: companies.get(s.company_id) || (s.company_id ? { id: s.company_id, name: null, slug: null } : null),
      status: s.status,
      sale_date: s.sale_date,
      created_at: s.created_at,
      updated_at: s.updated_at,
      reference_no: s.reference_no,
      client_name: s.client_name,
      plan: s.plan,
      down_payment: s.down_payment,
      monthly_payment: s.monthly_payment,
      closer: person(s.closer_id, ids),
      fronter: person(s.fronter_id, ids),
      vicidial_agent: upper(s.vicidial_agent),
      transfer_id: s.transfer_id,
      compliance_reviewed_at: s.compliance_reviewed_at,
      cancellation_date: s.cancellation_date,
      cancellation_reason_key: s.cancellation_reason_key,
      chargeback_date: s.chargeback_date,
      chargeback_amount: s.chargeback_amount,
      superseded_at: s.superseded_at,
    };
    if (pii) {
      out.customer_name = s.customer_name ?? null;
      out.customer_phone = s.customer_phone ?? null;
    }
    return out;
  });
}

/** id -> shaped sale, for webhook payloads. */
async function salesByIds(saleIds, { pii = false } = {}) {
  const ids = [...new Set(saleIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const cols = pii ? `${SALE_COLS}, ${SALE_PII_COLS}` : SALE_COLS;
  const rows = await inChunks(ids, async (part) => {
    const { data, error } = await supabaseAdmin.from('sales').select(cols).in('id', part);
    if (error) throw new Error(error.message);
    return data || [];
  });
  const shaped = await shapeSales(rows, { pii });
  return new Map(shaped.map((s) => [s.id, s]));
}

async function shapeTransfers(rows, { pii = false } = {}) {
  const [companies, ids] = await Promise.all([companyMap(), viciIdsOf(rows.map((t) => t.created_by))]);
  return rows.map((t) => {
    const out = {
      id: t.id,
      company: companies.get(t.company_id) || (t.company_id ? { id: t.company_id, name: null, slug: null } : null),
      status: t.status,
      created_at: t.created_at,
      updated_at: t.updated_at,
      created_by: person(t.created_by, ids),
      vicidial_agent: upper(t.vicidial_agent),
      vicidial_vendor_code: t.vicidial_vendor_code ?? null,
      latest_disposition: t.latest_disposition ?? null,
    };
    if (pii) out.form_data = t.form_data ?? null;
    return out;
  });
}

module.exports = {
  SALE_COLS, SALE_PII_COLS, TRANSFER_COLS, TRANSFER_PII_COLS,
  companyMap, viciIdsOf, shapeSales, salesByIds, shapeTransfers, inChunks,
};

const { supabaseAdmin } = require('../../config/database');
const { Customer } = require('./Customer');
const { Vehicle } = require('./Vehicle');
const { WarrantyPlan } = require('./WarrantyPlan');
const { Transfer } = require('./Transfer');
const { Sale } = require('./Sale');
const { Cancellation } = require('./Cancellation');
const { Fronter, Closer } = require('./Agent');
const { Client } = require('./Client');

const ZERO = '00000000-0000-0000-0000-000000000000';

/** Most frequently occurring non-null value in a list (primary fronter/closer/client). */
function mostCommon(values) {
  const counts = new Map();
  for (const v of values) {
    if (v == null || v === '') continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  let best = null, bestN = 0;
  for (const [v, n] of counts) if (n > bestN) { best = v; bestN = n; }
  return best;
}

/** Collapse rows into one entry per customer_uuid (for the browse/search list). */
function dedupeCustomers(rows, limit) {
  const seen = new Map();
  for (const r of rows || []) {
    if (!r.customer_uuid || seen.has(r.customer_uuid)) continue;
    seen.set(r.customer_uuid, {
      customer_uuid: r.customer_uuid,
      name: r.customer_name || '—',
      phone: r.customer_phone || '',
      last_sale_date: r.sale_date || null,
    });
    if (seen.size >= limit) break;
  }
  return [...seen.values()];
}

/** 1–5 star value rating from a v_customer_segments row. */
function starRating(r) {
  const active = r.active_policies || 0;
  const canc   = r.cancellations   || 0;
  const sales  = r.sales_total     || 0;
  const xfers  = r.transfers_total || 0;
  if (sales === 0 && xfers >= 2) return 1;          // chased a lot, never bought
  let stars = 3;
  if (active >= 1) stars += 1;
  if (active >= 3) stars += 1;
  if (canc >= 1)   stars -= 1;
  if (canc >= 3)   stars -= 1;
  return Math.max(1, Math.min(5, stars));
}

/** VIN reduced to bare alphanumerics, uppercased (kills dashes/spaces/case). */
function normVin(v) { return String(v || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase(); }
/** Year|make|model fingerprint, punctuation/spacing/case stripped. */
function ymmKey(row) {
  return [row.car_year, row.car_make, row.car_model]
    .map(x => String(x ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase()).filter(Boolean).join('|');
}

/**
 * Map each sale row → a canonical vehicle key, de-duping a customer's cars.
 * Rule: same VIN = same car. A VIN-less sale folds into a VIN car with the same
 * year/make/model (a resell where the VIN was left blank), else groups with
 * other VIN-less sales of that year/make/model. Two DIFFERENT VINs never merge,
 * so genuinely distinct cars stay separate.
 */
function groupVehicleKeys(sales) {
  const keyByRow  = new Map();
  const vinKey    = new Map();   // vinNorm -> canonical key
  const ymmToVin  = new Map();   // ymm -> a VIN group's key
  for (const row of sales) {     // pass 1: VIN rows anchor the groups
    const vin = normVin(row.car_vin); if (!vin) continue;
    if (!vinKey.has(vin)) vinKey.set(vin, `vin:${vin}`);
    const k = vinKey.get(vin);
    const y = ymmKey(row); if (y && !ymmToVin.has(y)) ymmToVin.set(y, k);
    keyByRow.set(row.id, k);
  }
  const ymmless = new Map();
  for (const row of sales) {     // pass 2: VIN-less rows fold in by year/make/model
    const vin = normVin(row.car_vin); if (vin) continue;
    const y = ymmKey(row);
    let k = (y && ymmToVin.get(y)) || (y && ymmless.get(y));
    if (!k) { k = y ? `ymm:${y}` : `row:${row.id}`; if (y) ymmless.set(y, k); }
    keyByRow.set(row.id, k);
  }
  return keyByRow;
}

/** Human segment label for a row. */
function segmentLabel(r) {
  const a = r.active_policies || 0, c = r.cancellations || 0,
        s = r.sales_total || 0, x = r.transfers_total || 0, re = r.resells || 0;
  if (s === 0 && x >= 2) return 'Chased — no sale';
  if (a >= 2 && c === 0) return 'Star';
  if (re >= 1)           return 'Reseller';
  if (c >= 1 && a === 0) return 'Lost';
  if (c >= 1)            return 'At-risk';
  if (a >= 2)            return 'Loyal';
  if (a >= 1)            return 'Customer';
  if (s >= 1)            return 'Past customer';
  return 'Lead';
}

// Columns the profile needs — explicit (no select('*')) to keep egress tight.
const SALE_COLS = [
  'id', 'reference_no', 'status', 'closer_disposition', 'plan', 'sale_date', 'created_at',
  'company_id', 'closer_id', 'fronter_id', 'client_name',
  'customer_name', 'customer_phone', 'customer_phone_2', 'customer_email', 'customer_address',
  'car_vin', 'car_year', 'car_make', 'car_model', 'car_miles', 'miles_num',
  'down_payment', 'monthly_payment', 'cancellation_date', 'cancellation_reason_key',
  'superseded_by', 'is_resell', 'form_data',
].join(', ');
const TRANSFER_COLS = [
  'id', 'status', 'created_at', 'company_id', 'created_by', 'assigned_closer_id',
  'latest_disposition', 'vicidial_vendor_code', 'form_data', 'customer_uuid', 'normalized_phone',
].join(', ');

// Phone can live in the column OR inside form_data under any of these keys —
// mirrors the customer_uuid trigger (079), so anything that produced a uuid has
// a recoverable phone. Stops the profile showing a blank number when data exists.
const PHONE_KEYS = ['Phone', 'phone', 'customer_phone', 'Mobile', 'CellPhone', 'cli_number', 'phone_number', 'PhoneNumber'];
const fdPhone = (fd) => {
  if (!fd || typeof fd !== 'object') return null;
  for (const k of PHONE_KEYS) { const v = fd[k]; if (v != null && String(v).trim() !== '') return String(v).trim(); }
  return null;
};
/** First recoverable phone across all sales then all transfers (column → form_data). */
const pickPhone = (sales, transfers) => {
  for (const s of sales)     if (s.customer_phone)   return s.customer_phone;
  for (const s of sales)     { const p = fdPhone(s.form_data); if (p) return p; }
  for (const t of transfers) if (t.normalized_phone) return t.normalized_phone;
  for (const t of transfers) { const p = fdPhone(t.form_data); if (p) return p; }
  for (const s of sales)     if (s.customer_phone_2) return s.customer_phone_2;
  return null;
};

/**
 * CustomerProfileRepository — the ONLY place the profile talks to the database.
 * It resolves a customer_uuid, loads every sale + transfer that links to it, and
 * assembles the Customer aggregate (vehicles, plans, transfers, sales,
 * cancellations, fronter, closer, client). Superadmin scope = no row filtering;
 * the route enforces access. Static methods — the class is a namespace, the
 * entities carry the behaviour.
 */
class CustomerProfileRepository {
  /** Resolve a customer_uuid from a phone (sales first, then transfers). */
  static async resolveUuidByPhone(phone) {
    const raw = String(phone || '').replace(/\D/g, '');
    const norm = raw.length === 11 && raw.startsWith('1') ? raw.slice(1) : raw;
    if (!norm || norm.length < 7) return null;

    const { data: s } = await supabaseAdmin.from('sales')
      .select('customer_uuid').not('customer_uuid', 'is', null)
      .or(`customer_phone.eq.${norm},customer_phone.eq.+1${norm}`).limit(1).maybeSingle();
    if (s?.customer_uuid) return s.customer_uuid;

    const { data: t } = await supabaseAdmin.from('transfers')
      .select('customer_uuid').not('customer_uuid', 'is', null)
      .eq('normalized_phone', norm).limit(1).maybeSingle();
    return t?.customer_uuid || null;
  }

  static async loadByPhone(phone) {
    const uuid = await this.resolveUuidByPhone(phone);
    return uuid ? this.loadByUuid(uuid) : null;
  }

  /** Assemble the full Customer aggregate for a customer_uuid. */
  static async loadByUuid(customerUuid) {
    if (!customerUuid) return null;

    const [{ data: salesRows }, { data: transferRows }] = await Promise.all([
      supabaseAdmin.from('sales').select(SALE_COLS)
        .eq('customer_uuid', customerUuid).order('sale_date', { ascending: false }),
      supabaseAdmin.from('transfers').select(TRANSFER_COLS)
        .eq('customer_uuid', customerUuid).order('created_at', { ascending: false }),
    ]);
    const sales = salesRows || [];
    const transfers = transferRows || [];
    if (!sales.length && !transfers.length) return null;

    // Identity from the most recent sale, falling back to the latest transfer's form_data.
    const topSale = sales[0] || {};
    const fd = (transfers[0] || {}).form_data || {};
    const customer = new Customer({
      customer_uuid: customerUuid,
      name: topSale.customer_name
        || fd.customer_name || [fd.FirstName, fd.LastName].filter(Boolean).join(' ') || fd.Name || null,
      phone: pickPhone(sales, transfers),
      phone_2: topSale.customer_phone_2 || fd.Phone2 || fd.phone_2 || null,
      email: topSale.customer_email || fd.Email || null,
      address: topSale.customer_address || null,
    });

    // Sales → Sale + WarrantyPlan + Vehicle (de-duped) + Cancellation.
    const vehKeyByRow = groupVehicleKeys(sales);   // robust same-car dedup
    const vehicleByKey = new Map();
    for (const row of sales) {
      customer.addSale(new Sale(row));

      const vkey = vehKeyByRow.get(row.id) || Vehicle.keyOf(row);
      if (vkey) {
        if (!vehicleByKey.has(vkey)) vehicleByKey.set(vkey, new Vehicle({ ...row, plan_count: 0 }));
        const v = vehicleByKey.get(vkey);
        v.set('plan_count', v.get('plan_count', 0) + 1);
        // Keep the richest identity for the merged car (prefer a row with a VIN).
        if (!normVin(v.get('car_vin')) && row.car_vin) {
          v.set('car_vin', row.car_vin);
          if (row.car_year)  v.set('car_year', row.car_year);
          if (row.car_make)  v.set('car_make', row.car_make);
          if (row.car_model) v.set('car_model', row.car_model);
        }
      }
      if (row.plan) customer.addPlan(new WarrantyPlan({ ...row, vehicle_key: vkey }));
      if (row.cancellation_date || Sale.TERMINAL.includes(row.status)) {
        customer.addCancellation(new Cancellation(row));
      }
    }
    for (const v of vehicleByKey.values()) customer.addVehicle(v);

    // Transfers → Transfer.
    for (const row of transfers) customer.addTransfer(new Transfer(row));

    // Links — primary fronter / closer / client by frequency across the graph.
    const fronterId = mostCommon([...sales.map(s => s.fronter_id), ...transfers.map(t => t.created_by)]);
    const closerId  = mostCommon([...sales.map(s => s.closer_id), ...transfers.map(t => t.assigned_closer_id)]);
    const clientName = mostCommon(sales.map(s => s.client_name));

    const [fronter, closer] = await Promise.all([
      fronterId ? this.#loadAgentLite(fronterId, Fronter) : null,
      closerId ? this.#loadAgentLite(closerId, Closer) : null,
    ]);
    if (fronter) customer.linkFronter(fronter);
    if (closer)  customer.linkCloser(closer);
    if (clientName) {
      customer.linkClient(new Client({
        id: clientName, name: clientName,
        policy_count: sales.filter(s => s.client_name === clientName).length,
      }));
    }

    // Resolve company ids → names so the profile shows real company names.
    const coIds = customer.companies();
    if (coIds.length) {
      const { data: cos } = await supabaseAdmin.from('companies').select('id, name').in('id', coIds);
      customer.set('company_names', Object.fromEntries((cos || []).map(c => [c.id, c.name])));
    }

    return customer;
  }

  /** Light agent (name + role) for the customer's links — no stats query. */
  static async #loadAgentLite(userId, AgentClass) {
    const { data: prof } = await supabaseAdmin.from('user_profiles')
      .select('user_id, first_name, last_name').eq('user_id', userId).maybeSingle();
    return new AgentClass({ user_id: userId, ...(prof || {}) });
  }

  /** Full agent profile: their linked customers / transfers / sales / cancellations. */
  static async loadAgentProfile(userId, role) {
    if (!userId) return null;
    const { data: prof } = await supabaseAdmin.from('user_profiles')
      .select('user_id, first_name, last_name').eq('user_id', userId).maybeSingle();
    if (!prof) return null;

    const isFronter = role === 'fronter';
    const AgentClass = isFronter ? Fronter : Closer;
    const saleCol  = isFronter ? 'fronter_id' : 'closer_id';
    const xferCol  = isFronter ? 'created_by' : 'assigned_closer_id';

    const [{ data: aSales }, { data: aXfers }] = await Promise.all([
      supabaseAdmin.from('sales').select('customer_uuid, status, cancellation_date')
        .eq(saleCol, userId).limit(20000),
      supabaseAdmin.from('transfers').select('customer_uuid').eq(xferCol, userId).limit(20000),
    ]);
    const sales = aSales || [], xfers = aXfers || [];
    const customers = new Set(
      [...sales.map(s => s.customer_uuid), ...xfers.map(t => t.customer_uuid)].filter(Boolean)
    );
    const cancellations = sales.filter(s => s.cancellation_date || Sale.TERMINAL.includes(s.status)).length;

    return new AgentClass({
      user_id: userId, ...prof,
      stats: { customers: customers.size, transfers: xfers.length, sales: sales.length, cancellations },
    });
  }

  /** Browse/search distinct customers for the panel (by phone digits or name). */
  static async search(term, limit = 25) {
    const t = String(term || '').trim();
    let q = supabaseAdmin.from('sales')
      .select('customer_uuid, customer_name, customer_phone, sale_date')
      .not('customer_uuid', 'is', null);

    if (t) {
      const digits = t.replace(/\D/g, '');
      q = digits.length >= 4
        ? q.ilike('customer_phone', `%${digits}%`)
        : q.ilike('customer_name', `%${t}%`);
    }
    const { data } = await q.order('sale_date', { ascending: false }).limit(400);
    return dedupeCustomers(data, limit);
  }

  /**
   * Filterable browse over the per-customer rollup (v_customer_segments).
   * segment presets + numeric floors + name/phone search + sort. Gracefully
   * falls back to the simple search if the view isn't applied yet.
   */
  static async browse({ segment = 'all', sort = 'score', dir = 'desc', q = '', limit = 50, minT = 0, minP = 0, minC = 0 } = {}) {
    const cap = Math.min(limit, 100);
    const asc = dir === 'asc';

    // Build the filtered query for a given primary sort column. Secondary order
    // by active policies keeps ranking stable when the primary ties.
    const build = (col) => {
      let qb = supabaseAdmin.from('v_customer_segments').select('*');
      switch (segment) {
        case 'chased_no_sale': qb = qb.gte('transfers_total', Math.max(minT, 2)).eq('sales_total', 0); break;
        case 'star':           qb = qb.gte('active_policies', 2).eq('cancellations', 0); break;
        case 'loyal':          qb = qb.gte('active_policies', 2); break;
        case 'at_risk':        qb = qb.gte('cancellations', 1); break;
        case 'reseller':       qb = qb.gte('resells', 1); break;
        case 'one_and_done':   qb = qb.eq('active_policies', 1); break;
        default: break;
      }
      if (minT) qb = qb.gte('transfers_total', minT);
      if (minP) qb = qb.gte('active_policies', minP);
      if (minC) qb = qb.gte('cancellations', minC);
      if (q && q.trim()) {
        const d = q.replace(/\D/g, '');
        qb = d.length >= 4 ? qb.ilike('phone', `%${d}%`) : qb.ilike('name', `%${q.trim()}%`);
      }
      return qb.order(col, { ascending: asc, nullsFirst: false })
               .order('active_policies', { ascending: false, nullsFirst: false })
               .limit(cap);
    };

    const sortCol = ({
      transfers: 'transfers_total', policies: 'active_policies', cancellations: 'cancellations',
      activity: 'last_activity', sales: 'sales_total', resells: 'resells', score: 'score',
    })[sort] || 'score';

    let { data, error } = await build(sortCol);
    // 'score' column needs migration 125 — if absent, re-run sorted by activity.
    if (error && sortCol === 'score') ({ data, error } = await build('last_activity'));
    if (error) {
      const rows = await this.search(q, limit);   // view missing entirely → no breakdown
      return rows.map(r => ({ ...r, _fallback: true }));
    }
    return (data || []).map(r => ({
      ...r,
      last_sale_date: r.last_sale_date || null,
      stars: r.score != null ? r.score : starRating(r),
      segment_label: segmentLabel(r),
    }));
  }
}

module.exports = { CustomerProfileRepository, ZERO };

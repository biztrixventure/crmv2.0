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

// Columns the profile needs — explicit (no select('*')) to keep egress tight.
const SALE_COLS = [
  'id', 'reference_no', 'status', 'closer_disposition', 'plan', 'sale_date', 'created_at',
  'company_id', 'closer_id', 'fronter_id', 'client_name',
  'customer_name', 'customer_phone', 'customer_phone_2', 'customer_email', 'customer_address',
  'car_vin', 'car_year', 'car_make', 'car_model', 'car_miles', 'miles_num',
  'down_payment', 'monthly_payment', 'cancellation_date', 'cancellation_reason_key',
  'superseded_by', 'is_resell',
].join(', ');
const TRANSFER_COLS = [
  'id', 'status', 'created_at', 'company_id', 'created_by', 'assigned_closer_id',
  'latest_disposition', 'vicidial_vendor_code', 'form_data', 'customer_uuid', 'normalized_phone',
].join(', ');

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
      phone: topSale.customer_phone || fd.Phone || fd.phone || (transfers[0] || {}).normalized_phone || null,
      phone_2: topSale.customer_phone_2 || null,
      email: topSale.customer_email || fd.Email || null,
      address: topSale.customer_address || null,
    });

    // Sales → Sale + WarrantyPlan + Vehicle (de-duped) + Cancellation.
    const vehicleByKey = new Map();
    for (const row of sales) {
      customer.addSale(new Sale(row));

      const vkey = Vehicle.keyOf(row);
      if (vkey) {
        if (!vehicleByKey.has(vkey)) vehicleByKey.set(vkey, new Vehicle({ ...row, plan_count: 0 }));
        const v = vehicleByKey.get(vkey);
        v.set('plan_count', v.get('plan_count', 0) + 1);
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
}

module.exports = { CustomerProfileRepository, ZERO };

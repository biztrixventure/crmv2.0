const { Entity } = require('./Entity');

/**
 * Customer — the AGGREGATE ROOT of the profile and the central object of the
 * whole system. A customer is identified by customer_uuid (UUIDv5 of the
 * normalized phone — migrations 079/085). There is no customers table: the uuid
 * IS the identity, and every sale/transfer links back to it.
 *
 * A Fronter creates the transfer, but the entity being created is the Customer —
 * so this root composes the entire graph:
 *
 *   Customer 1 ─── * Vehicle          Customer * ─── 1 Fronter
 *            1 ─── * WarrantyPlan               * ─── 1 Closer
 *            1 ─── * Transfer                   * ─── 1 Client
 *            1 ─── * Sale
 *            1 ─── * Cancellation
 *
 * Collections are PRIVATE and appended through mutators during hydration (the
 * repository owns I/O). The root owns the derived counts and the single unified
 * profile shape the Superadmin panel renders. Extensibility: add a new linked
 * entity by adding a private collection + an add/link mutator + a line in
 * toProfile() — nothing else restructures, and bump SCHEMA_VERSION.
 */
class Customer extends Entity {
  static SCHEMA_VERSION = 1;

  #vehicles = [];
  #plans = [];
  #transfers = [];
  #sales = [];
  #cancellations = [];
  #fronter = null;
  #closer = null;
  #client = null;

  get customerUuid() { return this.get('customer_uuid'); }
  get name()    { return this.get('name'); }
  get phone()   { return this.get('phone'); }
  get phone2()  { return this.get('phone_2'); }
  get email()   { return this.get('email'); }
  get address() { return this.get('address'); }

  // ── relationship mutators (used by the repository during hydration) ──
  addVehicle(v)      { this.#vehicles.push(v); return this; }
  addPlan(p)         { this.#plans.push(p); return this; }
  addTransfer(t)     { this.#transfers.push(t); return this; }
  addSale(s)         { this.#sales.push(s); return this; }
  addCancellation(c) { this.#cancellations.push(c); return this; }
  linkFronter(f)     { this.#fronter = f; return this; }
  linkCloser(c)      { this.#closer = c; return this; }
  linkClient(c)      { this.#client = c; return this; }

  // ── encapsulated read access ──
  get vehicles()      { return [...this.#vehicles]; }
  get plans()         { return [...this.#plans]; }
  get transfers()     { return [...this.#transfers]; }
  get sales()         { return [...this.#sales]; }
  get cancellations() { return [...this.#cancellations]; }
  get fronter()       { return this.#fronter; }
  get closer()        { return this.#closer; }
  get client()        { return this.#client; }

  // ── derived domain queries ──
  transferCount()     { return this.#transfers.length; }
  saleCount()         { return this.#sales.length; }
  cancellationCount() { return this.#cancellations.length; }
  activePolicyCount() { return this.#plans.filter(p => p.active).length; }
  companies()         { return [...new Set(this.#sales.map(s => s.companyId).filter(Boolean))]; }

  stats() {
    return {
      transfers: this.transferCount(),
      sales: this.saleCount(),
      active_policies: this.activePolicyCount(),
      cancellations: this.cancellationCount(),
      vehicles: this.#vehicles.length,
      plans: this.#plans.length,
      companies: this.companies().length,
    };
  }

  /** The one unified view the Superadmin customer profile renders. */
  toProfile() {
    return {
      schema_version: Customer.SCHEMA_VERSION,
      customer_uuid: this.customerUuid,
      identity: {
        name: this.name, phone: this.phone, phone_2: this.phone2,
        email: this.email, address: this.address,
      },
      links: {
        fronter: this.#fronter ? this.#fronter.serialize() : null,
        closer:  this.#closer  ? this.#closer.serialize()  : null,
        client:  this.#client  ? this.#client.serialize()  : null,
      },
      vehicles:      this.#vehicles.map(v => v.serialize()),
      plans:         this.#plans.map(p => p.serialize()),
      transfers:     this.#transfers.map(t => t.serialize()),
      sales:         this.#sales.map(s => s.serialize()),
      cancellations: this.#cancellations.map(c => c.serialize()),
      stats: this.stats(),
    };
  }

  serialize() { return this.toProfile(); }
}

module.exports = { Customer };

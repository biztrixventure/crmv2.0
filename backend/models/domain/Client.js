const { Entity } = require('./Entity');

/**
 * Client — the closer-side client a customer's policies belong to
 * (sales.client_name today). Deliberately a thin entity so it can grow into a
 * first-class table later (id, contacts, billing) without changing the contract
 * the profile depends on.
 *
 *   Customer * ─── 1 Client
 */
class Client extends Entity {
  get name() { return this.get('name'); }

  fields() {
    return { name: this.name, policy_count: this.get('policy_count', 0) };
  }
}

module.exports = { Client };

const { Entity } = require('./Entity');

/**
 * Agent — base blueprint for the people who work a customer. Fronter and Closer
 * INHERIT from it: same profile shape, different role label and relationship to
 * the customer. The repository fills `stats` (their linked customers / transfers
 * / sales / cancellations) so an agent carries its own mini-profile.
 *
 *   Customer * ─── 1 Fronter (primary lead source)
 *   Customer * ─── 1 Closer  (primary handler)
 */
class Agent extends Entity {
  get userId()    { return this.get('user_id') ?? this.id; }
  get firstName() { return this.get('first_name'); }
  get lastName()  { return this.get('last_name'); }
  get fullName() {
    return [this.firstName, this.lastName].filter(Boolean).join(' ')
      || this.get('email') || 'Unknown';
  }

  /** Role label — subclasses override. Base is the abstract "agent". */
  get role() { return 'agent'; }

  fields() {
    return {
      user_id: this.userId,
      name: this.fullName,
      role: this.role,
      // { customers, transfers, sales, cancellations } — null until hydrated.
      stats: this.get('stats', null),
    };
  }
}

/** Fronter — created the transfer / generated the lead. */
class Fronter extends Agent {
  get role() { return 'fronter'; }
}

/** Closer — handled the transfer and made the sale. */
class Closer extends Agent {
  get role() { return 'closer'; }
}

module.exports = { Agent, Fronter, Closer };

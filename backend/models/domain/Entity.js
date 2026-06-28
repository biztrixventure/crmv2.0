/**
 * Entity — base blueprint for the customer-profile domain model.
 *
 * Every domain object (Customer, Vehicle, WarrantyPlan, Transfer, Sale,
 * Cancellation, Agent → Fronter/Closer, Client) extends this. It gives them:
 *   1. Encapsulation — the raw attribute bag is a PRIVATE field (#attrs).
 *      Callers read through typed getters, never the bag directly.
 *   2. A stable id + identity equality.
 *   3. Forward-compatible serialization — subclasses describe their shape in
 *      fields(); set()/get() let a new column flow through without restructuring
 *      every consumer (the extensibility hook the spec asks for).
 *
 * Pure domain object: holds NO database handle and performs NO I/O. Hydration
 * lives in CustomerProfileRepository, so these blueprints stay testable and the
 * persistence layer stays swappable.
 */
class Entity {
  #attrs;

  constructor(attrs = {}) {
    this.#attrs = { ...(attrs || {}) };
  }

  /** Read an encapsulated attribute (protected accessor for subclasses). */
  get(key, fallback = null) {
    const v = this.#attrs[key];
    return v === undefined ? fallback : v;
  }

  /** Set/extend an attribute — add new fields later without a new class shape. */
  set(key, value) {
    this.#attrs[key] = value;
    return this;
  }

  get id() { return this.get('id'); }

  /** Identity equality by concrete class + id. */
  equals(other) {
    return other instanceof Entity
      && other.constructor === this.constructor
      && other.id === this.id;
  }

  /** Subclasses override fields(); serialize() wraps it with the id. */
  fields() { return {}; }

  serialize() {
    return { id: this.id, ...this.fields() };
  }

  toJSON() { return this.serialize(); }
}

module.exports = { Entity };

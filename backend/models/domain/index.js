/**
 * Customer-profile domain model (OOP layer for the Superadmin panel).
 *
 * A pure, I/O-free blueprint of the business — Customer is the aggregate root;
 * everything links back to it. CustomerProfileRepository is the single seam to
 * the database. Existing functional routes are untouched; this is additive.
 *
 *   Entity (base · encapsulation + serialization)
 *    ├─ Customer (aggregate root)
 *    ├─ Vehicle · WarrantyPlan · Transfer · Sale · Cancellation · Client
 *    └─ Agent ─┬─ Fronter
 *              └─ Closer
 */
const { Entity } = require('./Entity');
const { Customer } = require('./Customer');
const { Vehicle } = require('./Vehicle');
const { WarrantyPlan } = require('./WarrantyPlan');
const { Transfer } = require('./Transfer');
const { Sale } = require('./Sale');
const { Cancellation } = require('./Cancellation');
const { Agent, Fronter, Closer } = require('./Agent');
const { Client } = require('./Client');
const { CustomerProfileRepository } = require('./CustomerProfileRepository');

module.exports = {
  Entity,
  Customer,
  Vehicle,
  WarrantyPlan,
  Transfer,
  Sale,
  Cancellation,
  Agent,
  Fronter,
  Closer,
  Client,
  CustomerProfileRepository,
};

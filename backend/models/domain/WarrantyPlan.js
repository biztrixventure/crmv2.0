const { Entity } = require('./Entity');

/**
 * WarrantyPlan — the coverage a customer holds. One per sale (a sale IS the
 * purchase of a plan on a vehicle). Linked to its Customer and the Vehicle (by
 * vehicle_key). "active" mirrors the one-active-policy rule used elsewhere:
 * approved (closed_won), not superseded, not cancelled.
 *
 *   Customer 1 ─── * WarrantyPlan * ─── 1 Vehicle
 */
class WarrantyPlan extends Entity {
  get name()        { return this.get('plan'); }
  get status()      { return this.get('status'); }
  get vehicleKey()  { return this.get('vehicle_key'); }
  get soldOn()      { return this.get('sale_date'); }
  get cancelledOn() { return this.get('cancellation_date'); }
  get referenceNo() { return this.get('reference_no'); }
  get downPayment() { return this.get('down_payment'); }
  get monthly()     { return this.get('monthly_payment'); }

  get active() {
    return this.status === 'closed_won' && !this.get('superseded_by') && !this.cancelledOn;
  }

  fields() {
    return {
      name: this.name, status: this.status, reference_no: this.referenceNo,
      vehicle_key: this.vehicleKey, sold_on: this.soldOn, cancelled_on: this.cancelledOn,
      down_payment: this.downPayment, monthly_payment: this.monthly, active: this.active,
    };
  }
}

module.exports = { WarrantyPlan };

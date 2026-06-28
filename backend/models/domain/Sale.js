const { Entity } = require('./Entity');

// A sale is "cancelled" by an explicit cancellation_date OR a terminal status —
// the same rule the customer-lifetime/timeline endpoints already use.
const TERMINAL = ['cancelled', 'compliance_cancelled', 'closed_lost', 'chargeback'];

/**
 * Sale — a concrete policy-sale row (the record behind a WarrantyPlan). Carries
 * the closer's disposition, the compliance status, the vehicle facets, and the
 * fronter/closer/client attribution.
 *
 *   Customer 1 ─── * Sale
 */
class Sale extends Entity {
  static TERMINAL = TERMINAL;

  get status()           { return this.get('status'); }
  get disposition()      { return this.get('closer_disposition'); }
  get plan()             { return this.get('plan'); }
  get referenceNo()      { return this.get('reference_no'); }
  get saleDate()         { return this.get('sale_date'); }
  get companyId()        { return this.get('company_id'); }
  get closerId()         { return this.get('closer_id'); }
  get fronterId()        { return this.get('fronter_id'); }
  get clientName()       { return this.get('client_name'); }
  get cancellationDate() { return this.get('cancellation_date'); }
  get isResell()         { return !!this.get('is_resell'); }

  get cancelled() {
    return !!this.cancellationDate || TERMINAL.includes(this.status);
  }
  get active() {
    return this.status === 'closed_won' && !this.get('superseded_by') && !this.cancelled;
  }

  fields() {
    return {
      reference_no: this.referenceNo, status: this.status, disposition: this.disposition,
      plan: this.plan, sale_date: this.saleDate, company_id: this.companyId,
      client_name: this.clientName, is_resell: this.isResell,
      cancelled: this.cancelled, active: this.active,
      cancellation_date: this.cancellationDate,   // SaleStatusBadge reads this
      down_payment: this.get('down_payment'),
      monthly_payment: this.get('monthly_payment'),
      vehicle: [this.get('car_year'), this.get('car_make'), this.get('car_model')]
        .filter(Boolean).join(' ') || null,
      vin: this.get('car_vin'),
    };
  }
}

module.exports = { Sale };

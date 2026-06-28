const { Entity } = require('./Entity');

/**
 * Transfer — a lead hand-off the FRONTER created. Carries the transfer number
 * (the row id), the customer reference (customer_uuid), the fronter (created_by),
 * the closer (assigned_closer_id), the dialer disposition, datetime, and status.
 * Plan + vehicle hints live in the dynamic form_data captured at transfer time.
 *
 *   Customer 1 ─── * Transfer * ─── 1 Fronter
 *                              * ─── 1 Closer
 */
class Transfer extends Entity {
  get number()      { return this.id; }
  get status()      { return this.get('status'); }
  get createdAt()   { return this.get('created_at'); }
  get fronterId()   { return this.get('created_by'); }
  get closerId()    { return this.get('assigned_closer_id'); }
  get companyId()   { return this.get('company_id'); }
  get disposition() { return this.get('latest_disposition'); }
  get vendorCode()  { return this.get('vicidial_vendor_code'); }

  fields() {
    const fd = this.get('form_data') || {};
    return {
      number: this.number, status: this.status, created_at: this.createdAt,
      company_id: this.companyId, disposition: this.disposition, vendor_code: this.vendorCode,
      plan: fd.plan || fd.Plan || null,
      vehicle: fd.vehicle
        || [fd.Year || fd.car_year, fd.Make || fd.car_make, fd.Model || fd.car_model]
            .filter(Boolean).join(' ') || null,
    };
  }
}

module.exports = { Transfer };

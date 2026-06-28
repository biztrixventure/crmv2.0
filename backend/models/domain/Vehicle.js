const { Entity } = require('./Entity');

/**
 * Vehicle — a customer's car. Identity is the VIN when present, else a
 * year|make|model fingerprint (VIN is missing on many imported rows). Derived
 * from the sale rows that reference it and linked back to its Customer.
 *
 *   Customer 1 ─── * Vehicle 1 ─── * WarrantyPlan
 */
class Vehicle extends Entity {
  /** Stable key used to de-duplicate a customer's cars across many sales. */
  static keyOf(row) {
    const vin = String(row.car_vin || '').trim().toUpperCase();
    if (vin) return `vin:${vin}`;
    const ymm = [row.car_year, row.car_make, row.car_model]
      .map(x => String(x || '').trim().toLowerCase()).filter(Boolean).join('|');
    return ymm ? `ymm:${ymm}` : null;
  }

  get vin()   { return this.get('car_vin'); }
  get year()  { return this.get('car_year'); }
  get make()  { return this.get('car_make'); }
  get model() { return this.get('car_model'); }
  get miles() { return this.get('miles_num') ?? this.get('car_miles'); }
  get label() { return [this.year, this.make, this.model].filter(Boolean).join(' ') || 'Vehicle'; }

  fields() {
    return {
      vin: this.vin, year: this.year, make: this.make, model: this.model,
      miles: this.miles, label: this.label,
      plan_count: this.get('plan_count', 0),
    };
  }
}

module.exports = { Vehicle };

const { Entity } = require('./Entity');

/**
 * Cancellation — a terminated policy. Built from a Sale that has a
 * cancellation_date (or a terminal status). Keeps the link back to its sale so
 * the profile can show "how many cancellations + their details".
 *
 *   Customer 1 ─── * Cancellation (each derived from one Sale)
 */
class Cancellation extends Entity {
  get date()        { return this.get('cancellation_date'); }
  get saleDate()    { return this.get('sale_date'); }
  get reasonKey()   { return this.get('cancellation_reason_key'); }
  get plan()        { return this.get('plan'); }
  get referenceNo() { return this.get('reference_no'); }
  get status()      { return this.get('status'); }

  fields() {
    return {
      sale_id: this.id, reference_no: this.referenceNo, plan: this.plan,
      status: this.status, date: this.date, reason_key: this.reasonKey,
      // sale_date lets the UI show "kept paying N months" (sale → cancel span).
      sale_date: this.saleDate,
    };
  }
}

module.exports = { Cancellation };

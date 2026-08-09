// ============================================================================
// qa2CustomerContext.js — auto-fetches customer/vehicle context for the QA v2
// Review screen. Never manually typed by a reviewer; resolved from the CRM
// the same way distributionBatches.js's GET /number-detail route already
// does it — mirrored deliberately, not reimplemented differently, since that
// route already solves the exact problem this one has: a fronter's transfer
// form_data is often the ONLY place customer/vehicle info lives when no sale
// ever closed (which is precisely the "Unclosed" review case this exists
// for). An earlier version of this file went through
// CustomerProfileRepository.loadByUuid(), whose vehicle-building loop reads
// ONLY sales rows — structurally empty for an unclosed call, so vehicle/zip
// silently never showed up. Fixed by reading sales AND the transfer's raw
// form_data directly, same as distributionBatches.js.
//
// TWO-TIER IDENTITY LOOKUP, safest first:
//   1. qa2_call.transfer_id is a real FK (set only for some fronter-leg
//      ingest rows) — zero ambiguity, no phone matching involved, and its
//      OWN form_data is preferred over any other transfer for this customer.
//   2. Otherwise fall back to normalized_phone -> customer_uuid via
//      CustomerProfileRepository.resolveUuidByPhone — the SAME identity
//      system sales/transfers already use (migs 079/085).
//
// Deliberately NOT dialer_lead_id or vendor_code: qa2_call.dialer_lead_id is
// bare digits with no box context, and vendor_code carries a prefix but no
// box confirmation either — both are exactly the "ambiguous across boxes"
// shape dialerBoxes.js's parseVendorCode()/findSaleRecording() refuse to
// trust alone (two boxes can share a prefix and name different customers).
// normalized_phone sidesteps that whole collision class.
// ============================================================================

const { supabaseAdmin } = require('../config/database');
const { CustomerProfileRepository } = require('../models/domain/CustomerProfileRepository');

const clean = (v) => { const s = v == null ? '' : String(v).trim(); return (s && s !== '-') ? s : null; };

// Lead form_data keys vary (VICIdial imports use CarMake/CarYear/Zip, manual
// forms use car_make/customer_address, …) — match case-insensitively, same
// pattern as distributionBatches.js:462-469.
function fieldGetter(fd) {
  const fdKeys = fd && typeof fd === 'object' ? Object.keys(fd) : [];
  return (...cands) => {
    for (const cand of cands) {
      const hit = fdKeys.find(k => k.toLowerCase() === cand.toLowerCase());
      const s = hit ? clean(fd[hit]) : null;
      if (s) return s;
    }
    return null;
  };
}

async function resolveCustomerContext(call) {
  if (!call) return null;

  let customerUuid = null;
  let directTransfer = null; // the transfer tied to THIS exact call, if any
  if (call.transfer_id) {
    const { data: t } = await supabaseAdmin
      .from('transfers').select('customer_uuid, form_data, company_id').eq('id', call.transfer_id).maybeSingle();
    if (t) { customerUuid = t.customer_uuid || null; directTransfer = t; }
  }
  if (!customerUuid && call.normalized_phone) {
    customerUuid = await CustomerProfileRepository.resolveUuidByPhone(call.normalized_phone);
  }
  if (!customerUuid) return null;

  const [{ data: salesR }, { data: transfersR }] = await Promise.all([
    supabaseAdmin.from('sales')
      .select('customer_name, car_year, car_make, car_model, car_vin, sale_date, company_id')
      .eq('customer_uuid', customerUuid).order('sale_date', { ascending: false, nullsFirst: false }).limit(20),
    supabaseAdmin.from('transfers')
      .select('form_data, created_at, company_id').eq('customer_uuid', customerUuid).order('created_at', { ascending: false }).limit(20),
  ]);
  const sales = salesR || [];
  const transfers = transfersR || [];
  if (!sales.length && !directTransfer && !transfers.length) return null;

  // Prefer whichever record shares THIS call's company — a reviewer should
  // see the deal for the company they're reviewing, not a different
  // company's record for the same phone number.
  const topSale = sales.find(s => s.company_id === call.company_id) || sales[0] || null;
  const topTransfer = directTransfer || transfers.find(t => t.company_id === call.company_id) || transfers[0] || null;
  const fget = fieldGetter(topTransfer?.form_data);

  const context = {
    customer_name: clean(topSale?.customer_name)
      || fget('customer_name', 'CustomerName') || [fget('FirstName'), fget('LastName')].filter(Boolean).join(' ') || fget('Name') || null,
    zip: fget('Zip', 'ZipCode', 'PostalCode', 'postal_code'),
    vehicle_year: clean(topSale?.car_year) || fget('CarYear', 'car_year', 'Year', 'vehicle_year'),
    vehicle_make: clean(topSale?.car_make) || fget('CarMake', 'car_make', 'Make', 'vehicle_make'),
    vehicle_model: clean(topSale?.car_model) || fget('CarModel', 'car_model', 'Model', 'vehicle_model'),
    vin: clean(topSale?.car_vin) || fget('CarVin', 'car_vin', 'VIN', 'vin'),
  };
  const hasAnything = Object.values(context).some(v => v != null);
  return hasAnything ? context : null;
}

module.exports = { resolveCustomerContext };

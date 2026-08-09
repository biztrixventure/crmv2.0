// ============================================================================
// qa2CustomerContext.js — auto-fetches customer/vehicle context for the QA v2
// Review screen. Never manually typed by a reviewer; resolved from the CRM
// the same way the rest of this codebase already does it.
//
// Reuses CustomerProfileRepository (backend/models/domain/) — the ONE place
// this codebase resolves a phone to a customer_uuid and assembles the full
// sales/transfers/vehicles graph — rather than reimplementing that here.
//
// TWO-TIER LOOKUP, safest first:
//   1. qa2_call.transfer_id is a real FK (set only for some fronter-leg
//      ingest rows) — zero ambiguity, no phone matching involved at all.
//   2. Otherwise fall back to normalized_phone -> customer_uuid, the SAME
//      identity system sales/transfers already use (migs 079/085).
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

// sales has no zip column at all (confirmed — vehicle/name are denormalized,
// zip never was) and neither does the Customer domain model, so this is the
// one field pulled straight from form_data rather than through the repository.
const ZIP_KEYS = ['Zip', 'ZipCode', 'PostalCode', 'postal_code', 'zip'];
function formDataZip(fd) {
  if (!fd || typeof fd !== 'object') return null;
  for (const k of ZIP_KEYS) { const v = fd[k]; if (v != null && String(v).trim() !== '') return String(v).trim(); }
  return null;
}

async function resolveCustomerContext(call) {
  if (!call) return null;
  let customerUuid = null;

  if (call.transfer_id) {
    const { data: t } = await supabaseAdmin.from('transfers').select('customer_uuid').eq('id', call.transfer_id).maybeSingle();
    customerUuid = t?.customer_uuid || null;
  }
  if (!customerUuid && call.normalized_phone) {
    customerUuid = await CustomerProfileRepository.resolveUuidByPhone(call.normalized_phone);
  }
  if (!customerUuid) return null;

  const customer = await CustomerProfileRepository.loadByUuid(customerUuid);
  if (!customer) return null;

  // Richest vehicle first (the repository already prefers a VIN-bearing row
  // when merging duplicates) and the most recent sale for the zip lookup.
  const vehicle = customer.vehicles[0] || null;
  const topSale = customer.sales[0] || null;

  const context = {
    customer_name: customer.name || null,
    zip: formDataZip(topSale?.get('form_data')) || null,
    vehicle_year: vehicle?.year ?? null,
    vehicle_make: vehicle?.make ?? null,
    vehicle_model: vehicle?.model ?? null,
    vin: vehicle?.vin ?? null,
  };
  const hasAnything = Object.values(context).some(v => v != null);
  return hasAnything ? context : null;
}

module.exports = { resolveCustomerContext };

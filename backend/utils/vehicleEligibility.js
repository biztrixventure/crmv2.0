// ============================================================================
// vehicleEligibility — auto-warranty plan-level vehicle eligibility checks
// (G22). Reads business_config vehicle_eligibility per-company w/ global
// fallback, then enforces year / miles / make caps against the row's
// vehicle. Returns either:
//   { ok: true }
//   { ok: false, reason, rule, attempted }
//
// Used by:
//   - POST /sales            (closer-side create)
//   - PUT  /sales/:id        (any-role edit)
//   - POST /sales/:id/resell (new resell row carries vehicle)
//   - confirmUpload (bulk-upload inserts)
//
// Enforcement mode comes from business_config vehicle_eligibility.enforcement
// (default 'block' → 400 from routes; 'warn' → routes attach
// eligibility_warning to the response).
// ============================================================================
const { getConfig } = require('./businessConfig');

const norm = (s) => String(s || '').trim().toLowerCase();
const intOrNull = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };

async function getEligibilityRule(companyId, planName) {
  const catalog = await getConfig(companyId, 'vehicle_eligibility', null);
  if (!catalog || typeof catalog !== 'object') return null;
  const key = norm(planName);
  if (catalog[key]) return { rule: catalog[key], match: key };
  if (catalog._default) return { rule: catalog._default, match: '_default' };
  return null;
}

/*
 * checkEligibility — runs every rule the catalog defines against the
 * vehicle. First-failure wins so the error message is precise.
 *
 * Args:
 *   { plan, car_year, car_make, car_miles }  (fields the route already has)
 *   companyId  (for per-company override resolution)
 *
 * Returns:
 *   { ok: true,  rule, match }                         on pass
 *   { ok: false, reason, rule, match, field, value }   on fail
 *   { ok: true, skipped: true }                        when catalog absent
 */
async function checkEligibility({ plan, car_year, car_make, car_miles }, companyId) {
  if (!plan) return { ok: true, skipped: true };
  const hit = await getEligibilityRule(companyId, plan);
  if (!hit) return { ok: true, skipped: true };
  const rule = hit.rule || {};

  const year  = intOrNull(car_year);
  const miles = intOrNull(car_miles);
  const make  = norm(car_make);

  // min_year — vehicle must be from this year or later.
  if (Number.isFinite(rule.min_year) && year !== null && year < rule.min_year) {
    return {
      ok: false, rule, match: hit.match, field: 'car_year', value: year,
      reason: `Vehicle year ${year} is below the minimum (${rule.min_year}) for plan "${plan}".`,
    };
  }

  // max_age_years — relative cap measured against current year.
  if (Number.isFinite(rule.max_age_years) && year !== null) {
    const currentYear = new Date().getFullYear();
    if (currentYear - year > rule.max_age_years) {
      return {
        ok: false, rule, match: hit.match, field: 'car_year', value: year,
        reason: `Vehicle is ${currentYear - year} years old; "${plan}" caps coverage at ${rule.max_age_years} years.`,
      };
    }
  }

  // max_miles — odometer cap.
  if (Number.isFinite(rule.max_miles) && miles !== null && miles > rule.max_miles) {
    return {
      ok: false, rule, match: hit.match, field: 'car_miles', value: miles,
      reason: `Vehicle has ${miles.toLocaleString()} miles; "${plan}" caps coverage at ${rule.max_miles.toLocaleString()} miles.`,
    };
  }

  // max_age_miles_combined — pair of [years, miles]. Both must be under
  // the pair to pass; either side over fails the rule. Useful for "older
  // than 10y OR over 100k → ineligible".
  if (Array.isArray(rule.max_age_miles_combined) && rule.max_age_miles_combined.length === 2) {
    const [maxAge, maxM] = rule.max_age_miles_combined.map(intOrNull);
    const currentYear = new Date().getFullYear();
    if (year !== null && miles !== null && (currentYear - year > maxAge || miles > maxM)) {
      return {
        ok: false, rule, match: hit.match, field: 'car_age_miles', value: { year, miles },
        reason: `"${plan}" requires both ≤ ${maxAge} years AND ≤ ${maxM.toLocaleString()} miles; this vehicle exceeds at least one.`,
      };
    }
  }

  // allowed_makes — whitelist (null = unrestricted).
  if (Array.isArray(rule.allowed_makes) && rule.allowed_makes.length && make
      && !rule.allowed_makes.map(norm).includes(make)) {
    return {
      ok: false, rule, match: hit.match, field: 'car_make', value: car_make,
      reason: `Make "${car_make}" isn't in the allowed list for "${plan}".`,
    };
  }

  // disallowed_makes — blacklist (overrides allowed_makes when both set).
  if (Array.isArray(rule.disallowed_makes) && rule.disallowed_makes.length && make
      && rule.disallowed_makes.map(norm).includes(make)) {
    return {
      ok: false, rule, match: hit.match, field: 'car_make', value: car_make,
      reason: `Make "${car_make}" is excluded from "${plan}" per the eligibility catalog.`,
    };
  }

  return { ok: true, rule, match: hit.match };
}

/*
 * enforceOrAttach — convenience for routes. Returns one of:
 *   { ok: true }                              → continue with route
 *   { ok: true, eligibility_warning: ... }    → continue, attach to response
 *   { ok: false, status: 400, payload }       → return res.status(400).json(payload)
 */
async function enforceOrAttach(row, companyId) {
  const result = await checkEligibility(row, companyId);
  if (result.ok || result.skipped) return { ok: true };
  const mode = await getConfig(companyId, 'vehicle_eligibility.enforcement', 'block');
  if (mode === 'warn') {
    return { ok: true, eligibility_warning: { reason: result.reason, field: result.field, value: result.value, match: result.match } };
  }
  return {
    ok: false, status: 400,
    payload: {
      error: result.reason,
      code: 'VEHICLE_INELIGIBLE',
      eligibility: { field: result.field, value: result.value, match: result.match, rule: result.rule },
    },
  };
}

module.exports = { checkEligibility, enforceOrAttach, getEligibilityRule };

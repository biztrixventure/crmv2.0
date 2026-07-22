// ============================================================================
// readonlyDataGuard — forget-proof RO enforcement for the raw sales / transfers
// / callbacks read mounts.
//
// The governed cross-company endpoints live under /api/compliance/* and apply
// company isolation + PII/financial masking inline. But /api/sales, /api/transfers
// and /api/callbacks are ALSO reachable by a readonly_admin's JWT and treat them
// like a superadmin (global, unmasked). Rather than patch every handler (easy to
// forget), this middleware wraps res.json on those mounts so EVERY response is
// governed by default:
//   • drop rows whose company_id is outside the RO's allowed-company set
//   • run maskForReadonly (PII / financial redaction per the RO's flags)
//   • 404 an out-of-scope single record
//
// No-op for non-RO and for an RO with no company restriction + both view flags
// on. Mirrors the egressAudit res.json-wrap precedent. Mount AFTER authMiddleware.
// ============================================================================
const { readonlyAllowedCompanyIds, companyInScope, maskForReadonly, isReadonly } = require('../utils/readonlyGovernance');

// Mount base → dataset slug (for the masker's field map).
const DATASET_BY_BASE = {
  '/api/sales': 'sales',
  '/api/transfers': 'transfers',
  '/api/callbacks': 'callbacks',
};
const ARRAY_KEYS = ['sales', 'transfers', 'callbacks', 'data', 'results'];
const RECORD_KEYS = ['sale', 'transfer', 'callback'];

function readonlyDataGuard(req, res, next) {
  if (req.method !== 'GET' || !isReadonly(req)) return next();
  const dataset = DATASET_BY_BASE[req.baseUrl];
  if (!dataset) return next();

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    // Defer to a microtask so we can await the async governance; identical
    // effect to a synchronous res.json from Express's perspective.
    Promise.resolve()
      .then(() => govern(body, dataset, req, res))
      .then(originalJson)
      .catch(() => originalJson(body));   // fail-open on any governance error
    return res;
  };
  next();
}

async function govern(body, dataset, req, res) {
  if (!body || typeof body !== 'object') return body;
  const allowed = await readonlyAllowedCompanyIds(req);   // null = unrestricted

  // Bare array response.
  if (Array.isArray(body)) {
    let rows = Array.isArray(allowed) ? body.filter(r => r && companyInScope(allowed, r.company_id)) : body;
    return await maskForReadonly(rows, dataset, req);
  }

  // { sales: [...] } / { transfers: [...] } / { callbacks: [...] } list wrappers.
  const arrKey = ARRAY_KEYS.find(k => Array.isArray(body[k]));
  if (arrKey) {
    let rows = body[arrKey];
    if (Array.isArray(allowed)) rows = rows.filter(r => r && companyInScope(allowed, r.company_id));
    rows = await maskForReadonly(rows, dataset, req);
    return { ...body, [arrKey]: rows };
  }

  // { sale: {...} } / { transfer: {...} } / { callback: {...} } single wrappers.
  const recKey = RECORD_KEYS.find(k => body[k] && typeof body[k] === 'object' && !Array.isArray(body[k]));
  if (recKey) {
    const rec = body[recKey];
    if (Array.isArray(allowed) && rec.company_id != null && !companyInScope(allowed, rec.company_id)) {
      res.status(404);
      return { error: 'Not found' };
    }
    return { ...body, [recKey]: await maskForReadonly(rec, dataset, req) };
  }

  // Bare single record (has company_id).
  if (body.company_id != null) {
    if (Array.isArray(allowed) && !companyInScope(allowed, body.company_id)) {
      res.status(404);
      return { error: 'Not found' };
    }
    return await maskForReadonly(body, dataset, req);
  }

  return body;
}

module.exports = { readonlyDataGuard };

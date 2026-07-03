// ============================================================================
// egressAudit — governs the CLIENT-SIDE CSV exports, which reuse the normal
// paginated list endpoints. It engages ONLY when a request carries the
// `__egress` marker (added by the frontend export helpers), so ordinary list
// browsing is completely untouched.
//
// How it works (page-based endpoints that return { total }):
//   • Only acts on the FIRST page of an export loop (page<=1 / offset 0). The
//     first page carries `total` = the whole export size, so we can reject the
//     export BEFORE it drains — the client's fetchAllForExport loop aborts on
//     the 429.
//   • Wraps res.json: reads total, runs the shared enforceEgress() (row cap +
//     daily count, logs allow/deny), and either 429s or passes the payload.
//   • Field selection: when an export.columns config exists for this
//     dataset+role, disallowed keys are DELETED from each response row so the
//     restricted field's value can never reach the browser/CSV (data-level
//     enforcement — universal; header-level removal is additionally applied by
//     the reference export handlers).
//
// Mounted globally BEFORE the routers; a request without `__egress` returns
// immediately. Deferring pages 2+ keeps the whole export authorized by one
// page-1 decision.
// ============================================================================
const { enforceEgress } = require('../utils/egressGuard');
const { resolveExportColumns } = require('../utils/egressConfig');

// dataset → the response key that holds the row array (so we can strip columns).
const DATASET_ROWS_KEY = {
  sales: 'sales', transfers: 'transfers', callbacks: 'callbacks',
  callback_audit: 'entries', reviews: 'reviews', numbers: 'numbers',
  company_data: 'sales',   // CompanyDetail reuses list shapes
};

function egressAudit(req, res, next) {
  const action = req.query.__egress || req.headers['x-egress-export'];
  if (!action) return next();   // not an export — untouched

  const dataset = String(req.query.__dataset || req.headers['x-egress-dataset'] || 'unknown');
  const pageNum = parseInt(req.query.page ?? '1', 10) || 1;
  const offset  = parseInt(req.query.offset ?? '0', 10) || 0;
  const isFirstPage = pageNum <= 1 && offset === 0;
  if (!isFirstPage) return next();   // pages 2+ already authorized on page 1

  // Snapshot the filter state exactly as sent (drop our own control keys).
  const filters = { ...req.query };
  delete filters.__egress; delete filters.__dataset;
  delete filters.page; delete filters.limit; delete filters.offset;

  const origJson = res.json.bind(res);
  res.json = (payload) => {
    (async () => {
      try {
        const total = typeof payload?.total === 'number'
          ? payload.total
          : (Array.isArray(payload?.[DATASET_ROWS_KEY[dataset]]) ? payload[DATASET_ROWS_KEY[dataset]].length : undefined);

        const decision = await enforceEgress({
          user: req.user, actionType: String(action), dataset,
          surface: `${req.method} ${req.baseUrl}${req.path}`,
          rowCount: total, filters,
        });
        if (!decision.allowed) {
          res.statusCode = 429;
          return origJson({ error: decision.message, code: 'EGRESS_LIMIT', limit: decision.limit });
        }

        // Field selection — delete disallowed keys from every row (data-level).
        const allowed = await resolveExportColumns({ companyId: req.user?.company_id, dataset, role: req.user?.role });
        if (allowed && allowed.length) {
          const key = DATASET_ROWS_KEY[dataset];
          const rows = key && Array.isArray(payload?.[key]) ? payload[key] : null;
          if (rows) {
            const keep = new Set(allowed);
            for (const row of rows) {
              for (const k of Object.keys(row)) if (!keep.has(k)) delete row[k];
            }
          }
        }
        return origJson(payload);
      } catch (e) {
        // Fail-open on an enforcement bug → serve the export rather than break it.
        return origJson(payload);
      }
    })();
    return res;
  };
  next();
}

module.exports = { egressAudit };

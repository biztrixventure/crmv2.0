// ============================================================================
// /api/payouts — SuperAdmin Payout tab (mig 243).
//
// Worklist = every sale compliance has EVER approved (compliance_reviewed_at
// IS NOT NULL), regardless of its current status — a sale approved then later
// cancelled still owes (or has already received) its payout, so it stays on
// this list with its live compliance status shown alongside the payout state.
//
// payout_status is a separate lifecycle from the sale's own compliance
// status: pending (default) → paid / reverted, set here and nowhere else.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');
const { escapeOrValue } = require('../utils/searchSanitize');

const router = express.Router();

const PAYOUT_STATUSES = ['pending', 'paid', 'reverted'];
const LIMIT = 30;

router.use(asyncHandler(async (req, res, next) => {
  if (!(await isSuperAdmin(req.user.id))) {
    return res.status(403).json({ error: 'Superadmin access required' });
  }
  next();
}));

// Applies the filters shared by the list query and the KPI RPC — every caller
// narrows by the same company/client/date/search combination, just not by
// payout_status (that stays list-only so the KPI tiles keep showing all three
// buckets at once).
function applyFilters(q, { company_id, client_name, date_from, date_to, search }) {
  q = q.not('compliance_reviewed_at', 'is', null);
  if (company_id)  q = q.eq('company_id', company_id);
  if (client_name) q = q.eq('client_name', client_name);
  if (date_from)    q = q.gte('sale_date', date_from);
  if (date_to)      q = q.lte('sale_date', date_to);
  if (search) {
    const s = escapeOrValue(search);
    q = q.or(`customer_name.ilike.%${s}%,customer_phone.ilike.%${s}%,reference_no.ilike.%${s}%`);
  }
  return q;
}

// GET /payouts — the approved-sales worklist + KPI sums for the current filters.
router.get('/', asyncHandler(async (req, res) => {
  const {
    company_id, client_name, payout_status, date_from, date_to, search,
    page = 1, limit = LIMIT,
  } = req.query;

  if (payout_status && !PAYOUT_STATUSES.includes(payout_status)) {
    return res.status(400).json({ error: 'Invalid payout_status filter' });
  }

  const filters = { company_id, client_name, date_from, date_to, search };

  let listQuery = applyFilters(supabaseAdmin.from('sales').select('*', { count: 'exact' }), filters)
    .order('sale_date', { ascending: false, nullsFirst: false });
  if (payout_status) listQuery = listQuery.eq('payout_status', payout_status);

  const offset = (parseInt(page) - 1) * parseInt(limit);
  listQuery = listQuery.range(offset, offset + parseInt(limit) - 1);

  const [{ data, error, count }, { data: kpiRows, error: kpiError }] = await Promise.all([
    listQuery,
    supabaseAdmin.rpc('payout_kpis', {
      p_company_id: company_id || null,
      p_client_name: client_name || null,
      p_date_from: date_from || null,
      p_date_to: date_to || null,
      p_search: search || null,
    }),
  ]);
  if (error) return res.status(500).json({ error: error.message });

  const kpis = { pending: { count: 0, gross: 0 }, paid: { count: 0, gross: 0 }, reverted: { count: 0, gross: 0 } };
  if (!kpiError) {
    for (const row of (kpiRows || [])) {
      if (kpis[row.payout_status]) kpis[row.payout_status] = { count: Number(row.cnt) || 0, gross: Number(row.gross) || 0 };
    }
  }

  res.json({ sales: data || [], total: count || 0, kpis });
}));

// PATCH /payouts/:id — set payout_status. The only write this surface makes.
router.patch('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { payout_status } = req.body;
  if (!PAYOUT_STATUSES.includes(payout_status)) {
    return res.status(400).json({ error: 'payout_status must be one of: ' + PAYOUT_STATUSES.join(', ') });
  }

  const { data, error } = await supabaseAdmin
    .from('sales')
    .update({
      payout_status,
      payout_updated_at: new Date().toISOString(),
      payout_updated_by: req.user.id,
    })
    .eq('id', id)
    .not('compliance_reviewed_at', 'is', null)
    .select('id, payout_status, payout_updated_at')
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Sale not found, or it has never been compliance-approved' });

  res.json({ sale: data });
}));

module.exports = router;

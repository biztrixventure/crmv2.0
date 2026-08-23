// ============================================================================
// /api/accounting/accounts -- the chart of accounts (mig 283).
//
// The account_type on every row is what the P&L and balance sheet are built
// from (routes/accounting/reports.js), so it is immutable once the account has
// been used: re-typing a used account silently rewrites every past report.
// Renaming, re-coding and re-parenting stay editable.
//
// Deleting is likewise refused once an account carries journal lines -- the FK
// is ON DELETE RESTRICT and would 500; this returns a 409 that says why, and
// points at archiving (is_active=false) instead.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../../config/database');
const { asyncHandler } = require('../../middleware/errorHandler');
const logger = require('../../utils/logger');
const { deny, readCompanyId, writeCompanyId } = require('../../utils/moduleAccess');

const router = express.Router();

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'];

// Rows -> nested tree by parent_id. Orphans (parent archived or in another
// company) surface at the root rather than vanishing.
function toTree(rows) {
  const byId = new Map(rows.map(r => [r.id, { ...r, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (list) => {
    list.sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
    list.forEach(n => sort(n.children));
  };
  sort(roots);
  return roots;
}

const usageCount = async (accountId) => {
  const { count } = await supabaseAdmin
    .from('journal_entry_lines')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId);
  return count || 0;
};

// GET /api/accounting/accounts?tree=true&include_inactive=true
router.get('/', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ accounts: [], tree: [] });
  if (await deny(req, res, companyId, 'accounting.accounts.view')) return;

  let q = supabaseAdmin
    .from('chart_of_accounts')
    .select('id, code, name, account_type, account_subtype, parent_id, description, is_active, is_system, created_at')
    .eq('company_id', companyId)
    .order('code', { ascending: true });
  if (req.query.include_inactive !== 'true') q = q.eq('is_active', true);
  if (req.query.account_type) q = q.eq('account_type', req.query.account_type);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const accounts = data || [];
  res.json({
    accounts,
    tree: req.query.tree === 'true' ? toTree(accounts) : undefined,
    total: accounts.length,
  });
}));

// GET /api/accounting/accounts/:id -- one account plus how heavily it is used.
router.get('/:id', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.accounts.view')) return;

  const { data, error } = await supabaseAdmin
    .from('chart_of_accounts').select('*')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Account not found' });

  res.json({ account: { ...data, line_count: await usageCount(data.id) } });
}));

// POST /api/accounting/accounts
router.post('/', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });
  if (await deny(req, res, companyId, 'accounting.accounts.manage')) return;

  const { code, name, account_type, account_subtype, parent_id, description } = req.body || {};
  if (!code || !name)                      return res.status(400).json({ error: 'code and name are required' });
  if (!ACCOUNT_TYPES.includes(account_type)) return res.status(400).json({ error: 'account_type must be one of: ' + ACCOUNT_TYPES.join(', ') });

  // A parent must live in the same company, or the tree leaks across tenants.
  if (parent_id) {
    const { data: parent } = await supabaseAdmin
      .from('chart_of_accounts').select('id').eq('id', parent_id).eq('company_id', companyId).maybeSingle();
    if (!parent) return res.status(400).json({ error: 'Parent account not found in this company' });
  }

  const { data, error } = await supabaseAdmin.from('chart_of_accounts').insert({
    company_id: companyId,
    code: String(code).trim(),
    name: String(name).trim(),
    account_type,
    account_subtype: account_subtype || null,
    parent_id: parent_id || null,
    description: description || null,
    created_by: req.user.id,
  }).select().single();

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'An account with that code already exists' });
    return res.status(500).json({ error: error.message });
  }
  logger.info('ACCOUNTING', 'account ' + data.code + ' created in ' + companyId + ' by ' + req.user.id);
  res.status(201).json({ account: data });
}));

// PUT /api/accounting/accounts/:id
router.put('/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.accounts.manage')) return;

  const { data: existing } = await supabaseAdmin
    .from('chart_of_accounts').select('*')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Account not found' });

  const patch = { updated_at: new Date().toISOString() };
  for (const f of ['code', 'name', 'account_subtype', 'description']) {
    if (req.body?.[f] !== undefined) patch[f] = req.body[f];
  }
  if (req.body?.is_active !== undefined) patch.is_active = !!req.body.is_active;

  if (req.body?.parent_id !== undefined) {
    if (req.body.parent_id === existing.id) return res.status(400).json({ error: 'An account cannot be its own parent' });
    if (req.body.parent_id) {
      const { data: parent } = await supabaseAdmin
        .from('chart_of_accounts').select('id').eq('id', req.body.parent_id).eq('company_id', companyId).maybeSingle();
      if (!parent) return res.status(400).json({ error: 'Parent account not found in this company' });
    }
    patch.parent_id = req.body.parent_id || null;
  }

  // account_type is frozen once the account carries history -- see header.
  if (req.body?.account_type !== undefined && req.body.account_type !== existing.account_type) {
    if (!ACCOUNT_TYPES.includes(req.body.account_type)) {
      return res.status(400).json({ error: 'account_type must be one of: ' + ACCOUNT_TYPES.join(', ') });
    }
    if (await usageCount(existing.id) > 0) {
      return res.status(409).json({
        error: 'This account already has journal lines. Changing its type would rewrite past reports -- archive it and create a new account instead.',
      });
    }
    patch.account_type = req.body.account_type;
  }

  const { data, error } = await supabaseAdmin
    .from('chart_of_accounts').update(patch).eq('id', existing.id).select().single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'An account with that code already exists' });
    return res.status(500).json({ error: error.message });
  }
  res.json({ account: data });
}));

// DELETE /api/accounting/accounts/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'accounting.accounts.manage')) return;

  const { data: existing } = await supabaseAdmin
    .from('chart_of_accounts').select('id, code, is_system')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Account not found' });

  const used = await usageCount(existing.id);
  if (used > 0) {
    return res.status(409).json({
      error: 'Account ' + existing.code + ' has ' + used + ' journal line(s) and cannot be deleted. Archive it instead.',
      line_count: used,
    });
  }
  const { count: childCount } = await supabaseAdmin
    .from('chart_of_accounts').select('id', { count: 'exact', head: true }).eq('parent_id', existing.id);
  if (childCount) return res.status(409).json({ error: 'Account has ' + childCount + ' child account(s). Move or delete those first.' });

  const { error } = await supabaseAdmin.from('chart_of_accounts').delete().eq('id', existing.id);
  if (error) return res.status(500).json({ error: error.message });
  logger.info('ACCOUNTING', 'account ' + existing.code + ' deleted from ' + companyId + ' by ' + req.user.id);
  res.json({ ok: true });
}));

// POST /api/accounting/accounts/seed-defaults
// A blank chart of accounts is unusable, and hand-typing 20 accounts before you
// can raise one invoice is how a module gets abandoned. Seeds a conventional
// starter chart. Idempotent -- existing codes are skipped, nothing overwritten.
const DEFAULT_ACCOUNTS = [
  ['1000', 'Cash',                  'asset',     null],
  ['1100', 'Accounts Receivable',   'asset',     null],
  ['1200', 'Prepaid Expenses',      'asset',     null],
  ['1500', 'Equipment',             'asset',     null],
  ['2000', 'Accounts Payable',      'liability', null],
  ['2100', 'Payroll Liabilities',   'liability', null],
  ['2200', 'Taxes Payable',         'liability', null],
  ['3000', 'Owner Equity',          'equity',    null],
  ['3100', 'Retained Earnings',     'equity',    null],
  ['4000', 'Sales Revenue',         'revenue',   null],
  ['4100', 'Service Revenue',       'revenue',   null],
  ['5000', 'Salaries and Wages',    'expense',   null],
  ['5100', 'Commissions',           'expense',   null],
  ['5200', 'Rent',                  'expense',   null],
  ['5300', 'Utilities',             'expense',   null],
  ['5400', 'Software and Tools',    'expense',   null],
  ['5500', 'Telecom and Dialer',    'expense',   null],
  ['5600', 'Marketing',             'expense',   null],
  ['5700', 'Travel',                'expense',   null],
  ['5900', 'Other Expenses',        'expense',   null],
];

router.post('/seed-defaults', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });
  if (await deny(req, res, companyId, 'accounting.accounts.manage')) return;

  const { data: existing } = await supabaseAdmin
    .from('chart_of_accounts').select('code').eq('company_id', companyId);
  const have = new Set((existing || []).map(r => r.code));
  const rows = DEFAULT_ACCOUNTS
    .filter(([code]) => !have.has(code))
    .map(([code, name, account_type]) => ({
      company_id: companyId, code, name, account_type,
      is_system: true, created_by: req.user.id,
    }));

  if (!rows.length) return res.json({ created: 0, accounts: [], message: 'Chart of accounts already seeded' });

  const { data, error } = await supabaseAdmin.from('chart_of_accounts').insert(rows).select();
  if (error) return res.status(500).json({ error: error.message });
  logger.info('ACCOUNTING', 'seeded ' + rows.length + ' default accounts in ' + companyId);
  res.status(201).json({ created: data.length, accounts: data });
}));

module.exports = router;

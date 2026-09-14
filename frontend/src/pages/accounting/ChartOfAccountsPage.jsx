// ============================================================================
// Accounting -> Chart of Accounts. A tree, because the chart IS a tree and
// flattening it hides the one thing the reader is looking for: what rolls up
// into what. Each row shows the account's balance to date (the same fold the
// reports use -- GET /accounting/accounts?with_balances=true).
//
// Two refusals are surfaced as guidance rather than as failures, because both
// are the server protecting history and the person needs to know what to do
// instead:
//   * deleting an account that carries journal lines -> archive it
//   * re-typing an account that carries journal lines -> make a new one
//
// Name, code, parent and description stay editable for ever; entries already
// posted keep pointing at the same account, so renaming never rewrites history.
// ============================================================================
import { useState, useEffect, useMemo } from 'react';
import {
  ListTree, Plus, Pencil, Trash2, ChevronRight, ChevronDown, Archive, Sparkles,
} from 'lucide-react';
import { Panel, SectionHeader, Loading, EmptyState, Field, IconButton } from '../../components/UI/kit';
import { Alert, Badge } from '../../components/UI';
import ThemedSelect from '../../components/UI/Select';
import { Btn, ModuleModal } from '../../components/Modules/ModuleUI';
import AskDialog from '../../components/Modules/AskDialog';
import { useChartOfAccounts } from '../../hooks/useChartOfAccounts';
import { fmtMoney, DEFAULT_CURRENCY } from '../../utils/money';

const TYPES = [
  { value: 'asset',     label: 'Asset',     tone: 'var(--color-info-600)',    means: 'Something the company has (cash, money owed to it, equipment).' },
  { value: 'liability', label: 'Liability', tone: 'var(--color-warning-600)', means: 'Something the company owes (bills, salaries due, tax held).' },
  { value: 'equity',    label: 'Equity',    tone: 'var(--color-primary-600)', means: "The owners' stake -- what is left after paying everything owed." },
  { value: 'revenue',   label: 'Revenue',   tone: 'var(--color-success-600)', means: 'Money earned. Lands on the profit and loss.' },
  { value: 'expense',   label: 'Expense',   tone: 'var(--color-error-600)',   means: 'Money spent running the business. Lands on the profit and loss.' },
];
const toneOf = (t) => TYPES.find(x => x.value === t)?.tone || 'var(--color-text-secondary)';

export default function ChartOfAccountsPage({ scope }) {
  const companyId = scope?.company_id || null;
  const currency = scope?.currency || DEFAULT_CURRENCY;
  const canManage = !!scope?.permissions?.['accounting.accounts.manage'];
  const canSeeMoney = !!scope?.permissions?.['accounting.journal.view'] || !!scope?.permissions?.['accounting.reports.view'];
  const { accounts, tree, loading, error, fetchAccounts, createAccount, updateAccount, deleteAccount, seedDefaults } =
    useChartOfAccounts(companyId);

  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState(null);      // account object, or {} for new
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(null);

  useEffect(() => {
    fetchAccounts({ include_inactive: showInactive, with_balances: canSeeMoney || undefined });
  }, [fetchAccounts, showInactive, canSeeMoney]);

  const toggle = (id) => setCollapsed(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const onDelete = (account) => setAsking({
    title: `Delete ${account.code} ${account.name}?`,
    message: 'Only an account nothing was ever posted to can be deleted. If it has been used, archive it instead -- it disappears from pickers but its history stays.',
    confirmLabel: 'Delete account', danger: true,
    onConfirm: async () => {
      setNotice(null);
      try {
        await deleteAccount(account.id);
        setNotice({ type: 'success', text: `Deleted ${account.code}.` });
      } catch (e) {
        // 409 = it has journal lines. That is guidance, not a bug.
        setNotice({ type: 'warning', text: e.response?.data?.error || 'Could not delete the account.' });
      }
      setAsking(null);
    },
  });

  const onArchive = async (account) => {
    setBusy(true);
    try {
      await updateAccount(account.id, { is_active: !account.is_active });
      setNotice({ type: 'success', text: `${account.code} ${account.is_active ? 'archived' : 'restored'}.` });
    } catch (e) {
      setNotice({ type: 'error', text: e.response?.data?.error || 'Could not update the account.' });
    } finally { setBusy(false); }
  };

  // Idempotent server-side: only codes the company does not have are added,
  // nothing is overwritten -- safe to press on a chart that already exists.
  const onSeed = async () => {
    setBusy(true);
    try {
      const r = await seedDefaults();
      setNotice({ type: 'success', text: r.created ? `Added ${r.created} standard account${r.created === 1 ? '' : 's'}.` : 'Every standard account is already here.' });
    } catch (e) {
      setNotice({ type: 'error', text: e.response?.data?.error || 'Could not add the standard accounts.' });
    } finally { setBusy(false); }
  };

  // Parent picker excludes the account being edited (it cannot parent itself);
  // deeper cycles are refused by the server.
  const parentOptions = useMemo(
    () => accounts.filter(a => !editing?.id || a.id !== editing.id),
    [accounts, editing?.id],
  );

  return (
    <div className="space-y-4">
      <SectionHeader level="page" icon={ListTree} title="Chart of accounts"
        subtitle={`${accounts.length} account${accounts.length === 1 ? '' : 's'}${scope?.company_name ? ' -- ' + scope.company_name : ''}`}
        actions={canManage ? (
          <div className="flex items-center gap-2 flex-wrap">
            <Btn icon={Sparkles} busy={busy} onClick={onSeed}>
              {accounts.length === 0 ? 'Add the standard accounts' : 'Add any missing standard accounts'}
            </Btn>
            <Btn variant="primary" icon={Plus} onClick={() => setEditing({})}>New account</Btn>
          </div>
        ) : null} />

      {error && <Alert type="error">{error}</Alert>}
      {notice && <Alert type={notice.type} onDismiss={() => setNotice(null)}>{notice.text}</Alert>}

      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer"
          style={{ color: 'var(--color-text-secondary)' }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)}
            style={{ accentColor: 'var(--color-primary-600)', width: 14, height: 14 }} />
          Show archived accounts
        </label>
        <div className="flex items-center gap-2 flex-wrap ml-auto">
          {TYPES.map(t => (
            <span key={t.value} className="flex items-center gap-1 text-[11px] font-semibold"
              style={{ color: 'var(--color-text-secondary)' }} title={t.means}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: t.tone, display: 'inline-block' }} />
              {t.label}
            </span>
          ))}
        </div>
      </div>

      {loading && accounts.length === 0 ? <Loading variant="rows" rows={8} label="Loading the chart of accounts" /> : (
        tree.length === 0 ? (
          <EmptyState icon={ListTree} title="No accounts yet"
            hint="A ledger needs accounts to post to. Add the standard set (you can rename, re-code or archive any of them), or add them one at a time."
            action={canManage ? <Btn variant="primary" icon={Sparkles} busy={busy} onClick={onSeed}>Add the standard accounts</Btn> : null} />
        ) : (
          <Panel pad="sm">
            {tree.map(node => (
              <AccountRow key={node.id} node={node} depth={0} canManage={canManage} currency={currency}
                showBalance={canSeeMoney} collapsed={collapsed} onToggle={toggle}
                onEdit={setEditing} onArchive={onArchive} onDelete={onDelete} />
            ))}
          </Panel>
        )
      )}

      {editing && (
        <AccountEditor account={editing} parents={parentOptions}
          onClose={() => setEditing(null)}
          onSave={async (payload) => {
            setNotice(null);
            try {
              if (editing.id) await updateAccount(editing.id, payload);
              else await createAccount(payload);
              setEditing(null);
              setNotice({ type: 'success', text: 'Saved.' });
            } catch (e) {
              setNotice({ type: 'error', text: e.response?.data?.error || 'Could not save the account.' });
            }
          }} />
      )}

      {asking && <AskDialog {...asking} onClose={() => setAsking(null)} />}
    </div>
  );
}

function AccountRow({ node, depth, canManage, currency, showBalance, collapsed, onToggle, onEdit, onArchive, onDelete }) {
  const kids = node.children || [];
  const isCollapsed = collapsed.has(node.id);
  const bal = Number(node.balance || 0);
  return (
    <>
      <div className="flex items-center gap-2 py-1.5 group"
        style={{ paddingLeft: depth * 18, borderBottom: '1px solid var(--color-border-subtle, var(--color-border))' }}>
        <span style={{ width: 16, flexShrink: 0 }}>
          {kids.length > 0 && (
            <button onClick={() => onToggle(node.id)} className="flex items-center"
              style={{ color: 'var(--color-text-tertiary)' }} aria-label={isCollapsed ? 'Expand' : 'Collapse'}>
              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
        </span>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: toneOf(node.account_type), flexShrink: 0 }} />
        <span className="font-mono text-xs w-12 sm:w-16 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>{node.code}</span>
        <span className="text-sm truncate min-w-0" style={{ color: 'var(--color-text)', opacity: node.is_active ? 1 : 0.5 }}>
          {node.name}
        </span>
        {!node.is_active && <Badge variant="info" size="sm">Archived</Badge>}
        <span className="text-[11px] ml-auto flex-shrink-0 capitalize hidden sm:inline" style={{ color: 'var(--color-text-tertiary)' }}>
          {node.account_type}
        </span>
        {showBalance && (
          <span className="text-sm tabular-nums text-right flex-shrink-0" style={{
            minWidth: 96, marginLeft: 8,
            color: bal === 0 ? 'var(--color-text-tertiary)' : bal < 0 ? 'var(--color-error-600)' : 'var(--color-text)',
          }}>
            {fmtMoney(bal, currency)}
          </span>
        )}
        {/* Always reachable on touch screens; brighter on hover with a mouse. */}
        {canManage && (
          <span className="flex items-center gap-1 flex-shrink-0 opacity-70 group-hover:opacity-100 transition-opacity">
            <IconButton label="Edit" variant="ghost" onClick={() => onEdit(node)}><Pencil size={15} /></IconButton>
            <IconButton label={node.is_active ? 'Archive' : 'Restore'} variant="ghost" onClick={() => onArchive(node)}><Archive size={15} /></IconButton>
            <IconButton label="Delete" tone="error" variant="ghost" onClick={() => onDelete(node)}><Trash2 size={15} /></IconButton>
          </span>
        )}
      </div>
      {!isCollapsed && kids.map(k => (
        <AccountRow key={k.id} node={k} depth={depth + 1} canManage={canManage} currency={currency}
          showBalance={showBalance} collapsed={collapsed} onToggle={onToggle}
          onEdit={onEdit} onArchive={onArchive} onDelete={onDelete} />
      ))}
    </>
  );
}

function AccountEditor({ account, parents, onClose, onSave }) {
  const isNew = !account.id;
  const [form, setForm] = useState({
    code: account.code || '',
    name: account.name || '',
    account_type: account.account_type || 'expense',
    account_subtype: account.account_subtype || '',
    parent_id: account.parent_id || '',
    description: account.description || '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const type = TYPES.find(t => t.value === form.account_type);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!form.code.trim() || !form.name.trim()) return;
    setSaving(true);
    try { await onSave({ ...form, parent_id: form.parent_id || null }); } finally { setSaving(false); }
  };

  return (
    <ModuleModal title={isNew ? 'New account' : `Edit ${account.code}`} onClose={onClose}
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" busy={saving} disabled={!form.code.trim() || !form.name.trim()} onClick={submit}>Save account</Btn>
      </>}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Code" required>
            <input className="input w-full" value={form.code} required
              onChange={e => set('code', e.target.value)} placeholder="5200" />
          </Field>
          <Field label="Name" required className="sm:col-span-2">
            <input className="input w-full" value={form.name} required
              onChange={e => set('name', e.target.value)} placeholder="Rent" />
          </Field>
        </div>

        <Field label="Type" required
          hint={(type?.means || '') + (!isNew ? ' Cannot be changed once the account has entries -- it would rewrite past reports.' : '')}>
          <ThemedSelect value={form.account_type} onChange={e => set('account_type', e.target.value)}>
            {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </ThemedSelect>
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Parent account" hint="Optional -- for roll-up subtotals.">
            <ThemedSelect value={form.parent_id} onChange={e => set('parent_id', e.target.value)}>
              <option value="">No parent (top level)</option>
              {parents.map(p => <option key={p.id} value={p.id}>{p.code} -- {p.name}</option>)}
            </ThemedSelect>
          </Field>
          <Field label="Subtype" hint="Free text, e.g. Current asset.">
            <input className="input w-full" value={form.account_subtype}
              onChange={e => set('account_subtype', e.target.value)} />
          </Field>
        </div>

        <Field label="Description">
          <textarea className="input w-full" rows={2} value={form.description}
            onChange={e => set('description', e.target.value)} />
        </Field>
      </form>
    </ModuleModal>
  );
}

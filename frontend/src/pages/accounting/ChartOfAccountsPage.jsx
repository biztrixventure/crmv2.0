// ============================================================================
// Accounting -> Chart of Accounts. A tree, because the chart IS a tree and
// flattening it hides the one thing the reader is looking for: what rolls up
// into what.
//
// Two refusals are surfaced as guidance rather than as failures, because both
// are the server protecting history and the person needs to know what to do
// instead:
//   * deleting an account that carries journal lines -> archive it
//   * re-typing an account that carries journal lines -> make a new one
// ============================================================================
import { useState, useEffect, useMemo } from 'react';
import {
  ListTree, Plus, Pencil, Trash2, ChevronRight, ChevronDown, Archive, Sparkles, X,
} from 'lucide-react';
import { Panel, SectionHeader, Loading, EmptyState, Field, IconButton } from '../../components/UI/kit';
import { Alert, Badge } from '../../components/UI';
import ThemedSelect from '../../components/UI/Select';
import { useChartOfAccounts } from '../../hooks/useChartOfAccounts';

const TYPES = [
  { value: 'asset',     label: 'Asset',     tone: 'var(--color-info-600)' },
  { value: 'liability', label: 'Liability', tone: 'var(--color-warning-600)' },
  { value: 'equity',    label: 'Equity',    tone: 'var(--color-primary-600)' },
  { value: 'revenue',   label: 'Revenue',   tone: 'var(--color-success-600)' },
  { value: 'expense',   label: 'Expense',   tone: 'var(--color-error-600)' },
];
const toneOf = (t) => TYPES.find(x => x.value === t)?.tone || 'var(--color-text-secondary)';

export default function ChartOfAccountsPage({ scope }) {
  const companyId = scope?.company_id || null;
  const canManage = !!scope?.permissions?.['accounting.accounts.manage'];
  const { accounts, tree, loading, error, fetchAccounts, createAccount, updateAccount, deleteAccount, seedDefaults } =
    useChartOfAccounts(companyId);

  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState(null);      // account object, or {} for new
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetchAccounts({ include_inactive: showInactive }); }, [fetchAccounts, showInactive]);

  const toggle = (id) => setCollapsed(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const onDelete = async (account) => {
    if (!window.confirm(`Delete account ${account.code} -- ${account.name}?`)) return;
    setBusy(true);
    setNotice(null);
    try {
      await deleteAccount(account.id);
      setNotice({ type: 'success', text: `Deleted ${account.code}.` });
    } catch (e) {
      // 409 = it has journal lines. That is guidance, not a bug.
      setNotice({ type: 'warning', text: e.response?.data?.error || 'Could not delete the account.' });
    } finally { setBusy(false); }
  };

  const onArchive = async (account) => {
    setBusy(true);
    try {
      await updateAccount(account.id, { is_active: !account.is_active });
      setNotice({ type: 'success', text: `${account.code} ${account.is_active ? 'archived' : 'restored'}.` });
    } catch (e) {
      setNotice({ type: 'error', text: e.response?.data?.error || 'Could not update the account.' });
    } finally { setBusy(false); }
  };

  const onSeed = async () => {
    setBusy(true);
    try {
      const r = await seedDefaults();
      setNotice({ type: 'success', text: r.created ? `Created ${r.created} starter accounts.` : r.message });
    } catch (e) {
      setNotice({ type: 'error', text: e.response?.data?.error || 'Could not seed accounts.' });
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
          <div className="flex items-center gap-2">
            {accounts.length === 0 && (
              <button onClick={onSeed} disabled={busy}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                <Sparkles size={14} /> Seed starter chart
              </button>
            )}
            <button onClick={() => setEditing({})}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold"
              style={{ background: 'var(--color-primary-600)', color: '#fff' }}>
              <Plus size={14} /> New account
            </button>
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
              style={{ color: 'var(--color-text-secondary)' }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: t.tone, display: 'inline-block' }} />
              {t.label}
            </span>
          ))}
        </div>
      </div>

      {loading && accounts.length === 0 ? <Loading variant="rows" rows={8} label="Loading the chart of accounts" /> : (
        tree.length === 0 ? (
          <EmptyState icon={ListTree} title="No accounts yet"
            hint="A ledger needs accounts to post to. Seed a conventional starter set, or add them one at a time."
            action={canManage ? (
              <button onClick={onSeed} className="px-4 py-2 rounded-lg text-sm font-semibold"
                style={{ background: 'var(--color-primary-600)', color: '#fff' }}>
                Create a starter chart of accounts
              </button>
            ) : null} />
        ) : (
          <Panel pad="sm">
            {tree.map(node => (
              <AccountRow key={node.id} node={node} depth={0} canManage={canManage}
                collapsed={collapsed} onToggle={toggle}
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
    </div>
  );
}

function AccountRow({ node, depth, canManage, collapsed, onToggle, onEdit, onArchive, onDelete }) {
  const kids = node.children || [];
  const isCollapsed = collapsed.has(node.id);
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
        <span className="font-mono text-xs w-16 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>{node.code}</span>
        <span className="text-sm truncate" style={{ color: 'var(--color-text)', opacity: node.is_active ? 1 : 0.5 }}>
          {node.name}
        </span>
        {!node.is_active && <Badge variant="info" size="sm">Archived</Badge>}
        <span className="text-[11px] ml-auto flex-shrink-0 capitalize" style={{ color: 'var(--color-text-tertiary)' }}>
          {node.account_type}
        </span>
        {canManage && (
          <span className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <IconButton label="Edit" variant="ghost" onClick={() => onEdit(node)}><Pencil size={15} /></IconButton>
            <IconButton label={node.is_active ? 'Archive' : 'Restore'} variant="ghost" onClick={() => onArchive(node)}><Archive size={15} /></IconButton>
            <IconButton label="Delete" tone="error" variant="ghost" onClick={() => onDelete(node)}><Trash2 size={15} /></IconButton>
          </span>
        )}
      </div>
      {!isCollapsed && kids.map(k => (
        <AccountRow key={k.id} node={k} depth={depth + 1} canManage={canManage}
          collapsed={collapsed} onToggle={onToggle} onEdit={onEdit} onArchive={onArchive} onDelete={onDelete} />
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

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    await onSave({ ...form, parent_id: form.parent_id || null });
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }} onClick={onClose}>
      <Panel className="w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <SectionHeader title={isNew ? 'New account' : `Edit ${account.code}`}
          actions={<IconButton label="Close" variant="ghost" onClick={onClose}><X size={16} /></IconButton>} />
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
            hint={!isNew ? 'Cannot be changed once the account carries journal lines -- it would rewrite past reports.' : 'Decides whether this account lands on the P&L or the balance sheet.'}>
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

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm font-semibold"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
              Cancel
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ background: 'var(--color-primary-600)', color: '#fff', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving...' : 'Save account'}
            </button>
          </div>
        </form>
      </Panel>
    </div>
  );
}

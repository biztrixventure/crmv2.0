// ============================================================================
// Accounting -> Expenses. One page, two audiences, decided by the server.
//
//   "My claims"     -- anyone with accounting.expenses.submit
//   "Approvals"     -- only accounting.expenses.approve
//
// The tab strip only offers Approvals when the server said can_approve. And the
// list scope is never chosen here: the request asks, the response reports what
// it actually applied, and the page renders that. Someone with only submit
// gets their own claims however the URL is poked.
//
// Nobody approves their own claim. The server refuses it; the buttons are
// hidden as well, so the refusal is never the first time you hear about it.
// ============================================================================
import { useState, useEffect } from 'react';
import { Receipt, Plus, Check, X, Send, Undo2, Banknote, Trash2 } from 'lucide-react';
import { Panel, SectionHeader, Loading, EmptyState, Field, KpiTile, TableScroll, PillTabs } from '../../components/UI/kit';
import { Alert } from '../../components/UI';
import ThemedSelect from '../../components/UI/Select';
import { Btn, StatusPill, ModuleModal } from '../../components/Modules/ModuleUI';
import { useExpenses } from '../../hooks/useExpenses';
import { fmtMoney, fmtMoneyShort, fmtDate, todayISO, CURRENCIES, DEFAULT_CURRENCY } from '../../utils/money';

export default function ExpensesPage({ scope }) {
  const companyId = scope?.company_id || null;
  const myUserId = scope?.user_id || null;
  const {
    expenses, categories, scope: serverScope, canApprove, loading, error,
    fetchExpenses, fetchCategories, createExpense, updateExpense, deleteExpense,
    submitExpense, withdrawExpense, approveExpense, rejectExpense, reimburseExpense,
  } = useExpenses(companyId);

  const [tab, setTab] = useState('mine');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => { fetchCategories(); }, [fetchCategories]);
  useEffect(() => {
    fetchExpenses({
      scope: tab === 'queue' ? 'all' : 'mine',
      status: tab === 'queue' && !status ? 'submitted' : (status || undefined),
    });
  }, [fetchExpenses, tab, status]);

  const act = async (fn, okText) => {
    setNotice(null);
    try {
      const r = await fn();
      setNotice({ type: r?.journal_note ? 'warning' : 'success', text: r?.journal_note || okText });
    } catch (e) {
      setNotice({ type: 'error', text: e.response?.data?.error || 'That did not work.' });
    }
  };

  const tabs = [{ key: 'mine', label: 'My claims', icon: Receipt }];
  if (canApprove) tabs.push({ key: 'queue', label: 'Approval queue', icon: Check });

  const totals = expenses.reduce((a, e) => {
    a.count += 1;
    a.amount += Number(e.amount || 0);
    if (e.status === 'submitted') a.pending += Number(e.amount || 0);
    if (e.status === 'approved') a.approved += Number(e.amount || 0);
    return a;
  }, { count: 0, amount: 0, pending: 0, approved: 0 });

  return (
    <div className="space-y-4">
      <SectionHeader level="page" icon={Receipt} title="Expenses"
        subtitle={scope?.company_name || undefined}
        actions={<Btn variant="primary" icon={Plus} onClick={() => setEditing({})}>New claim</Btn>} />

      {error && <Alert type="error">{error}</Alert>}
      {notice && <Alert type={notice.type} onDismiss={() => setNotice(null)}>{notice.text}</Alert>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label={tab === 'queue' ? 'Claims in view' : 'My claims'} value={totals.count} tone="info" />
        <KpiTile label="Value in view" value={fmtMoneyShort(totals.amount)} tone="primary" />
        <KpiTile label="Awaiting approval" value={fmtMoneyShort(totals.pending)} tone={totals.pending > 0 ? 'warning' : 'muted'} />
        <KpiTile label="Approved, not yet paid" value={fmtMoneyShort(totals.approved)} tone="success" />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {tabs.length > 1 && <PillTabs items={tabs} value={tab} onChange={t => { setTab(t); setStatus(''); }} />}
        <div className="ml-auto">
          <ThemedSelect value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">{tab === 'queue' ? 'Awaiting approval' : 'All statuses'}</option>
            {['draft', 'submitted', 'approved', 'rejected', 'reimbursed'].map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </ThemedSelect>
        </div>
      </div>

      {loading && expenses.length === 0 ? <Loading variant="table" rows={5} label="Loading expense claims" /> : (
        expenses.length === 0 ? (
          <EmptyState icon={Receipt}
            title={tab === 'queue' ? 'Nothing waiting for you' : 'No claims yet'}
            hint={tab === 'queue'
              ? 'Submitted claims appear here for approval.'
              : 'File a claim for anything you paid for out of pocket.'}
            action={tab === 'mine' ? <Btn variant="primary" icon={Plus} onClick={() => setEditing({})}>New claim</Btn> : null} />
        ) : (
          <Panel pad="none">
            <TableScroll stickyFirst>
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    {['Date', 'Description', 'Category', 'Claimant', 'Amount', 'Status', ''].map((h, i) => (
                      <th key={h + i} className={`td-p text-[11px] font-bold uppercase tracking-wider ${i === 4 ? 'text-right' : 'text-left'}`}
                        style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {expenses.map(e => {
                    const mine = myUserId ? e.submitted_by === myUserId : serverScope === 'mine';
                    return (
                      <tr key={e.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td className="td-p text-xs" style={{ color: 'var(--color-text-secondary)' }}>{fmtDate(e.expense_date)}</td>
                        <td className="td-p text-sm" style={{ color: 'var(--color-text)' }}>
                          {e.description || <span style={{ color: 'var(--color-text-tertiary)' }}>No description</span>}
                          {e.vendor && <span className="block text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{e.vendor}</span>}
                          {e.status === 'rejected' && e.rejection_reason && (
                            <span className="block text-[11px] mt-0.5" style={{ color: 'var(--color-error-600)' }}>
                              Rejected: {e.rejection_reason}
                            </span>
                          )}
                        </td>
                        <td className="td-p text-xs" style={{ color: 'var(--color-text-secondary)' }}>{e.expense_categories?.name || '--'}</td>
                        <td className="td-p text-xs" style={{ color: 'var(--color-text-secondary)' }}>{e.submitted_by_name || (mine ? 'You' : '--')}</td>
                        <td className="td-p text-sm text-right tabular-nums font-semibold" style={{ color: 'var(--color-text)' }}>
                          {fmtMoney(e.amount, e.currency)}
                        </td>
                        <td className="td-p"><StatusPill status={e.status} /></td>
                        <td className="td-p">
                          <div className="flex items-center gap-1.5 justify-end flex-wrap">
                            {mine && ['draft', 'rejected'].includes(e.status) && (
                              <>
                                <Btn size="sm" onClick={() => setEditing(e)}>Edit</Btn>
                                <Btn size="sm" variant="primary" icon={Send}
                                  onClick={() => act(() => submitExpense(e.id), 'Claim submitted for approval.')}>Submit</Btn>
                              </>
                            )}
                            {mine && e.status === 'draft' && (
                              <Btn size="sm" variant="danger" icon={Trash2}
                                onClick={() => { if (window.confirm('Delete this claim?')) act(() => deleteExpense(e.id), 'Claim deleted.'); }}>
                                Delete
                              </Btn>
                            )}
                            {mine && e.status === 'submitted' && (
                              <Btn size="sm" icon={Undo2}
                                onClick={() => act(() => withdrawExpense(e.id), 'Claim withdrawn to a draft.')}>Withdraw</Btn>
                            )}
                            {/* Approve/reject are hidden on your own claim -- the
                                server refuses it and finding out via a 403 is worse. */}
                            {canApprove && !mine && e.status === 'submitted' && (
                              <>
                                <Btn size="sm" variant="primary" icon={Check}
                                  onClick={() => act(() => approveExpense(e.id), 'Claim approved.')}>Approve</Btn>
                                <Btn size="sm" variant="danger" icon={X}
                                  onClick={() => {
                                    const reason = window.prompt('Why is this claim being rejected? The claimant will see this.');
                                    if (reason) act(() => rejectExpense(e.id, reason), 'Claim rejected.');
                                  }}>Reject</Btn>
                              </>
                            )}
                            {canApprove && e.status === 'approved' && (
                              <Btn size="sm" icon={Banknote}
                                onClick={() => act(() => reimburseExpense(e.id), 'Marked as reimbursed.')}>Mark paid</Btn>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
          </Panel>
        )
      )}

      {editing && (
        <ExpenseEditor expense={editing} categories={categories} defaultCurrency={scope?.currency || DEFAULT_CURRENCY}
          onClose={() => setEditing(null)}
          onSave={async (payload, submitNow) => {
            setNotice(null);
            try {
              if (editing.id) await updateExpense(editing.id, payload);
              else await createExpense({ ...payload, submit: submitNow });
              setEditing(null);
              setNotice({ type: 'success', text: submitNow ? 'Claim submitted.' : 'Claim saved.' });
            } catch (e) {
              setNotice({ type: 'error', text: e.response?.data?.error || 'Could not save the claim.' });
            }
          }} />
      )}
    </div>
  );
}

function ExpenseEditor({ expense, categories, defaultCurrency, onClose, onSave }) {
  const [form, setForm] = useState({
    expense_date: expense.expense_date || todayISO(),
    amount: expense.amount ?? '',
    currency: expense.currency || defaultCurrency,
    category_id: expense.category_id || '',
    vendor: expense.vendor || '',
    description: expense.description || '',
    receipt_url: expense.receipt_url || '',
    is_billable: !!expense.is_billable,
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async (submitNow) => {
    setSaving(true);
    await onSave({ ...form, amount: Number(form.amount), category_id: form.category_id || null }, submitNow);
    setSaving(false);
  };

  return (
    <ModuleModal title={expense.id ? 'Edit claim' : 'New expense claim'} onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn busy={saving} onClick={() => save(false)}>Save as draft</Btn>
          {!expense.id && <Btn variant="primary" busy={saving} onClick={() => save(true)}>Save and submit</Btn>}
        </>
      }>
      <form onSubmit={e => { e.preventDefault(); save(false); }} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" required>
            <input className="input w-full" type="date" required value={form.expense_date} onChange={e => set('expense_date', e.target.value)} />
          </Field>
          <Field label="Amount" required>
            <input className="input w-full" type="number" step="0.01" min="0.01" required
              value={form.amount} onChange={e => set('amount', e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category" hint="Decides which ledger account this posts to on approval.">
            <ThemedSelect value={form.category_id} onChange={e => set('category_id', e.target.value)}>
              <option value="">Uncategorised</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </ThemedSelect>
          </Field>
          <Field label="Currency">
            <ThemedSelect value={form.currency} onChange={e => set('currency', e.target.value)}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </ThemedSelect>
          </Field>
        </div>
        <Field label="Vendor"><input className="input w-full" value={form.vendor} onChange={e => set('vendor', e.target.value)} /></Field>
        <Field label="Description" hint="What this was for. An approver reads this first.">
          <textarea className="input w-full" rows={2} value={form.description} onChange={e => set('description', e.target.value)} />
        </Field>
        <Field label="Receipt link" hint="A link to the receipt image or PDF.">
          <input className="input w-full" value={form.receipt_url} onChange={e => set('receipt_url', e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
          <input type="checkbox" checked={form.is_billable} onChange={e => set('is_billable', e.target.checked)}
            style={{ accentColor: 'var(--color-primary-600)', width: 15, height: 15 }} />
          Rebillable to a customer
        </label>
      </form>
    </ModuleModal>
  );
}

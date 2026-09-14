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
import client from '../../api/client';
import AskDialog from '../../components/Modules/AskDialog';
import ThemedDate from '../../components/UI/ThemedDate';
import { fmtMoney, fmtMoneyShort, fmtDate, todayISO, CURRENCIES, DEFAULT_CURRENCY } from '../../utils/money';

// Receipts (mig 318): a private file, opened only through a two-minute link.
const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];
const asDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

// selfOnly: mounted by "My HR" -- the person's own claims, never the approval queue.
export default function ExpensesPage({ scope, selfOnly = false }) {
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
  const [asking, setAsking] = useState(null);
  const [payingBack, setPayingBack] = useState(null);

  useEffect(() => { fetchCategories(); }, [fetchCategories]);
  useEffect(() => {
    fetchExpenses({
      scope: tab === 'queue' ? 'all' : 'mine',
      status: tab === 'queue' && !status ? 'submitted' : (status || undefined),
    });
  }, [fetchExpenses, tab, status]);

  // okText may be a function of the response, for the entry number.
  const act = async (fn, okText) => {
    setNotice(null);
    try {
      const r = await fn();
      const text = r?.journal_note || (typeof okText === 'function' ? okText(r) : okText);
      setNotice({ type: r?.journal_note ? 'warning' : 'success', text });
      return true;
    } catch (e) {
      setNotice({ type: 'error', text: e.response?.data?.error || 'That did not work.' });
      return false;
    }
  };
  const inBooks = (did) => (r) => r?.entry_no ? `${did} Recorded in the books as ${r.entry_no}.` : did;

  // Opened in a new tab through a signed link that expires in two minutes.
  const openReceipt = async (e) => {
    const tab = window.open('', '_blank');
    try {
      const r = await client.get(`accounting/expenses/${e.id}/receipt`, { params: { company_id: companyId || undefined } });
      if (tab) { tab.opener = null; tab.location.href = r.data.url; } else window.location.assign(r.data.url);
    } catch (err) {
      if (tab) tab.close();
      setNotice({ type: 'error', text: err.response?.data?.error || 'Could not open the receipt.' });
    }
  };

  const tabs = [{ key: 'mine', label: 'My claims', icon: Receipt }];
  if (canApprove && !selfOnly) tabs.push({ key: 'queue', label: 'Approval queue', icon: Check });

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
                          {e.receipt_path ? (
                            <button type="button" onClick={() => openReceipt(e)} className="text-[11px] font-semibold"
                              style={{ color: 'var(--color-primary-600)' }}>Receipt</button>
                          ) : e.receipt_url ? (
                            <a href={e.receipt_url} target="_blank" rel="noopener noreferrer" className="text-[11px] font-semibold"
                              style={{ color: 'var(--color-primary-600)' }}>Receipt link</a>
                          ) : null}
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
                        <td className="td-p">
                          <StatusPill status={e.status} />
                          {(e.journal_entry?.entry_no || e.reimbursement_entry?.entry_no) && (
                            <span className="block text-[11px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                              {[e.journal_entry?.entry_no, e.reimbursement_entry?.entry_no].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </td>
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
                                onClick={() => setAsking({
                                  title: 'Delete this draft claim?',
                                  message: `${fmtMoney(e.amount, e.currency)}${e.description ? ' -- ' + e.description : ''}. A draft was never sent for approval, so it is removed completely.`,
                                  confirmLabel: 'Delete draft', danger: true,
                                  onConfirm: async () => { if (await act(() => deleteExpense(e.id), 'Claim deleted.')) setAsking(null); },
                                })}>
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
                                  onClick={() => act(() => approveExpense(e.id), inBooks('Claim approved.'))}>Approve</Btn>
                                <Btn size="sm" variant="danger" icon={X}
                                  onClick={() => setAsking({
                                    title: 'Reject this claim?',
                                    message: `${fmtMoney(e.amount, e.currency)}${e.description ? ' -- ' + e.description : ''}. It goes back to the claimant, who can fix it and send it again.`,
                                    confirmLabel: 'Reject claim', reason: 'required', danger: true,
                                    reasonLabel: 'What should they fix?', reasonHint: 'The claimant sees this.',
                                    onConfirm: async (why) => { if (await act(() => rejectExpense(e.id, why), 'Claim rejected.')) setAsking(null); },
                                  })}>Reject</Btn>
                              </>
                            )}
                            {canApprove && e.status === 'approved' && (
                              <Btn size="sm" icon={Banknote} onClick={() => setPayingBack(e)}>Mark paid back</Btn>
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
          onSave={async (payload, submitNow, file) => {
            setNotice(null);
            try {
              const saved = editing.id ? await updateExpense(editing.id, payload) : await createExpense({ ...payload, submit: submitNow });
              let attached = '';
              if (file && saved?.id) {
                try {
                  await client.post(`accounting/expenses/${saved.id}/receipt`, {
                    company_id: companyId, name: file.name, type: file.type, data: await asDataUrl(file),
                  });
                  await fetchExpenses();
                  attached = ' Receipt attached.';
                } catch (e) {
                  attached = ' The receipt could not be attached: ' + (e.response?.data?.error || 'upload failed') + '.';
                }
              }
              setEditing(null);
              setNotice({ type: attached.includes('could not') ? 'warning' : 'success', text: (submitNow ? 'Claim submitted.' : 'Claim saved.') + attached });
            } catch (e) {
              setNotice({ type: 'error', text: e.response?.data?.error || 'Could not save the claim.' });
            }
          }} />
      )}

      {payingBack && (
        <PaidBackDialog expense={payingBack} onClose={() => setPayingBack(null)}
          onSubmit={async (paidOn) => {
            if (await act(() => reimburseExpense(payingBack.id, paidOn), inBooks('Marked as paid back.'))) setPayingBack(null);
          }} />
      )}

      {asking && <AskDialog {...asking} onClose={() => setAsking(null)} />}
    </div>
  );
}

// The claimant got their money back. paid_on dates the entry in the books.
function PaidBackDialog({ expense, onClose, onSubmit }) {
  const [paidOn, setPaidOn] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  return (
    <ModuleModal title="Mark this claim paid back"
      subtitle={`${fmtMoney(expense.amount, expense.currency)}${expense.description ? ' -- ' + expense.description : ''}. Do this once the money has reached the person.`}
      onClose={onClose}
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" busy={busy} disabled={!paidOn}
          onClick={async () => { setBusy(true); try { await onSubmit(paidOn); } finally { setBusy(false); } }}>Mark paid back</Btn>
      </>}>
      <Field label="Paid on" required>
        <ThemedDate value={paidOn} onChange={e => setPaidOn(e.target.value)} />
      </Field>
    </ModuleModal>
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
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState(null);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const pickFile = (f) => {
    setFileError(null);
    if (!f) { setFile(null); return; }
    if (!RECEIPT_TYPES.includes(f.type)) { setFileError('A receipt must be a photo (JPG, PNG, WEBP, HEIC) or a PDF.'); return; }
    if (f.size > 5 * 1024 * 1024) { setFileError('A receipt can be at most 5 MB.'); return; }
    setFile(f);
  };

  const save = async (submitNow) => {
    setSaving(true);
    await onSave({ ...form, amount: Number(form.amount), category_id: form.category_id || null }, submitNow, file);
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
            <ThemedDate value={form.expense_date} onChange={e => set('expense_date', e.target.value)} />
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
        <Field as="div" label="Receipt" hint={expense.receipt_path ? 'A receipt is attached. Pick a new file to replace it.' : 'A photo or PDF, up to 5 MB. Kept private -- only you and approvers can open it.'}>
          <input type="file" accept={RECEIPT_TYPES.join(',')} className="block text-sm w-full"
            style={{ color: 'var(--color-text-secondary)' }} onChange={e => pickFile(e.target.files?.[0] || null)} />
          {file && <span className="block text-[11px] mt-1" style={{ color: 'var(--color-text-secondary)' }}>{file.name} will be attached when you save.</span>}
          {fileError && <span className="block text-[11px] mt-1" style={{ color: 'var(--color-error-600)' }}>{fileError}</span>}
          {!expense.receipt_path && expense.receipt_url && (
            <a href={expense.receipt_url} target="_blank" rel="noopener noreferrer" className="block text-[11px] mt-1" style={{ color: 'var(--color-primary-600)' }}>Earlier receipt link</a>
          )}
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

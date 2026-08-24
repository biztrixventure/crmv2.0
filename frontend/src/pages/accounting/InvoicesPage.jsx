// ============================================================================
// Accounting -> Invoices. List, editor, and the record-payment dialog.
//
// The editor computes a LIVE preview total from the line items, but it never
// writes one: subtotal, tax, total, amount_paid and status are all maintained
// by database triggers (mig 284). The preview exists so you can see what you
// are about to charge; the saved invoice always re-reads from the server.
//
// Overpayment is refused by the server with a 422 that names the balance, and
// that sentence is shown verbatim -- a payment larger than the balance is
// nearly always a typo, and silently absorbing it becomes a refund conversation
// three weeks later.
// ============================================================================
import { useState, useEffect, useMemo } from 'react';
import { FileText, Plus, Send, Trash2, Ban, DollarSign, Search, Eye } from 'lucide-react';
import { Panel, SectionHeader, Loading, EmptyState, Field, KpiTile, TableScroll, PillTabs } from '../../components/UI/kit';
import { Alert } from '../../components/UI';
import ThemedSelect from '../../components/UI/Select';
import SearchSelect from '../../components/UI/SearchSelect';
import { Btn, StatusPill, ModuleModal } from '../../components/Modules/ModuleUI';
import { useInvoices } from '../../hooks/useInvoices';
import { useChartOfAccounts } from '../../hooks/useChartOfAccounts';
import { fmtMoney, fmtMoneyShort, fmtDate, todayISO, CURRENCIES } from '../../utils/money';

const FILTERS = [
  { key: '',        label: 'All' },
  { key: 'draft',   label: 'Draft' },
  { key: 'sent',    label: 'Sent' },
  { key: 'partial', label: 'Partial' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'paid',    label: 'Paid' },
];

export default function InvoicesPage({ scope }) {
  const companyId = scope?.company_id || null;
  const canManage = !!scope?.permissions?.['accounting.invoices.manage'];
  const {
    invoices, summary, loading, error,
    fetchInvoices, fetchInvoice, createInvoice, updateInvoice, sendInvoice,
    recordPayment, voidInvoice, deleteInvoice,
  } = useInvoices(companyId);
  const { accounts, fetchAccounts } = useChartOfAccounts(companyId);

  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [paying, setPaying] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => { fetchInvoices({ status: status || undefined, search: search || undefined }); }, [fetchInvoices, status, search]);
  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  const open = async (id, mode) => {
    const inv = await fetchInvoice(id);
    if (!inv) return;
    if (mode === 'edit') setEditing(inv);
    else if (mode === 'pay') setPaying(inv);
    else setViewing(inv);
  };

  const act = async (fn, okText) => {
    setNotice(null);
    try {
      const r = await fn();
      setNotice({ type: 'success', text: r?.journal_note || okText });
    } catch (e) {
      setNotice({ type: 'error', text: e.response?.data?.error || 'That did not work.' });
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeader level="page" icon={FileText} title="Invoices"
        subtitle={scope?.company_name || undefined}
        actions={canManage ? <Btn variant="primary" icon={Plus} onClick={() => setEditing({ line_items: [] })}>New invoice</Btn> : null} />

      {error && <Alert type="error">{error}</Alert>}
      {notice && <Alert type={notice.type} onDismiss={() => setNotice(null)}>{notice.text}</Alert>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label="Invoiced" value={fmtMoneyShort(summary.invoiced)} tone="info" />
        <KpiTile label="Collected" value={fmtMoneyShort(summary.collected)} tone="success" />
        <KpiTile label="Outstanding" value={fmtMoneyShort(summary.outstanding)} tone="warning" />
        <KpiTile label="Overdue" value={fmtMoneyShort(summary.overdue)} tone={summary.overdue > 0 ? 'error' : 'muted'} />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <PillTabs items={FILTERS.map(f => ({ key: f.key, label: f.label }))} value={status} onChange={setStatus} />
        <div className="relative ml-auto">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
          <input className="input pl-8" placeholder="Invoice no, customer, email"
            value={search} onChange={e => setSearch(e.target.value)} style={{ minWidth: 220 }} />
        </div>
      </div>

      {loading && invoices.length === 0 ? <Loading variant="table" rows={6} label="Loading invoices" /> : (
        invoices.length === 0 ? (
          <EmptyState icon={FileText} title="No invoices here"
            hint={status ? 'Nothing matches this filter.' : 'Raise your first invoice to start tracking what is owed.'}
            action={canManage && !status ? <Btn variant="primary" icon={Plus} onClick={() => setEditing({ line_items: [] })}>New invoice</Btn> : null} />
        ) : (
          <Panel pad="none">
            <TableScroll stickyFirst>
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    {['Invoice', 'Customer', 'Issued', 'Due', 'Total', 'Paid', 'Balance', 'Status', ''].map((h, i) => (
                      <th key={h + i} className={`td-p text-[11px] font-bold uppercase tracking-wider ${i >= 4 && i <= 6 ? 'text-right' : 'text-left'}`}
                        style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invoices.map(inv => (
                    <tr key={inv.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td className="td-p text-sm font-mono" style={{ color: 'var(--color-text)' }}>{inv.invoice_no}</td>
                      <td className="td-p text-sm" style={{ color: 'var(--color-text)' }}>
                        {inv.customer_name}
                        {inv.customer_email && <span className="block text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{inv.customer_email}</span>}
                      </td>
                      <td className="td-p text-xs" style={{ color: 'var(--color-text-secondary)' }}>{fmtDate(inv.issue_date)}</td>
                      <td className="td-p text-xs" style={{ color: inv.status === 'overdue' ? 'var(--color-error-600)' : 'var(--color-text-secondary)' }}>{fmtDate(inv.due_date)}</td>
                      <td className="td-p text-sm text-right tabular-nums" style={{ color: 'var(--color-text)' }}>{fmtMoney(inv.total, inv.currency)}</td>
                      <td className="td-p text-sm text-right tabular-nums" style={{ color: 'var(--color-success-600)' }}>{fmtMoney(inv.amount_paid, inv.currency)}</td>
                      <td className="td-p text-sm text-right tabular-nums font-semibold" style={{ color: 'var(--color-text)' }}>{fmtMoney(inv.balance_due, inv.currency)}</td>
                      <td className="td-p"><StatusPill status={inv.status} /></td>
                      <td className="td-p">
                        <div className="flex items-center gap-1.5 justify-end">
                          <Btn size="sm" icon={Eye} onClick={() => open(inv.id, 'view')}>View</Btn>
                          {canManage && inv.status === 'draft' && (
                            <Btn size="sm" icon={Send} onClick={() => act(() => sendInvoice(inv.id), 'Invoice marked as sent.')}>Send</Btn>
                          )}
                          {canManage && ['sent', 'partial', 'overdue'].includes(inv.status) && (
                            <Btn size="sm" variant="primary" icon={DollarSign} onClick={() => open(inv.id, 'pay')}>Payment</Btn>
                          )}
                          {canManage && inv.status === 'draft' && (
                            <Btn size="sm" variant="danger" icon={Trash2}
                              onClick={() => { if (window.confirm(`Delete ${inv.invoice_no}?`)) act(() => deleteInvoice(inv.id), 'Invoice deleted.'); }}>
                              Delete
                            </Btn>
                          )}
                          {canManage && !['draft', 'void', 'paid'].includes(inv.status) && Number(inv.amount_paid) === 0 && (
                            <Btn size="sm" icon={Ban}
                              onClick={() => {
                                const reason = window.prompt('Why is this invoice being voided?');
                                if (reason) act(() => voidInvoice(inv.id, reason), 'Invoice voided.');
                              }}>Void</Btn>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </Panel>
        )
      )}

      {editing && (
        <InvoiceEditor invoice={editing} accounts={accounts}
          onClose={() => setEditing(null)}
          onSave={async (payload) => {
            setNotice(null);
            try {
              if (editing.id) await updateInvoice(editing.id, payload);
              else await createInvoice(payload);
              setEditing(null);
              setNotice({ type: 'success', text: 'Invoice saved.' });
            } catch (e) {
              setNotice({ type: 'error', text: e.response?.data?.error || 'Could not save the invoice.' });
            }
          }} />
      )}

      {viewing && <InvoiceView invoice={viewing} onClose={() => setViewing(null)}
        onEdit={canManage && viewing.status !== 'void' ? () => { setEditing(viewing); setViewing(null); } : null} />}

      {paying && (
        <PaymentDialog invoice={paying} onClose={() => setPaying(null)}
          onSubmit={async (payload) => {
            setNotice(null);
            try {
              const r = await recordPayment(paying.id, payload);
              setPaying(null);
              setNotice({ type: r.journal_note ? 'warning' : 'success', text: r.journal_note || 'Payment recorded.' });
            } catch (e) {
              // 422 here names the outstanding balance -- show it as written.
              setNotice({ type: 'error', text: e.response?.data?.error || 'Could not record the payment.' });
            }
          }} />
      )}
    </div>
  );
}

// -- Editor ---------------------------------------------------------------------

const blankLine = () => ({ description: '', quantity: 1, unit_price: 0, tax_rate: 0, discount: 0, account_id: '' });

function InvoiceEditor({ invoice, accounts, onClose, onSave }) {
  const isNew = !invoice.id;
  const [form, setForm] = useState({
    customer_name: invoice.customer_name || '',
    customer_email: invoice.customer_email || '',
    customer_phone: invoice.customer_phone || '',
    issue_date: invoice.issue_date || todayISO(),
    due_date: invoice.due_date || '',
    currency: invoice.currency || 'PKR',
    notes: invoice.notes || '',
    terms: invoice.terms || '',
  });
  const [lines, setLines] = useState(
    (invoice.invoice_line_items?.length ? invoice.invoice_line_items : [blankLine()])
      .map(l => ({ ...blankLine(), ...l })),
  );
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setLine = (i, k, v) => setLines(ls => ls.map((l, idx) => idx === i ? { ...l, [k]: v } : l));

  // Preview only -- the database recomputes these on save. Mirrors the mig 284
  // generated-column formula exactly so the number does not jump after saving.
  const totals = useMemo(() => lines.reduce((a, l) => {
    const net = Math.round(Number(l.quantity || 0) * Number(l.unit_price || 0) * 100) / 100 - Number(l.discount || 0);
    const tax = Math.round(net * Number(l.tax_rate || 0)) / 100;
    a.net += net; a.tax += tax;
    return a;
  }, { net: 0, tax: 0 }), [lines]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    await onSave({
      ...form,
      due_date: form.due_date || null,
      line_items: lines.filter(l => l.description.trim()),
    });
    setSaving(false);
  };

  return (
    <ModuleModal wide title={isNew ? 'New invoice' : `Edit ${invoice.invoice_no}`} onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" busy={saving} onClick={submit}>Save invoice</Btn>
        </>
      }>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Customer" required>
            <input className="input w-full" required value={form.customer_name} onChange={e => set('customer_name', e.target.value)} />
          </Field>
          <Field label="Email">
            <input className="input w-full" type="email" value={form.customer_email} onChange={e => set('customer_email', e.target.value)} />
          </Field>
          <Field label="Phone">
            <input className="input w-full" value={form.customer_phone} onChange={e => set('customer_phone', e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Issue date">
            <input className="input w-full" type="date" value={form.issue_date} onChange={e => set('issue_date', e.target.value)} />
          </Field>
          <Field label="Due date" hint="Blank means no due date -- it will never go overdue.">
            <input className="input w-full" type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} />
          </Field>
          <Field label="Currency">
            <ThemedSelect value={form.currency} onChange={e => set('currency', e.target.value)}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </ThemedSelect>
          </Field>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-bold uppercase tracking-wider m-0" style={{ color: 'var(--color-text-secondary)' }}>Line items</p>
            <Btn size="sm" icon={Plus} onClick={() => setLines(ls => [...ls, blankLine()])}>Add line</Btn>
          </div>
          <TableScroll>
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {['Description', 'Account', 'Qty', 'Unit price', 'Discount', 'Tax %', 'Line total', ''].map(h => (
                    <th key={h} className="td-p text-[10px] font-bold uppercase tracking-wider text-left"
                      style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const net = Math.round(Number(l.quantity || 0) * Number(l.unit_price || 0) * 100) / 100 - Number(l.discount || 0);
                  const tax = Math.round(net * Number(l.tax_rate || 0)) / 100;
                  return (
                    <tr key={i}>
                      <td className="td-p"><input className="input w-full" value={l.description} placeholder="What is being charged"
                        onChange={e => setLine(i, 'description', e.target.value)} style={{ minWidth: 180 }} /></td>
                      <td className="td-p">
                        <SearchSelect
                          value={l.account_id || ''}
                          onChange={v => setLine(i, 'account_id', v)}
                          options={accounts.filter(a => a.account_type === 'revenue')
                            .map(a => ({ value: a.id, label: a.name, hint: a.code }))}
                          placeholder="Search revenue accounts..."
                          emptyLabel="--" />
                      </td>
                      <td className="td-p"><input className="input" type="number" step="0.001" min="0" value={l.quantity}
                        onChange={e => setLine(i, 'quantity', e.target.value)} style={{ width: 70 }} /></td>
                      <td className="td-p"><input className="input" type="number" step="0.01" min="0" value={l.unit_price}
                        onChange={e => setLine(i, 'unit_price', e.target.value)} style={{ width: 90 }} /></td>
                      <td className="td-p"><input className="input" type="number" step="0.01" min="0" value={l.discount}
                        onChange={e => setLine(i, 'discount', e.target.value)} style={{ width: 80 }} /></td>
                      <td className="td-p"><input className="input" type="number" step="0.001" min="0" value={l.tax_rate}
                        onChange={e => setLine(i, 'tax_rate', e.target.value)} style={{ width: 70 }} /></td>
                      <td className="td-p text-sm text-right tabular-nums whitespace-nowrap" style={{ color: 'var(--color-text)' }}>
                        {fmtMoney(net + tax, form.currency)}
                      </td>
                      <td className="td-p">
                        <Btn size="sm" variant="danger" icon={Trash2} onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))}>
                          <span className="sr-only">Remove line</span>
                        </Btn>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
          <div className="flex flex-col items-end gap-1 mt-3 text-sm">
            <Row label="Subtotal" value={fmtMoney(totals.net, form.currency)} />
            <Row label="Tax" value={fmtMoney(totals.tax, form.currency)} />
            <Row label="Total" value={fmtMoney(totals.net + totals.tax, form.currency)} strong />
            <p className="text-[11px] m-0 mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
              Preview -- the saved totals are recomputed by the database.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Notes"><textarea className="input w-full" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} /></Field>
          <Field label="Terms"><textarea className="input w-full" rows={2} value={form.terms} onChange={e => set('terms', e.target.value)} /></Field>
        </div>
      </form>
    </ModuleModal>
  );
}

const Row = ({ label, value, strong }) => (
  <div className="flex items-center gap-8">
    <span className={strong ? 'font-bold' : ''} style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
    <span className={`tabular-nums ${strong ? 'font-bold text-base' : ''}`} style={{ color: 'var(--color-text)', minWidth: 110, textAlign: 'right' }}>{value}</span>
  </div>
);

// -- View ------------------------------------------------------------------------

function InvoiceView({ invoice, onClose, onEdit }) {
  const cur = invoice.currency;
  return (
    <ModuleModal wide title={invoice.invoice_no} subtitle={invoice.customer_name} onClose={onClose}
      footer={<>{onEdit && <Btn onClick={onEdit}>Edit</Btn>}<Btn variant="primary" onClick={onClose}>Close</Btn></>}>
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <StatusPill status={invoice.status} />
        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Issued {fmtDate(invoice.issue_date)}</span>
        {invoice.due_date && <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Due {fmtDate(invoice.due_date)}</span>}
      </div>

      <TableScroll>
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              {['Description', 'Qty', 'Unit', 'Net', 'Tax'].map(h => (
                <th key={h} className="td-p text-[10px] font-bold uppercase tracking-wider text-left"
                  style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(invoice.invoice_line_items || []).map(l => (
              <tr key={l.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td className="td-p text-sm" style={{ color: 'var(--color-text)' }}>{l.description}</td>
                <td className="td-p text-sm tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{l.quantity}</td>
                <td className="td-p text-sm tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{fmtMoney(l.unit_price, cur)}</td>
                <td className="td-p text-sm tabular-nums" style={{ color: 'var(--color-text)' }}>{fmtMoney(l.net_total, cur)}</td>
                <td className="td-p text-sm tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{fmtMoney(l.tax_amount, cur)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>

      <div className="flex flex-col items-end gap-1 mt-3 text-sm">
        <Row label="Subtotal" value={fmtMoney(invoice.subtotal, cur)} />
        <Row label="Tax" value={fmtMoney(invoice.tax_total, cur)} />
        <Row label="Total" value={fmtMoney(invoice.total, cur)} strong />
        <Row label="Paid" value={fmtMoney(invoice.amount_paid, cur)} />
        <Row label="Balance due" value={fmtMoney(invoice.balance_due, cur)} strong />
      </div>

      {(invoice.invoice_payments || []).length > 0 && (
        <div className="mt-5">
          <p className="text-[11px] font-bold uppercase tracking-wider m-0 mb-2" style={{ color: 'var(--color-text-secondary)' }}>Payments</p>
          {invoice.invoice_payments.map(p => (
            <div key={p.id} className="flex items-center justify-between py-1.5 text-sm"
              style={{ borderBottom: '1px solid var(--color-border)' }}>
              <span style={{ color: 'var(--color-text-secondary)' }}>
                {fmtDate(p.paid_at)}{p.method ? ` -- ${p.method}` : ''}{p.reference ? ` (${p.reference})` : ''}
              </span>
              <span className="tabular-nums font-semibold" style={{ color: 'var(--color-success-600)' }}>{fmtMoney(p.amount, cur)}</span>
            </div>
          ))}
        </div>
      )}
    </ModuleModal>
  );
}

// -- Payment dialog -----------------------------------------------------------------

function PaymentDialog({ invoice, onClose, onSubmit }) {
  const [amount, setAmount] = useState(invoice.balance_due ?? '');
  const [method, setMethod] = useState('card');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    await onSubmit({ amount: Number(amount), method, reference: reference || null, note: note || null });
    setSaving(false);
  };

  return (
    <ModuleModal title={`Record a payment on ${invoice.invoice_no}`}
      subtitle={`${fmtMoney(invoice.balance_due, invoice.currency)} outstanding`} onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={saving} onClick={submit}>Record payment</Btn></>}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Amount" required hint="Cannot exceed the outstanding balance.">
          <input className="input w-full" type="number" step="0.01" min="0.01" required
            max={invoice.balance_due} value={amount} onChange={e => setAmount(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Method">
            <ThemedSelect value={method} onChange={e => setMethod(e.target.value)}>
              {['card', 'ach', 'cash', 'check', 'wire', 'other'].map(m => <option key={m} value={m}>{m}</option>)}
            </ThemedSelect>
          </Field>
          <Field label="Reference" hint="Transaction or check number.">
            <input className="input w-full" value={reference} onChange={e => setReference(e.target.value)} />
          </Field>
        </div>
        <Field label="Note"><input className="input w-full" value={note} onChange={e => setNote(e.target.value)} /></Field>
      </form>
    </ModuleModal>
  );
}

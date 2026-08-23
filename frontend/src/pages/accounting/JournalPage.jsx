// ============================================================================
// Accounting -> Journal. The ledger browser and the manual-entry editor.
//
// The editor will not let you post an unbalanced entry, and it says so before
// you try: the running debit/credit totals and their difference sit under the
// line table, and the Post button is disabled until they match. The server
// checks again (422) and a database trigger checks a third time -- three
// independent guards, because a crooked posted entry is not fixable by editing,
// only by reversing.
//
// Posted entries are read-only here on purpose. Void writes a mirror-image
// reversing entry so the ledger still adds up; there is no delete.
// ============================================================================
import { useState, useEffect, useMemo } from 'react';
import { BookOpen, Plus, CheckCircle2, Ban, Trash2, Search, ArrowLeftRight } from 'lucide-react';
import { Panel, SectionHeader, Loading, EmptyState, Field, TableScroll, PillTabs } from '../../components/UI/kit';
import { Alert } from '../../components/UI';
import ThemedSelect from '../../components/UI/Select';
import SearchSelect from '../../components/UI/SearchSelect';
import { Btn, StatusPill, ModuleModal } from '../../components/Modules/ModuleUI';
import { useJournalEntries } from '../../hooks/useJournalEntries';
import { useChartOfAccounts } from '../../hooks/useChartOfAccounts';
import { fmtMoney, fmtDate, todayISO } from '../../utils/money';

const cents = (v) => Math.round(Number(v || 0) * 100);

export default function JournalPage({ scope }) {
  const companyId = scope?.company_id || null;
  const canManage = !!scope?.permissions?.['accounting.journal.manage'];
  const { entries, total, loading, error, fetchEntries, fetchLedger, createEntry, postEntry, voidEntry, deleteEntry } =
    useJournalEntries(companyId);
  const { accounts, fetchAccounts } = useChartOfAccounts(companyId);

  const [view, setView] = useState('entries');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState(null);
  const [ledgerAccount, setLedgerAccount] = useState('');
  const [ledger, setLedger] = useState(null);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);
  useEffect(() => {
    if (view === 'entries') fetchEntries({ status: status || undefined, search: search || undefined });
  }, [fetchEntries, view, status, search]);
  useEffect(() => {
    if (view === 'ledger' && ledgerAccount) fetchLedger(ledgerAccount).then(setLedger);
    if (!ledgerAccount) setLedger(null);
  }, [view, ledgerAccount, fetchLedger]);

  const act = async (fn, okText) => {
    setNotice(null);
    try {
      const r = await fn();
      setNotice({
        type: 'success',
        text: r?.reversal_entry_no ? `${okText} Reversing entry ${r.reversal_entry_no} was posted.` : okText,
      });
    } catch (e) {
      setNotice({ type: 'error', text: e.response?.data?.error || 'That did not work.' });
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeader level="page" icon={BookOpen} title="Journal"
        subtitle={`${total} entr${total === 1 ? 'y' : 'ies'}${scope?.company_name ? ' -- ' + scope.company_name : ''}`}
        actions={canManage ? <Btn variant="primary" icon={Plus} onClick={() => setEditing({})}>New entry</Btn> : null} />

      {error && <Alert type="error">{error}</Alert>}
      {notice && <Alert type={notice.type} onDismiss={() => setNotice(null)}>{notice.text}</Alert>}

      <div className="flex items-center gap-3 flex-wrap">
        <PillTabs
          items={[{ key: 'entries', label: 'Entries', icon: BookOpen }, { key: 'ledger', label: 'Account ledger', icon: ArrowLeftRight }]}
          value={view} onChange={setView} />
        {view === 'entries' ? (
          <>
            <ThemedSelect value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {['draft', 'posted', 'void'].map(s => <option key={s} value={s}>{s}</option>)}
            </ThemedSelect>
            <div className="relative ml-auto">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
              <input className="input pl-8" placeholder="Entry no or memo" value={search}
                onChange={e => setSearch(e.target.value)} style={{ minWidth: 220 }} />
            </div>
          </>
        ) : (
          <div className="ml-auto" style={{ minWidth: 280 }}>
            {/* A real chart of accounts runs to dozens, so this has to be
                searchable -- a native select cannot be typed into. */}
            <SearchSelect
              value={ledgerAccount}
              onChange={setLedgerAccount}
              options={accounts.map(a => ({ value: a.id, label: a.name, hint: a.code }))}
              placeholder="Search by code or name..."
              emptyLabel="Pick an account" />
          </div>
        )}
      </div>

      {view === 'ledger' ? (
        !ledgerAccount ? (
          <EmptyState icon={ArrowLeftRight} title="Pick an account"
            hint="The ledger shows every posted line against one account, with a running balance. Drafts are not included -- they are not ledger facts yet." />
        ) : !ledger ? <Loading variant="table" rows={6} /> : (
          <Panel pad="none">
            <div className="flex items-center justify-between td-p" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <span className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>
                {ledger.account?.code} -- {ledger.account?.name}
              </span>
              <span className="text-sm tabular-nums font-bold" style={{ color: 'var(--color-text)' }}>
                Closing {fmtMoney(ledger.closing_balance)}
              </span>
            </div>
            {ledger.lines?.length === 0 ? (
              <div className="p-6"><EmptyState compact icon={BookOpen} title="Nothing posted to this account yet" /></div>
            ) : (
              <TableScroll stickyFirst>
                <table className="w-full">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                      {['Date', 'Entry', 'Description', 'Debit', 'Credit', 'Balance'].map((h, i) => (
                        <th key={h} className={`td-p text-[11px] font-bold uppercase tracking-wider ${i >= 3 ? 'text-right' : 'text-left'}`}
                          style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.lines.map(l => (
                      <tr key={l.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td className="td-p text-xs" style={{ color: 'var(--color-text-secondary)' }}>{fmtDate(l.entry_date)}</td>
                        <td className="td-p text-xs font-mono" style={{ color: 'var(--color-text)' }}>{l.entry_no}</td>
                        <td className="td-p text-sm" style={{ color: 'var(--color-text)' }}>{l.description || l.memo || '--'}</td>
                        <td className="td-p text-sm text-right tabular-nums" style={{ color: 'var(--color-text)' }}>{Number(l.debit) ? fmtMoney(l.debit) : ''}</td>
                        <td className="td-p text-sm text-right tabular-nums" style={{ color: 'var(--color-text)' }}>{Number(l.credit) ? fmtMoney(l.credit) : ''}</td>
                        <td className="td-p text-sm text-right tabular-nums font-semibold" style={{ color: 'var(--color-text)' }}>{fmtMoney(l.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </Panel>
        )
      ) : (
        loading && entries.length === 0 ? <Loading variant="table" rows={6} label="Loading journal entries" /> : (
          entries.length === 0 ? (
            <EmptyState icon={BookOpen} title="No journal entries"
              hint="Invoices, payments, approved expenses and finalized payroll runs post here automatically. You can also write a manual entry."
              action={canManage ? <Btn variant="primary" icon={Plus} onClick={() => setEditing({})}>New entry</Btn> : null} />
          ) : (
            <div className="space-y-2">
              {entries.map(entry => (
                <EntryCard key={entry.id} entry={entry} accounts={accounts} canManage={canManage}
                  onPost={() => act(() => postEntry(entry.id), `${entry.entry_no} posted.`)}
                  onVoid={() => {
                    const reason = window.prompt('Why is this entry being voided?');
                    if (reason) act(() => voidEntry(entry.id, reason), `${entry.entry_no} voided.`);
                  }}
                  onDelete={() => { if (window.confirm(`Delete draft ${entry.entry_no}?`)) act(() => deleteEntry(entry.id), 'Draft deleted.'); }} />
              ))}
            </div>
          )
        )
      )}

      {editing && (
        <EntryEditor accounts={accounts} onClose={() => setEditing(null)}
          onSave={async (payload) => {
            setNotice(null);
            try {
              await createEntry(payload);
              setEditing(null);
              setNotice({ type: 'success', text: payload.post ? 'Entry posted.' : 'Draft saved.' });
            } catch (e) {
              setNotice({ type: 'error', text: e.response?.data?.error || 'Could not save the entry.' });
            }
          }} />
      )}
    </div>
  );
}

function EntryCard({ entry, accounts, canManage, onPost, onVoid, onDelete }) {
  const nameOf = (id) => {
    const a = accounts.find(x => x.id === id);
    return a ? `${a.code} -- ${a.name}` : 'Unknown account';
  };
  const lines = entry.journal_entry_lines || [];
  const debit = lines.reduce((s, l) => s + cents(l.debit), 0);
  const credit = lines.reduce((s, l) => s + cents(l.credit), 0);
  const balanced = debit === credit && debit > 0;

  return (
    <Panel pad="sm">
      <div className="flex items-center gap-3 flex-wrap mb-2">
        <span className="font-mono text-sm font-bold" style={{ color: 'var(--color-text)' }}>{entry.entry_no}</span>
        <StatusPill status={entry.status} />
        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{fmtDate(entry.entry_date)}</span>
        {entry.source_type !== 'manual' && (
          <span className="text-[11px] px-1.5 py-0.5 rounded capitalize"
            style={{ background: 'var(--color-bg)', color: 'var(--color-text-tertiary)' }}>{entry.source_type}</span>
        )}
        <span className="text-sm truncate" style={{ color: 'var(--color-text-secondary)' }}>{entry.memo}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {canManage && entry.status === 'draft' && (
            <>
              <Btn size="sm" variant="primary" icon={CheckCircle2} disabled={!balanced} onClick={onPost}
                title={balanced ? 'Post to the ledger' : 'Debits and credits do not match'}>Post</Btn>
              <Btn size="sm" variant="danger" icon={Trash2} onClick={onDelete}>Delete</Btn>
            </>
          )}
          {canManage && entry.status === 'posted' && <Btn size="sm" icon={Ban} onClick={onVoid}>Void</Btn>}
        </div>
      </div>

      <TableScroll>
        <table className="w-full">
          <tbody>
            {lines.map(l => (
              <tr key={l.id}>
                <td className="py-1 text-xs" style={{ color: 'var(--color-text)' }}>{nameOf(l.account_id)}</td>
                <td className="py-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{l.description}</td>
                <td className="py-1 text-xs text-right tabular-nums" style={{ color: 'var(--color-text)', minWidth: 90 }}>
                  {Number(l.debit) ? fmtMoney(l.debit) : ''}
                </td>
                <td className="py-1 text-xs text-right tabular-nums" style={{ color: 'var(--color-text)', minWidth: 90 }}>
                  {Number(l.credit) ? fmtMoney(l.credit) : ''}
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: '1px solid var(--color-border)' }}>
              <td colSpan={2} className="py-1 text-[11px] font-bold uppercase tracking-wider"
                style={{ color: balanced ? 'var(--color-text-secondary)' : 'var(--color-error-600)' }}>
                {balanced ? 'Balanced' : `Out of balance by ${fmtMoney(Math.abs(debit - credit) / 100)}`}
              </td>
              <td className="py-1 text-xs text-right tabular-nums font-bold" style={{ color: 'var(--color-text)' }}>{fmtMoney(debit / 100)}</td>
              <td className="py-1 text-xs text-right tabular-nums font-bold" style={{ color: 'var(--color-text)' }}>{fmtMoney(credit / 100)}</td>
            </tr>
          </tbody>
        </table>
      </TableScroll>

      {entry.status === 'void' && entry.void_reason && (
        <p className="text-[11px] m-0 mt-2" style={{ color: 'var(--color-error-600)' }}>Voided: {entry.void_reason}</p>
      )}
    </Panel>
  );
}

const blankLine = () => ({ account_id: '', debit: '', credit: '', description: '' });

function EntryEditor({ accounts, onClose, onSave }) {
  const [memo, setMemo] = useState('');
  const [entryDate, setEntryDate] = useState(todayISO());
  const [lines, setLines] = useState([blankLine(), blankLine()]);
  const [saving, setSaving] = useState(false);

  const setLine = (i, k, v) => setLines(ls => ls.map((l, idx) => {
    if (idx !== i) return l;
    // A line is a debit OR a credit. Typing in one clears the other, so the
    // "both sides filled" state the database rejects is simply unreachable.
    if (k === 'debit' && v) return { ...l, debit: v, credit: '' };
    if (k === 'credit' && v) return { ...l, credit: v, debit: '' };
    return { ...l, [k]: v };
  }));

  const totals = useMemo(() => {
    const d = lines.reduce((s, l) => s + cents(l.debit), 0);
    const c = lines.reduce((s, l) => s + cents(l.credit), 0);
    return { debit: d, credit: c, diff: d - c, balanced: d === c && d > 0 };
  }, [lines]);

  const usable = lines.filter(l => l.account_id && (cents(l.debit) > 0 || cents(l.credit) > 0));

  const save = async (post) => {
    setSaving(true);
    await onSave({
      entry_date: entryDate,
      memo: memo || null,
      post,
      lines: usable.map(l => ({
        account_id: l.account_id,
        debit: Number(l.debit || 0),
        credit: Number(l.credit || 0),
        description: l.description || null,
      })),
    });
    setSaving(false);
  };

  return (
    <ModuleModal wide title="New journal entry" onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn busy={saving} disabled={!usable.length} onClick={() => save(false)}>Save as draft</Btn>
          <Btn variant="primary" busy={saving} disabled={!totals.balanced}
            title={totals.balanced ? undefined : 'Debits must equal credits before this can be posted'}
            onClick={() => save(true)}>Post entry</Btn>
        </>
      }>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Date">
            <input className="input w-full" type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)} />
          </Field>
          <Field label="Memo" className="sm:col-span-2" hint="What this entry is for. It appears in the ledger.">
            <input className="input w-full" value={memo} onChange={e => setMemo(e.target.value)} />
          </Field>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-bold uppercase tracking-wider m-0" style={{ color: 'var(--color-text-secondary)' }}>Lines</p>
            <Btn size="sm" icon={Plus} onClick={() => setLines(ls => [...ls, blankLine()])}>Add line</Btn>
          </div>
          <TableScroll>
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {['Account', 'Description', 'Debit', 'Credit', ''].map(h => (
                    <th key={h} className="td-p text-[10px] font-bold uppercase tracking-wider text-left"
                      style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td className="td-p" style={{ minWidth: 220 }}>
                      <SearchSelect
                        value={l.account_id}
                        onChange={v => setLine(i, 'account_id', v)}
                        options={accounts.map(a => ({ value: a.id, label: a.name, hint: a.code }))}
                        placeholder="Search by code or name..."
                        emptyLabel="Pick an account" />
                    </td>
                    <td className="td-p"><input className="input w-full" value={l.description}
                      onChange={e => setLine(i, 'description', e.target.value)} style={{ minWidth: 150 }} /></td>
                    <td className="td-p"><input className="input" type="number" step="0.01" min="0" value={l.debit}
                      onChange={e => setLine(i, 'debit', e.target.value)} style={{ width: 110 }} /></td>
                    <td className="td-p"><input className="input" type="number" step="0.01" min="0" value={l.credit}
                      onChange={e => setLine(i, 'credit', e.target.value)} style={{ width: 110 }} /></td>
                    <td className="td-p">
                      {lines.length > 2 && (
                        <Btn size="sm" variant="danger" icon={Trash2} onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))}>
                          <span className="sr-only">Remove</span>
                        </Btn>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>

          {/* The balance readout. This is the whole point of the editor. */}
          <div className="flex items-center justify-end gap-6 mt-3 text-sm">
            <span style={{ color: 'var(--color-text-secondary)' }}>Debits <strong className="tabular-nums" style={{ color: 'var(--color-text)' }}>{fmtMoney(totals.debit / 100)}</strong></span>
            <span style={{ color: 'var(--color-text-secondary)' }}>Credits <strong className="tabular-nums" style={{ color: 'var(--color-text)' }}>{fmtMoney(totals.credit / 100)}</strong></span>
            <span className="font-bold" style={{ color: totals.balanced ? 'var(--color-success-600)' : 'var(--color-error-600)' }}>
              {totals.balanced ? 'Balanced' : `Out by ${fmtMoney(Math.abs(totals.diff) / 100)}`}
            </span>
          </div>
        </div>
      </div>
    </ModuleModal>
  );
}

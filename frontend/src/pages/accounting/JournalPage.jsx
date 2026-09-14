// ============================================================================
// Accounting -> Books -> Journal. Every money movement, as double entry.
//
// Posted entries are never edited (the database refuses, mig 315). What a
// person can do instead, and what this page offers:
//   Correct -> opens the entry's lines in the editor; saving reverses the
//              original and posts the corrected version, one transaction.
//   Reverse -> posts a mirror image that cancels it. Both stay visible.
// Entries written by an invoice, payment, expense or payroll run carry a
// "from invoice" badge and are changed from THAT screen, so the document and
// the books never disagree.
//
// Money is in the company's own currency (scope.currency, mig 295). Foreign
// amounts show their original currency and rate on the line.
// ============================================================================
import { useState, useEffect, useMemo } from 'react';
import { BookOpen, Plus, CheckCircle2, Trash2, Search, ArrowLeftRight, Undo2, PencilLine, Link2 } from 'lucide-react';
import { Panel, SectionHeader, Loading, EmptyState, Field, TableScroll, PillTabs } from '../../components/UI/kit';
import { Alert } from '../../components/UI';
import ThemedSelect from '../../components/UI/Select';
import ThemedDate from '../../components/UI/ThemedDate';
import SearchSelect from '../../components/UI/SearchSelect';
import { Btn, StatusPill, ModuleModal } from '../../components/Modules/ModuleUI';
import AskDialog from '../../components/Modules/AskDialog';
import { useJournalEntries } from '../../hooks/useJournalEntries';
import { useChartOfAccounts } from '../../hooks/useChartOfAccounts';
import { HistoryButton } from '../../components/Modules/RecordHistory';
import { fmtMoney, fmtDate, todayISO } from '../../utils/money';

const cents = (v) => Math.round(Number(v || 0) * 100);

const SOURCE_WORDS = {
  manual: 'Typed in', invoice: 'From an invoice', payment: 'From a payment', expense: 'From an expense claim',
  payroll: 'From payroll', adjustment: 'Correction', sale: 'From a CRM sale', partner_fee: 'Partner fee',
  commission: 'Commission', opening_balance: 'Opening balance', fx: 'Exchange rate',
};

export default function JournalPage({ scope }) {
  const companyId = scope?.company_id || null;
  const currency = scope?.currency || 'PKR';
  const canManage = !!scope?.permissions?.['accounting.journal.manage'];
  const {
    entries, total, loading, error, fetchEntries, fetchLedger, createEntry, postEntry, voidEntry,
    deleteEntry, reverseEntry, correctEntry,
  } = useJournalEntries(companyId);
  const { accounts, fetchAccounts } = useChartOfAccounts(companyId);

  const [view, setView] = useState('entries');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);      // {} new | { correcting: entry }
  const [asking, setAsking] = useState(null);        // AskDialog props
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
      const extra = [
        r?.reversal_entry_no ? `Reversal ${r.reversal_entry_no} was posted.` : null,
        r?.corrected_entry_no ? `Corrected entry ${r.corrected_entry_no} was posted.` : null,
      ].filter(Boolean).join(' ');
      setNotice({ type: 'success', text: [okText, extra].filter(Boolean).join(' ') });
      return true;
    } catch (e) {
      setNotice({ type: 'error', text: e.response?.data?.error || 'That did not work.' });
      return false;
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeader level="page" icon={BookOpen} title="Journal"
        subtitle={`Every money movement, ${total} entr${total === 1 ? 'y' : 'ies'}. Posted entries are never edited -- correct or reverse them instead.`}
        actions={canManage ? <Btn variant="primary" icon={Plus} onClick={() => setEditing({})}>New entry</Btn> : null} />

      {error && <Alert type="error">{error}</Alert>}
      {notice && <Alert type={notice.type} onDismiss={() => setNotice(null)}>{notice.text}</Alert>}

      <div className="flex items-center gap-3 flex-wrap">
        <PillTabs
          items={[{ key: 'entries', label: 'Entries', icon: BookOpen }, { key: 'ledger', label: 'One account', icon: ArrowLeftRight }]}
          value={view} onChange={setView} />
        {view === 'entries' ? (
          <>
            <ThemedSelect value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">Everything</option>
              <option value="posted">Posted</option>
              <option value="draft">Drafts</option>
              <option value="void">Discarded drafts</option>
            </ThemedSelect>
            <div className="relative ml-auto">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
              <input className="input pl-8" placeholder="Entry no or memo" value={search}
                onChange={e => setSearch(e.target.value)} style={{ minWidth: 220 }} />
            </div>
          </>
        ) : (
          <div className="ml-auto" style={{ minWidth: 280 }}>
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
            hint="See every posted movement on one account with a running balance. A reversed entry and its reversal both show, and cancel." />
        ) : !ledger ? <Loading variant="table" rows={6} /> : (
          <Panel pad="none">
            <div className="flex items-center justify-between td-p" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <span className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>
                {ledger.account?.code} -- {ledger.account?.name}
              </span>
              <span className="text-sm tabular-nums font-bold" style={{ color: 'var(--color-text)' }}>
                Balance {fmtMoney(ledger.closing_balance, currency)}
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
                      <tr key={l.id} style={{ borderBottom: '1px solid var(--color-border)', opacity: l.is_reversed || l.is_reversal ? 0.75 : 1 }}>
                        <td className="td-p text-xs" style={{ color: 'var(--color-text-secondary)' }}>{fmtDate(l.entry_date)}</td>
                        <td className="td-p text-xs font-mono" style={{ color: 'var(--color-text)' }}>
                          {l.entry_no}{l.is_reversal ? ' (reversal)' : l.is_reversed ? ' (reversed)' : ''}
                        </td>
                        <td className="td-p text-sm" style={{ color: 'var(--color-text)' }}>{l.description || l.memo || '--'}</td>
                        <td className="td-p text-sm text-right tabular-nums" style={{ color: 'var(--color-text)' }}>{Number(l.debit) ? fmtMoney(l.debit, currency) : ''}</td>
                        <td className="td-p text-sm text-right tabular-nums" style={{ color: 'var(--color-text)' }}>{Number(l.credit) ? fmtMoney(l.credit, currency) : ''}</td>
                        <td className="td-p text-sm text-right tabular-nums font-semibold" style={{ color: 'var(--color-text)' }}>{fmtMoney(l.balance, currency)}</td>
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
            <EmptyState icon={BookOpen} title="No journal entries yet"
              hint="Invoices, payments, approved expenses and payroll post here by themselves. You can also type an entry."
              action={canManage ? <Btn variant="primary" icon={Plus} onClick={() => setEditing({})}>New entry</Btn> : null} />
          ) : (
            <div className="space-y-2">
              {entries.map(entry => (
                <EntryCard key={entry.id} entry={entry} accounts={accounts} canManage={canManage}
                  companyId={companyId} currency={currency}
                  onPost={() => act(() => postEntry(entry.id), `${entry.entry_no} posted.`)}
                  onCorrect={() => setEditing({ correcting: entry })}
                  onReverse={() => setAsking({
                    title: `Reverse ${entry.entry_no}?`,
                    message: 'A mirror-image entry is posted today that cancels it. Both stay in the books, so the history still reads correctly.',
                    confirmLabel: 'Reverse it', reason: 'required', danger: true,
                    onConfirm: async (why) => { if (await act(() => reverseEntry(entry.id, why), `${entry.entry_no} reversed.`)) setAsking(null); },
                  })}
                  onDiscard={() => setAsking({
                    title: `Discard draft ${entry.entry_no}?`,
                    message: 'The draft is kept, marked as discarded, and never posted.',
                    confirmLabel: 'Discard draft', reason: 'required',
                    onConfirm: async (why) => { if (await act(() => voidEntry(entry.id, why), 'Draft discarded.')) setAsking(null); },
                  })}
                  onDelete={() => setAsking({
                    title: `Delete draft ${entry.entry_no}?`,
                    message: 'A draft was never in the books, so it can be deleted. Its history stays in the change log.',
                    confirmLabel: 'Delete draft', danger: true,
                    onConfirm: async () => { if (await act(() => deleteEntry(entry.id), 'Draft deleted.')) setAsking(null); },
                  })} />
              ))}
            </div>
          )
        )
      )}

      {editing && (
        <EntryEditor accounts={accounts} currency={currency} correcting={editing.correcting || null}
          onClose={() => setEditing(null)}
          onSave={async (payload) => {
            setNotice(null);
            try {
              if (editing.correcting) {
                const r = await correctEntry(editing.correcting.id, payload);
                setNotice({ type: 'success', text: `${editing.correcting.entry_no} corrected: reversed as ${r.reversal_entry_no}, corrected entry ${r.corrected_entry_no} posted.` });
              } else {
                await createEntry(payload);
                setNotice({ type: 'success', text: payload.post ? 'Entry posted.' : 'Draft saved.' });
              }
              setEditing(null);
            } catch (e) {
              setNotice({ type: 'error', text: e.response?.data?.error || 'Could not save the entry.' });
            }
          }} />
      )}

      {asking && <AskDialog {...asking} onClose={() => setAsking(null)} />}
    </div>
  );
}

function EntryCard({ entry, accounts, canManage, companyId, currency, onPost, onCorrect, onReverse, onDiscard, onDelete }) {
  const nameOf = (id) => {
    const a = accounts.find(x => x.id === id);
    return a ? `${a.code} -- ${a.name}` : 'Unknown account';
  };
  const lines = entry.journal_entry_lines || [];
  const debit = lines.reduce((s, l) => s + cents(l.debit), 0);
  const credit = lines.reduce((s, l) => s + cents(l.credit), 0);
  const balanced = debit === credit && debit > 0;
  const live = entry.status === 'posted' && !entry.reversed_by && !entry.reversal_of;

  return (
    <Panel pad="sm" style={{ opacity: entry.reversed_by ? 0.8 : 1 }}>
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="font-mono text-sm font-bold" style={{ color: 'var(--color-text)' }}>{entry.entry_no}</span>
        <StatusPill status={entry.status} />
        {entry.reversed_by_no && (
          <span className="text-[11px] px-1.5 py-0.5 rounded inline-flex items-center gap-1"
            style={{ background: 'color-mix(in srgb, var(--color-error-600) 12%, transparent)', color: 'var(--color-error-600)' }}>
            <Undo2 size={11} /> Reversed by {entry.reversed_by_no}
          </span>
        )}
        {entry.reversal_of_no && (
          <span className="text-[11px] px-1.5 py-0.5 rounded inline-flex items-center gap-1"
            style={{ background: 'color-mix(in srgb, var(--color-warning-600) 14%, transparent)', color: 'var(--color-warning-600)' }}>
            <Link2 size={11} /> Reverses {entry.reversal_of_no}
          </span>
        )}
        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{fmtDate(entry.entry_date)}</span>
        <span className="text-[11px] px-1.5 py-0.5 rounded"
          style={{ background: 'var(--color-bg)', color: 'var(--color-text-tertiary)' }}>{SOURCE_WORDS[entry.source_type] || entry.source_type}</span>
        <span className="text-sm truncate" style={{ color: 'var(--color-text-secondary)' }}>{entry.memo}</span>
        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
          <HistoryButton module="accounting" table="journal_entries" id={entry.id} companyId={companyId}
            title={'History -- ' + entry.entry_no} />
          {canManage && entry.status === 'draft' && (
            <>
              <Btn size="sm" variant="primary" icon={CheckCircle2} disabled={!balanced} onClick={onPost}
                title={balanced ? 'Post to the books' : 'Debits and credits do not match'}>Post</Btn>
              <Btn size="sm" onClick={onDiscard}>Discard</Btn>
              <Btn size="sm" variant="danger" icon={Trash2} onClick={onDelete}>Delete</Btn>
            </>
          )}
          {canManage && live && entry.editable_here && (
            <>
              <Btn size="sm" icon={PencilLine} onClick={onCorrect}>Correct</Btn>
              <Btn size="sm" icon={Undo2} onClick={onReverse}>Reverse</Btn>
            </>
          )}
        </div>
      </div>

      <TableScroll>
        <table className="w-full">
          <tbody>
            {lines.map(l => (
              <tr key={l.id}>
                <td className="py-1 text-xs" style={{ color: 'var(--color-text)' }}>{nameOf(l.account_id)}</td>
                <td className="py-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                  {l.description}
                  {l.orig_currency && (
                    <span className="ml-1">({fmtMoney(l.orig_amount, l.orig_currency)} @ {Number(l.fx_rate)})</span>
                  )}
                </td>
                <td className="py-1 text-xs text-right tabular-nums" style={{ color: 'var(--color-text)', minWidth: 100 }}>
                  {Number(l.debit) ? fmtMoney(l.debit, currency) : ''}
                </td>
                <td className="py-1 text-xs text-right tabular-nums" style={{ color: 'var(--color-text)', minWidth: 100 }}>
                  {Number(l.credit) ? fmtMoney(l.credit, currency) : ''}
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: '1px solid var(--color-border)' }}>
              <td colSpan={2} className="py-1 text-[11px] font-bold uppercase tracking-wider"
                style={{ color: balanced ? 'var(--color-text-secondary)' : 'var(--color-error-600)' }}>
                {balanced ? 'Balanced' : `Out of balance by ${fmtMoney(Math.abs(debit - credit) / 100, currency)}`}
              </td>
              <td className="py-1 text-xs text-right tabular-nums font-bold" style={{ color: 'var(--color-text)' }}>{fmtMoney(debit / 100, currency)}</td>
              <td className="py-1 text-xs text-right tabular-nums font-bold" style={{ color: 'var(--color-text)' }}>{fmtMoney(credit / 100, currency)}</td>
            </tr>
          </tbody>
        </table>
      </TableScroll>

      {entry.status === 'posted' && !entry.editable_here && !entry.reversal_of && (
        <p className="text-[11px] m-0 mt-2" style={{ color: 'var(--color-text-tertiary)' }}>
          {entry.source_type === 'opening_balance'
            ? 'To change the opening balances, use Books -> Opening balances.'
            : `Written automatically. To change it, change the ${SOURCE_WORDS[entry.source_type]?.replace(/^From an? /, '').toLowerCase() || 'source'} it came from.`}
        </p>
      )}
      {entry.reversal_reason && (
        <p className="text-[11px] m-0 mt-2" style={{ color: 'var(--color-error-600)' }}>Reversed because: {entry.reversal_reason}</p>
      )}
      {entry.status === 'void' && entry.void_reason && (
        <p className="text-[11px] m-0 mt-2" style={{ color: 'var(--color-text-tertiary)' }}>Discarded: {entry.void_reason}</p>
      )}
    </Panel>
  );
}

const blankLine = () => ({ account_id: '', debit: '', credit: '', description: '' });

function EntryEditor({ accounts, currency, correcting, onClose, onSave }) {
  const [memo, setMemo] = useState(correcting ? (correcting.memo || '') : '');
  const [entryDate, setEntryDate] = useState(todayISO());
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState(() => correcting
    ? (correcting.journal_entry_lines || []).map(l => ({
        account_id: l.account_id,
        debit: Number(l.debit) ? String(l.debit) : '',
        credit: Number(l.credit) ? String(l.credit) : '',
        description: l.description || '',
      }))
    : [blankLine(), blankLine()]);
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
  const payloadLines = () => usable.map(l => ({
    account_id: l.account_id,
    debit: Number(l.debit || 0),
    credit: Number(l.credit || 0),
    description: l.description || null,
  }));

  const save = async (post) => {
    setSaving(true);
    try {
      if (correcting) await onSave({ reason: reason.trim(), entry_date: entryDate, memo: memo || null, lines: payloadLines() });
      else await onSave({ entry_date: entryDate, memo: memo || null, post, lines: payloadLines() });
    } finally { setSaving(false); }
  };

  return (
    <ModuleModal wide
      title={correcting ? `Correct ${correcting.entry_no}` : 'New journal entry'}
      subtitle={correcting ? 'Saving reverses the original and posts this corrected version. Both stay in the books.' : undefined}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          {!correcting && <Btn busy={saving} disabled={!usable.length} onClick={() => save(false)}>Save as draft</Btn>}
          <Btn variant="primary" busy={saving} disabled={!totals.balanced || (correcting && !reason.trim())}
            title={totals.balanced ? undefined : 'Debits must equal credits'}
            onClick={() => save(true)}>{correcting ? 'Save correction' : 'Post entry'}</Btn>
        </>
      }>
      <div className="space-y-4">
        {correcting && (
          <Field label="What was wrong with the original" hint="Kept with the reversal in the record history.">
            <input className="input w-full" value={reason} onChange={e => setReason(e.target.value)} maxLength={500} />
          </Field>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Date">
            <ThemedDate value={entryDate} onChange={e => setEntryDate(e.target.value)} />
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
          <div className="flex items-center justify-end gap-6 mt-3 text-sm flex-wrap">
            <span style={{ color: 'var(--color-text-secondary)' }}>Debits <strong className="tabular-nums" style={{ color: 'var(--color-text)' }}>{fmtMoney(totals.debit / 100, currency)}</strong></span>
            <span style={{ color: 'var(--color-text-secondary)' }}>Credits <strong className="tabular-nums" style={{ color: 'var(--color-text)' }}>{fmtMoney(totals.credit / 100, currency)}</strong></span>
            <span className="font-bold" style={{ color: totals.balanced ? 'var(--color-success-600)' : 'var(--color-error-600)' }}>
              {totals.balanced ? 'Balanced' : `Out by ${fmtMoney(Math.abs(totals.diff) / 100, currency)}`}
            </span>
          </div>
        </div>
      </div>
    </ModuleModal>
  );
}

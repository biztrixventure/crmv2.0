// ============================================================================
// Accounting -> Settings. Everything the books do automatically, editable.
//
//   Money rules      for each automatic posting ("an invoice is sent", "a
//                    payroll run is finalized"...), which two accounts it uses.
//                    Default = the standard codes; change any side per company.
//   Exchange rates   the rate to use for a foreign currency from a date on.
//                    Nothing foreign is ever posted without one.
// Reads GET/PUT /accounting/settings/rules and /fx (routes/accounting/settings.js).
// Every change is kept in the change log (mig 313).
// ============================================================================
import { useEffect, useState } from 'react';
import { Settings, RotateCcw, Plus, Trash2, Save, ArrowRightLeft } from 'lucide-react';
import client from '../../api/client';
import { Panel, SectionHeader, Loading, EmptyState, Field, TableScroll } from '../../components/UI/kit';
import { Alert } from '../../components/UI';
import SearchSelect from '../../components/UI/SearchSelect';
import ThemedDate from '../../components/UI/ThemedDate';
import { Btn } from '../../components/Modules/ModuleUI';
import AskDialog from '../../components/Modules/AskDialog';
import { fmtDate, todayISO } from '../../utils/money';

export default function AccountingSettingsPage({ scope }) {
  const companyId = scope?.company_id || null;
  const [rules, setRules] = useState(null);
  const [fx, setFx] = useState(null);
  const [notice, setNotice] = useState(null);
  const [asking, setAsking] = useState(null);

  const load = async () => {
    const [r, f] = await Promise.all([
      client.get('accounting/settings/rules', { params: { company_id: companyId || undefined } }),
      client.get('accounting/settings/fx', { params: { company_id: companyId || undefined } }),
    ]);
    setRules(r.data);
    setFx(f.data);
  };
  useEffect(() => {
    load().catch(e => setNotice({ type: 'error', text: e.response?.data?.error || 'Could not load the settings' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  if (!rules || !fx) return notice ? <Alert type={notice.type}>{notice.text}</Alert> : <Loading variant="cards" cards={2} />;
  const canManage = !!rules.can_manage;
  const accountOptions = (rules.accounts || []).filter(a => a.is_active !== false)
    .map(a => ({ value: a.id, label: a.name, hint: a.code + ' · ' + a.account_type }));

  const saveRule = async (key, patch) => {
    setNotice(null);
    try {
      await client.put(`accounting/settings/rules/${key}`, { company_id: companyId, ...patch });
      await load();
      setNotice({ type: 'success', text: 'Money rule saved.' });
    } catch (e) {
      setNotice({ type: 'error', text: e.response?.data?.error || 'Could not save the rule' });
    }
  };
  const resetRule = async (key) => {
    setNotice(null);
    try {
      await client.delete(`accounting/settings/rules/${key}`, { params: { company_id: companyId || undefined } });
      await load();
      setNotice({ type: 'success', text: 'Back to the standard accounts.' });
    } catch (e) {
      setNotice({ type: 'error', text: e.response?.data?.error || 'Could not reset the rule' });
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeader level="page" icon={Settings} title="Accounts settings"
        subtitle={`What the books do automatically for ${scope?.company_name || 'this company'}, and the exchange rates they use. Books are kept in ${rules.currency}.`} />
      {notice && <Alert type={notice.type} onDismiss={() => setNotice(null)}>{notice.text}</Alert>}
      {(rules.accounts || []).length === 0 && (
        <Alert type="info" dismissible={false}>
          This company has no chart of accounts yet, so nothing is recorded in the books. Set one up under Books, Chart of accounts
          (one click adds a standard set).
        </Alert>
      )}

      <Panel>
        <SectionHeader title="Money rules" subtitle="When something happens in the CRM or this module, these two accounts record it. Pick different ones any time -- entries already posted keep the accounts they used." />
        <div className="space-y-3">
          {rules.rules.map(r => (
            <RuleRow key={r.event_key} rule={r} options={accountOptions} canManage={canManage}
              onSave={(patch) => saveRule(r.event_key, patch)} onReset={() => resetRule(r.event_key)} />
          ))}
        </div>
      </Panel>

      <FxPanel data={fx} companyId={companyId} canManage={!!fx.can_manage}
        onChanged={load} onNotice={setNotice} onAsk={setAsking} />

      {asking && <AskDialog {...asking} onClose={() => setAsking(null)} />}
    </div>
  );
}

function RuleRow({ rule, options, canManage, onSave, onReset }) {
  const [debit, setDebit] = useState(rule.debit?.account?.id || '');
  const [credit, setCredit] = useState(rule.credit?.account?.id || '');
  useEffect(() => { setDebit(rule.debit?.account?.id || ''); setCredit(rule.credit?.account?.id || ''); }, [rule]);
  const dirty = (rule.debit && debit !== (rule.debit.account?.id || '')) || (rule.credit && credit !== (rule.credit.account?.id || ''));
  const missing = (rule.debit && !rule.debit.account) || (rule.credit && !rule.credit.account);

  const side = (s, value, onChange, label) => (
    <Field label={label} hint={s.account ? null : `Not set -- the standard is account ${s.default_code}, which this company does not have.`}>
      {canManage ? (
        <SearchSelect value={value} onChange={onChange} options={options}
          placeholder="Search by code or name..." emptyLabel="Pick an account" />
      ) : (
        <p className="text-sm m-0" style={{ color: 'var(--color-text)' }}>
          {s.account ? `${s.account.code} ${s.account.name}` : '--'}
        </p>
      )}
    </Field>
  );

  return (
    <div className="p-3 rounded-xl" style={{ border: `1px solid ${missing ? 'var(--color-warning-600)' : 'var(--color-border)'}` }}>
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{rule.label}</span>
        {rule.customised && <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: 'color-mix(in srgb, var(--color-primary-600) 12%, transparent)', color: 'var(--color-text)' }}>changed for this company</span>}
        {missing && <span className="text-[11px] font-semibold" style={{ color: 'var(--color-warning-600)' }}>needs an account</span>}
        {canManage && (
          <div className="ml-auto flex items-center gap-2">
            {rule.customised && <Btn size="sm" icon={RotateCcw} onClick={onReset}>Use standard</Btn>}
            <Btn size="sm" variant="primary" icon={Save} disabled={!dirty}
              onClick={() => onSave({ debit_account_id: debit || null, credit_account_id: credit || null })}>Save</Btn>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {rule.debit && side(rule.debit, debit, setDebit, 'Debit -- ' + rule.debit.words)}
        {rule.credit && side(rule.credit, credit, setCredit, 'Credit -- ' + rule.credit.words)}
      </div>
    </div>
  );
}

function FxPanel({ data, companyId, canManage, onChanged, onNotice, onAsk }) {
  const [form, setForm] = useState({ currency: 'USD', rate: '', effective_from: todayISO(), note: '' });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const add = async () => {
    setBusy(true); onNotice(null);
    try {
      await client.post('accounting/settings/fx', { company_id: companyId, ...form, rate: Number(form.rate) });
      await onChanged();
      setForm(f => ({ ...f, rate: '', note: '' }));
      onNotice({ type: 'success', text: `${form.currency} rate added from ${form.effective_from}.` });
    } catch (e) {
      onNotice({ type: 'error', text: e.response?.data?.error || 'Could not add the rate' });
    } finally { setBusy(false); }
  };

  return (
    <Panel>
      <SectionHeader icon={ArrowRightLeft} title="Exchange rates"
        subtitle={`How many ${data.currency} one unit of another currency is worth, from a date on. A rate stays in force until the next one. Entries already posted keep the rate they used.`} />
      {canManage && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 items-end mb-4">
          <Field label="Currency">
            <input className="input w-full uppercase" maxLength={3} value={form.currency} onChange={e => set('currency', e.target.value.toUpperCase())} />
          </Field>
          <Field label={`1 ${form.currency || '---'} =`}>
            <input className="input w-full" type="number" min="0" step="0.0001" placeholder={data.currency}
              value={form.rate} onChange={e => set('rate', e.target.value)} />
          </Field>
          <Field label="From">
            <ThemedDate value={form.effective_from} onChange={e => set('effective_from', e.target.value)} />
          </Field>
          <Field label="Note">
            <input className="input w-full" value={form.note} onChange={e => set('note', e.target.value)} placeholder="e.g. bank rate" />
          </Field>
          <Btn variant="primary" icon={Plus} busy={busy} disabled={!(Number(form.rate) > 0) || form.currency.length !== 3} onClick={add}>Add rate</Btn>
        </div>
      )}
      {(data.rates || []).length === 0 ? (
        <EmptyState compact icon={ArrowRightLeft} title="No exchange rates yet"
          hint={`Only needed for invoices, expenses or payroll in a currency other than ${data.currency}.`} />
      ) : (
        <TableScroll>
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                {['Currency', 'Rate', 'From', 'Note', ''].map(h => (
                  <th key={h} className="td-p text-[11px] font-bold uppercase tracking-wider text-left" style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rates.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td className="td-p text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{r.currency}</td>
                  <td className="td-p text-sm tabular-nums" style={{ color: 'var(--color-text)' }}>1 {r.currency} = {Number(r.rate)} {data.currency}</td>
                  <td className="td-p text-sm" style={{ color: 'var(--color-text-secondary)' }}>{fmtDate(r.effective_from)}</td>
                  <td className="td-p text-sm" style={{ color: 'var(--color-text-secondary)' }}>{r.note || ''}</td>
                  <td className="td-p text-right">
                    {canManage && (
                      <Btn size="sm" variant="danger" icon={Trash2} onClick={() => onAsk({
                        title: `Remove the ${r.currency} rate from ${fmtDate(r.effective_from)}?`,
                        message: 'Only future postings are affected -- every posted entry keeps the rate it used.',
                        confirmLabel: 'Remove rate', reason: 'required', danger: true,
                        onConfirm: async (why) => {
                          try {
                            await client.delete(`accounting/settings/fx/${r.id}`, { data: { company_id: companyId, change_reason: why } });
                            await onChanged(); onAsk(null);
                          } catch (e) { onNotice({ type: 'error', text: e.response?.data?.error || 'Could not remove the rate' }); }
                        },
                      })}><span className="sr-only">Remove</span></Btn>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Panel>
  );
}

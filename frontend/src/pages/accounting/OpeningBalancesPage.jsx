// ============================================================================
// Accounts -> Books -> Opening balances. What the company already had, and
// already owed, on the day it started keeping its books here -- typed in once,
// editable any time.
//
// Plain rows per balance-sheet account; the balancing figure (whatever makes
// "what we have" equal "what we owe + the owners' stake") is worked out live and
// lands on ONE equity account the accountant picks. Saving posts one journal
// entry; changing it later reverses that entry and posts the new one, and the
// server asks why (needs_reason -> ReasonPromptHost), so the change log keeps
// both versions. Reads/writes GET/PUT /accounting/opening-balances.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { Landmark, Save } from 'lucide-react';
import client from '../../api/client';
import { Panel, SectionHeader, Loading, EmptyState, Field } from '../../components/UI/kit';
import { Alert } from '../../components/UI';
import SearchSelect from '../../components/UI/SearchSelect';
import ThemedDate from '../../components/UI/ThemedDate';
import { Btn } from '../../components/Modules/ModuleUI';
import { fmtMoney, fmtDate, todayISO, DEFAULT_CURRENCY } from '../../utils/money';

const GROUPS = [
  { type: 'asset',     title: 'What the company has',  hint: 'Cash in each bank, money customers owe you, equipment. A negative number = overdrawn.' },
  { type: 'liability', title: 'What the company owes', hint: 'Unpaid bills, salaries due, tax held back, loans.' },
  { type: 'equity',    title: "Owners' stake",         hint: 'Money the owners put in. Leave blank if you are not sure -- the balancing figure covers it.' },
];

const toCents = (v) => Math.round(Number(v || 0) * 100);

export default function OpeningBalancesPage({ scope }) {
  const companyId = scope?.company_id || null;
  const [data, setData] = useState(null);
  const [amounts, setAmounts] = useState({});
  const [asOf, setAsOf] = useState(todayISO());
  const [plugId, setPlugId] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = async () => {
    const r = await client.get('accounting/opening-balances', { params: { company_id: companyId || undefined } });
    setData(r.data);
    setAmounts(Object.fromEntries((r.data.balances || []).map(b => [b.account_id, String(b.amount)])));
    setAsOf(r.data.entry?.entry_date || todayISO());
    setPlugId(r.data.balancing_account_id || '');
  };
  useEffect(() => {
    load().catch(e => setNotice({ type: 'error', text: e.response?.data?.error || 'Could not load the opening balances' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const currency = data?.currency || scope?.currency || DEFAULT_CURRENCY;
  const canManage = !!data?.can_manage;

  // Active accounts, plus any archived one that still carries an opening amount.
  const visible = useMemo(() => (data?.accounts || []).filter(a =>
    a.is_active !== false || toCents(amounts[a.id]) !== 0), [data, amounts]);

  const totals = useMemo(() => {
    const t = { asset: 0, liability: 0, equity: 0 };
    for (const a of visible) {
      if (a.id === plugId) continue;
      t[a.account_type] += toCents(amounts[a.id]);
    }
    return { ...t, plug: t.asset - t.liability - t.equity };
  }, [visible, amounts, plugId]);

  if (!data) return notice ? <Alert type={notice.type}>{notice.text}</Alert> : <Loading variant="cards" cards={3} />;

  if ((data.accounts || []).length === 0) {
    return <EmptyState icon={Landmark} title="No balance-sheet accounts yet"
      hint="Open Chart of accounts and add the standard accounts first -- opening balances are entered against them." />;
  }

  const equityOptions = (data.accounts || []).filter(a => a.account_type === 'equity' && a.is_active !== false)
    .map(a => ({ value: a.id, label: a.name, hint: a.code }));
  const plug = (data.accounts || []).find(a => a.id === plugId);

  const save = async () => {
    setBusy(true); setNotice(null);
    try {
      const r = await client.put('accounting/opening-balances', {
        company_id: companyId,
        as_of: asOf,
        balancing_account_id: plugId,
        // The balancing account fills itself in; a number typed there before it
        // was picked as the balancing account is dropped, not sent.
        balances: Object.entries(amounts).filter(([id]) => id !== plugId)
          .map(([account_id, amount]) => ({ account_id, amount: Number(amount || 0) })),
      });
      await load();
      setNotice({
        type: 'success',
        text: r.data.entry_no
          ? `Saved. Recorded in the books as ${r.data.entry_no}${r.data.reversal_no ? ` (the old version was reversed as ${r.data.reversal_no})` : ''}.`
          : `Opening balances cleared${r.data.reversal_no ? ` (reversed as ${r.data.reversal_no})` : ''}.`,
      });
    } catch (e) {
      setNotice({ type: 'error', text: e.response?.data?.error || 'Could not save the opening balances' });
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <SectionHeader level="page" icon={Landmark} title="Opening balances"
        subtitle={`What ${scope?.company_name || 'the company'} had and owed on the day it started keeping books here. Amounts in ${currency}.`} />
      {notice && <Alert type={notice.type} onDismiss={() => setNotice(null)}>{notice.text}</Alert>}
      {data.entry && (
        <Alert type="info" dismissible={false}>
          In the books as {data.entry.entry_no}, dated {fmtDate(data.entry.entry_date)}.
          {canManage ? ' Change any number and save -- the old entry is reversed and a new one posted, and you will be asked why.' : ''}
        </Alert>
      )}

      <Panel>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="As of" hint="Usually the day before your first real entry here.">
            {canManage
              ? <ThemedDate value={asOf} onChange={e => setAsOf(e.target.value)} />
              : <p className="text-sm m-0" style={{ color: 'var(--color-text)' }}>{fmtDate(asOf)}</p>}
          </Field>
          <Field label="Balancing figure goes to" hint="An equity account. It absorbs whatever makes the two sides equal.">
            {canManage
              ? <SearchSelect value={plugId} onChange={setPlugId} options={equityOptions} placeholder="Search equity accounts..." emptyLabel="Pick an account" />
              : <p className="text-sm m-0" style={{ color: 'var(--color-text)' }}>{plug ? `${plug.code} ${plug.name}` : '--'}</p>}
          </Field>
        </div>
      </Panel>

      {GROUPS.map(g => {
        const rows = visible.filter(a => a.account_type === g.type);
        if (!rows.length) return null;
        return (
          <Panel key={g.type}>
            <SectionHeader title={g.title} subtitle={g.hint}
              actions={<span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>{fmtMoney(totals[g.type] / 100, currency)}</span>} />
            <div className="space-y-1.5">
              {rows.map(a => {
                const isPlug = a.id === plugId;
                return (
                  <div key={a.id} className="flex items-center gap-3 py-1" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <span className="font-mono text-xs w-12 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>{a.code}</span>
                    <span className="text-sm flex-1 min-w-0 truncate" style={{ color: 'var(--color-text)' }}>{a.name}</span>
                    {isPlug ? (
                      <span className="text-sm tabular-nums text-right" style={{ width: 150, color: 'var(--color-text-secondary)' }}
                        title="Worked out for you">
                        {fmtMoney(totals.plug / 100, currency)} <span className="text-[11px]">(balancing)</span>
                      </span>
                    ) : canManage ? (
                      <input className="input text-right tabular-nums" type="number" step="0.01" style={{ width: 150 }}
                        value={amounts[a.id] ?? ''} placeholder="0.00"
                        onChange={e => setAmounts(m => ({ ...m, [a.id]: e.target.value }))} />
                    ) : (
                      <span className="text-sm tabular-nums text-right" style={{ width: 150, color: 'var(--color-text)' }}>
                        {fmtMoney(Number(amounts[a.id] || 0), currency)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </Panel>
        );
      })}

      <Panel>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Has {fmtMoney(totals.asset / 100, currency)} - owes {fmtMoney(totals.liability / 100, currency)}
            {totals.equity ? ` - owners ${fmtMoney(totals.equity / 100, currency)}` : ''} ={' '}
            <strong style={{ color: 'var(--color-text)' }}>{fmtMoney(totals.plug / 100, currency)}</strong>
            {' '}to {plug ? `${plug.code} ${plug.name}` : 'the balancing account'}.
          </div>
          {canManage && (
            <Btn variant="primary" icon={Save} busy={busy} disabled={!plugId || !asOf} className="ml-auto" onClick={save}>
              Save opening balances
            </Btn>
          )}
        </div>
      </Panel>
    </div>
  );
}

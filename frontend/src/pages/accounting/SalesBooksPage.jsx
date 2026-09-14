// ============================================================================
// Accounts -> Sales. CRM sales into the books (mig 317, utils/revenueSync.js).
//
//   Overview    what the books would gain / lose if this ran now, month by
//               month "should be" vs "in the books", the sales that cannot be
//               priced yet, and the two switches. OFF until someone turns it on.
//   Rates       the rate card: what each client pays us per sale, each
//               partner's cut, our own fee as a partner. Effective-dated.
//   Statements  one client's earned sales for a month, as a CSV to send them.
//
// Nothing here writes to the books by itself: switching on asks first and
// names how many entries will be posted.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { Coins, Power, Play, Plus, Trash2, Download, FileSpreadsheet, AlertTriangle, ListChecks, Save } from 'lucide-react';
import client from '../../api/client';
import { Panel, SectionHeader, Loading, EmptyState, Field, Toggle, TableScroll, PillTabs, KpiTile } from '../../components/UI/kit';
import { Alert } from '../../components/UI';
import ThemedSelect from '../../components/UI/Select';
import SearchSelect from '../../components/UI/SearchSelect';
import ThemedDate from '../../components/UI/ThemedDate';
import { Btn } from '../../components/Modules/ModuleUI';
import AskDialog from '../../components/Modules/AskDialog';
import { downloadCSV } from '../../utils/recordFormat';
import { fmtMoney, fmtDate } from '../../utils/money';

const EVENT_WORDS = {
  'sale.earned': 'Sales earned', 'sale.collected': 'Paid by clients',
  'partner.cost': "Partners' cut", 'partner.paid': 'Paid to partners',
  'partner.income': 'Our partner fees', 'partner.received': 'Fees received',
};
const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function SalesBooksPage({ scope }) {
  const companyId = scope?.company_id || null;
  const [tab, setTab] = useState('overview');
  const [data, setData] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = async () => {
    const r = await client.get('accounting/revenue/settings', { params: { company_id: companyId || undefined } });
    setData(r.data);
  };
  useEffect(() => {
    load().catch(e => setNotice({ type: 'error', text: e.response?.data?.error || 'Could not load the sales settings' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  if (!data) return notice ? <Alert type={notice.type}>{notice.text}</Alert> : <Loading variant="cards" cards={3} />;

  return (
    <div className="space-y-4">
      <SectionHeader level="page" icon={Coins} title="Sales into the books"
        subtitle={`CRM sales become revenue, money owed and partner fees for ${scope?.company_name || 'this company'} -- only once you switch it on.`} />
      {notice && <Alert type={notice.type} onDismiss={() => setNotice(null)}>{notice.text}</Alert>}
      <PillTabs items={[
        { key: 'overview', label: 'Overview', icon: ListChecks },
        { key: 'rates', label: 'Rates', icon: Coins },
        { key: 'statements', label: 'Statements', icon: FileSpreadsheet },
      ]} value={tab} onChange={setTab} />
      {tab === 'overview' && <Overview companyId={companyId} data={data} onChanged={load} onNotice={setNotice} goRates={() => setTab('rates')} />}
      {tab === 'rates' && <Rates companyId={companyId} data={data} onChanged={load} onNotice={setNotice} />}
      {tab === 'statements' && <Statements companyId={companyId} data={data} onNotice={setNotice} />}
    </div>
  );
}

// -- Overview -------------------------------------------------------------------------

function Overview({ companyId, data, onChanged, onNotice, goRates }) {
  const [p, setP] = useState(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(null);
  const [form, setForm] = useState({ go_live: data.settings.go_live, recognize_on: data.settings.recognize_on, rate_currency: data.settings.rate_currency });
  const canManage = !!data.can_manage;
  const s = data.settings;

  const loadPreview = async () => {
    const r = await client.get('accounting/revenue/preview', { params: { company_id: companyId || undefined } });
    setP(r.data);
  };
  useEffect(() => {
    loadPreview().catch(e => onNotice({ type: 'error', text: e.response?.data?.error || 'Could not work out the preview' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, data]);

  const saveSettings = async (patch, okText) => {
    setBusy(true); onNotice(null);
    try {
      await client.put('accounting/revenue/settings', { company_id: companyId, ...patch });
      await onChanged();
      onNotice({ type: 'success', text: okText });
      return true;
    } catch (e) {
      onNotice({ type: 'error', text: e.response?.data?.error || 'Could not save' });
      return false;
    } finally { setBusy(false); }
  };

  const toggle = (side, on) => {
    const label = side === 'closer_enabled' ? 'the sales this company closes' : 'the partner fees on sales this company passes on';
    if (!on) {
      setAsking({
        title: 'Stop booking ' + label + '?',
        message: 'Nothing already in the books is undone -- new and changed sales simply stop being booked until you switch it back on.',
        confirmLabel: 'Switch off',
        onConfirm: async () => { if (await saveSettings({ [side]: false }, 'Switched off.')) setAsking(null); },
      });
      return;
    }
    const n = p?.summary?.to_post || 0;
    setAsking({
      title: 'Start booking ' + label + '?',
      message: `The books will be brought in line with the CRM now and every hour after: about ${n} entr${n === 1 ? 'y' : 'ies'} will be posted in the first run`
        + ' (the preview below). Sales that cannot be priced yet are skipped, not guessed. You can switch it off any time.',
      confirmLabel: 'Switch on and run',
      onConfirm: async () => {
        if (await saveSettings({ [side]: true }, 'Switched on. The first run has started -- refresh in a minute to see it.')) {
          await client.post('accounting/revenue/run', { company_id: companyId }).catch(() => {});
          setAsking(null);
        }
      },
    });
  };

  const runNow = async () => {
    setBusy(true); onNotice(null);
    try {
      await client.post('accounting/revenue/run', { company_id: companyId });
      onNotice({ type: 'success', text: 'Started. It runs in the background -- refresh in a minute to see the result.' });
    } catch (e) {
      onNotice({ type: 'error', text: e.response?.data?.error || 'Could not start the run' });
    } finally { setBusy(false); }
  };

  const sm = p?.summary;
  const events = useMemo(() => {
    const seen = new Set();
    for (const m of sm?.months || []) Object.keys(m.events).forEach(e => seen.add(e));
    return Object.keys(EVENT_WORDS).filter(e => seen.has(e));
  }, [sm]);
  const rc = p?.rate_currency || s.rate_currency;
  const problems = sm?.problems || {};
  const blocked = (problems.no_rate?.length || 0) + (problems.no_partner_rate?.length || 0) + (problems.no_fx?.length || 0) + (problems.no_account?.length || 0);

  return (
    <div className="space-y-4">
      <Panel>
        <SectionHeader icon={Power} title="Switches" subtitle={s.last_run_at ? `Last run ${fmtDate(s.last_run_at)}` : 'Never run for this company.'}
          actions={canManage && (s.closer_enabled || s.fronter_enabled) ? <Btn icon={Play} busy={busy} onClick={runNow}>Run now</Btn> : null} />
        <div className="space-y-3">
          <Toggle checked={!!s.closer_enabled} disabled={!canManage || busy} onChange={v => toggle('closer_enabled', v)}
            label="Book the sales this company closes"
            hint="Client revenue when a sale is approved, money in when the DP is paid, and each partner company's cut." />
          <Toggle checked={!!s.fronter_enabled} disabled={!canManage || busy} onChange={v => toggle('fronter_enabled', v)}
            label="Book our partner fees on sales we pass on"
            hint="For a fronter company: the fee the closer company owes us on each of our sales, and the money when it is paid." />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
          <Field label="Start from" hint="Sales before this date are never booked.">
            <ThemedDate value={form.go_live} disabled={!canManage} onChange={e => setForm(f => ({ ...f, go_live: e.target.value }))} />
          </Field>
          <Field label="A sale counts as revenue when">
            <ThemedSelect value={form.recognize_on} disabled={!canManage} onChange={e => setForm(f => ({ ...f, recognize_on: e.target.value }))}>
              <option value="approved">It is approved (or its DP is paid)</option>
              <option value="dp_paid">Only when its DP is paid</option>
            </ThemedSelect>
          </Field>
          <Field label="Rates are in" hint="Converted with Accounts, Settings, Exchange rates.">
            <input className="input w-full uppercase" maxLength={3} disabled={!canManage} value={form.rate_currency}
              onChange={e => setForm(f => ({ ...f, rate_currency: e.target.value.toUpperCase() }))} />
          </Field>
        </div>
        {canManage && (form.go_live !== s.go_live || form.recognize_on !== s.recognize_on || form.rate_currency !== s.rate_currency) && (
          <div className="flex justify-end mt-3">
            <Btn variant="primary" icon={Save} busy={busy} onClick={() => saveSettings(form, 'Saved. The preview below uses the new rules.')}>Save</Btn>
          </div>
        )}
      </Panel>

      {!p ? <Loading variant="cards" cards={2} /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiTile label="Should be in the books" value={sm.should_hold} sub="entries" tone="info" />
            <KpiTile label="In the books now" value={sm.holds} sub="entries" tone="primary" />
            <KpiTile label={s.closer_enabled || s.fronter_enabled ? 'Next run posts' : 'Switching on would post'}
              value={sm.to_post + sm.to_repost} sub={sm.to_repost ? `${sm.to_repost} of them corrected amounts` : 'new entries'} tone={sm.to_post ? 'warning' : 'muted'} />
            <KpiTile label="Would reverse" value={sm.to_reverse} sub="no longer count" tone={sm.to_reverse ? 'error' : 'muted'} />
          </div>

          {blocked > 0 && (
            <Panel>
              <SectionHeader icon={AlertTriangle} title="Cannot be booked yet" subtitle="Nothing is guessed: these sales wait until the missing piece is added, and anything already booked for them stays as it is." />
              <div className="space-y-3 text-sm" style={{ color: 'var(--color-text)' }}>
                {problems.no_fx?.length > 0 && (
                  <p className="m-0"><strong>No {rc} exchange rate</strong> for {problems.no_fx[0]}{problems.no_fx.length > 1 ? ` and ${problems.no_fx.length - 1} more day(s)` : ''}. Add one under Accounts, Settings, Exchange rates (from {problems.no_fx[0]} or earlier).</p>
                )}
                {problems.no_account?.length > 0 && (
                  <p className="m-0"><strong>Missing accounts</strong> for: {problems.no_account.map(e => EVENT_WORDS[e] || e).join(', ')}. Pick them under Accounts, Settings, Money rules (or add the standard accounts in Books).</p>
                )}
                {problems.no_rate?.length > 0 && (
                  <ProblemList title="Clients / plans with no rate" rows={problems.no_rate} action={<Btn size="sm" onClick={goRates}>Add rates</Btn>} />
                )}
                {problems.no_partner_rate?.length > 0 && (
                  <ProblemList title="Partners with no rate" rows={problems.no_partner_rate} action={<Btn size="sm" onClick={goRates}>Add rates</Btn>} />
                )}
              </div>
            </Panel>
          )}

          <Panel pad="none">
            <div className="p-4 pb-0"><SectionHeader title="Month by month" subtitle={`Should be vs in the books, in ${rc}.`} /></div>
            {(sm.months || []).length === 0 ? (
              <div className="p-4"><EmptyState compact icon={Coins} title="Nothing to book yet" hint="Add rates (and an exchange rate) to see what would be booked." /></div>
            ) : (
              <TableScroll stickyFirst>
                <table className="w-full">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <th className="td-p text-[11px] font-bold uppercase tracking-wider text-left" style={{ color: 'var(--color-text-secondary)' }}>Month</th>
                      {events.map(e => (
                        <th key={e} className="td-p text-[11px] font-bold uppercase tracking-wider text-right" style={{ color: 'var(--color-text-secondary)' }}>{EVENT_WORDS[e]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sm.months.map(m => (
                      <tr key={m.month} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td className="td-p text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{m.month}</td>
                        {events.map(e => {
                          const c = m.events[e];
                          const off = c && Math.round(c.should * 100) !== Math.round(c.booked * 100);
                          return (
                            <td key={e} className="td-p text-sm text-right tabular-nums whitespace-nowrap" style={{ color: 'var(--color-text)' }}>
                              {c ? fmtMoney(c.should, rc) : '--'}
                              {c && off && (
                                <span className="block text-[11px]" style={{ color: 'var(--color-warning-600)' }}>in books {fmtMoney(c.booked, rc)}</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </Panel>

          {p.last_run?.done && (
            <p className="text-[11px] m-0" style={{ color: 'var(--color-text-tertiary)' }}>
              Last run: {p.last_run.done.posted} posted, {p.last_run.done.reposted} corrected, {p.last_run.done.reversed} reversed
              {p.last_run.done.failed ? `, ${p.last_run.done.failed} failed (${(p.last_run.done.errors || [])[0] || ''})` : ''}
              {p.last_run.left ? ` -- ${p.last_run.left} left for the next run` : ''}.
            </p>
          )}
        </>
      )}
      {asking && <AskDialog {...asking} onClose={() => setAsking(null)} />}
    </div>
  );
}

function ProblemList({ title, rows, action }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <strong>{title}</strong>
        <span className="ml-auto">{action}</span>
      </div>
      <TableScroll>
        <table className="w-full">
          <tbody>
            {rows.slice(0, 15).map(r => (
              <tr key={r.what} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td className="td-p text-sm" style={{ color: 'var(--color-text)' }}>{r.what}</td>
                <td className="td-p text-sm text-right tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{r.sales} sale{r.sales === 1 ? '' : 's'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      {rows.length > 15 && <p className="text-[11px] m-0 mt-1" style={{ color: 'var(--color-text-tertiary)' }}>and {rows.length - 15} more</p>}
    </div>
  );
}

// -- Rates ----------------------------------------------------------------------------

const blankRate = (kind) => ({ kind, client_name: '', plan: '', partner_company_id: '', basis: 'dp_percent', value: '', effective_from: '2026-06-01', note: '' });

function Rates({ companyId, data, onChanged, onNotice }) {
  const canManage = !!data.can_manage;
  const [asking, setAsking] = useState(null);
  const coName = Object.fromEntries((data.companies || []).map(c => [c.id, c.name]));
  const rc = data.settings.rate_currency;
  const byKind = (k) => (data.rates || []).filter(r => r.kind === k);

  const remove = (r) => setAsking({
    title: 'Remove this rate?',
    message: 'If the sales it priced have no other rate, they stop being booked -- anything already in the books for them stays until they can be priced again.',
    confirmLabel: 'Remove rate', reason: 'required', danger: true,
    onConfirm: async (why) => {
      try {
        await client.delete(`accounting/revenue/rates/${r.id}`, { data: { company_id: companyId, change_reason: why } });
        await onChanged(); setAsking(null);
        onNotice({ type: 'success', text: 'Rate removed.' });
      } catch (e) { onNotice({ type: 'error', text: e.response?.data?.error || 'Could not remove it' }); }
    },
  });

  const describe = (r) => r.basis === 'flat' ? fmtMoney(Number(r.value), rc) + ' per sale' : Number(r.value) + '% of the down payment';

  return (
    <div className="space-y-4">
      <RateSection title="What each client pays us per sale" subtitle="Used for the sales this company closes. A plan-specific line beats a client-wide one; a later start date replaces an earlier one."
        kind="client" rows={byKind('client')} data={data} companyId={companyId} canManage={canManage} onChanged={onChanged} onNotice={onNotice}
        columns={[['Client', r => r.client_name], ['Plan', r => r.plan || 'Every plan'], ['Rate', describe], ['From', r => fmtDate(r.effective_from)]]} onRemove={remove} />
      <RateSection title="Each partner company's cut" subtitle="What we owe a fronter company for a sale it passed to us. Their cut is booked as our cost."
        kind="partner_cost" rows={byKind('partner_cost')} data={data} companyId={companyId} canManage={canManage} onChanged={onChanged} onNotice={onNotice}
        columns={[['Partner', r => coName[r.partner_company_id] || 'A company'], ['Rate', describe], ['From', r => fmtDate(r.effective_from)]]} onRemove={remove} />
      <RateSection title="Our fee as a partner" subtitle="For a fronter company: what the closer company owes us per sale we pass on."
        kind="partner_income" rows={byKind('partner_income')} data={data} companyId={companyId} canManage={canManage} onChanged={onChanged} onNotice={onNotice}
        columns={[['From company', r => r.partner_company_id ? (coName[r.partner_company_id] || 'A company') : 'Any closer company'], ['Rate', describe], ['From', r => fmtDate(r.effective_from)]]} onRemove={remove} />
      {asking && <AskDialog {...asking} onClose={() => setAsking(null)} />}
    </div>
  );
}

function RateSection({ title, subtitle, kind, rows, data, companyId, canManage, onChanged, onNotice, columns, onRemove }) {
  const [form, setForm] = useState(blankRate(kind));
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const rc = data.settings.rate_currency;
  const clientOpts = (data.clients || []).map(c => ({ value: c.name, label: c.name, hint: c.plans.length + ' plans' }));
  const planOpts = ((data.clients || []).find(c => c.name === form.client_name)?.plans || []).map(p => ({ value: p, label: p }));
  const coOpts = (data.companies || []).map(c => ({ value: c.id, label: c.name }));
  const ready = form.value !== '' && Number(form.value) >= 0 && form.effective_from
    && (kind !== 'client' || form.client_name) && (kind !== 'partner_cost' || form.partner_company_id);

  const add = async () => {
    setBusy(true); onNotice(null);
    try {
      await client.post('accounting/revenue/rates', { company_id: companyId, ...form, value: Number(form.value), partner_company_id: form.partner_company_id || null, plan: form.plan || null });
      setForm(blankRate(kind));
      await onChanged();
      onNotice({ type: 'success', text: 'Rate added. The Overview now prices those sales.' });
    } catch (e) {
      onNotice({ type: 'error', text: e.response?.data?.error || 'Could not add the rate' });
    } finally { setBusy(false); }
  };

  return (
    <Panel>
      <SectionHeader title={title} subtitle={subtitle} />
      {canManage && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end mb-4">
          {kind === 'client' && (
            <>
              <Field as="div" label="Client" className="lg:col-span-2">
                <SearchSelect value={form.client_name} onChange={v => { set('client_name', v); set('plan', ''); }} options={clientOpts} placeholder="Search clients..." emptyLabel="Pick a client" />
              </Field>
              <Field as="div" label="Plan (optional)">
                <SearchSelect value={form.plan} onChange={v => set('plan', v)} options={planOpts} placeholder="Every plan" emptyLabel="Every plan" />
              </Field>
            </>
          )}
          {kind !== 'client' && (
            <Field as="div" label={kind === 'partner_cost' ? 'Partner company' : 'Closer company (optional)'} className="lg:col-span-3">
              <SearchSelect value={form.partner_company_id} onChange={v => set('partner_company_id', v)} options={coOpts}
                placeholder="Search companies..." emptyLabel={kind === 'partner_cost' ? 'Pick a company' : 'Any closer company'} />
            </Field>
          )}
          <Field as="div" label="Rate">
            <div className="flex gap-2">
              <input className="input w-24 text-right" type="number" min="0" step="0.01" value={form.value} onChange={e => set('value', e.target.value)}
                placeholder={form.basis === 'flat' ? rc : '%'} aria-label="Rate" />
              <ThemedSelect value={form.basis} onChange={e => set('basis', e.target.value)}>
                <option value="dp_percent">% of DP</option>
                <option value="flat">{rc} flat</option>
              </ThemedSelect>
            </div>
          </Field>
          <Field as="div" label="From"><ThemedDate value={form.effective_from} onChange={e => set('effective_from', e.target.value)} /></Field>
          <Btn variant="primary" icon={Plus} busy={busy} disabled={!ready} onClick={add}>Add rate</Btn>
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState compact icon={Coins} title="No rates yet" hint={canManage ? 'Add the first one above.' : 'Ask the accountant to set these.'} />
      ) : (
        <TableScroll>
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                {[...columns.map(c => c[0]), ''].map((h, i) => (
                  <th key={h + i} className="td-p text-[11px] font-bold uppercase tracking-wider text-left" style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {columns.map(([h, f]) => <td key={h} className="td-p text-sm" style={{ color: 'var(--color-text)' }}>{f(r)}</td>)}
                  <td className="td-p text-right">
                    {canManage && <Btn size="sm" variant="danger" icon={Trash2} onClick={() => onRemove(r)}><span className="sr-only">Remove</span></Btn>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      <p className="text-[11px] m-0 mt-2" style={{ color: 'var(--color-text-tertiary)' }}>
        To change a rate from a date, add a new line with that start date -- earlier sales keep the old rate. Every change is in the change log.
      </p>
    </Panel>
  );
}

// -- Statements ---------------------------------------------------------------------------

function Statements({ companyId, data, onNotice }) {
  const [clientName, setClientName] = useState('');
  const [month, setMonth] = useState(thisMonth());
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const months = useMemo(() => {
    const out = []; const d = new Date();
    for (let i = 0; i < 12; i++) { out.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7)); }
    return out;
  }, []);

  const load = async () => {
    setBusy(true); onNotice(null);
    try {
      const r = await client.get('accounting/revenue/statement', { params: { company_id: companyId || undefined, client: clientName, month } });
      setSt(r.data);
    } catch (e) {
      onNotice({ type: 'error', text: e.response?.data?.error || 'Could not build the statement' });
    } finally { setBusy(false); }
  };
  const csv = () => downloadCSV(
    st.rows.map(r => [r.reference_no || r.sale_id, r.sale_date, r.plan || '', r.down_payment, r.dp_status || '', r.amount ?? '']),
    ['Reference', 'Sale date', 'Plan', 'Down payment', 'DP status', 'Amount (' + st.currency + ')'],
    `statement-${st.client.replace(/[^A-Za-z0-9]+/g, '-')}-${st.month}.csv`,
  );

  return (
    <Panel>
      <SectionHeader icon={FileSpreadsheet} title="Client statement"
        subtitle="Every sale this company closed for one client in a month that counts as earned, priced with the rate card. A document to send -- it books nothing." />
      <div className="flex items-end gap-3 flex-wrap mb-4">
        <Field as="div" label="Client" className="min-w-[220px]">
          <SearchSelect value={clientName} onChange={setClientName} options={(data.clients || []).map(c => ({ value: c.name, label: c.name }))}
            placeholder="Search clients..." emptyLabel="Pick a client" />
        </Field>
        <Field as="div" label="Month">
          <ThemedSelect value={month} onChange={e => setMonth(e.target.value)}>
            {months.map(m => <option key={m} value={m}>{m}</option>)}
          </ThemedSelect>
        </Field>
        <Btn variant="primary" busy={busy} disabled={!clientName} onClick={load}>Show</Btn>
        {st && st.rows.length > 0 && <Btn icon={Download} onClick={csv}>CSV</Btn>}
      </div>
      {st && (st.rows.length === 0 ? (
        <EmptyState compact icon={FileSpreadsheet} title="No earned sales" hint={`Nothing for ${st.client} in ${st.month}.`} />
      ) : (
        <>
          <p className="text-sm m-0 mb-2" style={{ color: 'var(--color-text)' }}>
            {st.rows.length} sale{st.rows.length === 1 ? '' : 's'}, <strong>{fmtMoney(st.total, st.currency)}</strong>
            {st.unpriced ? <span style={{ color: 'var(--color-warning-600)' }}> -- {st.unpriced} without a rate (not in the total)</span> : null}
          </p>
          <TableScroll>
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {['Reference', 'Date', 'Plan', 'Down payment', 'DP status', 'Amount'].map(h => (
                    <th key={h} className="td-p text-[11px] font-bold uppercase tracking-wider text-left" style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {st.rows.map(r => (
                  <tr key={r.sale_id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td className="td-p text-sm font-mono" style={{ color: 'var(--color-text)' }}>{r.reference_no || r.sale_id.slice(0, 8)}</td>
                    <td className="td-p text-sm" style={{ color: 'var(--color-text-secondary)' }}>{fmtDate(r.sale_date)}</td>
                    <td className="td-p text-sm" style={{ color: 'var(--color-text-secondary)' }}>{r.plan || ''}</td>
                    <td className="td-p text-sm tabular-nums" style={{ color: 'var(--color-text)' }}>{fmtMoney(r.down_payment, st.currency)}</td>
                    <td className="td-p text-sm" style={{ color: 'var(--color-text-secondary)' }}>{r.dp_status || ''}</td>
                    <td className="td-p text-sm tabular-nums font-semibold" style={{ color: 'var(--color-text)' }}>{r.amount === null ? '--' : fmtMoney(r.amount, st.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </>
      ))}
    </Panel>
  );
}

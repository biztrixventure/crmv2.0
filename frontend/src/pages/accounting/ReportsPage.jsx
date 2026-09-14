// ============================================================================
// Accounting -> Reports. The three statements, in the company's own currency,
// each downloadable:
//   Profit and loss   money earned vs money spent over a PERIOD
//   Balance sheet     what the company owns and owes on ONE DAY
//   Trial balance     every account's debits and credits -- the accountant's
//                     check that the books add up (the dashboard used to point
//                     people at a trial balance that had no screen)
//
// Numbers come from POSTED entries only. A reversed entry and its reversal both
// count and cancel (mig 315), so correcting a mistake never distorts a period.
// ============================================================================
import { useEffect, useState } from 'react';
import { FileBarChart, Download, Scale, TrendingUp, ListChecks } from 'lucide-react';
import { Panel, SectionHeader, Loading, EmptyState, Field, PillTabs, TableScroll } from '../../components/UI/kit';
import { Alert } from '../../components/UI';
import ThemedSelect from '../../components/UI/Select';
import ThemedDate from '../../components/UI/ThemedDate';
import { Btn } from '../../components/Modules/ModuleUI';
import { useAccountingReports } from '../../hooks/useAccountingReports';
import { fmtMoney, todayISO } from '../../utils/money';
import { auditedCSV } from '../../utils/moduleExport';

const iso = (d) => d.toISOString().slice(0, 10);
const PRESETS = {
  this_month: () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth(), 1)), todayISO()]; },
  last_month: () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)), iso(new Date(n.getFullYear(), n.getMonth(), 0))]; },
  this_year:  () => { const n = new Date(); return [n.getFullYear() + '-01-01', todayISO()]; },
  last_year:  () => { const y = new Date().getFullYear() - 1; return [y + '-01-01', y + '-12-31']; },
};

export default function ReportsPage({ scope }) {
  const companyId = scope?.company_id || null;
  const currency = scope?.currency || 'PKR';
  const { profitLoss, balanceSheet, trialBalance, loading, error, fetchProfitLoss, fetchBalanceSheet, fetchTrialBalance } =
    useAccountingReports(companyId);

  const [tab, setTab] = useState('pl');
  const [preset, setPreset] = useState('this_month');
  const [range, setRange] = useState(PRESETS.this_month());
  const [asOf, setAsOf] = useState(todayISO());
  const [exportError, setExportError] = useState(null);
  // Every report CSV goes through the export log (utils/moduleExport.js).
  const csv = async (rows, headers, filename, filters) => {
    setExportError(null);
    const r = await auditedCSV('accounting_reports', rows, headers, filename, { company_id: companyId, ...filters });
    if (!r.ok) setExportError(r.error);
  };

  useEffect(() => { if (preset !== 'custom') setRange(PRESETS[preset]()); }, [preset]);
  useEffect(() => { if (tab === 'pl') fetchProfitLoss({ date_from: range[0], date_to: range[1] }); }, [tab, range, fetchProfitLoss]);
  useEffect(() => { if (tab === 'bs') fetchBalanceSheet(asOf); }, [tab, asOf, fetchBalanceSheet]);
  useEffect(() => { if (tab === 'tb') fetchTrialBalance(asOf); }, [tab, asOf, fetchTrialBalance]);

  const csvPL = () => {
    if (!profitLoss) return;
    const rows = [
      ...(profitLoss.revenue?.accounts || []).map(a => ['Money earned', a.code, a.name, a.amount]),
      ['Money earned', '', 'Total', profitLoss.revenue?.total],
      ...(profitLoss.expenses?.accounts || []).map(a => ['Money spent', a.code, a.name, a.amount]),
      ['Money spent', '', 'Total', profitLoss.expenses?.total],
      ['Profit', '', 'Net', profitLoss.net_income],
    ];
    csv(rows, ['Section', 'Code', 'Account', 'Amount (' + currency + ')'], `profit-loss-${range[0]}-to-${range[1]}.csv`,
      { report: 'profit_loss', date_from: range[0], date_to: range[1] });
  };
  const csvBS = () => {
    if (!balanceSheet) return;
    const sec = (label, g) => [...(g?.accounts || []).map(a => [label, a.code, a.name, a.amount]), [label, '', 'Total', g?.total]];
    csv([...sec('Owns', balanceSheet.assets), ...sec('Owes', balanceSheet.liabilities), ...sec('Owners', balanceSheet.equity)],
      ['Section', 'Code', 'Account', 'Amount (' + currency + ')'], `balance-sheet-${asOf}.csv`, { report: 'balance_sheet', as_of: asOf });
  };
  const csvTB = () => {
    if (!trialBalance) return;
    csv([...(trialBalance.rows || []).map(r => [r.code, r.name, r.account_type, r.debit, r.credit]),
      ['', 'Total', '', trialBalance.total_debit, trialBalance.total_credit]],
      ['Code', 'Account', 'Type', 'Debit', 'Credit'], `trial-balance-${asOf}.csv`, { report: 'trial_balance', as_of: asOf });
  };

  return (
    <div className="space-y-4">
      <SectionHeader level="page" icon={FileBarChart} title="Reports"
        subtitle={`${scope?.company_name || ''} -- in ${currency}. Built from posted entries only.`} />
      {error && <Alert type="error">{error}</Alert>}
      {exportError && <Alert type="warning" onDismiss={() => setExportError(null)}>{exportError}</Alert>}

      <div className="flex items-end gap-3 flex-wrap">
        <PillTabs value={tab} onChange={setTab} items={[
          { key: 'pl', label: 'Profit and loss', icon: TrendingUp },
          { key: 'bs', label: 'Balance sheet', icon: Scale },
          { key: 'tb', label: 'Trial balance', icon: ListChecks },
        ]} />
        {tab === 'pl' ? (
          <div className="flex items-end gap-2 flex-wrap ml-auto">
            <Field label="Period">
              <ThemedSelect value={preset} onChange={e => setPreset(e.target.value)}>
                <option value="this_month">This month</option>
                <option value="last_month">Last month</option>
                <option value="this_year">This year</option>
                <option value="last_year">Last year</option>
                <option value="custom">Pick dates</option>
              </ThemedSelect>
            </Field>
            {preset === 'custom' && (
              <>
                <Field label="From"><ThemedDate value={range[0]} onChange={e => setRange(r => [e.target.value, r[1]])} /></Field>
                <Field label="To"><ThemedDate value={range[1]} onChange={e => setRange(r => [r[0], e.target.value])} /></Field>
              </>
            )}
            <Btn icon={Download} onClick={csvPL} disabled={!profitLoss}>CSV</Btn>
          </div>
        ) : (
          <div className="flex items-end gap-2 flex-wrap ml-auto">
            <Field label="On"><ThemedDate value={asOf} onChange={e => setAsOf(e.target.value)} /></Field>
            <Btn icon={Download} onClick={tab === 'bs' ? csvBS : csvTB} disabled={tab === 'bs' ? !balanceSheet : !trialBalance}>CSV</Btn>
          </div>
        )}
      </div>

      {loading && <Loading variant="table" rows={6} />}

      {!loading && tab === 'pl' && profitLoss && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Statement title="Money earned" rows={profitLoss.revenue?.accounts} total={profitLoss.revenue?.total} currency={currency} tone="success" />
          <Statement title="Money spent" rows={profitLoss.expenses?.accounts} total={profitLoss.expenses?.total} currency={currency} tone="warning" />
          <Panel className="lg:col-span-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                {Number(profitLoss.net_income) >= 0 ? 'Profit' : 'Loss'} for {profitLoss.period?.date_from} to {profitLoss.period?.date_to}
              </span>
              <span className="text-xl font-bold tabular-nums" style={{ color: Number(profitLoss.net_income) >= 0 ? 'var(--color-success-600)' : 'var(--color-error-600)' }}>
                {fmtMoney(profitLoss.net_income, currency)}
                {profitLoss.margin_pct != null && <span className="text-xs ml-2 font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{profitLoss.margin_pct}% of money earned</span>}
              </span>
            </div>
          </Panel>
        </div>
      )}

      {!loading && tab === 'bs' && balanceSheet && (
        <>
          {!balanceSheet.balanced && (
            <Alert type="warning" dismissible={false}>
              The books are out by {fmtMoney(balanceSheet.difference, currency)} on this day. Open the Trial balance to see which account.
            </Alert>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Statement title="What we own" rows={balanceSheet.assets?.accounts} total={balanceSheet.assets?.total} currency={currency} tone="info" />
            <Statement title="What we owe" rows={balanceSheet.liabilities?.accounts} total={balanceSheet.liabilities?.total} currency={currency} tone="warning" />
            <Statement title="Owners' share" rows={balanceSheet.equity?.accounts} total={balanceSheet.equity?.total} currency={currency} tone="primary" />
          </div>
        </>
      )}

      {!loading && tab === 'tb' && trialBalance && (
        <Panel pad="none">
          {(trialBalance.rows || []).length === 0 ? (
            <div className="p-6"><EmptyState compact icon={ListChecks} title="Nothing posted yet" /></div>
          ) : (
            <TableScroll>
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    {['Code', 'Account', 'Type', 'Debit', 'Credit'].map((h, i) => (
                      <th key={h} className={`td-p text-[11px] font-bold uppercase tracking-wider ${i >= 3 ? 'text-right' : 'text-left'}`}
                        style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trialBalance.rows.map(r => (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td className="td-p text-xs font-mono" style={{ color: 'var(--color-text-secondary)' }}>{r.code}</td>
                      <td className="td-p text-sm" style={{ color: 'var(--color-text)' }}>{r.name}</td>
                      <td className="td-p text-xs capitalize" style={{ color: 'var(--color-text-secondary)' }}>{r.account_type}</td>
                      <td className="td-p text-sm text-right tabular-nums" style={{ color: 'var(--color-text)' }}>{Number(r.debit) ? fmtMoney(r.debit, currency) : ''}</td>
                      <td className="td-p text-sm text-right tabular-nums" style={{ color: 'var(--color-text)' }}>{Number(r.credit) ? fmtMoney(r.credit, currency) : ''}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={3} className="td-p text-xs font-bold uppercase tracking-wider"
                      style={{ color: trialBalance.balanced ? 'var(--color-success-600)' : 'var(--color-error-600)' }}>
                      {trialBalance.balanced ? 'Balanced' : 'NOT balanced'}
                    </td>
                    <td className="td-p text-sm text-right tabular-nums font-bold" style={{ color: 'var(--color-text)' }}>{fmtMoney(trialBalance.total_debit, currency)}</td>
                    <td className="td-p text-sm text-right tabular-nums font-bold" style={{ color: 'var(--color-text)' }}>{fmtMoney(trialBalance.total_credit, currency)}</td>
                  </tr>
                </tbody>
              </table>
            </TableScroll>
          )}
        </Panel>
      )}
    </div>
  );
}

function Statement({ title, rows = [], total, currency, tone }) {
  return (
    <Panel>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-bold uppercase tracking-wider m-0" style={{ color: `var(--color-${tone}-600)` }}>{title}</p>
        <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--color-text)' }}>{fmtMoney(total, currency)}</span>
      </div>
      {(!rows || rows.length === 0) ? (
        <p className="text-xs m-0" style={{ color: 'var(--color-text-tertiary)' }}>Nothing yet.</p>
      ) : (
        <ul className="m-0 p-0 list-none">
          {rows.map(r => (
            <li key={(r.id || r.name) + (r.code || '')} className="flex items-center justify-between py-1 text-sm" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <span style={{ color: 'var(--color-text)' }}>
                {r.code && <span className="font-mono text-xs mr-2" style={{ color: 'var(--color-text-tertiary)' }}>{r.code}</span>}
                {r.name}
              </span>
              <span className="tabular-nums" style={{ color: 'var(--color-text)' }}>{fmtMoney(r.amount, currency)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

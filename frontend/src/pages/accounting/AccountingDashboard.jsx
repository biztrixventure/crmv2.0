// ============================================================================
// Accounting -> Dashboard. The one screen that answers "how are we doing".
//
// Three honesty rules drive the layout:
//
//   1. Nothing is shown until there IS a chart of accounts. Rendering a P&L of
//      zeros against an unconfigured company reads as "we made nothing", which
//      is false -- we simply have not been told anything yet. The empty state
//      offers the one-click seed instead.
//
//   2. The balance sheet reports `balanced` and `difference`. If it does not
//      balance, that is stated at the top in error tone. A finance dashboard
//      that quietly presents a tidy total while the ledger disagrees is worse
//      than one that admits it is out by 12.40.
//
//   3. P&L is a PERIOD (month-to-date, year-to-date). The balance sheet is a
//      POINT IN TIME (as of today). They are laid out apart and labelled,
//      because treating one as the other is the classic way to misread both.
// ============================================================================
import { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp, TrendingDown, Wallet, FileText, Receipt, Scale, AlertTriangle, Sparkles, RefreshCw,
} from 'lucide-react';
import { Panel, SectionHeader, Loading, EmptyState, KpiTile, TableScroll } from '../../components/UI/kit';
import { Alert } from '../../components/UI';
import { useAccountingReports } from '../../hooks/useAccountingReports';
import { useChartOfAccounts } from '../../hooks/useChartOfAccounts';
import { fmtMoney, fmtMoneyShort, fmtDate, todayISO, monthStartISO, DEFAULT_CURRENCY } from '../../utils/money';

export default function AccountingDashboard({ scope }) {
  const companyId = scope?.company_id || null;
  // The company's own currency (mig 295), never a constant. This line read
  // 'USD' and put US$ on every tile, the P&L and the balance sheet of a company
  // that books in rupees.
  const currency = scope?.currency || DEFAULT_CURRENCY;
  const { summary, profitLoss, balanceSheet, loading, error, fetchSummary, fetchProfitLoss, fetchBalanceSheet } =
    useAccountingReports(companyId);
  const { seedDefaults } = useChartOfAccounts(companyId);
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState(null);

  const load = useCallback(async () => {
    const s = await fetchSummary();
    if (s?.ready) {
      await fetchProfitLoss({ date_from: monthStartISO(), date_to: todayISO() });
      await fetchBalanceSheet(todayISO());
    }
  }, [fetchSummary, fetchProfitLoss, fetchBalanceSheet]);

  useEffect(() => { load(); }, [load]);

  const onSeed = async () => {
    setSeeding(true);
    setSeedMsg(null);
    try {
      const r = await seedDefaults();
      setSeedMsg(r.created
        ? `Created ${r.created} starter accounts. Edit them to match how you actually book things.`
        : r.message);
      await load();
    } catch (e) {
      setSeedMsg(e.response?.data?.error || 'Could not seed the chart of accounts.');
    } finally {
      setSeeding(false);
    }
  };

  if (loading && !summary) return <Loading variant="cards" label="Loading the accounting summary" />;

  // No chart of accounts yet -- see rule 1 in the header.
  if (summary && !summary.ready) {
    return (
      <div className="space-y-5">
        <SectionHeader level="page" icon={Scale} title="Accounting"
          subtitle="Nothing has been set up for this company yet" />
        {seedMsg && <Alert type="info" onDismiss={() => setSeedMsg(null)}>{seedMsg}</Alert>}
        <EmptyState
          icon={Sparkles}
          title="This company has no chart of accounts"
          hint="Every report here is built from the ledger, and the ledger needs accounts to post to. Start from a conventional set of 20 -- you can rename, re-code and archive any of them afterwards."
          action={
            <button onClick={onSeed} disabled={seeding}
              className="px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ background: 'var(--color-primary-600)', color: '#fff', opacity: seeding ? 0.6 : 1 }}>
              {seeding ? 'Setting up...' : 'Create a starter chart of accounts'}
            </button>
          }
        />
      </div>
    );
  }

  const mtd = summary?.month_to_date;
  const ytd = summary?.year_to_date;
  const inv = summary?.invoices;
  const exp = summary?.expenses;

  return (
    <div className="space-y-5">
      <SectionHeader level="page" icon={Scale} title="Accounting"
        subtitle={scope?.company_name ? `${scope.company_name} -- as of ${fmtDate(todayISO())}` : `As of ${fmtDate(todayISO())}`}
        actions={
          <button onClick={load} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
            <RefreshCw size={14} /> Refresh
          </button>
        } />

      {error && <Alert type="error">{error}</Alert>}
      {seedMsg && <Alert type="info" onDismiss={() => setSeedMsg(null)}>{seedMsg}</Alert>}

      {/* Rule 2: an out-of-balance sheet says so, loudly, before anything else. */}
      {balanceSheet && balanceSheet.balanced === false && (
        <Alert type="error">
          <strong>The balance sheet does not balance.</strong> Assets minus liabilities and equity leaves{' '}
          {fmtMoney(balanceSheet.difference, currency)} unaccounted for. Check the trial balance in the Journal tab --
          this almost always means an entry was posted to the wrong account type.
        </Alert>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile icon={TrendingUp} label="Revenue (MTD)" tone="success"
          value={fmtMoneyShort(mtd?.revenue, currency)} sub={`Year to date ${fmtMoneyShort(ytd?.revenue, currency)}`} />
        <KpiTile icon={TrendingDown} label="Expenses (MTD)" tone="warning"
          value={fmtMoneyShort(mtd?.expenses, currency)} sub={`Year to date ${fmtMoneyShort(ytd?.expenses, currency)}`} />
        <KpiTile icon={Wallet} label="Net income (MTD)"
          tone={Number(mtd?.net_income) >= 0 ? 'success' : 'error'}
          value={fmtMoneyShort(mtd?.net_income, currency)}
          sub={`Year to date ${fmtMoneyShort(ytd?.net_income, currency)}`} />
        <KpiTile icon={FileText} label="Outstanding invoices" tone={inv?.overdue_count ? 'error' : 'info'}
          value={fmtMoneyShort(inv?.outstanding, currency)}
          sub={inv?.overdue_count ? `${inv.overdue_count} overdue -- ${fmtMoneyShort(inv.overdue_amount, currency)}` : 'Nothing overdue'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Profit and loss -- a PERIOD report. */}
        <Panel>
          <SectionHeader icon={TrendingUp} title="Profit and loss"
            subtitle={profitLoss ? `${fmtDate(profitLoss.period?.date_from)} to ${fmtDate(profitLoss.period?.date_to)}` : 'Month to date'} />
          {!profitLoss ? <Loading variant="rows" rows={4} /> : (
            <>
              <PLGroup title="Revenue" rows={profitLoss.revenue?.accounts} total={profitLoss.revenue?.total} tone="success" currency={currency} />
              <PLGroup title="Expenses" rows={profitLoss.expenses?.accounts} total={profitLoss.expenses?.total} tone="warning" currency={currency} />
              <div className="flex items-center justify-between pt-3 mt-3"
                style={{ borderTop: '2px solid var(--color-border)' }}>
                <span className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>Net income</span>
                <span className="text-base font-bold"
                  style={{ color: Number(profitLoss.net_income) >= 0 ? 'var(--color-success-600)' : 'var(--color-error-600)' }}>
                  {fmtMoney(profitLoss.net_income, currency)}
                </span>
              </div>
              {profitLoss.margin_pct !== null && profitLoss.margin_pct !== undefined && (
                <p className="text-[11px] m-0 mt-1 text-right" style={{ color: 'var(--color-text-secondary)' }}>
                  {profitLoss.margin_pct}% margin
                </p>
              )}
            </>
          )}
        </Panel>

        {/* Balance sheet -- a POINT IN TIME. */}
        <Panel>
          <SectionHeader icon={Scale} title="Balance sheet"
            subtitle={balanceSheet ? `As of ${fmtDate(balanceSheet.as_of)}` : 'Today'}
            actions={balanceSheet && balanceSheet.balanced
              ? <span className="text-[11px] font-semibold" style={{ color: 'var(--color-success-600)' }}>Balanced</span>
              : null} />
          {!balanceSheet ? <Loading variant="rows" rows={4} /> : (
            <>
              <PLGroup title="Assets" rows={balanceSheet.assets?.accounts} total={balanceSheet.assets?.total} tone="info" currency={currency} />
              <PLGroup title="Liabilities" rows={balanceSheet.liabilities?.accounts} total={balanceSheet.liabilities?.total} tone="warning" currency={currency} />
              <PLGroup title="Equity" rows={balanceSheet.equity?.accounts} total={balanceSheet.equity?.total} tone="primary" currency={currency} />
              {balanceSheet.balanced === false && (
                <div className="flex items-center gap-2 mt-3 p-2 rounded-lg"
                  style={{ background: 'var(--color-error-50)', border: '1px solid var(--color-error-200)' }}>
                  <AlertTriangle size={14} style={{ color: 'var(--color-error-600)' }} />
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--color-error-600)' }}>
                    Out by {fmtMoney(balanceSheet.difference, currency)}
                  </span>
                </div>
              )}
            </>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiTile icon={FileText} label="Invoiced (all time)" value={fmtMoneyShort(inv?.invoiced, currency)}
          sub={`${inv?.count || 0} invoices`} tone="info" />
        <KpiTile icon={Wallet} label="Collected" value={fmtMoneyShort(inv?.collected, currency)} tone="success" />
        <KpiTile icon={Receipt} label="Expense claims awaiting approval"
          value={exp?.pending_count || 0} sub={fmtMoneyShort(exp?.pending_amount, currency)}
          tone={exp?.pending_count ? 'warning' : 'muted'} />
      </div>
    </div>
  );
}

// One account-type block: its lines, then its total. Accounts with a zero
// balance are already filtered out server-side -- an untouched account is noise
// in a report, not information.
function PLGroup({ title, rows = [], total, tone = 'primary', currency }) {
  return (
    <div className="mb-4">
      <p className="text-[11px] font-bold uppercase tracking-wider m-0 mb-1.5"
        style={{ color: 'var(--color-text-secondary)' }}>{title}</p>
      {(!rows || rows.length === 0) ? (
        <p className="text-xs m-0 py-1" style={{ color: 'var(--color-text-tertiary)' }}>Nothing posted yet</p>
      ) : (
        <TableScroll>
          <table className="w-full">
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id || `derived-${i}`}>
                  <td className="py-1 text-xs" style={{ color: 'var(--color-text)' }}>
                    {r.code ? <span className="font-mono mr-2" style={{ color: 'var(--color-text-tertiary)' }}>{r.code}</span> : null}
                    {r.name}
                    {r.derived && <span className="ml-1.5 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>(derived)</span>}
                  </td>
                  <td className="py-1 text-xs text-right font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>
                    {fmtMoney(r.amount, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      <div className="flex items-center justify-between pt-1.5 mt-1.5" style={{ borderTop: '1px solid var(--color-border)' }}>
        <span className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Total {title.toLowerCase()}</span>
        <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--color-text)' }}>{fmtMoney(total, currency)}</span>
      </div>
    </div>
  );
}

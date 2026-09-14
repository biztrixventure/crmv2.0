// ============================================================================
// CompaniesOverview -- every company the viewer can reach, one row each, in
// HR or Accounts (stage 7). What a superadmin sees before choosing a company,
// and the "all your companies" panel on Home for anyone in more than one.
// Click a company to open the module for it.
//
// Money is shown in each company's own currency and never totalled across
// companies: rupees and dollars do not add up.
// Reads GET /hr/overview or /accounting/overview.
// ============================================================================
import { useEffect, useState } from 'react';
import { Building2, ArrowRight } from 'lucide-react';
import client from '../../api/client';
import { Panel, SectionHeader, Loading, TableScroll } from '../UI/kit';
import { Btn } from './ModuleUI';
import { fmtMoneyShort, fmtDate } from '../../utils/money';

const HR_COLUMNS = [
  ['People', r => r.active],
  ['Last shift', r => r.last_shift?.day
    ? `${(r.last_shift.counts.present || 0) + (r.last_shift.counts.late || 0) + (r.last_shift.counts.half_day || 0)} worked, ${r.last_shift.counts.absent || 0} absent`
    : '--', r => r.last_shift?.day ? fmtDate(r.last_shift.day) : null],
  ['Waiting', r => {
    const bits = [];
    if (r.open_exits) bits.push(`${r.open_exits} leaver${r.open_exits === 1 ? '' : 's'}`);
    if (r.pending_leave) bits.push(`${r.pending_leave} leave`);
    if (r.payroll_open) bits.push(`${r.payroll_open} payroll open`);
    if (r.payroll_unpaid) bits.push(`${r.payroll_unpaid} salaries unpaid`);
    return bits.join(', ') || 'Nothing';
  }],
];

const ACC_COLUMNS = [
  ['Money in (month)', r => r.has_books ? fmtMoneyShort(r.revenue_mtd, r.currency) : 'No books yet'],
  ['Money out (month)', r => r.has_books ? fmtMoneyShort(r.expenses_mtd, r.currency) : ''],
  ['Profit (month)', r => r.has_books ? fmtMoneyShort(r.profit_mtd, r.currency) : '', null, r => Number(r.profit_mtd) < 0],
  ['Cash', r => r.has_books ? fmtMoneyShort(r.cash, r.currency) : ''],
  ['Owed to us', r => r.has_books ? fmtMoneyShort(r.owed_to_us, r.currency) : ''],
  ['Waiting', r => {
    const bits = [];
    if (r.claims_waiting) bits.push(`${r.claims_waiting} claim${r.claims_waiting === 1 ? '' : 's'}`);
    if (r.invoices_overdue) bits.push(`${r.invoices_overdue} overdue`);
    return bits.join(', ') || 'Nothing';
  }],
];

export default function CompaniesOverview({ module, onOpen, currentId }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    client.get(`${module}/overview`)
      .then(r => { if (alive) setRows(r.data.companies || []); })
      .catch(e => { if (alive) setError(e.response?.data?.error || 'Could not load the companies'); });
    return () => { alive = false; };
  }, [module]);

  const columns = module === 'hr' ? HR_COLUMNS : ACC_COLUMNS;
  if (error) return null;
  if (!rows) return <Loading variant="table" rows={4} />;
  if (rows.length < 2) return null;

  return (
    <Panel pad="none">
      <div className="p-4 pb-0">
        <SectionHeader icon={Building2} title="All your companies"
          subtitle={module === 'hr' ? 'People and what is waiting, company by company.' : 'This month and today, each in its own currency. Click one to open it.'} />
      </div>
      <TableScroll stickyFirst>
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              {['Company', ...columns.map(c => c[0]), ''].map((h, i) => (
                <th key={h + i} className="td-p text-[11px] font-bold uppercase tracking-wider text-left" style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.company_id} style={{ borderBottom: '1px solid var(--color-border)', background: r.company_id === currentId ? 'color-mix(in srgb, var(--color-primary-600) 6%, transparent)' : undefined }}>
                <td className="td-p text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{r.name}</td>
                {columns.map(([h, val, sub, bad]) => (
                  <td key={h} className="td-p text-sm whitespace-nowrap tabular-nums" style={{ color: bad?.(r) ? 'var(--color-error-600)' : 'var(--color-text)' }}>
                    {val(r)}
                    {sub?.(r) && <span className="block text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{sub(r)}</span>}
                  </td>
                ))}
                <td className="td-p text-right">
                  {r.company_id !== currentId && <Btn size="sm" icon={ArrowRight} onClick={() => onOpen?.(r.company_id)}>Open</Btn>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </Panel>
  );
}

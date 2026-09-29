import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, Search, DollarSign } from 'lucide-react';
import client from '../../api/client';
import { Panel, PillTabs, TableScroll, Loading, EmptyState, accent } from '../UI/kit';

// ============================================================================
// ReportAccessPanel -- who can open Company Reports today, which companies, and
// who sees the payment amounts. Superadmin only (the endpoint enforces it).
// Every answer comes from utils/companyReport.effectiveAccess on the server,
// the same rule the reports themselves obey. To change one person: User
// Control Center -> that person -> Reports.
// ============================================================================
const SOURCE = { person: 'set for them', role: 'role', estate: 'compliance', none: '—' };

function Pill({ tone, children }) {
  const a = accent(tone);
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap"
      style={{ background: a.soft, color: a.fg }}>{children}</span>
  );
}

export default function ReportAccessPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('can');
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    client.get('company-reports/access')
      .then(r => { if (alive) setData(r.data); })
      .catch(e => { if (alive) setError(e?.response?.data?.error || 'Could not load who can see the reports.'); });
    return () => { alive = false; };
  }, []);

  const people = useMemo(() => data?.people || [], [data]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return people.filter(p => {
      if (filter === 'can' && !p.can_view) return false;
      if (filter === 'money' && !(p.can_view && p.amounts)) return false;
      if (filter === 'nomoney' && !(p.can_view && !p.amounts)) return false;
      if (filter === 'off' && p.can_view) return false;
      if (!needle) return true;
      return String(p.name).toLowerCase().includes(needle)
        || p.roles.some(r => String(r.company || '').toLowerCase().includes(needle) || String(r.level || '').includes(needle));
    });
  }, [people, filter, q]);

  if (error) return <Panel tone="surface" pad="sm" className="text-sm" style={{ color: accent('danger').fg }}>{error}</Panel>;
  if (!data) return <Loading variant="rows" rows={6} />;

  const can = people.filter(p => p.can_view);
  const withMoney = can.filter(p => p.amounts);

  return (
    <div className="space-y-4">
      <Panel tone="surface" pad="md" className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <span className="inline-flex items-center gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
          <ShieldCheck size={16} style={{ color: accent('primary').fg }} />
          <b>{can.length}</b> people can open Company Reports
        </span>
        <span className="inline-flex items-center gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
          <DollarSign size={16} style={{ color: accent('success').fg }} />
          <b>{withMoney.length}</b> of them see payment amounts
        </span>
        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          Superadmins always see everything and are not listed. Change a person in User Control Center → their name → Reports.
        </span>
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <PillTabs value={filter} onChange={setFilter} items={[
          { key: 'can', label: `Can open (${can.length})` },
          { key: 'money', label: `See amounts (${withMoney.length})` },
          { key: 'nomoney', label: `Counts only (${can.length - withMoney.length})` },
          { key: 'off', label: `Switched off (${people.length - can.length})` },
        ]} />
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Name, company or role" className="input pl-8 w-56 text-sm" />
        </div>
      </div>

      {rows.length === 0 ? <EmptyState icon={ShieldCheck} title="Nobody here" /> : (
        <Panel tone="surface" pad="none" className="overflow-hidden">
          <TableScroll stickyFirst label="Who can see Company Reports">
            <table className="w-full text-sm">
              <thead style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
                <tr>
                  {['Person', 'Role', 'Can open', 'Companies', 'Payment amounts'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(p => (
                  <tr key={p.user_id} style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}>
                    <td className="px-3 py-2 font-semibold whitespace-nowrap">{p.name}</td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                      {p.roles.map(r => `${(r.level || '').replace(/_/g, ' ')} · ${r.company || '?'}`).join(', ') || '—'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {p.can_view ? <Pill tone="success">Yes</Pill> : <Pill tone="danger">No</Pill>}
                      <span className="ml-1.5 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{SOURCE[p.view_source]}</span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {!p.can_view ? '—' : p.companies === 'all' ? <b>Every company</b> : p.companies.map(c => c.name).join(', ')}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {!p.can_view ? '—' : p.amounts === true ? <Pill tone="success">Shown</Pill> : p.amounts === 'some' ? <Pill tone="warn">Some companies</Pill> : <Pill tone="muted">Hidden</Pill>}
                      {p.can_view && <span className="ml-1.5 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{p.amounts_source === 'person' ? 'set for them' : 'role'}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
      )}
    </div>
  );
}

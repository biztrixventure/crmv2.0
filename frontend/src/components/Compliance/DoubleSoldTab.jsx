import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { AlertTriangle, Download, RefreshCw, Loader2, Search, ChevronDown, ChevronRight, ArrowUp, ArrowDown } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';

// Duplicate-sold report: every customer NUMBER (customer_uuid) with >= 2 real
// sales. Surfaces the whole picture — the same number sold repeatedly (even in
// ONE company), tied to DIFFERENT client names, worked by DIFFERENT closers, or
// sold across companies. Columns sort on header click; signal chips filter.
const fmtDate = (s) => { try { return s ? new Date(s).toLocaleDateString() : ''; } catch { return ''; } };
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const money = (v) => (v == null || v === '' ? '' : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

const STATUS_TINT = {
  closed_won: { bg: '#d1fae5', c: '#047857', label: 'Approved' },
  pending_review: { bg: '#dbeafe', c: '#1d4ed8', label: 'In Review' },
  cancelled: { bg: '#fee2e2', c: '#b91c1c', label: 'Cancelled' },
};
const StatusTag = ({ s }) => {
  const t = STATUS_TINT[s] || { bg: '#f3f4f6', c: '#6b7280', label: s };
  return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: t.bg, color: t.c }}>{t.label}</span>;
};

// Signal chips → predicate over a group row.
const SIGNALS = [
  { key: 'all', label: 'All duplicates', test: () => true },
  { key: 'cross_company', label: 'Cross-company', test: g => g.company_count >= 2 },
  { key: 'diff_clients', label: 'Different clients', test: g => g.client_count >= 2 },
  { key: 'diff_closers', label: 'Different closers', test: g => g.closer_count >= 2 },
  { key: 'same_ref', label: 'Same ref#, many sales', test: g => g.reference_count >= 1 && g.reference_count < g.sale_count },
  { key: 'has_cancelled', label: 'Has cancelled', test: g => g.cancelled_count >= 1 },
];

const COLS = [
  { key: 'customer_name', label: 'Customer', align: 'left', get: g => (g.customer_name || '').toLowerCase() },
  { key: 'phone', label: 'Phone', align: 'left', get: g => g.phone || '' },
  { key: 'sale_count', label: 'Sales', align: 'center', get: g => g.sale_count },
  { key: 'active_sale_count', label: 'Live', align: 'center', get: g => g.active_sale_count },
  { key: 'cancelled_count', label: 'Cxl', align: 'center', get: g => g.cancelled_count },
  { key: 'company_count', label: 'Cos', align: 'center', get: g => g.company_count },
  { key: 'closer_count', label: 'Closers', align: 'center', get: g => g.closer_count },
  { key: 'client_count', label: 'Clients', align: 'center', get: g => g.client_count },
  { key: 'reference_count', label: 'Ref#s', align: 'center', get: g => g.reference_count },
  { key: 'last_sale_at', label: 'Last', align: 'left', get: g => g.last_sale_at || '' },
];

export default function DoubleSoldTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [signal, setSignal] = useState('all');
  const [sort, setSort] = useState({ col: 'sale_count', dir: 'desc' });
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await client.get('compliance/duplicate-sold');
      setRows(r.data.customers || []);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not load duplicate-sold report');
      setRows([]);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggleSort = (col) => setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: col === 'customer_name' || col === 'phone' ? 'asc' : 'desc' });

  const view = useMemo(() => {
    const term = q.trim().toLowerCase();
    const sig = SIGNALS.find(s => s.key === signal) || SIGNALS[0];
    let out = rows.filter(sig.test);
    if (term) out = out.filter(g =>
      (g.customer_name || '').toLowerCase().includes(term) ||
      (g.phone || '').includes(term) ||
      (g.companies || []).some(n => String(n).toLowerCase().includes(term)) ||
      (g.closers || []).some(n => String(n).toLowerCase().includes(term)) ||
      (g.clients || []).some(n => String(n).toLowerCase().includes(term)) ||
      (g.references || []).some(n => String(n).toLowerCase().includes(term)));
    const col = COLS.find(c => c.key === sort.col) || COLS[2];
    out = [...out].sort((a, b) => {
      const va = col.get(a), vb = col.get(b);
      const cmp = (typeof va === 'number' && typeof vb === 'number') ? va - vb : String(va ?? '').localeCompare(String(vb ?? ''));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return out;
  }, [rows, q, signal, sort]);

  // headline counts (correct — computed from the full set, not the page)
  const stats = useMemo(() => ({
    customers: rows.length,
    sales: rows.reduce((s, g) => s + g.sale_count, 0),
    crossCompany: rows.filter(g => g.company_count >= 2).length,
    diffClients: rows.filter(g => g.client_count >= 2).length,
    diffClosers: rows.filter(g => g.closer_count >= 2).length,
  }), [rows]);

  const exportCsv = () => {
    const headers = ['Customer', 'Phone', 'Total Sales', 'Live', 'Cancelled', 'Companies', 'Closers', 'Clients', 'Ref#s', 'Company Names', 'Closer Names', 'Client Names', 'First', 'Last'];
    const lines = [headers.join(',')];
    view.forEach(g => lines.push([
      g.customer_name, g.phone, g.sale_count, g.active_sale_count, g.cancelled_count,
      g.company_count, g.closer_count, g.client_count, g.reference_count,
      (g.companies || []).join(' | '), (g.closers || []).join(' | '), (g.clients || []).join(' | '),
      fmtDate(g.first_sale_at), fmtDate(g.last_sale_at),
    ].map(csvCell).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `duplicate-sold-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const card = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12 };
  const Stat = ({ label, value, tint }) => (
    <div className="px-3 py-2 rounded-lg" style={{ ...card, minWidth: 92 }}>
      <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>{label}</div>
      <div className="text-lg font-extrabold tabular-nums" style={{ color: tint || 'var(--color-text)' }}>{value}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-3 rounded-lg" style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid var(--color-border)' }}>
        <AlertTriangle size={18} style={{ color: '#F59E0B', marginTop: 2, flexShrink: 0 }} />
        <div className="text-sm" style={{ color: 'var(--color-text)' }}>
          <strong>Duplicate sold.</strong> Every customer number with <strong>two or more real sales</strong> — matched by
          customer identity (normalized phone). Watch for the same number sold repeatedly, tied to <strong>different clients</strong>,
          worked by <strong>different closers</strong>, or sold across companies. Click a row to see every sale; click a column to sort.
        </div>
      </div>

      {/* headline stats — the correct totals */}
      <div className="flex flex-wrap gap-2">
        <Stat label="Numbers" value={stats.customers} />
        <Stat label="Total sales" value={stats.sales} tint="#b45309" />
        <Stat label="Cross-company" value={stats.crossCompany} tint="#dc2626" />
        <Stat label="Diff. clients" value={stats.diffClients} tint="#7c3aed" />
        <Stat label="Diff. closers" value={stats.diffClosers} tint="#2563eb" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--color-text-muted)' }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, phone, company, closer, client, ref#…"
            className="w-full pl-8 pr-3 py-2 text-sm rounded-lg"
            style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
        </div>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg" style={card} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
        <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg" style={card} disabled={!view.length}>
          <Download size={14} /> Export CSV
        </button>
      </div>

      {/* signal filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {SIGNALS.map(s => {
          const n = rows.filter(s.test).length;
          const on = signal === s.key;
          return (
            <button key={s.key} onClick={() => setSignal(s.key)}
              className="text-xs font-semibold px-2.5 py-1 rounded-full inline-flex items-center gap-1.5"
              style={on ? { background: 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))', color: '#fff' } : { background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
              {s.label}<span className="text-[10px] px-1.5 rounded-full" style={{ background: on ? 'rgba(255,255,255,0.25)' : 'var(--color-bg)', color: on ? '#fff' : 'var(--color-text-tertiary)' }}>{n}</span>
            </button>
          );
        })}
        <span className="text-xs px-2 py-1" style={{ color: 'var(--color-text-muted)' }}>{loading ? 'Loading…' : `${view.length} shown`}</span>
      </div>

      <div className="overflow-x-auto" style={card}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-muted)' }}>
              <th className="w-8" />
              {COLS.map(c => (
                <th key={c.key} onClick={() => toggleSort(c.key)}
                  className={`px-3 py-2 font-semibold cursor-pointer select-none whitespace-nowrap text-${c.align === 'center' ? 'center' : 'left'}`}>
                  <span className="inline-flex items-center gap-1">{c.label}
                    {sort.col === c.key && (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={COLS.length + 1} className="px-3 py-8 text-center"><Loader2 className="inline animate-spin" size={18} /></td></tr>
            ) : view.length === 0 ? (
              <tr><td colSpan={COLS.length + 1} className="px-3 py-8 text-center" style={{ color: 'var(--color-text-muted)' }}>No duplicate sales found.</td></tr>
            ) : view.map(g => {
              const open = expanded === g.customer_uuid;
              const num = (v, warn) => <span className="tabular-nums font-semibold" style={{ color: warn ? '#dc2626' : 'var(--color-text)' }}>{v}</span>;
              return (
                <Fragment key={g.customer_uuid}>
                  <tr onClick={() => setExpanded(open ? null : g.customer_uuid)}
                    className="cursor-pointer" style={{ borderTop: '1px solid var(--color-border)', background: open ? 'var(--color-bg-secondary)' : 'transparent' }}>
                    <td className="px-2 text-center" style={{ color: 'var(--color-text-tertiary)' }}>{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                    <td className="px-3 py-2" style={{ color: 'var(--color-text)' }}>{g.customer_name || '—'}</td>
                    <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{g.phone || '—'}</td>
                    <td className="px-3 py-2 text-center">
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold" style={{ background: '#f59e0b22', color: '#b45309' }}>{g.sale_count}</span>
                    </td>
                    <td className="px-3 py-2 text-center">{num(g.active_sale_count)}</td>
                    <td className="px-3 py-2 text-center">{g.cancelled_count ? num(g.cancelled_count, true) : <span style={{ color: 'var(--color-text-tertiary)' }}>0</span>}</td>
                    <td className="px-3 py-2 text-center">{num(g.company_count, g.company_count >= 2)}</td>
                    <td className="px-3 py-2 text-center">{num(g.closer_count, g.closer_count >= 2)}</td>
                    <td className="px-3 py-2 text-center">{num(g.client_count, g.client_count >= 2)}</td>
                    <td className="px-3 py-2 text-center">{num(g.reference_count)}</td>
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap" style={{ color: 'var(--color-text-muted)' }}>{fmtDate(g.last_sale_at)}</td>
                  </tr>
                  {open && (
                    <tr style={{ background: 'var(--color-bg-secondary)' }}>
                      <td colSpan={COLS.length + 1} className="px-4 py-3">
                        <div className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                          {g.sales?.length || 0} sales on {g.phone || 'this number'}
                        </div>
                        <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--color-border)' }}>
                          <table className="w-full text-xs">
                            <thead>
                              <tr style={{ background: 'var(--color-surface)', color: 'var(--color-text-tertiary)' }}>
                                {['Status', 'Company', 'Closer', 'Client', 'Ref#', 'Monthly', 'Sale date'].map(h => <th key={h} className="text-left px-3 py-1.5 font-semibold whitespace-nowrap">{h}</th>)}
                              </tr>
                            </thead>
                            <tbody>
                              {(g.sales || []).map(s => (
                                <tr key={s.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                                  <td className="px-3 py-1.5"><StatusTag s={s.status} /></td>
                                  <td className="px-3 py-1.5" style={{ color: 'var(--color-text)' }}>{s.company || '—'}</td>
                                  <td className="px-3 py-1.5" style={{ color: 'var(--color-text)' }}>{s.closer || '—'}</td>
                                  <td className="px-3 py-1.5" style={{ color: 'var(--color-text)' }}>{s.client_name || '—'}</td>
                                  <td className="px-3 py-1.5 font-mono" style={{ color: 'var(--color-text-secondary)' }}>{s.reference_no || '—'}</td>
                                  <td className="px-3 py-1.5 tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{money(s.monthly_payment) || '—'}</td>
                                  <td className="px-3 py-1.5 tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{s.sale_date ? fmtDate(s.sale_date) : fmtDate(s.created_at)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

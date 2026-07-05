import { useState, useEffect, useCallback, useMemo } from 'react';
import { AlertTriangle, Download, RefreshCw, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';

// Cross-closer double-sell report (issue #6): customers whose lead was closed_won
// by >= 2 distinct closer companies — a resold-lead / double-dip fraud signal.
// Source of truth for compliance; fronters get a lighter count-only badge.
const fmtDate = (s) => { try { return s ? new Date(s).toLocaleDateString() : ''; } catch { return ''; } };
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export default function DoubleSoldTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await client.get('compliance/double-sold');
      setRows(r.data.customers || []);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not load double-sold report');
      setRows([]);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(r =>
      (r.customer_name || '').toLowerCase().includes(term) ||
      (r.phone || '').includes(term) ||
      (r.closer_companies || []).some(n => String(n).toLowerCase().includes(term)));
  }, [rows, q]);

  const exportCsv = () => {
    const headers = ['Customer', 'Phone', '# Closer Companies', 'Closer Companies', 'Total Sales', 'First Sale', 'Last Sale'];
    const lines = [headers.join(',')];
    filtered.forEach(r => lines.push([
      r.customer_name, r.phone, r.closer_company_count,
      (r.closer_companies || []).join(' | '), r.sale_count, fmtDate(r.first_sale_at), fmtDate(r.last_sale_at),
    ].map(csvCell).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `double-sold-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const card = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12 };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-3 rounded-lg" style={{ background: 'var(--color-warning-bg, rgba(245,158,11,0.10))', border: '1px solid var(--color-border)' }}>
        <AlertTriangle size={18} style={{ color: '#F59E0B', marginTop: 2, flexShrink: 0 }} />
        <div className="text-sm" style={{ color: 'var(--color-text)' }}>
          <strong>Cross-closer double-selling.</strong> Customers whose lead was closed
          (<code>closed_won</code>) by <strong>two or more different closer companies</strong> —
          a resold-lead / double-dip fraud signal. Matched by customer identity (normalized phone).
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--color-text-muted)' }} />
          <input
            value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, phone, or company…"
            className="w-full pl-8 pr-3 py-2 text-sm rounded-lg"
            style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          />
        </div>
        <span className="text-sm px-2" style={{ color: 'var(--color-text-muted)' }}>
          {loading ? 'Loading…' : `${filtered.length} customer${filtered.length === 1 ? '' : 's'}`}
        </span>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg" style={card} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
        <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg" style={card} disabled={!filtered.length}>
          <Download size={14} /> Export CSV
        </button>
      </div>

      <div className="overflow-x-auto" style={card}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-muted)' }}>
              <th className="text-left px-3 py-2 font-medium">Customer</th>
              <th className="text-left px-3 py-2 font-medium">Phone</th>
              <th className="text-center px-3 py-2 font-medium">Closers</th>
              <th className="text-left px-3 py-2 font-medium">Closer Companies</th>
              <th className="text-center px-3 py-2 font-medium">Sales</th>
              <th className="text-left px-3 py-2 font-medium">First</th>
              <th className="text-left px-3 py-2 font-medium">Last</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center"><Loader2 className="inline animate-spin" size={18} /></td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center" style={{ color: 'var(--color-text-muted)' }}>No cross-closer double-sells found.</td></tr>
            ) : filtered.map(r => (
              <tr key={r.customer_uuid} style={{ borderTop: '1px solid var(--color-border)' }}>
                <td className="px-3 py-2" style={{ color: 'var(--color-text)' }}>{r.customer_name || '—'}</td>
                <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{r.phone || '—'}</td>
                <td className="px-3 py-2 text-center">
                  <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: 'rgba(239,68,68,0.15)', color: '#EF4444' }}>{r.closer_company_count}</span>
                </td>
                <td className="px-3 py-2" style={{ color: 'var(--color-text)' }}>{(r.closer_companies || []).join(', ')}</td>
                <td className="px-3 py-2 text-center tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{r.sale_count}</td>
                <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{fmtDate(r.first_sale_at)}</td>
                <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{fmtDate(r.last_sale_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

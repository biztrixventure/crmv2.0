import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, Loader2, FileSpreadsheet, DollarSign, Send, PhoneCall, Users } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import { saleExportColumns, saleToRow } from '../Admin/BulkSaleUploader/saleColumnMapping';
import ThemedSelect from '../UI/Select';
import ThemedDate from '../UI/ThemedDate';
import { useAuth } from '../../contexts/AuthContext';

// CSV download (client-side, no row cap).
function downloadCSV(rows, headers, filename) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map(r => r.map(esc).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

const SALE_STATUS = [['','All'],['open','Open'],['pending_review','In Review'],['needs_revision','Needs Revision'],['closed_won','Approved'],['closed_lost','Lost'],['cancelled','Cancelled'],['follow_up','Follow Up']];
const XFER_STATUS = [['','All'],['pending','Pending'],['assigned','Assigned'],['completed','Completed'],['rejected','Rejected'],['cancelled','Cancelled']];

const TYPES = [
  { key: 'sales',     label: 'Sales',     icon: DollarSign, date: true,  status: SALE_STATUS, agent: true  },
  { key: 'transfers', label: 'Transfers', icon: Send,       date: true,  status: XFER_STATUS, agent: true  },
  { key: 'callbacks', label: 'Callbacks', icon: PhoneCall,  date: true,  status: null,        agent: false },
  { key: 'users',     label: 'Users',     icon: Users,      date: false, status: null,        agent: false },
];

const fmtD  = (d) => d ? new Date(d).toLocaleDateString() : '';
const fmtDT = (d) => d ? new Date(d).toLocaleString() : '';

// Page through an endpoint in batches until every matching record is collected
// (PostgREST caps each response near 1000 rows, so a single big limit isn't enough).
async function fetchAll(endpoint, baseParams, key, pageSize = 1000) {
  let page = 1; const all = [];
  for (;;) {
    const r = await client.get(endpoint, { params: { ...baseParams, page, limit: pageSize } });
    const batch = r.data[key] || [];
    all.push(...batch);
    if (batch.length < pageSize || page >= 200) break;
    page++;
  }
  return all;
}

const ManagerExportModal = ({ onClose, agents = [] }) => {
  const { canExport } = useAuth();
  const [type, setType] = useState('sales');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [status, setStatus] = useState('');
  const [agent, setAgent] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [busy, setBusy] = useState(false);

  const cfg = TYPES.find(t => t.key === type);
  const today = new Date().toISOString().slice(0, 10);

  const run = async () => {
    setBusy(true);
    try {
      const dateParams = cfg.date ? { ...(dateFrom && { date_from: dateFrom }), ...(dateTo && { date_to: dateTo }) } : {};
      let rows = [], headers = [], data = [];

      if (type === 'sales') {
        // Headers + per-row values are derived from the same schema the bulk
        // sale uploader expects, so an exported file round-trips through the
        // uploader without manual header re-mapping. snake_case keys = bulk-
        // upload field keys = export headers.
        const [salesData, ffRes] = await Promise.all([
          fetchAll('sales', { ...dateParams, ...(status && { status }), ...(agent && { user_id: agent }) }, 'sales'),
          client.get('forms/fields').catch(() => ({ data: { fields: [] } })),
        ]);
        data = salesData;
        const cols = saleExportColumns(ffRes.data.fields || []);
        headers = cols.map(c => c.key);
        rows = data.map(s => saleToRow(s, cols));
      } else if (type === 'transfers') {
        data = await fetchAll('transfers', { ...dateParams, ...(status && { status }), ...(agent && { user_id: agent }) }, 'transfers');
        headers = ['Customer','Phone','Transfer Status','Fronter','Closer','Sale Ref','Created'];
        rows = data.map(t => {
          const fd = t.form_data || {};
          const name = fd.customer_name || (fd.FirstName ? `${fd.FirstName} ${fd.LastName || ''}`.trim() : '') || '';
          const phone = fd.customer_phone || fd.Phone || '';
          return [name, phone, t.status || '', t.created_by_name || '', t.assigned_closer_name || '', t.sale_reference_no || '', fmtD(t.created_at)];
        });
      } else if (type === 'callbacks') {
        data = await fetchAll('callbacks', { ...dateParams }, 'callbacks', 200);
        headers = ['Customer','Phone','Scheduled At','Status','Priority','Notes','Agent','Created'];
        rows = data.map(c => [
          c.customer_name || '', c.customer_phone || '', fmtDT(c.callback_at), c.status || '',
          c.priority || '', c.notes || '', c.user_name || '', fmtD(c.created_at),
        ]);
      } else {
        data = await fetchAll('users', { ...(includeInactive && { include_inactive: true }) }, 'users');
        headers = ['Name','Email','Role','Status','Joined'];
        rows = data.map(u => [
          `${u.first_name || ''} ${u.last_name || ''}`.trim(), u.email || '', u.role || '',
          u.is_active ? 'Active' : 'Inactive', fmtD(u.created_at),
        ]);
      }

      if (!rows.length) { toast.warning('No records match these filters.'); return; }
      downloadCSV(rows, headers, `${type}_export_${today}.csv`);
      toast.success(`Exported ${rows.length.toLocaleString()} ${type}.`);
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Export failed.');
    } finally { setBusy(false); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[2147483647] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(2px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="w-full max-w-lg rounded-2xl overflow-hidden flex flex-col"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ background: 'var(--gradient-sidebar)' }}>
          <span className="flex items-center gap-2 font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>
            <FileSpreadsheet size={18} /> Export Data
          </span>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30"><X size={18} className="text-white" /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Data type */}
          <div className="grid grid-cols-4 gap-2">
            {TYPES.map(t => (
              <button key={t.key} onClick={() => { setType(t.key); setStatus(''); setAgent(''); }}
                className="flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs font-semibold transition-colors"
                style={{
                  background: type === t.key ? 'var(--gradient-sidebar)' : 'var(--color-bg-secondary)',
                  color:      type === t.key ? '#fff' : 'var(--color-text-secondary)',
                  border: '1px solid var(--color-border)',
                }}>
                <t.icon size={17} />{t.label}
              </button>
            ))}
          </div>

          {/* Date range */}
          {cfg.date && (
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>
                From
                <ThemedDate value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input mt-1" />
              </label>
              <label className="text-xs font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>
                To
                <ThemedDate value={dateTo} onChange={e => setDateTo(e.target.value)} className="input mt-1" />
              </label>
            </div>
          )}

          {/* Status */}
          {cfg.status && (
            <label className="block text-xs font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>
              Status
              <ThemedSelect value={status} onChange={e => setStatus(e.target.value)} className="input mt-1">
                {cfg.status.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </ThemedSelect>
            </label>
          )}

          {/* Agent */}
          {cfg.agent && agents.length > 0 && (
            <label className="block text-xs font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>
              Agent
              <ThemedSelect value={agent} onChange={e => setAgent(e.target.value)} className="input mt-1">
                <option value="">All agents</option>
                {agents.map(a => (
                  <option key={a.user_id} value={a.user_id}>{`${a.first_name || ''} ${a.last_name || ''}`.trim() || a.email}</option>
                ))}
              </ThemedSelect>
            </label>
          )}

          {/* Users option */}
          {type === 'users' && (
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}>
              <input type="checkbox" checked={includeInactive} onChange={e => setIncludeInactive(e.target.checked)} className="w-4 h-4 accent-[var(--color-primary-600,#a8885c)]" />
              Include inactive users
            </label>
          )}

          <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            Exports every matching record (no 1,000-row limit) as a CSV.
          </p>
        </div>

        <div className="px-5 py-4 flex justify-end gap-2" style={{ borderTop: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          <button onClick={onClose} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>Cancel</button>
          {canExport(type === 'users' ? 'company_data' : type) && (
            <button onClick={run} disabled={busy}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50" style={{ background: 'var(--gradient-sidebar)' }}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Export CSV
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ManagerExportModal;

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

  // z-index note: the ThemedDate calendar and ThemedSelect menus portal to
  // <body> at zIndex 10000. This modal MUST sit BELOW that or those popups open
  // BEHIND the dialog (the old z-[2147483647] max-int did exactly that). z-[9000]
  // keeps the modal above all app chrome (which tops out well under 1000) while
  // letting the date/agent popups float above it. Do not raise past 9999.
  return createPortal(
    <div className="fixed inset-0 z-[9000] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="w-full max-w-xl rounded-2xl overflow-hidden flex flex-col animate-scale-in"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)', maxHeight: '90vh' }}>
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ background: 'var(--gradient-sidebar)' }}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(255,255,255,0.16)' }}>
              <FileSpreadsheet size={18} className="text-white" />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-white leading-tight truncate" style={{ fontFamily: 'var(--font-display)' }}>Export Data</div>
              <div className="text-[11px] text-white/70 truncate">Download a CSV of your company records</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-white/15 hover:bg-white/30 transition-colors shrink-0"><X size={18} className="text-white" /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Data type */}
          <div>
            <div className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-tertiary)' }}>What to export</div>
            <div className="grid grid-cols-4 gap-2">
              {TYPES.map(t => {
                const active = type === t.key;
                return (
                  <button key={t.key} onClick={() => { setType(t.key); setStatus(''); setAgent(''); }}
                    className="flex flex-col items-center gap-1.5 py-3 rounded-xl text-xs font-semibold transition-all"
                    style={{
                      background: active ? 'var(--gradient-sidebar)' : 'var(--color-bg-secondary)',
                      color:      active ? '#fff' : 'var(--color-text-secondary)',
                      border: active ? '1px solid transparent' : '1px solid var(--color-border)',
                      boxShadow: active ? 'var(--shadow-md)' : 'none',
                    }}>
                    <t.icon size={18} />{t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Filters — grouped so the dialog reads as one connected panel */}
          {(cfg.date || cfg.status || (cfg.agent && agents.length > 0) || type === 'users') && (
            <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
              <div className="text-xs font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>Filters</div>

              {/* Date range */}
              {cfg.date && (
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-xs font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>
                    From
                    <ThemedDate value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input mt-1" />
                  </label>
                  <label className="block text-xs font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>
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
            </div>
          )}

          <p className="flex items-start gap-1.5 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            <FileSpreadsheet size={13} className="mt-0.5 shrink-0" />
            <span>Exports every matching record (no 1,000-row limit) as a CSV. Exports are logged for compliance.</span>
          </p>
        </div>

        <div className="px-5 py-4 flex items-center justify-end gap-2" style={{ borderTop: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          <button onClick={onClose} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>Cancel</button>
          {canExport(type === 'users' ? 'company_data' : type) ? (
            <button onClick={run} disabled={busy}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50 transition-opacity" style={{ background: 'var(--gradient-sidebar)' }}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} {busy ? 'Exporting…' : 'Export CSV'}
            </button>
          ) : (
            <span className="px-3 py-2 text-xs font-medium" style={{ color: 'var(--color-text-tertiary)' }}>Export not permitted for this data.</span>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ManagerExportModal;

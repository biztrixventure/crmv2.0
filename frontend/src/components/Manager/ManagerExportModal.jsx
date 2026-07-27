import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, Loader2, FileSpreadsheet, DollarSign, Send, PhoneCall, Users } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import { saleExportColumns, saleToValue } from '../Admin/BulkSaleUploader/saleColumnMapping';
import ThemedSelect from '../UI/Select';
import ThemedDate from '../UI/ThemedDate';
import { useAuth } from '../../contexts/AuthContext';
import { fetchAllForExport, writeExport } from '../../utils/exportSpec';
import { useExportColumns } from '../../hooks/useExportColumns';

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

// These four exports used to page through the list endpoints with a plain
// client.get and no __egress marker, so they were the one export surface with
// no row cap and no audit row. They go through fetchAllForExport now, which
// carries the marker. pageSize is per-endpoint on purpose: the drain stops on a
// short page, and PostgREST caps these responses near 1000 (200 for callbacks),
// so asking for more would silently truncate the file.
const PAGE_SIZE = { sales: 1000, transfers: 1000, callbacks: 200, users: 1000 };

const ManagerExportModal = ({ onClose, agents = [] }) => {
  const { canExport } = useAuth();
  // null per dataset = unconfigured → each tab keeps its own default columns.
  const { allowedFor } = useExportColumns(['sales', 'transfers', 'callbacks', 'users']);
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
      const drain = (endpoint, params, key) =>
        fetchAllForExport(endpoint, params, key, undefined, key, { pageSize: PAGE_SIZE[key] });
      let data = [], write = null;

      if (type === 'sales') {
        // Values are derived from the same schema the bulk sale uploader
        // expects, so an exported file round-trips through the uploader without
        // manual header re-mapping — hence the manager_sales surface emits raw
        // keys as headers instead of friendly labels.
        const [salesData, ffRes] = await Promise.all([
          drain('sales', { ...dateParams, ...(status && { status }), ...(agent && { user_id: agent }) }, 'sales'),
          client.get('forms/fields').catch(() => ({ data: { fields: [] } })),
        ]);
        data = salesData;
        const cols = saleExportColumns(ffRes.data.fields || [])
          .map(c => ({ key: c.key, label: c.key, get: (s) => saleToValue(s, c) }));
        write = () => writeExport({
          dataset: 'sales', surface: 'manager_sales', allowed: allowedFor('sales'),
          extraColumns: cols, rows: data, filename: `${type}_export_${today}.csv`,
        });
      } else if (type === 'transfers') {
        data = await drain('transfers', { ...dateParams, ...(status && { status }), ...(agent && { user_id: agent }) }, 'transfers');
        write = () => writeExport({
          dataset: 'transfers', surface: 'manager_transfers', allowed: allowedFor('transfers'),
          rows: data, filename: `${type}_export_${today}.csv`,
        });
      } else if (type === 'callbacks') {
        data = await drain('callbacks', { ...dateParams }, 'callbacks');
        write = () => writeExport({
          dataset: 'callbacks', surface: 'manager_callbacks', allowed: allowedFor('callbacks'),
          rows: data, filename: `${type}_export_${today}.csv`,
        });
      } else {
        data = await drain('users', { ...(includeInactive && { include_inactive: true }) }, 'users');
        write = () => writeExport({
          dataset: 'users', surface: 'manager_users', allowed: allowedFor('users'),
          rows: data, filename: `${type}_export_${today}.csv`,
        });
      }

      // Checked BEFORE writing, so an empty result still downloads nothing.
      if (!data.length) { toast.warning('No records match these filters.'); return; }
      write();
      toast.success(`Exported ${data.length.toLocaleString()} ${type}.`);
      onClose();
    } catch (e) {
      // A daily/row cap now returns 429 on page 1 → typed egressBlocked error.
      toast.error(e?.egressBlocked ? e.message : (e.response?.data?.error || 'Export failed.'));
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

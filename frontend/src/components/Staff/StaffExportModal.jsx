import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, Loader2, FileSpreadsheet, DollarSign, Send, PhoneCall } from 'lucide-react';
import { toast } from 'sonner';
import ThemedDate from '../UI/ThemedDate';
import { useAuth } from '../../contexts/AuthContext';
import { fetchAllForExport, writeExport } from '../../utils/exportSpec';
import { useExportColumns } from '../../hooks/useExportColumns';

// ============================================================================
// StaffExportModal — a closer's / fronter's export of THEIR OWN records.
//
// StaffShell had no export at all before this. It ships DISABLED: migration 215
// writes export_blocked rows for the closer and fronter roles, so canExport()
// hides the button until a superadmin turns it on for a role or one person
// (Data Egress → Export access). Adding an egress surface for the two
// lowest-trust roles and switching it on in the same change would be the wrong
// default.
//
// Not a reuse of ManagerExportModal on purpose: that one carries an agent
// picker, a Users tab, and the bulk-upload round-trip sales shape, none of
// which apply here. This one pins user_id to the caller so the file can only
// ever contain their own records.
// ============================================================================
const TYPES = [
  { key: 'sales',     label: 'My Sales',     icon: DollarSign, surface: 'staff_sales',     pageSize: 1000 },
  { key: 'transfers', label: 'My Transfers', icon: Send,       surface: 'staff_transfers', pageSize: 1000 },
  { key: 'callbacks', label: 'My Callbacks', icon: PhoneCall,  surface: 'staff_callbacks', pageSize: 200 },
];

const StaffExportModal = ({ onClose }) => {
  const { user, canExport } = useAuth();
  const { allowedFor } = useExportColumns(['sales', 'transfers', 'callbacks']);
  const [type, setType] = useState('sales');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [busy, setBusy] = useState(false);

  const cfg = TYPES.find(t => t.key === type);
  const today = new Date().toISOString().slice(0, 10);

  const run = async () => {
    setBusy(true);
    try {
      const rows = await fetchAllForExport(type, {
        user_id: user?.id,
        ...(dateFrom && { date_from: dateFrom }),
        ...(dateTo && { date_to: dateTo }),
      }, type, undefined, type, { pageSize: cfg.pageSize });

      if (!rows.length) { toast.warning('No records match these filters.'); return; }
      writeExport({
        dataset: type, surface: cfg.surface, allowed: allowedFor(type),
        rows, filename: `${type}_export_${today}.csv`,
      });
      toast.success(`Exported ${rows.length.toLocaleString()} ${type}.`);
      onClose();
    } catch (e) {
      toast.error(e?.egressBlocked ? e.message : (e.response?.data?.error || 'Export failed.'));
    } finally { setBusy(false); }
  };

  // z-index: ThemedDate's calendar portals to <body> at 10000, so this must sit
  // BELOW that or the date popup opens behind the dialog. Do not raise past 9999.
  return createPortal(
    <div className="fixed inset-0 z-[9000] flex items-center justify-center p-0 sm:p-4"
      style={{ backgroundColor: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="w-full sm:max-w-md h-dvh sm:h-auto rounded-none sm:rounded-2xl overflow-hidden flex flex-col animate-scale-in"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)', maxHeight: '100dvh' }}>

        <div className="flex items-center justify-between px-4 sm:px-5 py-4 flex-shrink-0" style={{ background: 'var(--gradient-sidebar)' }}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(255,255,255,0.16)' }}>
              <FileSpreadsheet size={18} className="text-white" />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-white leading-none truncate" style={{ fontFamily: 'var(--font-display)' }}>Export my records</div>
              <div className="text-[11px] leading-none mt-1.5 text-white/70 truncate">Only records assigned to you</div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="w-11 h-11 sm:w-8 sm:h-8 flex items-center justify-center shrink-0 rounded-lg bg-white/15 hover:bg-white/30 transition-colors">
            <X size={18} className="text-white" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto">
          <div>
            <div className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-tertiary)' }}>What to export</div>
            <div className="grid grid-cols-3 gap-2">
              {TYPES.map(t => {
                const active = type === t.key;
                return (
                  <button key={t.key} onClick={() => setType(t.key)}
                    className="flex flex-col items-center gap-1.5 py-3 rounded-xl text-[11px] leading-none font-semibold transition-all"
                    style={{
                      background: active ? 'var(--gradient-sidebar)' : 'var(--color-bg-secondary)',
                      color:      active ? '#fff' : 'var(--color-text-secondary)',
                      border: `1px solid ${active ? 'transparent' : 'var(--color-border)'}`,
                      boxShadow: active ? 'var(--shadow-md)' : 'none',
                    }}>
                    <t.icon size={18} />{t.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            <div className="text-xs font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>Date range</div>
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
          </div>

          <p className="flex items-start gap-1.5 text-xs m-0" style={{ color: 'var(--color-text-tertiary)' }}>
            <FileSpreadsheet size={13} className="mt-0.5 shrink-0" />
            <span>Exports every matching record you own as a CSV. Exports are logged and counted against your daily limit.</span>
          </p>
        </div>

        <div className="px-4 sm:px-5 py-4 flex items-center justify-end gap-2 flex-shrink-0"
          style={{ borderTop: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          <button onClick={onClose} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-semibold"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>Cancel</button>
          {canExport(type) ? (
            <button onClick={run} disabled={busy}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50"
              style={{ background: 'var(--gradient-sidebar)' }}>
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

export default StaffExportModal;

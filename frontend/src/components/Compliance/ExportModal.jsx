import { useState, useEffect, useCallback } from 'react';
import { Download } from 'lucide-react';
import client from '../../api/client';
import { Overlay, ModalBox, ModalHeader } from './shared';
import ThemedSelect from '../UI/Select';

const ExportModal = ({ tab, companyList, cbType, onClose, onExport }) => {
  const [dateFrom, setDateFrom]   = useState('');
  const [dateTo, setDateTo]       = useState('');
  const [company, setCompany]     = useState('');
  const [userMode, setUserMode]   = useState('all');
  const [users, setUsers]         = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selected, setSelected]   = useState(new Set());
  const [loading, setLoading]     = useState(false);
  const [blocked, setBlocked]     = useState('');   // egress-limit message
  const [usage, setUsage]         = useState(null); // { limits, used } — pre-check hint

  // Client pre-check (fast UX only — the server is the real gate).
  useEffect(() => {
    client.get('egress/my-usage', { params: { action_type: 'csv_export' } })
      .then(r => setUsage(r.data)).catch(() => setUsage(null));
  }, []);

  const loadUsers = useCallback(async (cid) => {
    setLoadingUsers(true);
    try {
      const res = await client.get('compliance/users', { params: { company_id: cid || undefined } });
      setUsers(res.data.users || []);
    } catch { setUsers([]); } finally { setLoadingUsers(false); }
  }, []);

  useEffect(() => {
    if (userMode === 'select') loadUsers(company);
  }, [userMode, company, loadUsers]);

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const handleExport = async () => {
    setLoading(true); setBlocked('');
    try {
      await onExport({ dateFrom, dateTo, company, userIds: userMode === 'select' ? [...selected] : [] });
      onClose();
    } catch (err) {
      // Egress limit → keep the modal open and show the reason (server-enforced).
      if (err?.egressBlocked || err?.response?.data?.code === 'EGRESS_LIMIT') {
        setBlocked(err.message || err.response?.data?.error || 'Export blocked by your limit.');
      } else {
        setBlocked(err?.response?.data?.error || 'Export failed. Try again.');
      }
    } finally { setLoading(false); }
  };

  const TAB_LABELS = {
    queue: 'Review Queue', sales: 'All Sales', transfers: 'Transfers',
    callbacks: 'Callbacks', reviews: 'Call Reviews',
  };

  return (
    <Overlay>
      <ModalBox>
        <ModalHeader icon={Download} title={`Export ${TAB_LABELS[tab] || tab}`} onClose={onClose} />

        {usage && (usage.limits?.max_exports_per_day != null || usage.limits?.max_rows_per_export != null) && (
          <div className="mx-6 mt-4 px-3 py-2 rounded-lg text-xs" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
            {usage.limits.max_exports_per_day != null && <>Exports today: <b>{usage.used.exports}/{usage.limits.max_exports_per_day}</b>. </>}
            {usage.limits.max_rows_per_export != null && <>Max <b>{usage.limits.max_rows_per_export.toLocaleString()}</b> rows per export. </>}
            Narrow with a date range if you hit the limit.
          </div>
        )}

        <div className="overflow-y-auto p-6 space-y-5">

          {/* Date range */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wide mb-2"
              style={{ color: 'var(--color-text-secondary)' }}>Date Range</p>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs block mb-1" style={{ color: 'var(--color-text-tertiary)' }}>From</label>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input text-sm w-full" />
              </div>
              <div className="flex-1">
                <label className="text-xs block mb-1" style={{ color: 'var(--color-text-tertiary)' }}>To</label>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input text-sm w-full" />
              </div>
            </div>
          </div>

          {/* Company */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wide mb-2"
              style={{ color: 'var(--color-text-secondary)' }}>Company</p>
            <ThemedSelect value={company} onChange={e => { setCompany(e.target.value); setSelected(new Set()); }}
              className="input text-sm w-full">
              <option value="">All companies</option>
              {companyList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </ThemedSelect>
          </div>

          {/* Users */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wide mb-2"
              style={{ color: 'var(--color-text-secondary)' }}>Users</p>
            <div className="flex gap-2 mb-3">
              {['all', 'select'].map(m => (
                <button key={m} type="button" onClick={() => setUserMode(m)}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold border-2 transition-all"
                  style={{
                    borderColor: userMode === m ? 'var(--color-primary-600)' : 'var(--color-border)',
                    backgroundColor: userMode === m ? 'var(--color-primary-50)' : 'transparent',
                    color: userMode === m ? 'var(--color-primary-600)' : 'var(--color-text-secondary)',
                  }}>
                  {m === 'all' ? 'All Users' : 'Select Users'}
                </button>
              ))}
            </div>

            {userMode === 'select' && (
              <div className="rounded-xl overflow-auto" style={{ border: '1px solid var(--color-border)', maxHeight: 180 }}>
                {loadingUsers ? (
                  <div className="flex justify-center py-6">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2"
                      style={{ borderColor: 'var(--color-primary-600)' }} />
                  </div>
                ) : users.length === 0 ? (
                  <p className="text-center py-4 text-xs" style={{ color: 'var(--color-text-secondary)' }}>No users</p>
                ) : users.map(u => (
                  <label key={`${u.user_id}:${u.company_id}`}
                    className="flex items-center gap-3 px-4 py-2.5 cursor-pointer"
                    style={{
                      borderBottom: '1px solid var(--color-border)',
                      backgroundColor: selected.has(u.user_id) ? 'var(--color-primary-50)' : 'transparent',
                    }}>
                    <input type="checkbox" checked={selected.has(u.user_id)} onChange={() => toggle(u.user_id)} />
                    <div>
                      <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{u.full_name}</p>
                      <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                        {u.company_name} · {u.role_level?.replace(/_/g, ' ')}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            )}
            {userMode === 'select' && selected.size > 0 && (
              <p className="text-xs mt-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                {selected.size} user{selected.size !== 1 ? 's' : ''} selected
              </p>
            )}
          </div>
        </div>

        {blocked && (
          <div className="mx-6 mb-2 px-3 py-2.5 rounded-lg text-sm" style={{ background: 'var(--color-error-50, #fef2f2)', border: '1px solid var(--color-error-300, #fca5a5)', color: 'var(--color-error-700, #b91c1c)' }}>
            {blocked}
          </div>
        )}
        <div className="flex gap-3 px-6 pb-6 pt-3 flex-shrink-0"
          style={{ borderTop: '1px solid var(--color-border)' }}>
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border font-semibold text-sm"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
            Cancel
          </button>
          <button onClick={handleExport} disabled={loading}
            className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: 'var(--gradient-sidebar)' }}>
            {loading
              ? <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> Preparing…</>
              : <><Download size={14} /> Download CSV</>}
          </button>
        </div>
      </ModalBox>
    </Overlay>
  );
};

export default ExportModal;

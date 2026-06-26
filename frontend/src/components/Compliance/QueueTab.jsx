import { useState, useCallback, useEffect } from 'react';
import { Clock, CheckCircle, RotateCcw, Eye, AlertTriangle, User } from 'lucide-react';
import { Badge, Alert } from '../UI';
import client from '../../api/client';
import SaleDetailDrawer from '../Shared/SaleDetailDrawer';
import ExportModal from './ExportModal';
import {
  STATUS_LABEL, STATUS_BADGE, LIMIT, fmtDate, timeAgo, closerName, downloadCSV,
  TabHeader, Spinner, Empty, Overlay, ModalBox, ModalHeader, FSelect, fetchAllForExport,
} from './shared';

const QueueTab = ({ companyList }) => {
  const [queue, setQueue]       = useState([]);
  const [loading, setLoading]   = useState(false);
  const [company, setCompany]   = useState('');
  const [msg, setMsg]           = useState('');

  const [approving, setApproving]   = useState(null);
  const [approveMsg, setApproveMsg] = useState('');

  const [returnTarget, setReturnTarget] = useState(null);
  const [returnNote, setReturnNote]     = useState('');
  const [returning, setReturning]       = useState(false);
  const [returnMsg, setReturnMsg]       = useState('');

  const [detailSale, setDetailSale]   = useState(null);
  const [exportOpen, setExportOpen]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setMsg('');
    try {
      const res = await client.get('compliance/sales', {
        // Un-charged post-date sales are not yet eligible for review — they
        // only enter the queue once "Charge → Sale" submits them.
        params: { status: 'pending_review', exclude_post_date: 1, limit: 100, company_id: company || undefined },
      });
      setQueue(res.data.sales || []);
    } catch { setMsg('Failed to load review queue.'); } finally { setLoading(false); }
  }, [company]);

  useEffect(() => { load(); }, [load]);

  const approve = async (sale) => {
    setApproving(sale.id); setApproveMsg('');
    try {
      await client.post(`sales/${sale.id}/compliance-approve`);
      // Instant feedback: drop the approved sale out of the queue, then resync.
      setQueue(q => q.filter(x => x.id !== sale.id));
      load();
    } catch (err) {
      setApproveMsg(err.response?.data?.error || 'Failed to approve');
    } finally { setApproving(null); }
  };

  const openReturn = (sale) => { setReturnTarget(sale); setReturnNote(''); setReturnMsg(''); };
  const doReturn = async () => {
    if (!returnNote.trim()) { setReturnMsg('Note required.'); return; }
    setReturning(true);
    try {
      await client.post(`sales/${returnTarget.id}/compliance-return`, { note: returnNote });
      setReturnTarget(null);
      load();
    } catch (err) {
      setReturnMsg(err.response?.data?.error || 'Failed');
    } finally { setReturning(false); }
  };

  const handleExport = async ({ dateFrom, dateTo, company: co, userIds }) => {
    const allSales = await fetchAllForExport('compliance/sales',
      { status: 'pending_review', exclude_post_date: 1, date_from: dateFrom || undefined, date_to: dateTo || undefined, company_id: co || undefined, user_ids: userIds.length ? userIds.join(',') : undefined },
      'sales');
    const rows = allSales.map(s => [
      s.customer_name || '', s.customer_phone || '', s.reference_no || '',
      closerName(s), s.companies?.name || '', fmtDate(s.created_at),
    ]);
    downloadCSV(rows, ['Customer','Phone','Reference','Closer','Company','Created'],
      `queue_${new Date().toISOString().split('T')[0]}.csv`);
  };

  return (
    <div>
      <TabHeader
        title="Review Queue"
        subtitle={queue.length === 0 ? 'All clear — nothing pending' : `${queue.length} sale${queue.length !== 1 ? 's' : ''} awaiting approval`}
        onRefresh={load}
        onExport={() => setExportOpen(true)}
        extra={
          <select value={company} onChange={e => setCompany(e.target.value)}
            className="input text-sm py-1.5" style={{ minWidth: 160 }}>
            <option value="">All companies</option>
            {companyList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        }
      />

      {msg && <Alert variant="error" className="mb-4">{msg}</Alert>}
      {approveMsg && <Alert variant="error" className="mb-4">{approveMsg}</Alert>}

      {loading ? <Spinner /> : queue.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 rounded-2xl"
          style={{ border: '2px dashed var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
            style={{ backgroundColor: '#dcfce7' }}>
            <CheckCircle size={28} style={{ color: '#16a34a' }} />
          </div>
          <p className="text-lg font-bold mb-1" style={{ color: 'var(--color-text)' }}>All clear!</p>
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>No sales pending review.</p>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
          {queue.map(s => (
            <div key={s.id} className="rounded-2xl flex flex-col cursor-pointer hover:shadow-md transition-shadow"
              style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
              onClick={() => setDetailSale(s)}>

              <div className="p-4 flex items-start justify-between gap-3"
                style={{ borderBottom: '1px solid var(--color-border)' }}>
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: 'var(--color-primary-100)' }}>
                    <User size={13} style={{ color: 'var(--color-primary-600)' }} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold truncate" style={{ color: 'var(--color-text)' }}>{s.customer_name || '—'}</p>
                    <p className="text-xs truncate" style={{ color: 'var(--color-text-secondary)' }}>
                      {s.customer_phone || '—'}
                      {s.reference_no && <span className="ml-2 font-mono" style={{ color: 'var(--color-text-tertiary)' }}>#{s.reference_no}</span>}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                    style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>
                    {timeAgo(s.submitted_for_review_at || s.created_at)}
                  </span>
                  {s.companies?.name && (
                    <span className="text-xs px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>
                      {s.companies.name}
                    </span>
                  )}
                </div>
              </div>

              <div className="p-4 grid grid-cols-2 gap-3 text-xs"
                style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                <div>
                  <p className="mb-0.5 font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)', fontSize: '0.6rem' }}>Closer</p>
                  <p className="font-medium truncate" style={{ color: 'var(--color-text)' }}>{closerName(s)}</p>
                </div>
                <div>
                  <p className="mb-0.5 font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)', fontSize: '0.6rem' }}>Submitted</p>
                  <p className="font-medium" style={{ color: 'var(--color-text)' }}>{fmtDate(s.created_at)}</p>
                </div>
              </div>

              {s.compliance_note && (
                <div className="mx-4 mt-3 p-3 rounded-xl flex items-start gap-2 text-xs"
                  style={{ backgroundColor: '#fef3c7', border: '1px solid #fde68a' }}>
                  <AlertTriangle size={11} style={{ color: '#d97706', marginTop: 1, flexShrink: 0 }} />
                  <p style={{ color: '#78350f' }}>{s.compliance_note}</p>
                </div>
              )}

              <div className="p-4 mt-auto flex items-center gap-2">
                <button onClick={e => { e.stopPropagation(); approve(s); }} disabled={approving === s.id}
                  className="flex-1 py-2 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-1.5 disabled:opacity-60 hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)' }}>
                  <CheckCircle size={14} /> {approving === s.id ? '…' : 'Approve'}
                </button>
                <button onClick={e => { e.stopPropagation(); openReturn(s); }}
                  className="flex-1 py-2 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 hover:opacity-90"
                  style={{ border: '1.5px solid #fbbf24', color: '#d97706', backgroundColor: '#fffbeb' }}>
                  <RotateCcw size={14} /> Return
                </button>
                <button onClick={e => { e.stopPropagation(); setDetailSale(s); }}
                  className="p-2 rounded-xl hover:opacity-80"
                  style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                  <Eye size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Return modal */}
      {returnTarget && (
        <Overlay>
          <ModalBox>
            <ModalHeader icon={RotateCcw} title="Return to Closer"
              subtitle={`${returnTarget.customer_name} · Ref: ${returnTarget.reference_no || '—'}`}
              onClose={() => setReturnTarget(null)} />
            <div className="p-6 space-y-3">
              <label className="block text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                Note for closer <span className="text-red-500">*</span>
              </label>
              <textarea value={returnNote} onChange={e => setReturnNote(e.target.value)}
                placeholder="Explain what needs to be corrected…"
                rows={4} className="input text-sm w-full" autoFocus maxLength={2000} />
              <div className="flex justify-between items-center">
                {returnMsg ? <p className="text-xs text-red-500">{returnMsg}</p> : <span />}
                <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{returnNote.length}/2000</span>
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => setReturnTarget(null)}
                  className="flex-1 py-2.5 rounded-xl border font-semibold text-sm"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Cancel</button>
                <button onClick={doReturn} disabled={returning}
                  className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#d97706,#b45309)' }}>
                  {returning ? 'Returning…' : 'Return'}
                </button>
              </div>
            </div>
          </ModalBox>
        </Overlay>
      )}

      <SaleDetailDrawer sale={detailSale} onClose={() => setDetailSale(null)} />
      {exportOpen && (
        <ExportModal tab="queue" companyList={companyList}
          onClose={() => setExportOpen(false)} onExport={handleExport} />
      )}
    </div>
  );
};

export default QueueTab;

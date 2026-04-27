import { useState, useCallback, useEffect } from 'react';
import { PhoneCall } from 'lucide-react';
import CallbackPhoneHistoryDrawer from '../Shared/CallbackPhoneHistoryDrawer';
import { Badge } from '../UI';
import client from '../../api/client';
import ExportModal from './ExportModal';
import {
  STATUS_BADGE, STATUS_LABEL, CALLBACK_STATUSES, LIMIT,
  fmtDate, fmtDateTime, downloadCSV,
  TabHeader, Spinner, Empty, Pagination, Th, Filters, FInput, FSelect,
  Overlay, ModalBox, ModalHeader, InfoTile,
} from './shared';

const CallbacksTab = ({ companyList }) => {
  const [callbacks, setCallbacks] = useState([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(false);
  const [page, setPage]           = useState(1);
  const [cbType, setCbType]       = useState('fronter');
  const [status, setStatus]       = useState('');
  const [company, setCompany]     = useState('');
  const [dateFrom, setDateFrom]   = useState('');
  const [dateTo, setDateTo]       = useState('');

  const [detail,      setDetail]      = useState(null);
  const [phoneDrawer, setPhoneDrawer] = useState(null); // { phone, customerName }
  const [exportOpen,  setExportOpen]  = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get('compliance/callbacks', {
        params: {
          company_type: company ? undefined : cbType,
          company_id:   company || undefined,
          status:       status || undefined,
          date_from:    dateFrom || undefined,
          date_to:      dateTo || undefined,
          page, limit: LIMIT,
        },
      });
      setCallbacks(res.data.callbacks || []);
      setTotal(res.data.total || 0);
    } catch { /* non-critical */ } finally { setLoading(false); }
  }, [cbType, company, status, dateFrom, dateTo, page]);

  useEffect(() => { load(); }, [load]);

  const switchType = (t) => { setCbType(t); setCompany(''); setPage(1); };

  const filteredCompanies = companyList.filter(c => c.company_type === cbType);

  const handleExport = async ({ dateFrom: df, dateTo: dt, company: co, userIds }) => {
    const res = await client.get('compliance/callbacks', {
      params: {
        company_type: co ? undefined : cbType, company_id: co || undefined,
        date_from: df || undefined, date_to: dt || undefined,
        user_ids: userIds.length ? userIds.join(',') : undefined,
        limit: 5000, page: 1,
      },
    });
    const rows = (res.data.callbacks || []).map(c => [
      c.customer_name || '', c.customer_phone || '',
      fmtDateTime(c.callback_at), STATUS_LABEL[c.status] || c.status || '',
      c.notes || '', c.user_name || '', c.company_name || '',
    ]);
    downloadCSV(rows, ['Customer','Phone','Scheduled At','Status','Notes','Agent','Company'],
      `callbacks_${cbType}_${new Date().toISOString().split('T')[0]}.csv`);
  };

  return (
    <div>
      <TabHeader
        title="Callbacks"
        subtitle="Scheduled callbacks across all companies — read-only view"
        onRefresh={() => { setPage(1); load(); }}
        onExport={() => setExportOpen(true)}
      />

      {/* Fronter / Closer toggle */}
      <div className="flex gap-1 p-1 rounded-xl mb-4 w-fit"
        style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
        {[
          { key: 'fronter', label: 'Fronter Callbacks' },
          { key: 'closer',  label: 'Closer Callbacks' },
        ].map(t => (
          <button key={t.key} onClick={() => switchType(t.key)}
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-all"
            style={{
              backgroundColor: cbType === t.key ? 'var(--color-surface)' : 'transparent',
              color: cbType === t.key ? 'var(--color-primary-600)' : 'var(--color-text-secondary)',
              boxShadow: cbType === t.key ? 'var(--shadow-sm)' : 'none',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      <Filters onSubmit={() => { setPage(1); load(); }}>
        <FSelect label="Company" value={company} onChange={e => setCompany(e.target.value)}>
          <option value="">All {cbType} companies</option>
          {filteredCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FSelect>
        <FSelect label="Status" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {CALLBACK_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s] || s}</option>)}
        </FSelect>
        <FInput label="From" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <FInput label="To"   type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)} />
      </Filters>

      <div className="rounded-xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        {loading ? <Spinner /> : callbacks.length === 0 ? (
          <Empty icon={PhoneCall} msg="No callbacks found." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                  <Th>Customer</Th>
                  <Th>Scheduled At</Th>
                  <Th>Agent</Th>
                  <Th>Company</Th>
                  <Th>Status</Th>
                  <Th>Notes</Th>
                </tr>
              </thead>
              <tbody>
                {callbacks.map(c => (
                  <tr key={c.id} className="cursor-pointer"
                    style={{ borderBottom: '1px solid var(--color-border)' }}
                    onClick={() => setDetail(c)}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                    <td className="px-4 py-3">
                      <p className="font-semibold" style={{ color: 'var(--color-text)' }}>{c.customer_name || '—'}</p>
                      {c.customer_phone ? (
                        <button
                          onClick={e => { e.stopPropagation(); setPhoneDrawer({ phone: c.customer_phone, customerName: c.customer_name }); }}
                          className="text-xs mt-0.5 font-mono hover:underline text-left"
                          style={{ color: 'var(--color-primary-600)' }}
                          title="View all callbacks for this number">
                          {c.customer_phone}
                        </button>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                      {fmtDateTime(c.callback_at)}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                      {c.user_name || '—'}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                      {c.company_name || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_BADGE[c.status] || 'secondary'} size="sm">
                        {STATUS_LABEL[c.status] || c.status?.replace(/_/g,' ')}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs max-w-xs truncate"
                      style={{ color: 'var(--color-text-secondary)' }}>
                      {c.notes || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} total={total} limit={LIMIT} onPage={setPage} />
      </div>

      {/* Callback detail modal */}
      {detail && (
        <Overlay>
          <ModalBox>
            <ModalHeader icon={PhoneCall} title="Callback Record"
              subtitle={detail.customer_name || '—'} onClose={() => setDetail(null)} />
            <div className="overflow-y-auto p-6 space-y-5">
              <section>
                <p className="text-xs font-bold uppercase tracking-wide mb-3"
                  style={{ color: 'var(--color-text-secondary)' }}>Customer</p>
                <div className="grid grid-cols-2 gap-3">
                  <InfoTile label="Name"  value={detail.customer_name} />
                  <InfoTile label="Phone" value={detail.customer_phone} />
                </div>
              </section>

              <section>
                <p className="text-xs font-bold uppercase tracking-wide mb-3"
                  style={{ color: 'var(--color-text-secondary)' }}>Callback Details</p>
                <div className="grid grid-cols-2 gap-3">
                  <InfoTile label="Scheduled At" value={fmtDateTime(detail.callback_at)} />
                  <InfoTile label="Status" value={<Badge variant={STATUS_BADGE[detail.status] || 'secondary'} size="sm">{STATUS_LABEL[detail.status] || detail.status}</Badge>} />
                  <InfoTile label="Agent"   value={detail.user_name} />
                  <InfoTile label="Company" value={detail.company_name} />
                </div>
              </section>

              {detail.notes && (
                <section>
                  <p className="text-xs font-bold uppercase tracking-wide mb-2"
                    style={{ color: 'var(--color-text-secondary)' }}>Notes</p>
                  <div className="rounded-xl p-4"
                    style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                    <p className="text-sm" style={{ color: 'var(--color-text)' }}>{detail.notes}</p>
                  </div>
                </section>
              )}

              <section>
                <p className="text-xs font-bold uppercase tracking-wide mb-3"
                  style={{ color: 'var(--color-text-secondary)' }}>Trace Info</p>
                <div className="grid grid-cols-2 gap-3">
                  <InfoTile label="Record ID"  value={detail.id} />
                  <InfoTile label="Entered At" value={fmtDateTime(detail.created_at)} />
                  <InfoTile label="Push Sent"
                    value={detail.notified ? 'Yes — OS notification fired' : 'No — not yet notified'} />
                </div>
              </section>
            </div>
            <div className="px-6 pb-6 pt-3 flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)' }}>
              <button onClick={() => setDetail(null)}
                className="w-full py-2.5 rounded-xl border font-semibold text-sm"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                Close
              </button>
            </div>
          </ModalBox>
        </Overlay>
      )}

      {exportOpen && (
        <ExportModal tab="callbacks" companyList={filteredCompanies} cbType={cbType}
          onClose={() => setExportOpen(false)} onExport={handleExport} />
      )}

      {phoneDrawer && (
        <CallbackPhoneHistoryDrawer
          phone={phoneDrawer.phone}
          customerName={phoneDrawer.customerName}
          onClose={() => setPhoneDrawer(null)}
        />
      )}
    </div>
  );
};

export default CallbacksTab;

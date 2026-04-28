import { useState, useCallback, useEffect } from 'react';
import { PhoneCall, ArrowRight, Trash2 } from 'lucide-react';
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

// ── Audit Log sub-component ────────────────────────────────────────────────
const AuditLogView = ({ companyList }) => {
  const [entries, setEntries]   = useState([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(false);
  const [page, setPage]         = useState(1);
  const [company, setCompany]   = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get('compliance/callback-audit-log', {
        params: {
          company_id: company || undefined,
          date_from:  dateFrom || undefined,
          date_to:    dateTo   || undefined,
          page, limit: LIMIT,
        },
      });
      setEntries(res.data.entries || []);
      setTotal(res.data.total || 0);
    } catch { /* non-critical */ } finally { setLoading(false); }
  }, [company, dateFrom, dateTo, page]);

  useEffect(() => { load(); }, [load]);

  const handleExport = async () => {
    const res = await client.get('compliance/callback-audit-log', {
      params: { company_id: company || undefined, date_from: dateFrom || undefined, date_to: dateTo || undefined, limit: 5000, page: 1 },
    });
    const rows = (res.data.entries || []).map(e => [
      fmtDateTime(e.created_at),
      e.actor_name || e.actor_id || '—',
      e.customer_name_snapshot || '—',
      e.customer_phone_snapshot || '—',
      STATUS_LABEL[e.old_status] || e.old_status || '—',
      STATUS_LABEL[e.new_status] || e.new_status || '—',
      e.notes || '',
      e.callback_deleted ? 'Yes' : 'No',
    ]);
    downloadCSV(rows, ['Timestamp','Actor','Customer','Phone','From Status','To Status','Notes','Callback Deleted'],
      `callback_audit_log_${new Date().toISOString().split('T')[0]}.csv`);
  };

  return (
    <div>
      <Filters onSubmit={() => { setPage(1); load(); }}>
        <FSelect label="Company" value={company} onChange={e => setCompany(e.target.value)}>
          <option value="">All companies</option>
          {companyList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FSelect>
        <FInput label="From" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <FInput label="To"   type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)} />
      </Filters>

      <div className="rounded-xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        {loading ? <Spinner /> : entries.length === 0 ? (
          <Empty icon={PhoneCall} msg="No audit log entries found." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                  <Th>Timestamp</Th>
                  <Th>Actor</Th>
                  <Th>Customer</Th>
                  <Th>Status Change</Th>
                  <Th>Notes</Th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                      {fmtDateTime(e.created_at)}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text)' }}>
                      {e.actor_name || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
                        {e.customer_name_snapshot || '—'}
                        {e.callback_deleted && (
                          <span className="ml-1.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-bold"
                            style={{ backgroundColor: 'var(--color-error-50)', color: 'var(--color-error-600)', border: '1px solid var(--color-error-200)' }}>
                            <Trash2 size={9} /> Deleted
                          </span>
                        )}
                      </p>
                      {e.customer_phone_snapshot && (
                        <p className="text-xs mt-0.5 font-mono" style={{ color: 'var(--color-text-secondary)' }}>
                          {e.customer_phone_snapshot}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant={STATUS_BADGE[e.old_status] || 'secondary'} size="sm">
                          {STATUS_LABEL[e.old_status] || e.old_status || '—'}
                        </Badge>
                        <ArrowRight size={12} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
                        <Badge variant={STATUS_BADGE[e.new_status] || 'secondary'} size="sm">
                          {STATUS_LABEL[e.new_status] || e.new_status}
                        </Badge>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs max-w-xs truncate" style={{ color: 'var(--color-text-secondary)' }}>
                      {e.notes || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} total={total} limit={LIMIT} onPage={setPage} />
      </div>

      <div className="mt-3 flex justify-end">
        <button onClick={handleExport}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors hover:opacity-80"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
          Export CSV
        </button>
      </div>
    </div>
  );
};

// ── Main CallbacksTab ──────────────────────────────────────────────────────
const CallbacksTab = ({ companyList }) => {
  const [view, setView]           = useState('callbacks'); // 'callbacks' | 'audit'
  const [callbacks, setCallbacks] = useState([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(false);
  const [page, setPage]           = useState(1);
  const [cbType, setCbType]       = useState('fronter');
  const [status, setStatus]       = useState('');
  const [company, setCompany]     = useState('');
  const [search, setSearch]       = useState('');
  const [dateFrom, setDateFrom]   = useState('');
  const [dateTo, setDateTo]       = useState('');

  const [detail,      setDetail]      = useState(null);
  const [phoneDrawer, setPhoneDrawer] = useState(null);
  const [exportOpen,  setExportOpen]  = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get('compliance/callbacks', {
        params: {
          // When a specific company is selected, skip company_type — the company_id filter
          // is sufficient and avoids filtering out companies whose type doesn't match the toggle.
          company_type: company ? undefined : cbType,
          company_id:   company || undefined,
          status:       status || undefined,
          search:       search || undefined,
          date_from:    dateFrom || undefined,
          date_to:      dateTo || undefined,
          page, limit: LIMIT,
        },
      });
      setCallbacks(res.data.callbacks || []);
      setTotal(res.data.total || 0);
    } catch { /* non-critical */ } finally { setLoading(false); }
  }, [cbType, company, status, search, dateFrom, dateTo, page]);

  useEffect(() => { if (view === 'callbacks') load(); }, [load, view]);

  const switchType = (t) => { setCbType(t); setCompany(''); setSearch(''); setPage(1); };

  // Show ALL companies in the dropdown — not filtered by cbType.
  // The cbType toggle only affects the "all companies" aggregate view; when a specific
  // company is picked the company_type filter is irrelevant and would hide valid companies.
  const sortedCompanies = [...companyList].sort((a, b) => a.name.localeCompare(b.name));

  const handleExport = async ({ dateFrom: df, dateTo: dt, company: co, userIds }) => {
    const res = await client.get('compliance/callbacks', {
      params: {
        company_type: co ? undefined : cbType, company_id: co || undefined,
        date_from: df || undefined, date_to: dt || undefined,
        search: search || undefined,
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
        onRefresh={view === 'callbacks' ? () => { setPage(1); load(); } : undefined}
        onExport={view === 'callbacks' ? () => setExportOpen(true) : undefined}
        extra={
          <div className="flex gap-1 p-1 rounded-lg"
            style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            {[
              { key: 'callbacks', label: 'Callbacks' },
              { key: 'audit',     label: 'Audit Log' },
            ].map(v => (
              <button key={v.key} onClick={() => setView(v.key)}
                className="px-3 py-1.5 rounded-md text-xs font-semibold transition-all"
                style={{
                  backgroundColor: view === v.key ? 'var(--color-surface)' : 'transparent',
                  color: view === v.key ? 'var(--color-primary-600)' : 'var(--color-text-secondary)',
                  boxShadow: view === v.key ? 'var(--shadow-sm)' : 'none',
                }}>
                {v.label}
              </button>
            ))}
          </div>
        }
      />

      {view === 'audit' && <AuditLogView companyList={companyList} />}
      {view === 'callbacks' && <>

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
        <FInput label="Search" placeholder="Name or phone…" value={search}
          onChange={e => setSearch(e.target.value)} style={{ minWidth: 160 }} />
        <FSelect label="Company" value={company} onChange={e => setCompany(e.target.value)}>
          <option value="">All companies</option>
          {sortedCompanies.map(c => (
            <option key={c.id} value={c.id}>
              {c.name}{c.company_type ? ` (${c.company_type})` : ''}
            </option>
          ))}
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
        <ExportModal tab="callbacks" companyList={sortedCompanies} cbType={cbType}
          onClose={() => setExportOpen(false)} onExport={handleExport} />
      )}

      {phoneDrawer && (
        <CallbackPhoneHistoryDrawer
          phone={phoneDrawer.phone}
          customerName={phoneDrawer.customerName}
          onClose={() => setPhoneDrawer(null)}
        />
      )}
      </>}
    </div>
  );
};

export default CallbacksTab;

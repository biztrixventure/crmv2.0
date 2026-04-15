import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useNavigate } from "react-router-dom";
import { Shield, Search, RefreshCw, ChevronDown, ChevronUp, FileText, Star } from "lucide-react";
import { Card, Badge } from "../components/UI";
import { AppHeader } from "../components/Layout";
import { useNotifications } from "../hooks/useNotifications";
import client from "../api/client";

const STATUS_BADGE = {
  open:                 'info',
  sold:                 'success',
  closed_won:           'success',
  closed_lost:          'error',
  cancelled:            'error',
  compliance_cancelled: 'error',
  follow_up:            'warning',
  dispute:              'warning',
  chargeback:           'error',
};

const COMPLIANCE_STATUSES = [
  'open', 'sold', 'cancelled', 'follow_up',
  'closed_won', 'closed_lost',
  'compliance_cancelled', 'dispute', 'chargeback',
];
const RATING_COLOR = { excellent: '#16a34a', good: '#2563eb', average: '#d97706', below_average: '#ea580c', bad: '#dc2626' };

const ComplianceDashboard = () => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const notifHook = useNotifications();

  const [sales, setSales]         = useState([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(false);
  const [page, setPage]           = useState(1);
  const LIMIT = 30;

  // Filters
  const [search, setSearch]       = useState('');
  const [status, setStatus]       = useState('');
  const [dateFrom, setDateFrom]   = useState('');
  const [dateTo, setDateTo]       = useState('');
  const [companyId, setCompanyId] = useState('');

  // Companies list
  const [companies, setCompanies] = useState([]);

  // Edit modal
  const [editTarget, setEditTarget] = useState(null);
  const [editStatus, setEditStatus] = useState('');
  const [editReason, setEditReason] = useState('');
  const [editSaving, setEditSaving] = useState('');
  const [editMsg, setEditMsg]       = useState('');

  // Expanded row (audit trail)
  const [expanded, setExpanded]   = useState(null);

  // Active top-level tab
  const [mainTab, setMainTab]     = useState('sales');

  // Call reviews state
  const [reviews, setReviews]               = useState([]);
  const [dispos, setDispos]                 = useState([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsSubTab, setReviewsSubTab]   = useState('ratings');
  const [reviewCompany, setReviewCompany]   = useState('');

  const loadSales = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get('sales/all-companies', {
        params: {
          search:     search || undefined,
          status:     status || undefined,
          date_from:  dateFrom || undefined,
          date_to:    dateTo   || undefined,
          company_id: companyId || undefined,
          page,
          limit: LIMIT,
        },
      });
      setSales(res.data.sales || []);
      setTotal(res.data.total || 0);
    } catch { /* non-critical */ } finally {
      setLoading(false);
    }
  }, [search, status, dateFrom, dateTo, companyId, page]);

  const loadCompanies = useCallback(async () => {
    try {
      const res = await client.get('companies');
      setCompanies(res.data.companies || []);
    } catch {}
  }, []);

  const loadReviews = useCallback(async () => {
    setReviewsLoading(true);
    try {
      const [rRes, dRes] = await Promise.all([
        client.get('reviews',              { params: { company_id: reviewCompany || undefined, limit: 200 } }),
        client.get('reviews/dispositions', { params: { company_id: reviewCompany || undefined, limit: 200 } }),
      ]);
      setReviews(rRes.data.reviews || []);
      setDispos(dRes.data.dispositions || []);
    } catch { /* non-critical */ } finally {
      setReviewsLoading(false);
    }
  }, [reviewCompany]);

  useEffect(() => { loadSales(); }, [loadSales]);
  useEffect(() => { loadCompanies(); }, [loadCompanies]);
  useEffect(() => { if (mainTab === 'reviews') loadReviews(); }, [mainTab, loadReviews]);

  const handleLogout = () => { logout(); navigate('/login'); };

  const openEdit = (sale) => {
    setEditTarget(sale);
    setEditStatus(sale.status);
    setEditReason('');
    setEditMsg('');
  };

  const handleSaveEdit = async () => {
    if (!editReason.trim()) { setEditMsg('Reason is required.'); return; }
    setEditSaving(true);
    try {
      await client.post(`sales/${editTarget.id}/compliance`, { status: editStatus, reason: editReason });
      setEditMsg('');
      setEditTarget(null);
      loadSales();
    } catch (err) {
      setEditMsg(err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Failed to save');
    } finally {
      setEditSaving(false);
    }
  };

  const handleSearch = (e) => { e.preventDefault(); setPage(1); loadSales(); };

  return (
    <div className="min-h-screen bg-bg">
      <AppHeader
        title="Compliance"
        logo={<div className="w-10 h-10 bg-gradient-sidebar rounded-lg flex items-center justify-center"><Shield className="text-white" size={24} /></div>}
        theme={theme} onThemeToggle={toggleTheme}
        userEmail={user?.email} userRole={user?.role_name || 'Compliance Manager'} onLogout={handleLogout}
        notifications={notifHook.notifications} unreadCount={notifHook.unreadCount}
        onMarkRead={notifHook.markRead} onMarkAllRead={notifHook.markAllRead}
        onDeleteNotification={notifHook.deleteNotification} onClearNotifications={notifHook.clearAll}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6 animate-fade-in flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold mb-1 text-text">Compliance Dashboard</h2>
            <p className="text-text-secondary">Review and update sale records across all companies</p>
          </div>
          <button onClick={mainTab === 'sales' ? loadSales : loadReviews}
            className="p-2 rounded-lg transition-colors hover:bg-bg-secondary" title="Refresh">
            <RefreshCw size={18} style={{ color: 'var(--color-text-secondary)' }} />
          </button>
        </div>

        {/* Main tab bar */}
        <div className="flex gap-1 mb-6 p-1 rounded-xl w-fit"
          style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          {[{ key: 'sales', label: 'Sales', icon: FileText }, { key: 'reviews', label: 'Call Reviews', icon: Star }].map(t => (
            <button key={t.key} onClick={() => setMainTab(t.key)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
              style={{
                backgroundColor: mainTab === t.key ? 'var(--color-surface)' : 'transparent',
                color: mainTab === t.key ? 'var(--color-primary-600)' : 'var(--color-text-secondary)',
                boxShadow: mainTab === t.key ? 'var(--shadow-sm)' : 'none',
              }}>
              <t.icon size={15} />
              {t.label}
            </button>
          ))}
        </div>

        {mainTab === 'sales' && <>
        {/* ── Search & Filters ─────────────────────────────────────────── */}
        <Card className="p-5 mb-6">
          <form onSubmit={handleSearch} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="relative lg:col-span-2">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Name, phone, reference…"
                className="input pl-9"
              />
            </div>
            <select value={status} onChange={e => setStatus(e.target.value)} className="input">
              <option value="">All statuses</option>
              {COMPLIANCE_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
            <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="input">
              <option value="">All companies</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="flex gap-2">
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input flex-1" title="From" />
              <input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   className="input flex-1" title="To" />
            </div>
            <button type="submit"
              className="lg:col-span-5 py-2 rounded-lg font-semibold text-sm text-white"
              style={{ background: 'var(--gradient-sidebar)' }}>
              Search ({total} records)
            </button>
          </form>
        </Card>

        {/* ── Sales Table ──────────────────────────────────────────────── */}
        <Card className="overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>
          ) : sales.length === 0 ? (
            <div className="text-center py-16">
              <FileText size={48} className="mx-auto mb-4 text-text-tertiary" />
              <p className="text-text-secondary">No sales found. Adjust filters and search.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                    {['Customer', 'Phone', 'Reference', 'Vehicle', 'Status', 'Company', 'Date', 'Actions'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-bold text-text-secondary uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sales.map(s => (
                    <>
                      <tr key={s.id}
                        className="transition-colors hover:bg-bg-secondary"
                        style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td className="px-4 py-3 font-semibold text-text">{s.customer_name || '—'}</td>
                        <td className="px-4 py-3 text-text-secondary">{s.customer_phone || '—'}</td>
                        <td className="px-4 py-3 font-mono text-xs text-text-secondary">{s.reference_no || '—'}</td>
                        <td className="px-4 py-3 text-text-secondary text-xs">
                          {[s.car_year, s.car_make, s.car_model].filter(Boolean).join(' ') || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={STATUS_BADGE[s.status] || 'secondary'} size="sm">
                            {s.status?.replace(/_/g, ' ')}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-text-secondary text-xs">{s.companies?.name || '—'}</td>
                        <td className="px-4 py-3 text-text-tertiary text-xs">
                          {s.created_at ? new Date(s.created_at).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button onClick={() => openEdit(s)}
                              className="px-3 py-1 rounded-lg text-xs font-bold text-white transition-all hover:scale-105"
                              style={{ background: 'var(--gradient-sidebar)' }}>
                              Update
                            </button>
                            {Array.isArray(s.edit_history) && s.edit_history.length > 0 && (
                              <button onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                                className="p-1 rounded transition-colors hover:bg-bg-secondary"
                                title="View audit trail">
                                {expanded === s.id
                                  ? <ChevronUp size={14} style={{ color: 'var(--color-text-secondary)' }} />
                                  : <ChevronDown size={14} style={{ color: 'var(--color-text-secondary)' }} />}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {expanded === s.id && Array.isArray(s.edit_history) && s.edit_history.length > 0 && (
                        <tr key={`${s.id}-history`} style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                          <td colSpan={8} className="px-4 py-3">
                            <p className="text-xs font-bold text-text-secondary mb-2">Audit Trail</p>
                            <div className="space-y-1">
                              {s.edit_history.map((h, i) => (
                                <div key={i} className="text-xs text-text-secondary flex gap-3">
                                  <span className="text-text-tertiary">{new Date(h.edited_at).toLocaleString()}</span>
                                  {h.previous_status && <span>{h.previous_status} → {h.new_status}</span>}
                                  <span className="text-text italic">"{h.reason}"</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {total > LIMIT && (
            <div className="flex items-center justify-between px-4 py-3"
              style={{ borderTop: '1px solid var(--color-border)' }}>
              <span className="text-sm text-text-secondary">
                {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}
              </span>
              <div className="flex gap-2">
                <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                  className="px-3 py-1 rounded text-sm font-semibold disabled:opacity-40 transition-colors hover:bg-bg-secondary"
                  style={{ color: 'var(--color-text-secondary)' }}>
                  Previous
                </button>
                <button disabled={page * LIMIT >= total} onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1 rounded text-sm font-semibold disabled:opacity-40 transition-colors hover:bg-bg-secondary"
                  style={{ color: 'var(--color-text-secondary)' }}>
                  Next
                </button>
              </div>
            </div>
          )}
        </Card>
        </>}

        {mainTab === 'reviews' && (
          <div className="space-y-4">
            {/* Company filter + sub-tabs */}
            <div className="flex flex-wrap gap-3 items-center">
              <select value={reviewCompany} onChange={e => setReviewCompany(e.target.value)} className="input w-56">
                <option value="">All companies</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div className="flex gap-1 p-1 rounded-xl"
                style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                {[{ key: 'ratings', label: 'Call Ratings' }, { key: 'dispos', label: 'Dispositions' }].map(t => (
                  <button key={t.key} onClick={() => setReviewsSubTab(t.key)}
                    className="px-4 py-2 rounded-lg text-sm font-semibold transition-all"
                    style={{
                      backgroundColor: reviewsSubTab === t.key ? 'var(--color-surface)' : 'transparent',
                      color: reviewsSubTab === t.key ? 'var(--color-primary-600)' : 'var(--color-text-secondary)',
                      boxShadow: reviewsSubTab === t.key ? 'var(--shadow-sm)' : 'none',
                    }}>
                    {t.label}
                  </button>
                ))}
              </div>
              <button onClick={loadReviews} className="p-2 rounded-lg hover:bg-bg-secondary transition-colors">
                <RefreshCw size={16} style={{ color: 'var(--color-text-secondary)' }} />
              </button>
            </div>

            <Card className="overflow-hidden">
              {reviewsLoading ? (
                <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>
              ) : reviewsSubTab === 'ratings' ? (
                reviews.length === 0 ? (
                  <div className="text-center py-16 text-text-secondary">No call ratings found.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                          {['Customer', 'Company', 'Closer', 'Rating', 'Notes', 'Date'].map(h => (
                            <th key={h} className="px-4 py-3 text-left text-xs font-bold text-text-secondary uppercase">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {reviews.map(r => (
                          <tr key={r.id} className="hover:bg-bg-secondary" style={{ borderBottom: '1px solid var(--color-border)' }}>
                            <td className="px-4 py-3 font-semibold text-text">
                              {r.transfers?.form_data?.FirstName
                                ? `${r.transfers.form_data.FirstName} ${r.transfers.form_data.LastName || ''}`.trim()
                                : r.transfers?.form_data?.customer_name || '—'}
                            </td>
                            <td className="px-4 py-3 text-xs text-text-secondary">
                              {companies.find(c => c.id === r.company_id)?.name || '—'}
                            </td>
                            <td className="px-4 py-3 text-text-secondary">
                              {r.user_profiles ? `${r.user_profiles.first_name || ''} ${r.user_profiles.last_name || ''}`.trim() : '—'}
                            </td>
                            <td className="px-4 py-3">
                              <span className="px-2 py-1 rounded-full text-xs font-bold capitalize"
                                style={{ backgroundColor: `${RATING_COLOR[r.rating]}20`, color: RATING_COLOR[r.rating] }}>
                                {r.rating?.replace(/_/g, ' ')}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-text-secondary max-w-xs truncate">{r.notes || '—'}</td>
                            <td className="px-4 py-3 text-xs text-text-tertiary">{new Date(r.created_at).toLocaleDateString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : (
                dispos.length === 0 ? (
                  <div className="text-center py-16 text-text-secondary">No dispositions found.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                          {['Customer', 'Company', 'Closer', 'Disposition', 'Notes', 'Date'].map(h => (
                            <th key={h} className="px-4 py-3 text-left text-xs font-bold text-text-secondary uppercase">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dispos.map(d => (
                          <tr key={d.id} className="hover:bg-bg-secondary" style={{ borderBottom: '1px solid var(--color-border)' }}>
                            <td className="px-4 py-3 font-semibold text-text">
                              {d.transfers?.form_data?.FirstName
                                ? `${d.transfers.form_data.FirstName} ${d.transfers.form_data.LastName || ''}`.trim()
                                : d.transfers?.form_data?.customer_name || '—'}
                            </td>
                            <td className="px-4 py-3 text-xs text-text-secondary">
                              {companies.find(c => c.id === d.company_id)?.name || '—'}
                            </td>
                            <td className="px-4 py-3 text-text-secondary">
                              {d.user_profiles ? `${d.user_profiles.first_name || ''} ${d.user_profiles.last_name || ''}`.trim() : '—'}
                            </td>
                            <td className="px-4 py-3">
                              <span className="px-2 py-1 rounded-full text-xs font-bold capitalize bg-info-100 text-info-700">
                                {d.disposition?.replace(/_/g, ' ')}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-text-secondary max-w-xs truncate">{d.notes || '—'}</td>
                            <td className="px-4 py-3 text-xs text-text-tertiary">{new Date(d.created_at).toLocaleDateString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </Card>
          </div>
        )}
      </main>

      {/* ── Edit Modal ────────────────────────────────────────────────── */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-md mx-4 rounded-2xl p-6 shadow-2xl"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <h3 className="text-lg font-bold text-text mb-1">Compliance Update</h3>
            <p className="text-sm text-text-secondary mb-4">
              <strong>{editTarget.customer_name}</strong> · Ref: {editTarget.reference_no || '—'}
            </p>

            <label className="block text-sm font-medium text-text-secondary mb-1">New Status</label>
            <select value={editStatus} onChange={e => setEditStatus(e.target.value)} className="input mb-3">
              {COMPLIANCE_STATUSES.map(s => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
            </select>

            <label className="block text-sm font-medium text-text-secondary mb-1">
              Reason <span className="text-error-500">*</span>
            </label>
            <textarea
              value={editReason} onChange={e => setEditReason(e.target.value)}
              placeholder="Explain the reason for this compliance update…"
              rows={3} className="input mb-3"
            />

            {editMsg && (
              <p className="text-sm text-error-600 mb-3">{editMsg}</p>
            )}

            <div className="flex gap-3">
              <button onClick={() => setEditTarget(null)}
                className="flex-1 py-2 rounded-lg border font-semibold text-sm transition-colors"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                Cancel
              </button>
              <button onClick={handleSaveEdit} disabled={editSaving}
                className="flex-1 py-2 rounded-lg font-semibold text-sm text-white transition-all disabled:opacity-50"
                style={{ background: 'var(--gradient-sidebar)' }}>
                {editSaving ? 'Saving…' : 'Save Update'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ComplianceDashboard;

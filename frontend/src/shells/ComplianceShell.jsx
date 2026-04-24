import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useNavigate } from "react-router-dom";
import {
  Shield, Search, RefreshCw, ChevronDown, ChevronUp,
  FileText, Star, CheckCircle, RotateCcw, Clock, Download,
} from "lucide-react";
import { Card, Badge, Alert } from "../components/UI";
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
  pending_review:       'warning',
  needs_revision:       'error',
};

const ALL_STATUSES = [
  'open', 'sold', 'cancelled', 'follow_up',
  'closed_won', 'closed_lost',
  'compliance_cancelled', 'dispute', 'chargeback',
  'pending_review', 'needs_revision',
];

// Statuses compliance can set via the /compliance endpoint
const COMPLIANCE_EDIT_STATUSES = [
  'open', 'sold', 'cancelled', 'follow_up',
  'closed_won', 'closed_lost',
  'compliance_cancelled', 'dispute', 'chargeback',
];

const RATING_COLOR = {
  excellent: '#16a34a', good: '#2563eb', average: '#d97706',
  below_average: '#ea580c', bad: '#dc2626',
};

const LIMIT = 30;

const ComplianceShell = () => {
  const { user, logout, updateUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const notifHook = useNotifications();

  const isSuperadmin = user?.role === 'superadmin';

  // ── Tab state ────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('queue');

  // ── Pending review queue ─────────────────────────────────────────────────
  const [queue, setQueue]           = useState([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueMsg, setQueueMsg]     = useState('');

  // ── All sales ────────────────────────────────────────────────────────────
  const [sales, setSales]       = useState([]);
  const [total, setTotal]       = useState(0);
  const [salesLoading, setSalesLoading] = useState(false);
  const [page, setPage]         = useState(1);
  const [search, setSearch]     = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [expanded, setExpanded] = useState(null);

  // ── Companies (superadmin only) ──────────────────────────────────────────
  const [companies, setCompanies] = useState([]);
  const [companyFilter, setCompanyFilter] = useState('');

  // ── Call reviews ─────────────────────────────────────────────────────────
  const [reviews, setReviews]           = useState([]);
  const [dispos, setDispos]             = useState([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsSubTab, setReviewsSubTab] = useState('ratings');
  const [reviewCompany, setReviewCompany] = useState('');

  // ── Approve state ─────────────────────────────────────────────────────────
  const [approving, setApproving] = useState(null);
  const [approveMsg, setApproveMsg] = useState('');

  // ── Return modal ─────────────────────────────────────────────────────────
  const [returnTarget, setReturnTarget] = useState(null);
  const [returnNote, setReturnNote]     = useState('');
  const [returning, setReturning]       = useState(false);
  const [returnMsg, setReturnMsg]       = useState('');

  // ── Edit modal (post-confirmation status change) ──────────────────────────
  const [editTarget, setEditTarget] = useState(null);
  const [editStatus, setEditStatus] = useState('');
  const [editReason, setEditReason] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editMsg, setEditMsg]       = useState('');

  // ── Data loaders ─────────────────────────────────────────────────────────

  const loadQueue = useCallback(async () => {
    setQueueLoading(true);
    setQueueMsg('');
    try {
      const res = await client.get('sales/compliance', {
        params: {
          status: 'pending_review',
          limit: 100,
          company_id: companyFilter || undefined,
        },
      });
      setQueue(res.data.sales || []);
    } catch {
      setQueueMsg('Failed to load pending review queue.');
    } finally {
      setQueueLoading(false);
    }
  }, [companyFilter]);

  const loadSales = useCallback(async () => {
    setSalesLoading(true);
    try {
      const res = await client.get('sales/compliance', {
        params: {
          search:     search || undefined,
          status:     statusFilter || undefined,
          date_from:  dateFrom || undefined,
          date_to:    dateTo   || undefined,
          company_id: companyFilter || undefined,
          page,
          limit: LIMIT,
        },
      });
      setSales(res.data.sales || []);
      setTotal(res.data.total || 0);
    } catch { /* non-critical */ } finally {
      setSalesLoading(false);
    }
  }, [search, statusFilter, dateFrom, dateTo, companyFilter, page]);

  const loadCompanies = useCallback(async () => {
    if (!isSuperadmin) return;
    try {
      const res = await client.get('companies');
      setCompanies(res.data.companies || []);
    } catch {}
  }, [isSuperadmin]);

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

  useEffect(() => { loadQueue(); },    [loadQueue]);
  useEffect(() => { loadSales(); },    [loadSales]);
  useEffect(() => { loadCompanies(); },[loadCompanies]);
  useEffect(() => {
    if (activeTab === 'reviews') loadReviews();
  }, [activeTab, loadReviews]);

  const handleLogout = () => { logout(); navigate('/login'); };

  // ── Approve ───────────────────────────────────────────────────────────────
  const handleApprove = async (sale) => {
    setApproving(sale.id);
    try {
      await client.post(`sales/${sale.id}/compliance-approve`);
      await Promise.all([loadQueue(), loadSales()]);
    } catch (err) {
      setQueueMsg(err.response?.data?.error || 'Failed to approve');
    } finally {
      setApproving(null);
    }
  };

  // ── Return ────────────────────────────────────────────────────────────────
  const openReturn = (sale) => {
    setReturnTarget(sale);
    setReturnNote('');
    setReturnMsg('');
  };

  const handleReturn = async () => {
    if (!returnNote.trim()) { setReturnMsg('Note is required.'); return; }
    setReturning(true);
    try {
      await client.post(`sales/${returnTarget.id}/compliance-return`, { note: returnNote });
      setReturnTarget(null);
      await Promise.all([loadQueue(), loadSales()]);
    } catch (err) {
      setReturnMsg(err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Failed to return');
    } finally {
      setReturning(false);
    }
  };

  // ── Edit (post-confirmation) ───────────────────────────────────────────────
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
      setEditTarget(null);
      loadSales();
    } catch (err) {
      setEditMsg(err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Failed to save');
    } finally {
      setEditSaving(false);
    }
  };

  const handleSearch = (e) => { e.preventDefault(); setPage(1); loadSales(); };

  const exportCSV = () => {
    const headers = ['Customer','Phone','Email','Reference','Vehicle','Plan','Monthly Payment','Down Payment','Status','Sale Date','Created At'];
    const rows = sales.map(s => [
      s.customer_name   || '',
      s.customer_phone  || '',
      s.customer_email  || '',
      s.reference_no    || '',
      [s.car_year, s.car_make, s.car_model].filter(Boolean).join(' '),
      s.plan            || '',
      s.monthly_payment || '',
      s.down_payment    || '',
      s.status          || '',
      s.sale_date       || '',
      s.created_at ? new Date(s.created_at).toLocaleDateString() : '',
    ]);
    const csv = [headers, ...rows]
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `sales_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Tabs config ───────────────────────────────────────────────────────────
  const TABS = [
    { key: 'queue',   label: 'Pending Review', icon: Clock,      badge: queue.length || null },
    { key: 'sales',   label: 'All Sales',      icon: FileText,   badge: null },
    { key: 'reviews', label: 'Call Reviews',   icon: Star,       badge: null },
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      <AppHeader
        title="Compliance"
        logo={
          <div className="w-10 h-10 bg-gradient-sidebar rounded-lg flex items-center justify-center">
            <Shield className="text-white" size={24} />
          </div>
        }
        theme={theme} onThemeToggle={toggleTheme}
        userEmail={user?.email}
        userRole={user?.role_name || 'Compliance Manager'}
        onLogout={handleLogout}
        user={user} onUpdateUser={updateUser}
        notifications={notifHook.notifications}
        unreadCount={notifHook.unreadCount}
        onMarkRead={notifHook.markRead}
        onMarkAllRead={notifHook.markAllRead}
        onDeleteNotification={notifHook.deleteNotification}
        onClearNotifications={notifHook.clearAll}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* ── Primary tabs ──────────────────────────────────────────────── */}
        <div className="flex gap-1 mb-6 p-1 rounded-xl w-fit"
          style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
              style={{
                background: activeTab === t.key ? 'var(--gradient-sidebar)' : 'transparent',
                color: activeTab === t.key ? 'white' : 'var(--color-text-secondary)',
                boxShadow: activeTab === t.key ? 'var(--shadow-sm)' : 'none',
              }}>
              <t.icon size={15} />
              {t.label}
              {t.badge ? (
                <span className="ml-1 px-1.5 py-0.5 rounded-full text-xs font-bold"
                  style={{ backgroundColor: 'var(--color-warning-500)', color: '#fff' }}>
                  {t.badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {/* ── Company filter (superadmin only) ─────────────────────────── */}
        {isSuperadmin && companies.length > 0 && (
          <div className="mb-6 flex items-center gap-3">
            <label className="text-sm font-medium text-text-secondary">Company:</label>
            <select
              value={companyFilter}
              onChange={e => { setCompanyFilter(e.target.value); setPage(1); }}
              className="input w-56"
            >
              <option value="">All companies</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════ */}
        {/* PENDING REVIEW QUEUE                                          */}
        {/* ══════════════════════════════════════════════════════════════ */}
        {activeTab === 'queue' && (
          <div>
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-text">Pending Review Queue</h2>
                <p className="text-sm text-text-secondary mt-1">
                  Sales awaiting compliance approval
                </p>
              </div>
              <button onClick={loadQueue}
                className="p-2 rounded-lg hover:bg-bg-secondary transition-colors"
                title="Refresh">
                <RefreshCw size={18} style={{ color: 'var(--color-text-secondary)' }} />
              </button>
            </div>

            {queueMsg && (
              <Alert variant="error" className="mb-4">{queueMsg}</Alert>
            )}

            <Card className="overflow-hidden">
              {queueLoading ? (
                <div className="flex justify-center py-16">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2"
                    style={{ borderColor: 'var(--color-primary-600)' }} />
                </div>
              ) : queue.length === 0 ? (
                <div className="text-center py-20">
                  <CheckCircle size={48} className="mx-auto mb-4"
                    style={{ color: 'var(--color-success-500)' }} />
                  <p className="text-lg font-semibold text-text mb-1">All clear!</p>
                  <p className="text-sm text-text-secondary">No sales pending review.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                        {['Customer', 'Phone', 'Reference', 'Closer', 'Submitted', isSuperadmin && 'Company', 'Compliance Note', 'Actions']
                          .filter(Boolean)
                          .map(h => (
                            <th key={h} className="px-4 py-3 text-left text-xs font-bold text-text-secondary uppercase tracking-wider">{h}</th>
                          ))}
                      </tr>
                    </thead>
                    <tbody>
                      {queue.map(s => (
                        <tr key={s.id}
                          className="transition-colors hover:bg-bg-secondary"
                          style={{ borderBottom: '1px solid var(--color-border)' }}>
                          <td className="px-4 py-3 font-semibold text-text">{s.customer_name || '—'}</td>
                          <td className="px-4 py-3 text-text-secondary">{s.customer_phone || '—'}</td>
                          <td className="px-4 py-3 font-mono text-xs text-text-secondary">{s.reference_no || '—'}</td>
                          <td className="px-4 py-3 text-text-secondary text-sm">
                            {s.user_profiles
                              ? `${s.user_profiles.first_name || ''} ${s.user_profiles.last_name || ''}`.trim() || '—'
                              : '—'}
                          </td>
                          <td className="px-4 py-3 text-text-tertiary text-xs">
                            {s.submitted_for_review_at
                              ? new Date(s.submitted_for_review_at).toLocaleString()
                              : s.created_at ? new Date(s.created_at).toLocaleString() : '—'}
                          </td>
                          {isSuperadmin && (
                            <td className="px-4 py-3 text-text-secondary text-xs">
                              {s.companies?.name || '—'}
                            </td>
                          )}
                          <td className="px-4 py-3 text-xs text-text-secondary max-w-xs">
                            {s.compliance_note
                              ? <span className="text-warning-600 font-medium">{s.compliance_note}</span>
                              : <span className="text-text-tertiary italic">First submission</span>}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleApprove(s)}
                                disabled={approving === s.id}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-all hover:scale-105 disabled:opacity-60"
                                style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
                                <CheckCircle size={12} />
                                {approving === s.id ? 'Approving…' : 'Approve'}
                              </button>
                              <button
                                onClick={() => openReturn(s)}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:scale-105"
                                style={{
                                  backgroundColor: 'var(--color-bg-secondary)',
                                  color: 'var(--color-warning-600)',
                                  border: '1px solid var(--color-warning-300)',
                                }}>
                                <RotateCcw size={12} />
                                Return
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════ */}
        {/* ALL SALES                                                     */}
        {/* ══════════════════════════════════════════════════════════════ */}
        {activeTab === 'sales' && (
          <div>
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-text">All Sales</h2>
                <p className="text-sm text-text-secondary mt-1">
                  Full sales history for your company
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={exportCSV} disabled={sales.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all hover:scale-105 disabled:opacity-40"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
                  title="Export current results to CSV">
                  <Download size={14} /> Export CSV
                </button>
                <button onClick={loadSales}
                  className="p-2 rounded-lg hover:bg-bg-secondary transition-colors"
                  title="Refresh">
                  <RefreshCw size={18} style={{ color: 'var(--color-text-secondary)' }} />
                </button>
              </div>
            </div>

            {/* Filters */}
            <Card className="p-5 mb-6">
              <form onSubmit={handleSearch}
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div className="relative lg:col-span-2">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2"
                    style={{ color: 'var(--color-text-tertiary)' }} />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Name, phone, reference…"
                    className="input pl-9"
                  />
                </div>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input">
                  <option value="">All statuses</option>
                  {ALL_STATUSES.map(s => (
                    <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                    className="input flex-1" title="From" />
                  <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                    className="input flex-1" title="To" />
                </div>
                <button type="submit"
                  className="py-2 rounded-lg font-semibold text-sm text-white"
                  style={{ background: 'var(--gradient-sidebar)' }}>
                  Search ({total} records)
                </button>
              </form>
            </Card>

            {/* Sales table */}
            <Card className="overflow-hidden">
              {salesLoading ? (
                <div className="flex justify-center py-16">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2"
                    style={{ borderColor: 'var(--color-primary-600)' }} />
                </div>
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
                        {['Customer', 'Phone', 'Reference', 'Vehicle', 'Status', isSuperadmin && 'Company', 'Date', 'Actions']
                          .filter(Boolean)
                          .map(h => (
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
                            {isSuperadmin && (
                              <td className="px-4 py-3 text-text-secondary text-xs">{s.companies?.name || '—'}</td>
                            )}
                            <td className="px-4 py-3 text-text-tertiary text-xs">
                              {s.created_at ? new Date(s.created_at).toLocaleDateString() : '—'}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                {s.status === 'pending_review' ? (
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => handleApprove(s)}
                                      disabled={approving === s.id}
                                      className="px-3 py-1 rounded-lg text-xs font-bold text-white disabled:opacity-60"
                                      style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
                                      {approving === s.id ? '…' : 'Approve'}
                                    </button>
                                    <button
                                      onClick={() => openReturn(s)}
                                      className="px-3 py-1 rounded-lg text-xs font-bold"
                                      style={{ color: 'var(--color-warning-600)', border: '1px solid var(--color-warning-300)' }}>
                                      Return
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => openEdit(s)}
                                    className="px-3 py-1 rounded-lg text-xs font-bold text-white transition-all hover:scale-105"
                                    style={{ background: 'var(--gradient-sidebar)' }}>
                                    Update
                                  </button>
                                )}
                                {Array.isArray(s.edit_history) && s.edit_history.length > 0 && (
                                  <button
                                    onClick={() => setExpanded(expanded === s.id ? null : s.id)}
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
                            <tr key={`${s.id}-hist`} style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                              <td colSpan={isSuperadmin ? 8 : 7} className="px-4 py-3">
                                <p className="text-xs font-bold text-text-secondary mb-2">Audit Trail</p>
                                <div className="space-y-1">
                                  {s.edit_history.map((h, i) => (
                                    <div key={i} className="text-xs text-text-secondary flex gap-3">
                                      <span className="text-text-tertiary">
                                        {new Date(h.edited_at).toLocaleString()}
                                      </span>
                                      {h.previous_status && (
                                        <span>{h.previous_status} → {h.new_status || h.action}</span>
                                      )}
                                      {h.reason && <span className="text-text italic">"{h.reason}"</span>}
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
                      className="px-3 py-1 rounded text-sm font-semibold disabled:opacity-40 hover:bg-bg-secondary transition-colors"
                      style={{ color: 'var(--color-text-secondary)' }}>
                      Previous
                    </button>
                    <button disabled={page * LIMIT >= total} onClick={() => setPage(p => p + 1)}
                      className="px-3 py-1 rounded text-sm font-semibold disabled:opacity-40 hover:bg-bg-secondary transition-colors"
                      style={{ color: 'var(--color-text-secondary)' }}>
                      Next
                    </button>
                  </div>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════ */}
        {/* CALL REVIEWS                                                  */}
        {/* ══════════════════════════════════════════════════════════════ */}
        {activeTab === 'reviews' && (
          <div>
            <div className="mb-6 flex flex-wrap gap-3 items-center justify-between">
              <h2 className="text-2xl font-bold text-text">Call Reviews</h2>
              <div className="flex flex-wrap gap-3 items-center">
                {isSuperadmin && companies.length > 0 && (
                  <select
                    value={reviewCompany}
                    onChange={e => setReviewCompany(e.target.value)}
                    className="input w-48">
                    <option value="">All companies</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
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
                <button onClick={loadReviews}
                  className="p-2 rounded-lg hover:bg-bg-secondary transition-colors">
                  <RefreshCw size={16} style={{ color: 'var(--color-text-secondary)' }} />
                </button>
              </div>
            </div>

            <Card className="overflow-hidden">
              {reviewsLoading ? (
                <div className="flex justify-center py-16">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2"
                    style={{ borderColor: 'var(--color-primary-600)' }} />
                </div>
              ) : reviewsSubTab === 'ratings' ? (
                reviews.length === 0 ? (
                  <div className="text-center py-16 text-text-secondary">No call ratings found.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                          {['Customer', isSuperadmin && 'Company', 'Closer', 'Rating', 'Notes', 'Date']
                            .filter(Boolean).map(h => (
                              <th key={h} className="px-4 py-3 text-left text-xs font-bold text-text-secondary uppercase">{h}</th>
                            ))}
                        </tr>
                      </thead>
                      <tbody>
                        {reviews.map(r => (
                          <tr key={r.id} className="hover:bg-bg-secondary"
                            style={{ borderBottom: '1px solid var(--color-border)' }}>
                            <td className="px-4 py-3 font-semibold text-text">
                              {r.transfers?.form_data?.FirstName
                                ? `${r.transfers.form_data.FirstName} ${r.transfers.form_data.LastName || ''}`.trim()
                                : r.transfers?.form_data?.customer_name || '—'}
                            </td>
                            {isSuperadmin && (
                              <td className="px-4 py-3 text-xs text-text-secondary">
                                {companies.find(c => c.id === r.company_id)?.name || '—'}
                              </td>
                            )}
                            <td className="px-4 py-3 text-text-secondary">
                              {r.user_profiles
                                ? `${r.user_profiles.first_name || ''} ${r.user_profiles.last_name || ''}`.trim()
                                : '—'}
                            </td>
                            <td className="px-4 py-3">
                              <span className="px-2 py-1 rounded-full text-xs font-bold capitalize"
                                style={{
                                  backgroundColor: `${RATING_COLOR[r.rating]}20`,
                                  color: RATING_COLOR[r.rating],
                                }}>
                                {r.rating?.replace(/_/g, ' ')}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-text-secondary max-w-xs truncate">{r.notes || '—'}</td>
                            <td className="px-4 py-3 text-xs text-text-tertiary">
                              {new Date(r.created_at).toLocaleDateString()}
                            </td>
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
                          {['Customer', isSuperadmin && 'Company', 'Closer', 'Disposition', 'Notes', 'Date']
                            .filter(Boolean).map(h => (
                              <th key={h} className="px-4 py-3 text-left text-xs font-bold text-text-secondary uppercase">{h}</th>
                            ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dispos.map(d => (
                          <tr key={d.id} className="hover:bg-bg-secondary"
                            style={{ borderBottom: '1px solid var(--color-border)' }}>
                            <td className="px-4 py-3 font-semibold text-text">
                              {d.transfers?.form_data?.FirstName
                                ? `${d.transfers.form_data.FirstName} ${d.transfers.form_data.LastName || ''}`.trim()
                                : d.transfers?.form_data?.customer_name || '—'}
                            </td>
                            {isSuperadmin && (
                              <td className="px-4 py-3 text-xs text-text-secondary">
                                {companies.find(c => c.id === d.company_id)?.name || '—'}
                              </td>
                            )}
                            <td className="px-4 py-3 text-text-secondary">
                              {d.user_profiles
                                ? `${d.user_profiles.first_name || ''} ${d.user_profiles.last_name || ''}`.trim()
                                : '—'}
                            </td>
                            <td className="px-4 py-3">
                              <span className="px-2 py-1 rounded-full text-xs font-bold capitalize bg-info-100 text-info-700">
                                {d.disposition?.replace(/_/g, ' ')}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-text-secondary max-w-xs truncate">{d.notes || '—'}</td>
                            <td className="px-4 py-3 text-xs text-text-tertiary">
                              {new Date(d.created_at).toLocaleDateString()}
                            </td>
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

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* RETURN MODAL                                                      */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {returnTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-md mx-4 rounded-2xl p-6 shadow-2xl"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <h3 className="text-lg font-bold text-text mb-1">Return to Closer</h3>
            <p className="text-sm text-text-secondary mb-4">
              <strong>{returnTarget.customer_name}</strong> · Ref: {returnTarget.reference_no || '—'}
            </p>

            <label className="block text-sm font-medium text-text-secondary mb-1">
              Note for closer <span className="text-error-500">*</span>
            </label>
            <textarea
              value={returnNote}
              onChange={e => setReturnNote(e.target.value)}
              placeholder="Explain what needs to be corrected…"
              rows={4}
              className="input mb-3"
              autoFocus
            />

            {returnMsg && <p className="text-sm text-error-600 mb-3">{returnMsg}</p>}

            <div className="flex gap-3">
              <button onClick={() => setReturnTarget(null)}
                className="flex-1 py-2 rounded-lg border font-semibold text-sm transition-colors"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                Cancel
              </button>
              <button onClick={handleReturn} disabled={returning}
                className="flex-1 py-2 rounded-lg font-semibold text-sm text-white transition-all disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #d97706, #b45309)' }}>
                {returning ? 'Returning…' : 'Return to Closer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* EDIT MODAL (post-confirmation status change)                      */}
      {/* ══════════════════════════════════════════════════════════════════ */}
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
              {COMPLIANCE_EDIT_STATUSES.map(s => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
            </select>

            <label className="block text-sm font-medium text-text-secondary mb-1">
              Reason <span className="text-error-500">*</span>
            </label>
            <textarea
              value={editReason}
              onChange={e => setEditReason(e.target.value)}
              placeholder="Explain the reason for this compliance update…"
              rows={3}
              className="input mb-3"
            />

            {editMsg && <p className="text-sm text-error-600 mb-3">{editMsg}</p>}

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

export default ComplianceShell;

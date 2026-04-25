import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useFeatureFlags } from "../contexts/FeatureFlagsContext";
import { useTheme } from "../contexts/ThemeContext";
import { useNavigate } from "react-router-dom";
import {
  Shield, Search, RefreshCw, ChevronDown, ChevronUp,
  FileText, Star, CheckCircle, RotateCcw, Clock, Download,
  Eye, AlertCircle, Car, DollarSign, User, Calendar,
  TrendingUp, AlertTriangle, XCircle,
} from "lucide-react";
import { Card, Badge, Alert } from "../components/UI";
import { AppHeader } from "../components/Layout";
import { useNotifications } from "../hooks/useNotifications";
import SaleDetailDrawer from "../components/Shared/SaleDetailDrawer";
import client from "../api/client";

// ── helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

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

const STATUS_LABEL = {
  open: 'Open', sold: 'Sold', closed_won: 'Approved', closed_lost: 'Lost',
  cancelled: 'Cancelled', compliance_cancelled: 'Compliance Cancelled',
  follow_up: 'Follow Up', dispute: 'Dispute', chargeback: 'Chargeback',
  pending_review: 'Pending Review', needs_revision: 'Needs Revision',
};

const ALL_STATUSES = [
  'open', 'sold', 'cancelled', 'follow_up',
  'closed_won', 'closed_lost',
  'compliance_cancelled', 'dispute', 'chargeback',
  'pending_review', 'needs_revision',
];

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

// ── component ─────────────────────────────────────────────────────────────────

const ComplianceShell = () => {
  const { user, logout, updateUser, hasPermission } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const notifHook = useNotifications();
  const { isEnabled } = useFeatureFlags();

  const isSuperadmin = user?.role === 'superadmin';

  const canManageCompliance = (isSuperadmin || hasPermission('manage_compliance')) && isEnabled('compliance_workflow');
  const canViewAllSales     = (isSuperadmin || hasPermission('view_all_company_sales')) && isEnabled('sales');
  const canViewReviews      = (isSuperadmin || hasPermission('view_all_call_reviews')) && isEnabled('call_reviews');
  const canViewFinancial    = isSuperadmin || hasPermission('view_financial_data');
  const canSearch           = (isSuperadmin || hasPermission('search_sales')) && isEnabled('search_sales');
  const canExportCSV        = (isSuperadmin || hasPermission('view_all_company_sales')) && isEnabled('csv_export');

  // ── Tab state ────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('queue');

  // ── Detail drawer ────────────────────────────────────────────────────────
  const [detailSale, setDetailSale] = useState(null);

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

  // ── Edit modal ───────────────────────────────────────────────────────────
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
        params: { status: 'pending_review', limit: 100, company_id: companyFilter || undefined },
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
          search:     search     || undefined,
          status:     statusFilter || undefined,
          date_from:  dateFrom   || undefined,
          date_to:    dateTo     || undefined,
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

  useEffect(() => { if (canManageCompliance) loadQueue(); }, [loadQueue, canManageCompliance]);
  useEffect(() => { if (canViewAllSales) loadSales(); },    [loadSales, canViewAllSales]);
  useEffect(() => { loadCompanies(); },                     [loadCompanies]);
  useEffect(() => {
    if (activeTab === 'reviews' && canViewReviews) loadReviews();
  }, [activeTab, loadReviews, canViewReviews]);

  const handleLogout = () => { logout(); navigate('/login'); };

  // ── Approve ───────────────────────────────────────────────────────────────
  const handleApprove = async (sale) => {
    setApproving(sale.id);
    setApproveMsg('');
    try {
      await client.post(`sales/${sale.id}/compliance-approve`);
      await Promise.all([loadQueue(), loadSales()]);
    } catch (err) {
      setApproveMsg(err.response?.data?.error || 'Failed to approve');
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

  // ── Edit (post-confirmation status change) ────────────────────────────────
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
    a.href = url; a.download = `sales_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Tabs ─────────────────────────────────────────────────────────────────
  const TABS = [
    canManageCompliance && { key: 'queue',   label: 'Review Queue', icon: Clock,    badge: queue.length || null },
    canViewAllSales     && { key: 'sales',   label: 'All Sales',    icon: FileText, badge: null },
    canViewReviews      && { key: 'reviews', label: 'Call Reviews', icon: Star,     badge: null },
  ].filter(Boolean);

  useEffect(() => {
    if (TABS.length > 0 && !TABS.find(t => t.key === activeTab)) setActiveTab(TABS[0].key);
  }, [canManageCompliance, canViewAllSales, canViewReviews]);

  // ── closer name helper ─────────────────────────────────────────────────────
  const closerName = (s) =>
    s.closer_name ||
    (s.user_profiles ? `${s.user_profiles.first_name || ''} ${s.user_profiles.last_name || ''}`.trim() : null) ||
    '—';

  // ── render ────────────────────────────────────────────────────────────────
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

        {/* ── No access ──────────────────────────────────────────────────── */}
        {TABS.length === 0 && (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
              style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
              <Shield size={32} style={{ color: 'var(--color-text-tertiary)' }} />
            </div>
            <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--color-text)' }}>No Access</h2>
            <p className="text-sm max-w-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Your role has no permissions enabled. Ask your admin to grant you compliance permissions.
            </p>
          </div>
        )}

        {TABS.length > 0 && (
          <>
            {/* ── Tab bar ──────────────────────────────────────────────── */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
              <div className="flex gap-1 p-1 rounded-xl w-fit"
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
                        style={{ backgroundColor: '#f59e0b', color: '#fff' }}>
                        {t.badge}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>

              {/* Company filter — superadmin */}
              {isSuperadmin && companies.length > 0 && (
                <div className="flex items-center gap-2">
                  <label className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Company:</label>
                  <select value={companyFilter} onChange={e => { setCompanyFilter(e.target.value); setPage(1); }}
                    className="input text-sm py-1.5" style={{ minWidth: 180 }}>
                    <option value="">All companies</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
            </div>

            {/* ══════════════════════════════════════════════════════════ */}
            {/* PENDING REVIEW QUEUE                                      */}
            {/* ══════════════════════════════════════════════════════════ */}
            {activeTab === 'queue' && (
              <div>
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}>
                      Pending Review
                    </h2>
                    <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                      {queue.length === 0 ? 'All clear — no sales awaiting review'
                        : `${queue.length} sale${queue.length !== 1 ? 's' : ''} awaiting compliance approval`}
                    </p>
                  </div>
                  <button onClick={loadQueue} title="Refresh"
                    className="p-2 rounded-lg transition-colors"
                    style={{ color: 'var(--color-text-secondary)' }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                    <RefreshCw size={18} />
                  </button>
                </div>

                {queueMsg && <Alert variant="error" className="mb-4">{queueMsg}</Alert>}
                {approveMsg && <Alert variant="error" className="mb-4">{approveMsg}</Alert>}

                {queueLoading ? (
                  <div className="flex justify-center py-20">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2"
                      style={{ borderColor: 'var(--color-primary-600)' }} />
                  </div>
                ) : queue.length === 0 ? (
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
                      <div key={s.id}
                        className="rounded-2xl flex flex-col transition-all duration-200 hover:shadow-lg cursor-pointer"
                        style={{
                          backgroundColor: 'var(--color-surface)',
                          border: '1px solid var(--color-border)',
                          boxShadow: 'var(--shadow-sm)',
                        }}
                        onClick={() => setDetailSale(s)}>

                        {/* Card header */}
                        <div className="p-4 flex items-start justify-between gap-3"
                          style={{ borderBottom: '1px solid var(--color-border)' }}>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                                style={{ backgroundColor: 'var(--color-primary-100)' }}>
                                <User size={13} style={{ color: 'var(--color-primary-600)' }} />
                              </div>
                              <p className="font-bold truncate" style={{ color: 'var(--color-text)', fontSize: '0.95rem' }}>
                                {s.customer_name || '—'}
                              </p>
                            </div>
                            <p className="text-xs pl-9" style={{ color: 'var(--color-text-secondary)' }}>
                              {s.customer_phone || '—'}
                              {s.reference_no && (
                                <span className="ml-2 font-mono" style={{ color: 'var(--color-text-tertiary)' }}>
                                  #{s.reference_no}
                                </span>
                              )}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-1 flex-shrink-0">
                            <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                              style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>
                              {timeAgo(s.submitted_for_review_at || s.created_at)}
                            </span>
                            {isSuperadmin && s.companies?.name && (
                              <span className="text-xs px-2 py-0.5 rounded-full"
                                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>
                                {s.companies.name}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Info grid */}
                        <div className="p-4 grid grid-cols-3 gap-3 text-xs"
                          style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                          <div>
                            <p className="mb-0.5 font-semibold uppercase tracking-wide"
                              style={{ color: 'var(--color-text-tertiary)', fontSize: '0.65rem' }}>Vehicle</p>
                            <p className="font-medium" style={{ color: 'var(--color-text)' }}>
                              {[s.car_year, s.car_make, s.car_model].filter(Boolean).join(' ') || '—'}
                            </p>
                          </div>
                          <div>
                            <p className="mb-0.5 font-semibold uppercase tracking-wide"
                              style={{ color: 'var(--color-text-tertiary)', fontSize: '0.65rem' }}>Monthly</p>
                            <p className="font-bold" style={{ color: canViewFinancial && s.monthly_payment ? '#16a34a' : 'var(--color-text-secondary)' }}>
                              {canViewFinancial && s.monthly_payment ? `$${s.monthly_payment}/mo` : '—'}
                            </p>
                          </div>
                          <div>
                            <p className="mb-0.5 font-semibold uppercase tracking-wide"
                              style={{ color: 'var(--color-text-tertiary)', fontSize: '0.65rem' }}>Closer</p>
                            <p className="font-medium truncate" style={{ color: 'var(--color-text)' }}>
                              {closerName(s)}
                            </p>
                          </div>
                        </div>

                        {/* Compliance note (if previously returned) */}
                        {s.compliance_note && (
                          <div className="mx-4 mt-3 p-3 rounded-xl flex items-start gap-2 text-xs"
                            style={{ backgroundColor: '#fef3c7', border: '1px solid #fde68a' }}>
                            <AlertTriangle size={12} style={{ color: '#d97706', marginTop: 1, flexShrink: 0 }} />
                            <div>
                              <p className="font-bold mb-0.5" style={{ color: '#92400e' }}>Previous compliance note:</p>
                              <p style={{ color: '#78350f' }}>{s.compliance_note}</p>
                            </div>
                          </div>
                        )}

                        {/* Plan / client info */}
                        {(s.plan || s.client_name) && (
                          <div className="px-4 pt-3 text-xs flex items-center gap-3" style={{ color: 'var(--color-text-secondary)' }}>
                            {s.client_name && <span>Client: <strong>{s.client_name}</strong></span>}
                            {s.plan        && <span>Plan: <strong>{s.plan}</strong></span>}
                          </div>
                        )}

                        {/* Actions */}
                        <div className="p-4 mt-auto flex items-center gap-2">
                          <button
                            onClick={e => { e.stopPropagation(); handleApprove(s); }}
                            disabled={approving === s.id}
                            className="flex-1 py-2 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-1.5 transition-all hover:opacity-90 disabled:opacity-60"
                            style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
                            <CheckCircle size={14} />
                            {approving === s.id ? 'Approving…' : 'Approve'}
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); openReturn(s); }}
                            className="flex-1 py-2 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 transition-all hover:opacity-90"
                            style={{ border: '1.5px solid #fbbf24', color: '#d97706', backgroundColor: '#fffbeb' }}>
                            <RotateCcw size={14} />
                            Return
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); setDetailSale(s); }}
                            title="View full details"
                            className="p-2 rounded-xl flex items-center justify-center transition-all hover:opacity-90"
                            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-bg-secondary)' }}>
                            <Eye size={15} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ══════════════════════════════════════════════════════════ */}
            {/* ALL SALES                                                 */}
            {/* ══════════════════════════════════════════════════════════ */}
            {activeTab === 'sales' && (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}>
                      All Sales
                    </h2>
                    <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                      Full sales history for your company
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {canExportCSV && (
                      <button onClick={exportCSV} disabled={sales.length === 0}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all hover:scale-105 disabled:opacity-40"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                        <Download size={13} /> Export CSV
                      </button>
                    )}
                    <button onClick={loadSales} title="Refresh"
                      className="p-2 rounded-lg transition-colors"
                      style={{ color: 'var(--color-text-secondary)' }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                      <RefreshCw size={18} />
                    </button>
                  </div>
                </div>

                {/* Filters */}
                <Card className="p-4 mb-5">
                  <form onSubmit={handleSearch}
                    className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                    {canSearch && (
                      <div className="relative lg:col-span-2">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2"
                          style={{ color: 'var(--color-text-tertiary)' }} />
                        <input value={search} onChange={e => setSearch(e.target.value)}
                          placeholder="Name, phone, reference…" className="input pl-9 text-sm" />
                      </div>
                    )}
                    <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                      className={`input text-sm ${canSearch ? '' : 'lg:col-span-2'}`}>
                      <option value="">All statuses</option>
                      {ALL_STATUSES.map(s => (
                        <option key={s} value={s}>{STATUS_LABEL[s] || s.replace(/_/g, ' ')}</option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                        className="input flex-1 text-sm" title="From date" />
                      <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                        className="input flex-1 text-sm" title="To date" />
                    </div>
                    <button type="submit"
                      className="py-2 rounded-lg font-semibold text-sm text-white"
                      style={{ background: 'var(--gradient-sidebar)' }}>
                      Filter
                      {total > 0 && <span className="ml-1 opacity-80">({total})</span>}
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
                      <FileText size={40} className="mx-auto mb-3" style={{ color: 'var(--color-text-tertiary)', opacity: 0.5 }} />
                      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                        No sales found. Try adjusting filters.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                            {['Customer', 'Vehicle', canViewFinancial && 'Payment', 'Status', 'Closer',
                              isSuperadmin && 'Company', 'Date', canManageCompliance && 'Actions']
                              .filter(Boolean)
                              .map(h => (
                                <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider"
                                  style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                              ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sales.map(s => (
                            <>
                              <tr key={s.id}
                                className="transition-colors cursor-pointer"
                                style={{ borderBottom: '1px solid var(--color-border)' }}
                                onClick={() => setDetailSale(s)}
                                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'}
                                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>

                                <td className="px-4 py-3">
                                  <p className="font-semibold" style={{ color: 'var(--color-text)' }}>{s.customer_name || '—'}</p>
                                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{s.customer_phone || ''}</p>
                                  {s.reference_no && (
                                    <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>#{s.reference_no}</p>
                                  )}
                                </td>

                                <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                                  {[s.car_year, s.car_make, s.car_model].filter(Boolean).join(' ') || '—'}
                                </td>

                                {canViewFinancial && (
                                  <td className="px-4 py-3 text-xs font-semibold" style={{ color: '#16a34a' }}>
                                    {s.monthly_payment ? `$${s.monthly_payment}/mo` : '—'}
                                  </td>
                                )}

                                <td className="px-4 py-3">
                                  <Badge variant={STATUS_BADGE[s.status] || 'secondary'} size="sm">
                                    {STATUS_LABEL[s.status] || s.status?.replace(/_/g, ' ')}
                                  </Badge>
                                  {s.compliance_note && s.status === 'needs_revision' && (
                                    <p className="text-xs mt-1 italic truncate max-w-[140px]"
                                      style={{ color: 'var(--color-warning-600)' }}>
                                      {s.compliance_note}
                                    </p>
                                  )}
                                </td>

                                <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                                  {closerName(s)}
                                </td>

                                {isSuperadmin && (
                                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                                    {s.companies?.name || '—'}
                                  </td>
                                )}

                                <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                                  {s.created_at ? new Date(s.created_at).toLocaleDateString() : '—'}
                                </td>

                                {canManageCompliance && (
                                  <td className="px-4 py-3">
                                    <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                                      {s.status === 'pending_review' ? (
                                        <>
                                          <button onClick={() => handleApprove(s)} disabled={approving === s.id}
                                            className="px-2.5 py-1 rounded-lg text-xs font-bold text-white disabled:opacity-60 transition-all hover:scale-105"
                                            style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)' }}>
                                            {approving === s.id ? '…' : 'Approve'}
                                          </button>
                                          <button onClick={() => openReturn(s)}
                                            className="px-2.5 py-1 rounded-lg text-xs font-bold transition-all hover:scale-105"
                                            style={{ color: '#d97706', border: '1px solid #fbbf24', backgroundColor: '#fffbeb' }}>
                                            Return
                                          </button>
                                        </>
                                      ) : (
                                        <button onClick={() => openEdit(s)}
                                          className="px-2.5 py-1 rounded-lg text-xs font-bold text-white transition-all hover:scale-105"
                                          style={{ background: 'var(--gradient-sidebar)' }}>
                                          Update
                                        </button>
                                      )}
                                      {/* Audit trail toggle */}
                                      {Array.isArray(s.edit_history) && s.edit_history.length > 0 && (
                                        <button onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                                          className="p-1 rounded transition-colors"
                                          style={{ color: 'var(--color-text-secondary)' }}
                                          title="Audit trail">
                                          {expanded === s.id
                                            ? <ChevronUp size={13} />
                                            : <ChevronDown size={13} />}
                                        </button>
                                      )}
                                      <button onClick={() => setDetailSale(s)}
                                        title="View details"
                                        className="p-1 rounded transition-colors"
                                        style={{ color: 'var(--color-primary-600)' }}>
                                        <Eye size={14} />
                                      </button>
                                    </div>
                                  </td>
                                )}
                              </tr>

                              {/* Expanded audit trail */}
                              {expanded === s.id && Array.isArray(s.edit_history) && s.edit_history.length > 0 && (
                                <tr key={`${s.id}-hist`} style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                                  <td colSpan={10} className="px-5 py-3">
                                    <p className="text-xs font-bold mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                                      Audit Trail
                                    </p>
                                    <div className="space-y-1">
                                      {s.edit_history.map((h, i) => (
                                        <div key={i} className="text-xs flex gap-3 items-start">
                                          <span style={{ color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
                                            {new Date(h.edited_at).toLocaleString()}
                                          </span>
                                          {h.previous_status && (
                                            <span style={{ color: 'var(--color-text-secondary)' }}>
                                              {h.previous_status} → {h.new_status || h.action}
                                            </span>
                                          )}
                                          {(h.reason || h.note) && (
                                            <span className="italic" style={{ color: 'var(--color-text)' }}>
                                              "{h.reason || h.note}"
                                            </span>
                                          )}
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
                      <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                        {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}
                      </span>
                      <div className="flex gap-2">
                        <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                          className="px-3 py-1 rounded text-sm font-semibold disabled:opacity-40 transition-colors"
                          style={{ color: 'var(--color-text-secondary)' }}
                          onMouseEnter={e => { if (page !== 1) e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'; }}
                          onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                          Previous
                        </button>
                        <button disabled={page * LIMIT >= total} onClick={() => setPage(p => p + 1)}
                          className="px-3 py-1 rounded text-sm font-semibold disabled:opacity-40 transition-colors"
                          style={{ color: 'var(--color-text-secondary)' }}
                          onMouseEnter={e => { if (page * LIMIT < total) e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'; }}
                          onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </Card>
              </div>
            )}

            {/* ══════════════════════════════════════════════════════════ */}
            {/* CALL REVIEWS                                              */}
            {/* ══════════════════════════════════════════════════════════ */}
            {activeTab === 'reviews' && (
              <div>
                <div className="flex flex-wrap gap-3 items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}>
                    Call Reviews
                  </h2>
                  <div className="flex flex-wrap gap-2 items-center">
                    {isSuperadmin && companies.length > 0 && (
                      <select value={reviewCompany} onChange={e => setReviewCompany(e.target.value)}
                        className="input text-sm py-1.5" style={{ minWidth: 160 }}>
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
                    <button onClick={loadReviews} className="p-2 rounded-lg transition-colors"
                      style={{ color: 'var(--color-text-secondary)' }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                      <RefreshCw size={16} />
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
                      <div className="text-center py-16 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                        No call ratings found.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                              {['Customer', isSuperadmin && 'Company', 'Closer', 'Rating', 'Notes', 'Date']
                                .filter(Boolean).map(h => (
                                  <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider"
                                    style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                                ))}
                            </tr>
                          </thead>
                          <tbody>
                            {reviews.map(r => (
                              <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}
                                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'}
                                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                <td className="px-4 py-3 font-semibold" style={{ color: 'var(--color-text)' }}>
                                  {r.transfers?.form_data?.FirstName
                                    ? `${r.transfers.form_data.FirstName} ${r.transfers.form_data.LastName || ''}`.trim()
                                    : r.transfers?.form_data?.customer_name || '—'}
                                </td>
                                {isSuperadmin && (
                                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                                    {companies.find(c => c.id === r.company_id)?.name || '—'}
                                  </td>
                                )}
                                <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                                  {r.user_profiles
                                    ? `${r.user_profiles.first_name || ''} ${r.user_profiles.last_name || ''}`.trim()
                                    : '—'}
                                </td>
                                <td className="px-4 py-3">
                                  <span className="px-2 py-1 rounded-full text-xs font-bold capitalize"
                                    style={{
                                      backgroundColor: `${RATING_COLOR[r.rating]}22`,
                                      color: RATING_COLOR[r.rating],
                                    }}>
                                    {r.rating?.replace(/_/g, ' ')}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-xs max-w-xs truncate" style={{ color: 'var(--color-text-secondary)' }}>
                                  {r.notes || '—'}
                                </td>
                                <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
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
                      <div className="text-center py-16 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                        No dispositions found.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                              {['Customer', isSuperadmin && 'Company', 'Closer', 'Disposition', 'Notes', 'Date']
                                .filter(Boolean).map(h => (
                                  <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider"
                                    style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                                ))}
                            </tr>
                          </thead>
                          <tbody>
                            {dispos.map(d => (
                              <tr key={d.id} style={{ borderBottom: '1px solid var(--color-border)' }}
                                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'}
                                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                <td className="px-4 py-3 font-semibold" style={{ color: 'var(--color-text)' }}>
                                  {d.transfers?.form_data?.FirstName
                                    ? `${d.transfers.form_data.FirstName} ${d.transfers.form_data.LastName || ''}`.trim()
                                    : d.transfers?.form_data?.customer_name || '—'}
                                </td>
                                {isSuperadmin && (
                                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                                    {companies.find(c => c.id === d.company_id)?.name || '—'}
                                  </td>
                                )}
                                <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                                  {d.user_profiles
                                    ? `${d.user_profiles.first_name || ''} ${d.user_profiles.last_name || ''}`.trim()
                                    : '—'}
                                </td>
                                <td className="px-4 py-3">
                                  <span className="px-2 py-1 rounded-full text-xs font-bold capitalize"
                                    style={{ backgroundColor: 'var(--color-info-100)', color: 'var(--color-info-700)' }}>
                                    {d.disposition?.replace(/_/g, ' ')}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-xs max-w-xs truncate" style={{ color: 'var(--color-text-secondary)' }}>
                                  {d.notes || '—'}
                                </td>
                                <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
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
          </>
        )}
      </main>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* SALE DETAIL DRAWER                                               */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <SaleDetailDrawer sale={detailSale} onClose={() => setDetailSale(null)} />

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* RETURN MODAL                                                      */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {returnTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-md mx-4 rounded-2xl p-6 shadow-2xl animate-scale-in"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: '#fef3c7' }}>
                <RotateCcw size={16} style={{ color: '#d97706' }} />
              </div>
              <div>
                <h3 className="text-base font-bold" style={{ color: 'var(--color-text)' }}>Return to Closer</h3>
                <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  {returnTarget.customer_name} · Ref: {returnTarget.reference_no || '—'}
                </p>
              </div>
            </div>

            <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>
              Note for closer <span className="text-red-500">*</span>
            </label>
            <textarea value={returnNote} onChange={e => setReturnNote(e.target.value)}
              placeholder="Explain what needs to be corrected…"
              rows={4} className="input mb-3 text-sm" autoFocus
              maxLength={2000} />
            <div className="flex justify-between items-center mb-3">
              {returnMsg
                ? <p className="text-xs text-red-500">{returnMsg}</p>
                : <span />}
              <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                {returnNote.length}/2000
              </span>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setReturnTarget(null)}
                className="flex-1 py-2.5 rounded-xl border font-semibold text-sm transition-colors"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                Cancel
              </button>
              <button onClick={handleReturn} disabled={returning}
                className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white transition-all disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#d97706,#b45309)' }}>
                {returning ? 'Returning…' : 'Return to Closer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* EDIT MODAL (post-confirmation compliance update)                  */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-md mx-4 rounded-2xl p-6 shadow-2xl animate-scale-in"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>

            <div className="flex items-center gap-3 mb-5">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ background: 'var(--gradient-sidebar)' }}>
                <Shield size={16} className="text-white" />
              </div>
              <div>
                <h3 className="text-base font-bold" style={{ color: 'var(--color-text)' }}>Compliance Update</h3>
                <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  {editTarget.customer_name} · Ref: {editTarget.reference_no || '—'}
                </p>
              </div>
            </div>

            <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>New Status</label>
            <select value={editStatus} onChange={e => setEditStatus(e.target.value)} className="input mb-4 text-sm">
              {COMPLIANCE_EDIT_STATUSES.map(s => (
                <option key={s} value={s}>{STATUS_LABEL[s] || s.replace(/_/g, ' ')}</option>
              ))}
            </select>

            <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>
              Reason <span className="text-red-500">*</span>
            </label>
            <textarea value={editReason} onChange={e => setEditReason(e.target.value)}
              placeholder="Explain the reason for this compliance update…"
              rows={3} className="input mb-3 text-sm" />

            {editMsg && <p className="text-xs text-red-500 mb-3">{editMsg}</p>}

            <div className="flex gap-3">
              <button onClick={() => setEditTarget(null)}
                className="flex-1 py-2.5 rounded-xl border font-semibold text-sm transition-colors"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                Cancel
              </button>
              <button onClick={handleSaveEdit} disabled={editSaving}
                className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white transition-all disabled:opacity-50"
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

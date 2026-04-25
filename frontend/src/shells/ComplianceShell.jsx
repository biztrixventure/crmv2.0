import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useFeatureFlags } from "../contexts/FeatureFlagsContext";
import { useTheme } from "../contexts/ThemeContext";
import { useNavigate } from "react-router-dom";
import {
  Shield, Search, RefreshCw, ChevronDown, ChevronUp,
  FileText, Star, CheckCircle, RotateCcw, Clock, Download,
  Eye, AlertTriangle, User, Building2,
  ArrowRight, Trash2, X,
  PhoneCall,
} from "lucide-react";
import { Card, Badge, Alert } from "../components/UI";
import { AppHeader } from "../components/Layout";
import { useNotifications } from "../hooks/useNotifications";
import SaleDetailDrawer from "../components/Shared/SaleDetailDrawer";
import client from "../api/client";

// ── helpers ───────────────────────────────────────────────────────────────────

function timeAgo(d) {
  if (!d) return '—';
  const m = Math.floor((Date.now() - new Date(d)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function customerName(t) {
  const fd = t?.form_data || {};
  if (fd.FirstName || fd.LastName) return [fd.FirstName, fd.LastName].filter(Boolean).join(' ');
  return fd.customer_name || t?.customer_name || '—';
}

function downloadCSV(rows, headers, filename) {
  const csv = [headers, ...rows]
    .map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

const STATUS_BADGE = {
  open: 'info', sold: 'success', closed_won: 'success', closed_lost: 'error',
  cancelled: 'error', compliance_cancelled: 'error', follow_up: 'warning',
  dispute: 'warning', chargeback: 'error', pending_review: 'warning', needs_revision: 'error',
};
const STATUS_LABEL = {
  open: 'Open', sold: 'Sold', closed_won: 'Approved', closed_lost: 'Lost',
  cancelled: 'Cancelled', compliance_cancelled: 'Compliance Cancelled', follow_up: 'Follow Up',
  dispute: 'Dispute', chargeback: 'Chargeback', pending_review: 'Pending Review', needs_revision: 'Needs Revision',
  pending: 'Pending', completed: 'Completed', missed: 'Missed',
};
const ALL_SALE_STATUSES = ['open','sold','cancelled','follow_up','closed_won','closed_lost','compliance_cancelled','dispute','chargeback','pending_review','needs_revision'];
const COMPLIANCE_EDIT_STATUSES = ['open','sold','cancelled','follow_up','closed_won','closed_lost','compliance_cancelled','dispute','chargeback'];
const TRANSFER_STATUSES = ['pending','accepted','completed','rejected','cancelled'];
const CALLBACK_STATUSES = ['pending','completed','missed','cancelled'];
const RATING_COLOR = { excellent: '#16a34a', good: '#2563eb', average: '#d97706', below_average: '#ea580c', bad: '#dc2626' };
const LIMIT = 30;

// ── FilterBar — shared filter UI ──────────────────────────────────────────────
const FilterBar = ({ children, onSubmit }) => (
  <Card className="p-4 mb-5">
    <form onSubmit={onSubmit ? (e => { e.preventDefault(); onSubmit(); }) : e => e.preventDefault()}
      className="flex flex-wrap gap-3 items-end">
      {children}
      <button type="submit"
        className="px-5 py-2 rounded-lg font-semibold text-sm text-white shrink-0"
        style={{ background: 'var(--gradient-sidebar)' }}>
        Filter
      </button>
    </form>
  </Card>
);

const FInput = ({ label, ...props }) => (
  <div className="flex flex-col gap-1 min-w-[120px]">
    {label && <label className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{label}</label>}
    <input className="input text-sm" {...props} />
  </div>
);

const FSelect = ({ label, children, ...props }) => (
  <div className="flex flex-col gap-1 min-w-[130px]">
    {label && <label className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{label}</label>}
    <select className="input text-sm" {...props}>{children}</select>
  </div>
);

// ── Pagination ────────────────────────────────────────────────────────────────
const Pagination = ({ page, total, limit, onPage }) => {
  if (total <= limit) return null;
  return (
    <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid var(--color-border)' }}>
      <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
      </span>
      <div className="flex gap-2">
        <button disabled={page === 1} onClick={() => onPage(p => p - 1)}
          className="px-3 py-1 rounded text-sm font-semibold disabled:opacity-40"
          style={{ color: 'var(--color-text-secondary)' }}>Previous</button>
        <button disabled={page * limit >= total} onClick={() => onPage(p => p + 1)}
          className="px-3 py-1 rounded text-sm font-semibold disabled:opacity-40"
          style={{ color: 'var(--color-text-secondary)' }}>Next</button>
      </div>
    </div>
  );
};

// ── ExportModal ───────────────────────────────────────────────────────────────
const ExportModal = ({ tab, companyList, onClose, onExport }) => {
  const [dateFrom, setDateFrom]       = useState('');
  const [dateTo, setDateTo]           = useState('');
  const [company, setCompany]         = useState('');
  const [userMode, setUserMode]       = useState('all');
  const [users, setUsers]             = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState(new Set());
  const [loading, setLoading]         = useState(false);

  const loadUsers = useCallback(async (cid) => {
    setUsersLoading(true);
    try {
      const res = await client.get('compliance/users', { params: { company_id: cid || undefined } });
      setUsers(res.data.users || []);
    } catch { setUsers([]); } finally { setUsersLoading(false); }
  }, []);

  useEffect(() => { if (userMode === 'select') loadUsers(company); }, [userMode, company, loadUsers]);

  const toggleUser = (id) => setSelectedUsers(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const TAB_LABELS = {
    sales: 'Sales', transfers: 'Transfers',
    callbacks: 'Callbacks', reviews: 'Call Reviews', queue: 'Review Queue',
  };

  const handleExport = async () => {
    setLoading(true);
    try {
      await onExport({
        dateFrom, dateTo, company,
        userIds: userMode === 'select' ? [...selectedUsers] : [],
      });
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-lg mx-4 rounded-2xl shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--gradient-sidebar)' }}>
          <div className="flex items-center gap-3">
            <Download size={18} className="text-white opacity-80" />
            <h3 className="text-base font-bold text-white">Export {TAB_LABELS[tab] || tab}</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-white opacity-70 hover:opacity-100">
            <X size={16} />
          </button>
        </div>

        <div className="p-6 space-y-5">

          {/* Date range */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-secondary)' }}>
              Date Range
            </p>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs mb-1 block" style={{ color: 'var(--color-text-tertiary)' }}>From</label>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input text-sm w-full" />
              </div>
              <div className="flex-1">
                <label className="text-xs mb-1 block" style={{ color: 'var(--color-text-tertiary)' }}>To</label>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input text-sm w-full" />
              </div>
            </div>
          </div>

          {/* Company filter */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-secondary)' }}>
              Company
            </p>
            <select value={company} onChange={e => { setCompany(e.target.value); setSelectedUsers(new Set()); }} className="input text-sm w-full">
              <option value="">All companies</option>
              {companyList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {/* User filter */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-secondary)' }}>
              Users
            </p>
            <div className="flex gap-3 mb-3">
              {['all', 'select'].map(m => (
                <button key={m} type="button" onClick={() => setUserMode(m)}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold border-2 transition-all"
                  style={{
                    borderColor: userMode === m ? 'var(--color-primary-600)' : 'var(--color-border)',
                    backgroundColor: userMode === m ? 'var(--color-primary-50)' : 'var(--color-surface)',
                    color: userMode === m ? 'var(--color-primary-600)' : 'var(--color-text-secondary)',
                  }}>
                  {m === 'all' ? 'All Users' : 'Select Users'}
                </button>
              ))}
            </div>

            {userMode === 'select' && (
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)', maxHeight: 200, overflowY: 'auto' }}>
                {usersLoading ? (
                  <div className="flex justify-center py-6">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2" style={{ borderColor: 'var(--color-primary-600)' }} />
                  </div>
                ) : users.length === 0 ? (
                  <p className="text-center py-4 text-xs" style={{ color: 'var(--color-text-secondary)' }}>No users found</p>
                ) : (
                  users.map(u => (
                    <label key={`${u.user_id}:${u.company_id}`}
                      className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-opacity-50 transition-colors"
                      style={{
                        borderBottom: '1px solid var(--color-border)',
                        backgroundColor: selectedUsers.has(u.user_id) ? 'var(--color-primary-50)' : 'transparent',
                      }}>
                      <input type="checkbox" checked={selectedUsers.has(u.user_id)} onChange={() => toggleUser(u.user_id)}
                        className="rounded" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{u.full_name}</p>
                        <p className="text-xs truncate" style={{ color: 'var(--color-text-tertiary)' }}>
                          {u.company_name} · {u.role_level?.replace(/_/g, ' ')}
                        </p>
                      </div>
                    </label>
                  ))
                )}
              </div>
            )}
            {userMode === 'select' && selectedUsers.size > 0 && (
              <p className="text-xs mt-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                {selectedUsers.size} user{selectedUsers.size !== 1 ? 's' : ''} selected
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 pb-6">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border font-semibold text-sm"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
            Cancel
          </button>
          <button onClick={handleExport} disabled={loading}
            className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: 'var(--gradient-sidebar)' }}>
            {loading ? <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> Preparing…</> : <><Download size={14} /> Download CSV</>}
          </button>
        </div>
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════════════
// ComplianceShell
// ═════════════════════════════════════════════════════════════════════════════

const ComplianceShell = () => {
  const { user, logout, updateUser, hasPermission } = useAuth();
  const { isEnabled } = useFeatureFlags();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const notifHook = useNotifications();

  const userRole    = user?.role;
  const isSuperadmin = userRole === 'superadmin';
  const isCompliance = userRole === 'compliance_manager' || isSuperadmin;

  const canManageCompliance = isCompliance && (isSuperadmin || hasPermission('manage_compliance')) && isEnabled('compliance_workflow');
  const canViewAllSales     = isCompliance && (isSuperadmin || hasPermission('view_all_company_sales'));
  const canViewFinancial    = isSuperadmin || hasPermission('view_financial_data');
  const canViewReviews      = isCompliance && (isSuperadmin || hasPermission('view_all_call_reviews')) && isEnabled('call_reviews');

  // ── Tab ──────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('companies');

  // ── Detail drawer ─────────────────────────────────────────────────────────
  const [detailSale, setDetailSale] = useState(null);

  // ── Companies (global list, used across all dropdowns) ───────────────────
  const [companyList, setCompanyList]       = useState([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);

  // ── Queue tab ─────────────────────────────────────────────────────────────
  const [queue, setQueue]             = useState([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueMsg, setQueueMsg]       = useState('');
  const [approving, setApproving]     = useState(null);
  const [approveMsg, setApproveMsg]   = useState('');
  const [queueCompany, setQueueCompany] = useState('');

  // ── Sales tab ─────────────────────────────────────────────────────────────
  const [sales, setSales]         = useState([]);
  const [sTotal, setSTotal]       = useState(0);
  const [sLoading, setSLoading]   = useState(false);
  const [sPage, setSPage]         = useState(1);
  const [sSearch, setSSearch]     = useState('');
  const [sStatus, setSStatus]     = useState('');
  const [sCompany, setSCompany]   = useState('');
  const [sDateFrom, setSDateFrom] = useState('');
  const [sDateTo, setSDateTo]     = useState('');
  const [sExpanded, setSExpanded] = useState(null);

  // ── Transfers tab ─────────────────────────────────────────────────────────
  const [transfers, setTransfers]     = useState([]);
  const [tTotal, setTTotal]           = useState(0);
  const [tLoading, setTLoading]       = useState(false);
  const [tPage, setTPage]             = useState(1);
  const [tStatus, setTStatus]         = useState('');
  const [tCompany, setTCompany]       = useState('');
  const [tDateFrom, setTDateFrom]     = useState('');
  const [tDateTo, setTDateTo]         = useState('');

  // ── Callbacks tab ─────────────────────────────────────────────────────────
  const [callbacks, setCallbacks]     = useState([]);
  const [cbTotal, setCbTotal]         = useState(0);
  const [cbLoading, setCbLoading]     = useState(false);
  const [cbPage, setCbPage]           = useState(1);
  const [cbType, setCbType]           = useState('fronter');
  const [cbStatus, setCbStatus]       = useState('');
  const [cbCompany, setCbCompany]     = useState('');
  const [cbDateFrom, setCbDateFrom]   = useState('');
  const [cbDateTo, setCbDateTo]       = useState('');

  // ── Reviews tab ───────────────────────────────────────────────────────────
  const [reviews, setReviews]               = useState([]);
  const [dispos, setDispos]                 = useState([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsSubTab, setReviewsSubTab]   = useState('ratings');
  const [reviewCompany, setReviewCompany]   = useState('');

  // ── Return modal ──────────────────────────────────────────────────────────
  const [returnTarget, setReturnTarget] = useState(null);
  const [returnNote, setReturnNote]     = useState('');
  const [returning, setReturning]       = useState(false);
  const [returnMsg, setReturnMsg]       = useState('');

  // ── Edit modal ────────────────────────────────────────────────────────────
  const [editTarget, setEditTarget]   = useState(null);
  const [editStatus, setEditStatus]   = useState('');
  const [editReason, setEditReason]   = useState('');
  const [editSaving, setEditSaving]   = useState(false);
  const [editMsg, setEditMsg]         = useState('');

  // ── Delete confirm ────────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting]         = useState(false);

  // ── Export modal ──────────────────────────────────────────────────────────
  const [exportModal, setExportModal] = useState(null); // null | tab string

  // ── Data loaders ──────────────────────────────────────────────────────────

  const loadCompanies = useCallback(async () => {
    setCompaniesLoading(true);
    try {
      const res = await client.get('compliance/companies');
      setCompanyList(res.data.companies || []);
    } catch { /* non-critical */ } finally {
      setCompaniesLoading(false);
    }
  }, []);

  const loadQueue = useCallback(async () => {
    if (!canManageCompliance) return;
    setQueueLoading(true); setQueueMsg('');
    try {
      const res = await client.get('compliance/sales', {
        params: { status: 'pending_review', limit: 100, company_id: queueCompany || undefined },
      });
      setQueue(res.data.sales || []);
    } catch { setQueueMsg('Failed to load review queue.'); } finally { setQueueLoading(false); }
  }, [canManageCompliance, queueCompany]);

  const loadSales = useCallback(async () => {
    if (!canViewAllSales) return;
    setSLoading(true);
    try {
      const res = await client.get('compliance/sales', {
        params: {
          search:     sSearch   || undefined,
          status:     sStatus   || undefined,
          company_id: sCompany  || undefined,
          date_from:  sDateFrom || undefined,
          date_to:    sDateTo   || undefined,
          page: sPage, limit: LIMIT,
        },
      });
      setSales(res.data.sales || []);
      setSTotal(res.data.total || 0);
    } catch { /* non-critical */ } finally { setSLoading(false); }
  }, [canViewAllSales, sSearch, sStatus, sCompany, sDateFrom, sDateTo, sPage]);

  const loadTransfers = useCallback(async () => {
    setTLoading(true);
    try {
      const res = await client.get('compliance/transfers', {
        params: {
          status:     tStatus   || undefined,
          company_id: tCompany  || undefined,
          date_from:  tDateFrom || undefined,
          date_to:    tDateTo   || undefined,
          page: tPage, limit: LIMIT,
        },
      });
      setTransfers(res.data.transfers || []);
      setTTotal(res.data.total || 0);
    } catch { /* non-critical */ } finally { setTLoading(false); }
  }, [tStatus, tCompany, tDateFrom, tDateTo, tPage]);

  const loadCallbacks = useCallback(async () => {
    setCbLoading(true);
    try {
      const res = await client.get('compliance/callbacks', {
        params: {
          company_type: cbCompany ? undefined : cbType,
          company_id:   cbCompany || undefined,
          status:       cbStatus  || undefined,
          date_from:    cbDateFrom || undefined,
          date_to:      cbDateTo  || undefined,
          page: cbPage, limit: LIMIT,
        },
      });
      setCallbacks(res.data.callbacks || []);
      setCbTotal(res.data.total || 0);
    } catch { /* non-critical */ } finally { setCbLoading(false); }
  }, [cbType, cbCompany, cbStatus, cbDateFrom, cbDateTo, cbPage]);

  const loadReviews = useCallback(async () => {
    if (!canViewReviews) return;
    setReviewsLoading(true);
    try {
      const [rRes, dRes] = await Promise.all([
        client.get('reviews',              { params: { company_id: reviewCompany || undefined, limit: 200 } }),
        client.get('reviews/dispositions', { params: { company_id: reviewCompany || undefined, limit: 200 } }),
      ]);
      setReviews(rRes.data.reviews || []);
      setDispos(dRes.data.dispositions || []);
    } catch { /* non-critical */ } finally { setReviewsLoading(false); }
  }, [canViewReviews, reviewCompany]);

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => { if (isCompliance) loadCompanies(); }, [isCompliance, loadCompanies]);

  // Load tab data when switching tabs
  useEffect(() => {
    if (activeTab === 'queue')     loadQueue();
    if (activeTab === 'sales')     loadSales();
    if (activeTab === 'transfers') loadTransfers();
    if (activeTab === 'callbacks') loadCallbacks();
    if (activeTab === 'reviews')   loadReviews();
  }, [activeTab]);

  // Re-load when filters change (debounced via page changes)
  useEffect(() => { if (activeTab === 'queue')     loadQueue();     }, [loadQueue]);
  useEffect(() => { if (activeTab === 'sales')     loadSales();     }, [loadSales]);
  useEffect(() => { if (activeTab === 'transfers') loadTransfers(); }, [loadTransfers]);
  useEffect(() => { if (activeTab === 'callbacks') loadCallbacks(); }, [loadCallbacks]);
  useEffect(() => { if (activeTab === 'reviews')   loadReviews();   }, [loadReviews]);

  const handleLogout = () => { logout(); navigate('/login'); };

  // ── Queue actions ─────────────────────────────────────────────────────────
  const handleApprove = async (sale) => {
    setApproving(sale.id); setApproveMsg('');
    try {
      await client.post(`sales/${sale.id}/compliance-approve`);
      await Promise.all([loadQueue(), loadSales()]);
    } catch (err) {
      setApproveMsg(err.response?.data?.error || 'Failed to approve');
    } finally { setApproving(null); }
  };

  const openReturn = (sale) => { setReturnTarget(sale); setReturnNote(''); setReturnMsg(''); };
  const handleReturn = async () => {
    if (!returnNote.trim()) { setReturnMsg('Note is required.'); return; }
    setReturning(true);
    try {
      await client.post(`sales/${returnTarget.id}/compliance-return`, { note: returnNote });
      setReturnTarget(null);
      await Promise.all([loadQueue(), loadSales()]);
    } catch (err) {
      setReturnMsg(err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Failed to return');
    } finally { setReturning(false); }
  };

  // ── Edit ──────────────────────────────────────────────────────────────────
  const openEdit = (sale) => {
    setEditTarget(sale); setEditStatus(sale.status); setEditReason(''); setEditMsg('');
  };
  const handleSaveEdit = async () => {
    if (!editReason.trim()) { setEditMsg('Reason is required.'); return; }
    setEditSaving(true);
    try {
      await client.post(`sales/${editTarget.id}/compliance`, { status: editStatus, reason: editReason });
      setEditTarget(null);
      loadSales();
    } catch (err) {
      setEditMsg(err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Failed');
    } finally { setEditSaving(false); }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await client.delete(`sales/${deleteTarget.id}`);
      setDeleteTarget(null);
      loadSales();
    } catch { /* silently fail — user will retry */ } finally { setDeleting(false); }
  };

  // ── Export handlers ───────────────────────────────────────────────────────
  const exportData = async ({ dateFrom, dateTo, company, userIds }) => {
    const params = {
      date_from:  dateFrom || undefined,
      date_to:    dateTo   || undefined,
      company_id: company  || undefined,
      user_ids:   userIds.length ? userIds.join(',') : undefined,
      limit:      5000,
      page:       1,
    };

    if (exportModal === 'sales' || exportModal === 'queue') {
      const extra = exportModal === 'queue' ? { status: 'pending_review' } : {};
      const res = await client.get('compliance/sales', { params: { ...params, ...extra } });
      const rows = (res.data.sales || []).map(s => [
        s.customer_name || '', s.customer_phone || '', s.customer_email || '',
        s.reference_no || '', [s.car_year, s.car_make, s.car_model].filter(Boolean).join(' '),
        s.plan || '', s.monthly_payment || '', s.down_payment || '',
        STATUS_LABEL[s.status] || s.status || '', s.closer_name || '',
        s.companies?.name || '', s.sale_date || '', fmtDate(s.created_at),
      ]);
      downloadCSV(rows,
        ['Customer','Phone','Email','Reference','Vehicle','Plan','Monthly','Down Payment','Status','Closer','Company','Sale Date','Created'],
        `compliance_sales_${new Date().toISOString().split('T')[0]}.csv`);
    }

    if (exportModal === 'transfers') {
      const res = await client.get('compliance/transfers', { params });
      const rows = (res.data.transfers || []).map(t => [
        customerName(t), t.form_data?.Phone || '', t.created_by_name || '',
        t.company_name || '', STATUS_LABEL[t.status] || t.status || '',
        fmtDate(t.created_at),
      ]);
      downloadCSV(rows, ['Customer','Phone','Created By','Company','Status','Created'],
        `compliance_transfers_${new Date().toISOString().split('T')[0]}.csv`);
    }

    if (exportModal === 'callbacks') {
      const res = await client.get('compliance/callbacks', {
        params: { ...params, company_type: company ? undefined : cbType },
      });
      const rows = (res.data.callbacks || []).map(c => [
        c.customer_name || '', c.customer_phone || '',
        fmtDateTime(c.callback_at), STATUS_LABEL[c.status] || c.status || '',
        c.notes || '', c.user_name || '', c.company_name || '',
      ]);
      downloadCSV(rows, ['Customer','Phone','Scheduled At','Status','Notes','Agent','Company'],
        `compliance_callbacks_${new Date().toISOString().split('T')[0]}.csv`);
    }

    if (exportModal === 'reviews') {
      const res = await client.get('reviews', { params: { company_id: company || undefined, limit: 5000 } });
      const rows = (res.data.reviews || []).map(r => [
        customerName(r.transfers) || '',
        companyList.find(c => c.id === r.company_id)?.name || '',
        r.user_profiles ? `${r.user_profiles.first_name || ''} ${r.user_profiles.last_name || ''}`.trim() : '',
        r.rating || '', r.notes || '', fmtDate(r.created_at),
      ]);
      downloadCSV(rows, ['Customer','Company','Closer','Rating','Notes','Date'],
        `compliance_reviews_${new Date().toISOString().split('T')[0]}.csv`);
    }
  };

  // ── TABS definition ───────────────────────────────────────────────────────
  const TABS = [
    { key: 'companies',  label: 'Companies',     icon: Building2 },
    canManageCompliance && { key: 'queue',       label: 'Review Queue',  icon: Clock,      badge: queue.length || null },
    canViewAllSales     && { key: 'sales',       label: 'All Sales',     icon: FileText },
    isCompliance && { key: 'transfers',  label: 'Transfers',     icon: ArrowRight },
    isCompliance && { key: 'callbacks',  label: 'Callbacks',     icon: PhoneCall },
    canViewReviews      && { key: 'reviews',     label: 'Call Reviews',  icon: Star },
  ].filter(Boolean);

  const closerName = (s) =>
    s.closer_name || (s.user_profiles ? `${s.user_profiles.first_name || ''} ${s.user_profiles.last_name || ''}`.trim() : '') || '—';

  // ── Table header ──────────────────────────────────────────────────────────
  const Th = ({ children }) => (
    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider"
      style={{ color: 'var(--color-text-secondary)' }}>{children}</th>
  );

  // ── Export button ─────────────────────────────────────────────────────────
  const ExportBtn = ({ tab }) => (
    <button onClick={() => setExportModal(tab)}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all hover:scale-105"
      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
      <Download size={13} /> Export CSV
    </button>
  );

  // ── Tab header ────────────────────────────────────────────────────────────
  const TabHeader = ({ title, subtitle, onRefresh, exportTab, extra }) => (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h2 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}>{title}</h2>
        {subtitle && <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">
        {extra}
        {exportTab && <ExportBtn tab={exportTab} />}
        <button onClick={onRefresh} className="p-2 rounded-lg transition-colors" style={{ color: 'var(--color-text-secondary)' }}
          onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'}
          onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
          <RefreshCw size={16} />
        </button>
      </div>
    </div>
  );

  // ── Empty state ───────────────────────────────────────────────────────────
  const Empty = ({ icon: Icon = FileText, msg = 'No records found.' }) => (
    <div className="text-center py-16">
      <Icon size={36} className="mx-auto mb-3" style={{ color: 'var(--color-text-tertiary)', opacity: 0.4 }} />
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{msg}</p>
    </div>
  );

  // ── Spinner ───────────────────────────────────────────────────────────────
  const Spinner = () => (
    <div className="flex justify-center py-16">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--color-primary-600)' }} />
    </div>
  );

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      <AppHeader
        title="Compliance"
        logo={<div className="w-10 h-10 bg-gradient-sidebar rounded-lg flex items-center justify-center"><Shield className="text-white" size={24} /></div>}
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

        {TABS.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
              style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
              <Shield size={32} style={{ color: 'var(--color-text-tertiary)' }} />
            </div>
            <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--color-text)' }}>No Access</h2>
            <p className="text-sm max-w-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Ask your admin to grant compliance permissions.
            </p>
          </div>
        ) : (
          <>
            {/* ── Tab bar ─────────────────────────────────────────────── */}
            <div className="flex flex-wrap gap-1 p-1 rounded-xl mb-6 w-fit"
              style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
              {TABS.map(t => (
                <button key={t.key} onClick={() => setActiveTab(t.key)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
                  style={{
                    background: activeTab === t.key ? 'var(--gradient-sidebar)' : 'transparent',
                    color: activeTab === t.key ? 'white' : 'var(--color-text-secondary)',
                    boxShadow: activeTab === t.key ? 'var(--shadow-sm)' : 'none',
                  }}>
                  <t.icon size={14} />
                  {t.label}
                  {t.badge ? (
                    <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-xs font-bold"
                      style={{ backgroundColor: '#f59e0b', color: '#fff' }}>{t.badge}</span>
                  ) : null}
                </button>
              ))}
            </div>

            {/* ══════════════════════════════════════════════════════════ */}
            {/* COMPANIES                                                 */}
            {/* ══════════════════════════════════════════════════════════ */}
            {activeTab === 'companies' && (
              <div>
                <TabHeader title="All Companies" subtitle={`${companyList.length} companies on platform`} onRefresh={loadCompanies} />
                {companiesLoading ? <Spinner /> : companyList.length === 0 ? (
                  <Empty icon={Building2} msg="No companies found." />
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {companyList.map(c => (
                      <div key={c.id} className="rounded-2xl p-5 transition-all hover:shadow-lg"
                        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
                        {/* Header */}
                        <div className="flex items-start justify-between gap-3 mb-4">
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                            style={{ background: 'var(--gradient-sidebar)' }}>
                            <Building2 size={18} className="text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-bold truncate" style={{ color: 'var(--color-text)' }}>{c.name}</p>
                            <span className="text-xs px-2 py-0.5 rounded-full font-semibold capitalize"
                              style={{
                                backgroundColor: c.company_type === 'fronter' ? '#dbeafe' : '#dcfce7',
                                color: c.company_type === 'fronter' ? '#1e40af' : '#166534',
                              }}>
                              {c.company_type || 'unknown'}
                            </span>
                          </div>
                          {!c.is_active && (
                            <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>Inactive</span>
                          )}
                        </div>

                        {/* Stats row */}
                        <div className="grid grid-cols-3 gap-2 text-center">
                          {[
                            { label: 'Users',    val: c.user_count,           color: 'var(--color-text)' },
                            { label: 'Sales',    val: c.sale_count,           color: 'var(--color-text)' },
                            { label: 'Pending',  val: c.pending_review_count, color: c.pending_review_count > 0 ? '#d97706' : 'var(--color-text-secondary)' },
                          ].map(stat => (
                            <div key={stat.label} className="rounded-xl py-2"
                              style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                              <p className="text-lg font-bold" style={{ color: stat.color }}>{stat.val}</p>
                              <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{stat.label}</p>
                            </div>
                          ))}
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2 mt-4">
                          <button onClick={() => { setSCompany(c.id); setActiveTab('sales'); }}
                            className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all hover:opacity-90"
                            style={{ background: 'var(--gradient-sidebar)', color: 'white' }}>
                            View Sales
                          </button>
                          {isEnabled('transfers') && (
                            <button onClick={() => { setTCompany(c.id); setActiveTab('transfers'); }}
                              className="flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all hover:opacity-80"
                              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                              Transfers
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ══════════════════════════════════════════════════════════ */}
            {/* REVIEW QUEUE                                              */}
            {/* ══════════════════════════════════════════════════════════ */}
            {activeTab === 'queue' && (
              <div>
                <TabHeader
                  title="Pending Review"
                  subtitle={queue.length === 0 ? 'All clear — nothing awaiting review' : `${queue.length} sale${queue.length !== 1 ? 's' : ''} awaiting approval`}
                  onRefresh={loadQueue}
                  exportTab="queue"
                  extra={
                    <select value={queueCompany} onChange={e => { setQueueCompany(e.target.value); }}
                      className="input text-sm py-1.5" style={{ minWidth: 160 }}>
                      <option value="">All companies</option>
                      {companyList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  }
                />
                {queueMsg && <Alert variant="error" className="mb-4">{queueMsg}</Alert>}
                {approveMsg && <Alert variant="error" className="mb-4">{approveMsg}</Alert>}

                {queueLoading ? <Spinner /> : queue.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-24 rounded-2xl"
                    style={{ border: '2px dashed var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ backgroundColor: '#dcfce7' }}>
                      <CheckCircle size={28} style={{ color: '#16a34a' }} />
                    </div>
                    <p className="text-lg font-bold mb-1" style={{ color: 'var(--color-text)' }}>All clear!</p>
                    <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>No sales pending review.</p>
                  </div>
                ) : (
                  <div className="grid gap-4 grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
                    {queue.map(s => (
                      <div key={s.id}
                        className="rounded-2xl flex flex-col transition-all hover:shadow-lg cursor-pointer"
                        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}
                        onClick={() => setDetailSale(s)}>

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
                              {s.reference_no && <span className="ml-2 font-mono" style={{ color: 'var(--color-text-tertiary)' }}>#{s.reference_no}</span>}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-1 flex-shrink-0">
                            <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>
                              {timeAgo(s.submitted_for_review_at || s.created_at)}
                            </span>
                            {s.companies?.name && (
                              <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>
                                {s.companies.name}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="p-4 grid grid-cols-3 gap-3 text-xs"
                          style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                          {[
                            { label: 'Vehicle', val: [s.car_year, s.car_make, s.car_model].filter(Boolean).join(' ') || '—' },
                            { label: 'Monthly',  val: canViewFinancial && s.monthly_payment ? `$${s.monthly_payment}/mo` : '—', green: !!s.monthly_payment && canViewFinancial },
                            { label: 'Closer',   val: closerName(s) },
                          ].map(info => (
                            <div key={info.label}>
                              <p className="mb-0.5 font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)', fontSize: '0.65rem' }}>{info.label}</p>
                              <p className="font-medium truncate" style={{ color: info.green ? '#16a34a' : 'var(--color-text)' }}>{info.val}</p>
                            </div>
                          ))}
                        </div>

                        {s.compliance_note && (
                          <div className="mx-4 mt-3 p-3 rounded-xl flex items-start gap-2 text-xs" style={{ backgroundColor: '#fef3c7', border: '1px solid #fde68a' }}>
                            <AlertTriangle size={12} style={{ color: '#d97706', marginTop: 1, flexShrink: 0 }} />
                            <div>
                              <p className="font-bold mb-0.5" style={{ color: '#92400e' }}>Previous note:</p>
                              <p style={{ color: '#78350f' }}>{s.compliance_note}</p>
                            </div>
                          </div>
                        )}

                        <div className="p-4 mt-auto flex items-center gap-2">
                          <button onClick={e => { e.stopPropagation(); handleApprove(s); }} disabled={approving === s.id}
                            className="flex-1 py-2 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-1.5 hover:opacity-90 disabled:opacity-60"
                            style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)' }}>
                            <CheckCircle size={14} />
                            {approving === s.id ? 'Approving…' : 'Approve'}
                          </button>
                          <button onClick={e => { e.stopPropagation(); openReturn(s); }}
                            className="flex-1 py-2 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 hover:opacity-90"
                            style={{ border: '1.5px solid #fbbf24', color: '#d97706', backgroundColor: '#fffbeb' }}>
                            <RotateCcw size={14} /> Return
                          </button>
                          <button onClick={e => { e.stopPropagation(); setDetailSale(s); }}
                            className="p-2 rounded-xl flex items-center justify-center hover:opacity-90"
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
                <TabHeader title="All Sales" subtitle="Closer sales across all companies" onRefresh={() => { setSPage(1); loadSales(); }} exportTab="sales" />

                <FilterBar onSubmit={() => { setSPage(1); loadSales(); }}>
                  <div className="relative" style={{ minWidth: 200, flex: 2 }}>
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
                    <input value={sSearch} onChange={e => setSSearch(e.target.value)} placeholder="Name, phone, reference…" className="input pl-9 text-sm w-full" />
                  </div>
                  <FSelect label="Company" value={sCompany} onChange={e => setSCompany(e.target.value)}>
                    <option value="">All companies</option>
                    {companyList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </FSelect>
                  <FSelect label="Status" value={sStatus} onChange={e => setSStatus(e.target.value)}>
                    <option value="">All statuses</option>
                    {ALL_SALE_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s] || s.replace(/_/g,' ')}</option>)}
                  </FSelect>
                  <FInput label="From" type="date" value={sDateFrom} onChange={e => setSDateFrom(e.target.value)} />
                  <FInput label="To"   type="date" value={sDateTo}   onChange={e => setSDateTo(e.target.value)} />
                </FilterBar>

                <Card className="overflow-hidden">
                  {sLoading ? <Spinner /> : sales.length === 0 ? <Empty /> : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                            <Th>Customer</Th>
                            <Th>Vehicle</Th>
                            {canViewFinancial && <Th>Payment</Th>}
                            <Th>Status</Th>
                            <Th>Closer</Th>
                            <Th>Company</Th>
                            <Th>Date</Th>
                            <Th>Actions</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {sales.map(s => (
                            <>
                              <tr key={s.id} className="cursor-pointer transition-colors"
                                style={{ borderBottom: '1px solid var(--color-border)' }}
                                onClick={() => setDetailSale(s)}
                                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'}
                                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                <td className="px-4 py-3">
                                  <p className="font-semibold" style={{ color: 'var(--color-text)' }}>{s.customer_name || '—'}</p>
                                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{s.customer_phone || ''}</p>
                                  {s.reference_no && <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>#{s.reference_no}</p>}
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
                                    {STATUS_LABEL[s.status] || s.status?.replace(/_/g,' ')}
                                  </Badge>
                                </td>
                                <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{closerName(s)}</td>
                                <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{s.companies?.name || '—'}</td>
                                <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{fmtDate(s.created_at)}</td>
                                <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    {s.status === 'pending_review' ? (
                                      <>
                                        <button onClick={() => handleApprove(s)} disabled={approving === s.id}
                                          className="px-2.5 py-1 rounded-lg text-xs font-bold text-white disabled:opacity-60 hover:scale-105 transition-all"
                                          style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)' }}>
                                          {approving === s.id ? '…' : 'Approve'}
                                        </button>
                                        <button onClick={() => openReturn(s)}
                                          className="px-2.5 py-1 rounded-lg text-xs font-bold hover:scale-105 transition-all"
                                          style={{ color: '#d97706', border: '1px solid #fbbf24', backgroundColor: '#fffbeb' }}>
                                          Return
                                        </button>
                                      </>
                                    ) : (
                                      <button onClick={() => openEdit(s)}
                                        className="px-2.5 py-1 rounded-lg text-xs font-bold text-white hover:scale-105 transition-all"
                                        style={{ background: 'var(--gradient-sidebar)' }}>
                                        Update
                                      </button>
                                    )}
                                    {Array.isArray(s.edit_history) && s.edit_history.length > 0 && (
                                      <button onClick={() => setSExpanded(sExpanded === s.id ? null : s.id)}
                                        className="p-1 rounded transition-colors" style={{ color: 'var(--color-text-secondary)' }} title="Audit trail">
                                        {sExpanded === s.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                      </button>
                                    )}
                                    <button onClick={() => setDetailSale(s)} className="p-1 rounded" style={{ color: 'var(--color-primary-600)' }}>
                                      <Eye size={14} />
                                    </button>
                                    <button onClick={() => setDeleteTarget(s)} className="p-1 rounded" style={{ color: '#ef4444' }} title="Delete">
                                      <Trash2 size={13} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                              {sExpanded === s.id && Array.isArray(s.edit_history) && (
                                <tr key={`${s.id}-hist`} style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                                  <td colSpan={10} className="px-5 py-3">
                                    <p className="text-xs font-bold mb-2" style={{ color: 'var(--color-text-secondary)' }}>Audit Trail</p>
                                    <div className="space-y-1">
                                      {s.edit_history.map((h, i) => (
                                        <div key={i} className="text-xs flex gap-3 items-start">
                                          <span style={{ color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>{new Date(h.edited_at).toLocaleString()}</span>
                                          {h.previous_status && <span style={{ color: 'var(--color-text-secondary)' }}>{h.previous_status} → {h.new_status || h.action}</span>}
                                          {(h.reason || h.note) && <span className="italic" style={{ color: 'var(--color-text)' }}>"{h.reason || h.note}"</span>}
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
                  <Pagination page={sPage} total={sTotal} limit={LIMIT} onPage={setSPage} />
                </Card>
              </div>
            )}

            {/* ══════════════════════════════════════════════════════════ */}
            {/* TRANSFERS                                                 */}
            {/* ══════════════════════════════════════════════════════════ */}
            {activeTab === 'transfers' && (
              <div>
                <TabHeader title="All Transfers" subtitle="Read-only view across all companies" onRefresh={() => { setTPage(1); loadTransfers(); }} exportTab="transfers" />

                <FilterBar onSubmit={() => { setTPage(1); loadTransfers(); }}>
                  <FSelect label="Company" value={tCompany} onChange={e => setTCompany(e.target.value)}>
                    <option value="">All companies</option>
                    {companyList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </FSelect>
                  <FSelect label="Status" value={tStatus} onChange={e => setTStatus(e.target.value)}>
                    <option value="">All statuses</option>
                    {TRANSFER_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s] || s}</option>)}
                  </FSelect>
                  <FInput label="From" type="date" value={tDateFrom} onChange={e => setTDateFrom(e.target.value)} />
                  <FInput label="To"   type="date" value={tDateTo}   onChange={e => setTDateTo(e.target.value)} />
                </FilterBar>

                <Card className="overflow-hidden">
                  {tLoading ? <Spinner /> : transfers.length === 0 ? <Empty icon={ArrowRight} msg="No transfers found." /> : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                            <Th>Customer</Th><Th>Created By</Th><Th>Company</Th><Th>Status</Th><Th>Date</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {transfers.map(t => (
                            <tr key={t.id} style={{ borderBottom: '1px solid var(--color-border)' }}
                              onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'}
                              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                              <td className="px-4 py-3">
                                <p className="font-semibold" style={{ color: 'var(--color-text)' }}>{customerName(t)}</p>
                                <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{t.form_data?.Phone || t.form_data?.customer_phone || ''}</p>
                              </td>
                              <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{t.created_by_name || '—'}</td>
                              <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{t.company_name || '—'}</td>
                              <td className="px-4 py-3">
                                <Badge variant={STATUS_BADGE[t.status] || 'secondary'} size="sm">
                                  {STATUS_LABEL[t.status] || t.status?.replace(/_/g,' ')}
                                </Badge>
                              </td>
                              <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{fmtDate(t.created_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <Pagination page={tPage} total={tTotal} limit={LIMIT} onPage={setTPage} />
                </Card>
              </div>
            )}

            {/* ══════════════════════════════════════════════════════════ */}
            {/* CALLBACKS                                                 */}
            {/* ══════════════════════════════════════════════════════════ */}
            {activeTab === 'callbacks' && (
              <div>
                <TabHeader title="Callbacks" subtitle="Scheduled callbacks across all companies" onRefresh={() => { setCbPage(1); loadCallbacks(); }} exportTab="callbacks" />

                {/* Fronter / Closer toggle */}
                <div className="flex gap-1 p-1 rounded-xl mb-4 w-fit"
                  style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                  {[{ key: 'fronter', label: 'Fronter Callbacks' }, { key: 'closer', label: 'Closer Callbacks' }].map(t => (
                    <button key={t.key} onClick={() => { setCbType(t.key); setCbPage(1); }}
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

                <FilterBar onSubmit={() => { setCbPage(1); loadCallbacks(); }}>
                  <FSelect label="Company" value={cbCompany} onChange={e => setCbCompany(e.target.value)}>
                    <option value="">All companies</option>
                    {companyList.filter(c => cbCompany || c.company_type === cbType || true).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </FSelect>
                  <FSelect label="Status" value={cbStatus} onChange={e => setCbStatus(e.target.value)}>
                    <option value="">All statuses</option>
                    {CALLBACK_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s] || s}</option>)}
                  </FSelect>
                  <FInput label="From" type="date" value={cbDateFrom} onChange={e => setCbDateFrom(e.target.value)} />
                  <FInput label="To"   type="date" value={cbDateTo}   onChange={e => setCbDateTo(e.target.value)} />
                </FilterBar>

                <Card className="overflow-hidden">
                  {cbLoading ? <Spinner /> : callbacks.length === 0 ? <Empty icon={PhoneCall} msg="No callbacks found." /> : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                            <Th>Customer</Th><Th>Scheduled At</Th><Th>Agent</Th><Th>Company</Th><Th>Status</Th><Th>Notes</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {callbacks.map(c => (
                            <tr key={c.id} style={{ borderBottom: '1px solid var(--color-border)' }}
                              onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'}
                              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                              <td className="px-4 py-3">
                                <p className="font-semibold" style={{ color: 'var(--color-text)' }}>{c.customer_name || '—'}</p>
                                <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{c.customer_phone || ''}</p>
                              </td>
                              <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{fmtDateTime(c.callback_at)}</td>
                              <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{c.user_name || '—'}</td>
                              <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{c.company_name || '—'}</td>
                              <td className="px-4 py-3">
                                <Badge variant={STATUS_BADGE[c.status] || 'secondary'} size="sm">
                                  {STATUS_LABEL[c.status] || c.status?.replace(/_/g,' ')}
                                </Badge>
                              </td>
                              <td className="px-4 py-3 text-xs max-w-xs truncate" style={{ color: 'var(--color-text-secondary)' }}>{c.notes || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <Pagination page={cbPage} total={cbTotal} limit={LIMIT} onPage={setCbPage} />
                </Card>
              </div>
            )}

            {/* ══════════════════════════════════════════════════════════ */}
            {/* CALL REVIEWS                                              */}
            {/* ══════════════════════════════════════════════════════════ */}
            {activeTab === 'reviews' && (
              <div>
                <TabHeader title="Call Reviews" onRefresh={loadReviews} exportTab="reviews"
                  extra={
                    <div className="flex gap-2 items-center">
                      <select value={reviewCompany} onChange={e => setReviewCompany(e.target.value)}
                        className="input text-sm py-1.5" style={{ minWidth: 160 }}>
                        <option value="">All companies</option>
                        {companyList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <div className="flex gap-1 p-1 rounded-xl"
                        style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                        {[{ key: 'ratings', label: 'Ratings' }, { key: 'dispos', label: 'Dispositions' }].map(t => (
                          <button key={t.key} onClick={() => setReviewsSubTab(t.key)}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                            style={{
                              backgroundColor: reviewsSubTab === t.key ? 'var(--color-surface)' : 'transparent',
                              color: reviewsSubTab === t.key ? 'var(--color-primary-600)' : 'var(--color-text-secondary)',
                              boxShadow: reviewsSubTab === t.key ? 'var(--shadow-sm)' : 'none',
                            }}>
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  }
                />

                <Card className="overflow-hidden">
                  {reviewsLoading ? <Spinner /> : reviewsSubTab === 'ratings' ? (
                    reviews.length === 0 ? <Empty icon={Star} msg="No call ratings found." /> : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                              <Th>Customer</Th><Th>Company</Th><Th>Closer</Th><Th>Rating</Th><Th>Notes</Th><Th>Date</Th>
                            </tr>
                          </thead>
                          <tbody>
                            {reviews.map(r => (
                              <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}
                                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'}
                                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                <td className="px-4 py-3 font-semibold" style={{ color: 'var(--color-text)' }}>{customerName(r.transfers)}</td>
                                <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                                  {companyList.find(c => c.id === r.company_id)?.name || '—'}
                                </td>
                                <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                                  {r.user_profiles ? `${r.user_profiles.first_name||''} ${r.user_profiles.last_name||''}`.trim() : '—'}
                                </td>
                                <td className="px-4 py-3">
                                  <span className="px-2 py-1 rounded-full text-xs font-bold capitalize"
                                    style={{ backgroundColor: `${RATING_COLOR[r.rating]}22`, color: RATING_COLOR[r.rating] }}>
                                    {r.rating?.replace(/_/g,' ')}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-xs max-w-xs truncate" style={{ color: 'var(--color-text-secondary)' }}>{r.notes || '—'}</td>
                                <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{fmtDate(r.created_at)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
                  ) : (
                    dispos.length === 0 ? <Empty icon={Star} msg="No dispositions found." /> : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                              <Th>Customer</Th><Th>Company</Th><Th>Closer</Th><Th>Disposition</Th><Th>Notes</Th><Th>Date</Th>
                            </tr>
                          </thead>
                          <tbody>
                            {dispos.map(d => (
                              <tr key={d.id} style={{ borderBottom: '1px solid var(--color-border)' }}
                                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'}
                                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                <td className="px-4 py-3 font-semibold" style={{ color: 'var(--color-text)' }}>{customerName(d.transfers)}</td>
                                <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                                  {companyList.find(c => c.id === d.company_id)?.name || '—'}
                                </td>
                                <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                                  {d.user_profiles ? `${d.user_profiles.first_name||''} ${d.user_profiles.last_name||''}`.trim() : '—'}
                                </td>
                                <td className="px-4 py-3">
                                  <span className="px-2 py-1 rounded-full text-xs font-bold capitalize"
                                    style={{ backgroundColor: 'var(--color-info-100)', color: 'var(--color-info-700)' }}>
                                    {d.disposition?.replace(/_/g,' ')}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-xs max-w-xs truncate" style={{ color: 'var(--color-text-secondary)' }}>{d.notes || '—'}</td>
                                <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{fmtDate(d.created_at)}</td>
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

      {/* ── SALE DETAIL DRAWER ───────────────────────────────────────────────── */}
      <SaleDetailDrawer sale={detailSale} onClose={() => setDetailSale(null)} />

      {/* ── RETURN MODAL ────────────────────────────────────────────────────── */}
      {returnTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-md mx-4 rounded-2xl p-6 shadow-2xl"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#fef3c7' }}>
                <RotateCcw size={16} style={{ color: '#d97706' }} />
              </div>
              <div>
                <h3 className="text-base font-bold" style={{ color: 'var(--color-text)' }}>Return to Closer</h3>
                <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{returnTarget.customer_name} · Ref: {returnTarget.reference_no || '—'}</p>
              </div>
            </div>
            <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>Note for closer <span className="text-red-500">*</span></label>
            <textarea value={returnNote} onChange={e => setReturnNote(e.target.value)}
              placeholder="Explain what needs to be corrected…"
              rows={4} className="input mb-3 text-sm" autoFocus maxLength={2000} />
            <div className="flex justify-between items-center mb-3">
              {returnMsg ? <p className="text-xs text-red-500">{returnMsg}</p> : <span />}
              <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{returnNote.length}/2000</span>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setReturnTarget(null)} className="flex-1 py-2.5 rounded-xl border font-semibold text-sm"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Cancel</button>
              <button onClick={handleReturn} disabled={returning} className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#d97706,#b45309)' }}>
                {returning ? 'Returning…' : 'Return to Closer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT MODAL ───────────────────────────────────────────────────────── */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-md mx-4 rounded-2xl p-6 shadow-2xl"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'var(--gradient-sidebar)' }}>
                <Shield size={16} className="text-white" />
              </div>
              <div>
                <h3 className="text-base font-bold" style={{ color: 'var(--color-text)' }}>Compliance Update</h3>
                <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{editTarget.customer_name} · Ref: {editTarget.reference_no || '—'}</p>
              </div>
            </div>
            <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>New Status</label>
            <select value={editStatus} onChange={e => setEditStatus(e.target.value)} className="input mb-4 text-sm">
              {COMPLIANCE_EDIT_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s] || s.replace(/_/g,' ')}</option>)}
            </select>
            <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>Reason <span className="text-red-500">*</span></label>
            <textarea value={editReason} onChange={e => setEditReason(e.target.value)}
              placeholder="Explain the reason for this compliance update…"
              rows={3} className="input mb-3 text-sm" />
            {editMsg && <p className="text-xs text-red-500 mb-3">{editMsg}</p>}
            <div className="flex gap-3">
              <button onClick={() => setEditTarget(null)} className="flex-1 py-2.5 rounded-xl border font-semibold text-sm"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Cancel</button>
              <button onClick={handleSaveEdit} disabled={editSaving} className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white disabled:opacity-50"
                style={{ background: 'var(--gradient-sidebar)' }}>
                {editSaving ? 'Saving…' : 'Save Update'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DELETE CONFIRM ───────────────────────────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-sm mx-4 rounded-2xl p-6 shadow-2xl"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4 mx-auto" style={{ backgroundColor: '#fee2e2' }}>
              <Trash2 size={22} style={{ color: '#dc2626' }} />
            </div>
            <h3 className="text-base font-bold text-center mb-2" style={{ color: 'var(--color-text)' }}>Delete Sale?</h3>
            <p className="text-sm text-center mb-5" style={{ color: 'var(--color-text-secondary)' }}>
              {deleteTarget.customer_name} · {deleteTarget.reference_no || '—'}. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2.5 rounded-xl border font-semibold text-sm"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Cancel</button>
              <button onClick={handleDelete} disabled={deleting} className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#dc2626,#b91c1c)' }}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── EXPORT MODAL ─────────────────────────────────────────────────────── */}
      {exportModal && (
        <ExportModal
          tab={exportModal}
          companyList={companyList}
          onClose={() => setExportModal(null)}
          onExport={exportData}
        />
      )}
    </div>
  );
};

export default ComplianceShell;

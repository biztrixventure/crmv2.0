import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useNavigate } from "react-router-dom";
import {
  Users, Send, TrendingUp, Phone, BarChart3, DollarSign, Search,
  RefreshCw, CheckCircle, XCircle, AlertCircle, ChevronRight, Star,
  Hash, PlusCircle, FileText, Shield, Activity, ChevronLeft,
} from "lucide-react";
import { Card, Badge } from "../components/UI";
import SaleStatusBadge from "../components/UI/SaleStatusBadge";
import DateRangePicker, { getPresetRange } from "../components/UI/DateRangePicker";
import { AppHeader } from "../components/Layout";
import { useNotifications } from "../hooks/useNotifications";
import { useTransfers } from "../hooks/useTransfers";
import { useFormFields } from "../hooks/useFormFields";
import { useClosers } from "../hooks/useClosers";
import { useSaleConfigs } from "../hooks/useSaleConfigs";
import TransferFormModal from "../components/Transfers/TransferFormModal";
import SaleSearch from "../components/Sales/SaleSearch";
import CallbacksOverview from "../components/Callbacks/CallbacksOverview";
import NumberUploadManager from "../components/Numbers/NumberUploadManager";
import CallbackNumbers from "../components/CallbackNumbers/CallbackNumbers";
import CrossRoleContent from "../components/Navigation/CrossRoleContent";
import client from "../api/client";

const STATUS_COLORS = { pending: 'warning', assigned: 'info', completed: 'success', cancelled: 'error', rejected: 'error' };
const RATING_COLOR  = { excellent: '#16a34a', good: '#2563eb', average: '#d97706', below_average: '#ea580c', bad: '#dc2626' };
const DISPOSITIONS  = ['sale', 'no_sale', 'callback', 'not_interested', 'hung_up', 'voicemail', 'other'];
const DISPO_LABEL   = { sale: 'Sale', no_sale: 'No Sale', callback: 'Callback', not_interested: 'Not Interested', hung_up: 'Hung Up', voicemail: 'Voicemail', other: 'Other' };
const DISPO_COLOR   = { sale: '#16a34a', no_sale: '#dc2626', callback: '#2563eb', not_interested: '#6b7280', hung_up: '#ea580c', voicemail: '#9333ea', other: '#d97706' };
const PAGE_SIZE = 25;

// Simple client-side pagination strip
const Pagination = ({ page, total, onPage }) => {
  const totalPages = Math.ceil(total / PAGE_SIZE);
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between pt-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
      <span className="text-xs text-text-secondary">
        {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
      </span>
      <div className="flex items-center gap-1">
        <button onClick={() => onPage(page - 1)} disabled={page <= 1}
          className="p-1.5 rounded-lg disabled:opacity-40 transition-colors hover:bg-bg-secondary"
          style={{ color: 'var(--color-text-secondary)' }}>
          <ChevronLeft size={16} />
        </button>
        <span className="text-xs font-semibold px-2" style={{ color: 'var(--color-text)' }}>
          {page} / {totalPages}
        </span>
        <button onClick={() => onPage(page + 1)} disabled={page >= totalPages}
          className="p-1.5 rounded-lg disabled:opacity-40 transition-colors hover:bg-bg-secondary"
          style={{ color: 'var(--color-text-secondary)' }}>
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
};

const FronterManagerDashboard = () => {
  const { user, logout, updateUser, hasPermission } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const notifHook = useNotifications();

  const [activeTab, setActiveTab] = useState('overview');
  const [activeNav, setActiveNav] = useState('dashboard');

  const crossNavItems = [
    ...(hasPermission('view_company_members') || hasPermission('create_user') || hasPermission('edit_user')
      ? [{ key: 'team',    label: 'Team',    icon: Users    }] : []),
    ...(hasPermission('manage_roles')
      ? [{ key: 'roles',   label: 'Roles',   icon: Shield   }] : []),
    ...(hasPermission('manage_forms')
      ? [{ key: 'forms',   label: 'Forms',   icon: FileText }] : []),
    ...(hasPermission('view_call_reviews') || hasPermission('view_all_call_reviews')
      ? [{ key: 'reviews', label: 'Reviews', icon: Star     }] : []),
  ];

  // ── Core data ──────────────────────────────────────────────────────────────
  const [transfers, setTransfers]   = useState([]);
  const [sales, setSales]           = useState([]);
  const [fronters, setFronters]     = useState([]);
  const [closers, setClosers]       = useState([]);
  const [reviewMap, setReviewMap]   = useState({});
  const [tLoading, setTLoading]     = useState(false);
  const [lbLoading, setLbLoading]   = useState(false);

  // ── Pagination ─────────────────────────────────────────────────────────────
  const [transfersPage, setTransfersPage] = useState(1);
  const [salesPage, setSalesPage]         = useState(1);

  // ── Reassign modal ─────────────────────────────────────────────────────────
  const [reassignTarget, setReassignTarget] = useState(null);
  const [reassignCloser, setReassignCloser] = useState('');
  const [reassigning, setReassigning]       = useState(false);
  const [reassignMsg, setReassignMsg]       = useState('');

  // ── Disposition modal ──────────────────────────────────────────────────────
  const [dispoTarget, setDispoTarget] = useState(null);
  const [dispoVal, setDispoVal]       = useState('');
  const [dispoNotes, setDispoNotes]   = useState('');
  const [dispoSaving, setDispoSaving] = useState(false);
  const [dispoMsg, setDispoMsg]       = useState('');

  // ── Activity log ───────────────────────────────────────────────────────────
  const [activityLogs, setActivityLogs]     = useState([]);
  const [activityTotal, setActivityTotal]   = useState(0);
  const [activityPage, setActivityPage]     = useState(1);
  const [activityLoading, setActivityLoading] = useState(false);

  // ── Create transfer ────────────────────────────────────────────────────────
  const [showTransferModal, setShowTransferModal]       = useState(false);
  const [transferSubmitting, setTransferSubmitting]     = useState(false);

  const companyId = user?.company_id;

  const { createTransfer }                              = useTransfers(companyId);
  const { fields, loading: fieldsLoading, fetchFields } = useFormFields();
  const { closers: linkedClosers, loading: closersLoading, fetchClosers } = useClosers(companyId);
  const { clients: saleClients, plans: salePlans, fetchConfigs } = useSaleConfigs(companyId);

  useEffect(() => { fetchFields(); fetchClosers(); fetchConfigs(); }, []);

  const [dateRange, setDateRange] = useState(() => getPresetRange('30d'));
  const { date_from, date_to }    = dateRange;

  const handleDateChange = useCallback((range) => {
    setDateRange(range);
    setTransfersPage(1);
    setSalesPage(1);
    setActivityPage(1);
  }, []);

  // ── Fetch all data ─────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    if (!companyId) return;
    setTLoading(true);
    setLbLoading(true);
    try {
      const [tRes, sRes, closersRes, reviewsRes] = await Promise.allSettled([
        client.get('transfers',         { params: { company_id: companyId, limit: 200, date_from, date_to } }),
        client.get('sales',             { params: { company_id: companyId, limit: 200, date_from, date_to } }),
        client.get('transfers/closers', { params: { company_id: companyId } }),
        client.get('reviews',           { params: { company_id: companyId, limit: 200 } }),
      ]);

      const allTransfers = tRes.status === 'fulfilled' ? (tRes.value.data.transfers || []) : [];
      const allSales     = sRes.status === 'fulfilled' ? (sRes.value.data.sales     || []) : [];
      setTransfers(allTransfers);
      setSales(allSales);
      if (closersRes.status === 'fulfilled') setClosers(closersRes.value.data.closers || []);

      const rMap = {};
      if (reviewsRes.status === 'fulfilled') {
        (reviewsRes.value.data.reviews || []).forEach(r => { rMap[r.transfer_id] = r.rating; });
      }
      setReviewMap(rMap);

      const map = {};
      allTransfers.forEach(t => {
        const key  = t.created_by;
        const name = t.user_profiles
          ? `${t.user_profiles.first_name || ''} ${t.user_profiles.last_name || ''}`.trim() || 'Unknown'
          : 'Unknown';
        if (!map[key]) map[key] = { id: key, name, total: 0, assigned: 0, completed: 0, rejected: 0 };
        map[key].total++;
        if (t.status === 'assigned')  map[key].assigned++;
        if (t.status === 'completed') map[key].completed++;
        if (t.status === 'rejected')  map[key].rejected++;
      });
      setFronters(Object.values(map).sort((a, b) => b.completed - a.completed));
    } catch { /* non-critical */ } finally {
      setTLoading(false);
      setLbLoading(false);
    }
  }, [companyId, date_from, date_to]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Activity log fetch ─────────────────────────────────────────────────────
  const fetchActivityLogs = useCallback(async (page = 1) => {
    if (!companyId) return;
    setActivityLoading(true);
    try {
      const res = await client.get('activity-logs', {
        params: { company_id: companyId, page, limit: PAGE_SIZE, date_from, date_to },
      });
      setActivityLogs(res.data.logs || []);
      setActivityTotal(res.data.total || 0);
    } catch { /* non-critical */ } finally { setActivityLoading(false); }
  }, [companyId, date_from, date_to]);

  useEffect(() => {
    if (activeTab === 'activity_log') fetchActivityLogs(activityPage);
  }, [activeTab, fetchActivityLogs, activityPage]);

  const handleLogout = () => { logout(); navigate('/login'); };

  const handleCreateTransfer = async (payload) => {
    setTransferSubmitting(true);
    try { await createTransfer(payload); loadAll(); }
    finally { setTransferSubmitting(false); }
  };

  const handleReassign = async () => {
    if (!reassignCloser || !reassignTarget) return;
    setReassigning(true);
    try {
      await client.put(`transfers/${reassignTarget.id}`, { assigned_closer_id: reassignCloser });
      setReassignTarget(null);
      setReassignCloser('');
      setReassignMsg('Transfer reassigned.');
      loadAll();
      setTimeout(() => setReassignMsg(''), 4000);
    } catch (err) {
      setReassignMsg(err.response?.data?.error || 'Failed to reassign');
    } finally { setReassigning(false); }
  };

  const handleSetDispo = async () => {
    if (!dispoVal) return;
    setDispoSaving(true);
    setDispoMsg('');
    try {
      await client.post(`reviews/transfer/${dispoTarget.id}/dispo`, { disposition: dispoVal, notes: dispoNotes || undefined });
      setDispoTarget(null);
      setDispoVal('');
      setDispoNotes('');
      if (activeTab === 'activity_log') fetchActivityLogs(activityPage);
    } catch (err) {
      setDispoMsg(err.response?.data?.error || 'Failed to save disposition');
    } finally { setDispoSaving(false); }
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const rejected  = transfers.filter(t => t.status === 'rejected');
  const assigned  = transfers.filter(t => t.status === 'assigned');
  const completed = transfers.filter(t => t.status === 'completed');
  const totalSales = sales.length;
  const soldSales  = sales.filter(s => ['sold', 'closed_won'].includes(s.status)).length;
  const convRate   = transfers.length > 0 ? Math.round((soldSales / transfers.length) * 100) : 0;

  const SALE_BADGE = { open: 'info', sold: 'success', cancelled: 'error', follow_up: 'warning', closed_won: 'success', closed_lost: 'error', compliance_cancelled: 'error', dispute: 'warning', chargeback: 'error' };

  const myTransfers  = transfers.filter(t => t.created_by === user?.id);
  const myCompleted  = myTransfers.filter(t => t.status === 'completed').length;
  const myAssigned   = myTransfers.filter(t => t.status === 'assigned').length;
  const myConversion = myTransfers.length > 0 ? Math.round((myCompleted / myTransfers.length) * 100) : 0;

  // Client-side paginated slices
  const pagedTransfers = transfers.slice((transfersPage - 1) * PAGE_SIZE, transfersPage * PAGE_SIZE);
  const pagedSales     = sales.slice((salesPage - 1) * PAGE_SIZE, salesPage * PAGE_SIZE);

  const TABS = [
    { key: 'overview',        label: 'Overview',     icon: BarChart3  },
    { key: 'my_transfers',    label: 'My Leads',      icon: Send       },
    ...(hasPermission('view_team_transfers')     ? [{ key: 'transfers',      label: 'All Transfers',  icon: Send       }] : []),
    ...(hasPermission('view_team_sales')         ? [{ key: 'sales',          label: 'Team Sales',     icon: DollarSign }] : []),
    ...(hasPermission('view_fronter_stats')      ? [{ key: 'leaderboard',    label: 'Leaderboard',    icon: TrendingUp }] : []),
    ...(hasPermission('manage_callback_numbers') ? [{ key: 'tracked_numbers',label: 'Numbers',        icon: Phone      }] : []),
    ...(hasPermission('view_team_callbacks')     ? [{ key: 'callbacks',      label: 'Callbacks',      icon: Phone      }] : []),
    ...(hasPermission('manage_callback_numbers') ? [{ key: 'number_lists',   label: 'Number Lists',   icon: Hash       }] : []),
    ...(hasPermission('search_sales')            ? [{ key: 'search',         label: 'Search',         icon: Search     }] : []),
    { key: 'activity_log', label: 'Activity',   icon: Activity   },
  ];

  return (
    <>
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      <AppHeader
        title="Fronter Manager"
        logo={<div className="w-10 h-10 bg-gradient-sidebar rounded-lg flex items-center justify-center"><Users className="text-white" size={24} /></div>}
        theme={theme} onThemeToggle={toggleTheme}
        userEmail={user?.email} userRole={user?.role_name || user?.role} onLogout={handleLogout}
        user={user} onUpdateUser={updateUser}
        notifications={notifHook.notifications} unreadCount={notifHook.unreadCount}
        onMarkRead={notifHook.markRead} onMarkAllRead={notifHook.markAllRead}
        onDeleteNotification={notifHook.deleteNotification} onClearNotifications={notifHook.clearAll}
        navItems={crossNavItems} activeNav={activeNav} onNavChange={setActiveNav}
      />

      {activeNav !== 'dashboard' && <CrossRoleContent section={activeNav} user={user} />}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in"
        style={{ display: activeNav !== 'dashboard' ? 'none' : undefined }}>

        {/* Page header */}
        <div className="mb-6 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-2xl font-bold text-text">
              Welcome, {user?.first_name || user?.email}!
            </h2>
            <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
              <strong>{user?.role_name || 'Fronter Manager'}</strong> · {user?.company_name}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {hasPermission('create_transfer') && (
              <button onClick={() => setShowTransferModal(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm text-white transition-all hover:scale-105"
                style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-md)' }}>
                <PlusCircle size={16} /> New Lead
              </button>
            )}
            <button onClick={loadAll}
              className="p-2 rounded-xl transition-colors hover:bg-bg-secondary"
              title="Refresh" style={{ border: '1px solid var(--color-border)' }}>
              <RefreshCw size={16} style={{ color: 'var(--color-text-secondary)' }} />
            </button>
          </div>
        </div>

        {/* Tab bar + date picker */}
        <div className="mb-6 flex items-center justify-between gap-3 flex-wrap">
          <div className="overflow-x-auto flex-1 min-w-0">
            <div className="flex gap-1 p-1 rounded-xl w-fit min-w-full sm:min-w-0"
              style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
              {TABS.map(tab => (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all duration-150 whitespace-nowrap flex-shrink-0"
                  style={{
                    background:  activeTab === tab.key ? 'var(--gradient-sidebar)' : 'transparent',
                    color:       activeTab === tab.key ? 'white' : 'var(--color-text-secondary)',
                    boxShadow:   activeTab === tab.key ? 'var(--shadow-sm)' : 'none',
                  }}>
                  <tab.icon size={13} />
                  {tab.label}
                  {tab.key === 'transfers' && rejected.length > 0 && (
                    <span className="w-4 h-4 rounded-full text-xs font-bold flex items-center justify-center"
                      style={{ backgroundColor: 'rgba(255,255,255,0.3)', fontSize: '10px' }}>
                      {rejected.length}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-shrink-0">
            <DateRangePicker onChange={handleDateChange} defaultPreset="30d" />
          </div>
        </div>

        {reassignMsg && (
          <div className="mb-4 p-3 rounded-xl text-sm font-medium"
            style={{
              backgroundColor: reassignMsg.includes('Failed') ? 'var(--color-error-50)' : 'var(--color-success-50)',
              color:            reassignMsg.includes('Failed') ? 'var(--color-error-700)' : 'var(--color-success-700)',
            }}>
            {reassignMsg}
          </div>
        )}

        {/* ── OVERVIEW ───────────────────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {[
                { label: 'Transfers',   value: transfers.length, icon: Send,         color: 'info'    },
                { label: 'Assigned',    value: assigned.length,  icon: ChevronRight, color: 'primary' },
                { label: 'Completed',   value: completed.length, icon: CheckCircle,  color: 'success' },
                { label: 'Rejected',    value: rejected.length,  icon: XCircle,      color: 'error'   },
                { label: 'Total Sales', value: totalSales,       icon: DollarSign,   color: 'success' },
                { label: 'Conversion',  value: `${convRate}%`,   icon: TrendingUp,   color: 'warning' },
              ].map(s => (
                <Card key={s.label} className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs text-text-secondary mb-1">{s.label}</p>
                      <p className={`text-2xl font-bold text-${s.color}-600`}>
                        {tLoading ? '—' : s.value}
                      </p>
                    </div>
                    <div className={`p-2.5 rounded-xl bg-${s.color}-100`}>
                      <s.icon size={16} className={`text-${s.color}-600`} />
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            {rejected.length > 0 && (
              <Card className="p-6 border-2" style={{ borderColor: 'var(--color-error-200)' }}>
                <h3 className="text-base font-bold text-error-600 flex items-center gap-2 mb-4">
                  <AlertCircle size={18} /> Rejected — Need Reassignment ({rejected.length})
                </h3>
                <div className="space-y-2">
                  {rejected.map(t => (
                    <div key={t.id} className="flex items-center justify-between p-3 rounded-xl"
                      style={{ backgroundColor: 'var(--color-error-50)', border: '1px solid var(--color-error-200)' }}>
                      <div>
                        <p className="font-semibold text-sm text-text">{t.form_data?.customer_name || 'Customer'}</p>
                        <p className="text-xs text-error-600 mt-0.5">{t.rejection_reason || 'No reason given'}</p>
                      </div>
                      {hasPermission('reassign_transfer') && (
                        <button onClick={() => { setReassignTarget(t); setReassignCloser(''); }}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
                          style={{ background: 'var(--gradient-sidebar)' }}>
                          Reassign
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <Card className="p-6">
              <h3 className="text-base font-bold text-text mb-4 flex items-center gap-2">
                <TrendingUp size={16} /> Top Fronters
              </h3>
              {lbLoading ? (
                <div className="flex justify-center py-6"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
              ) : fronters.length === 0 ? (
                <p className="text-text-secondary text-center py-4 text-sm">No data yet</p>
              ) : (
                <div className="space-y-2">
                  {fronters.slice(0, 5).map((f, i) => (
                    <div key={f.id} className="flex items-center gap-3 p-3 rounded-xl"
                      style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                      <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                        style={{ background: i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : 'var(--gradient-sidebar)' }}>
                        {i + 1}
                      </span>
                      <span className="flex-1 font-semibold text-sm text-text">{f.name}</span>
                      <span className="text-xs text-text-secondary">{f.total} transfers</span>
                      <span className="text-xs font-bold text-success-600">{f.completed} won</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}

        {/* ── MY LEADS ───────────────────────────────────────────────────── */}
        {activeTab === 'my_transfers' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Total Leads',  value: myTransfers.length, color: 'info'    },
                { label: 'Assigned',     value: myAssigned,          color: 'success' },
                { label: 'Won',          value: myCompleted,         color: 'primary' },
                { label: 'Conversion',   value: `${myConversion}%`,  color: 'warning' },
              ].map(s => (
                <Card key={s.label} className="p-5">
                  <p className="text-xs text-text-secondary mb-1">{s.label}</p>
                  <p className={`text-2xl font-bold text-${s.color}-600`}>{s.value}</p>
                </Card>
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {hasPermission('create_transfer') && (
                <Card className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-bold text-text flex items-center gap-2"><PlusCircle size={17} /> Create New Lead</h3>
                    <button onClick={() => setShowTransferModal(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white"
                      style={{ background: 'var(--gradient-sidebar)' }}>
                      <PlusCircle size={13} /> New Lead
                    </button>
                  </div>
                  <div className="text-center py-8">
                    <FileText size={40} className="mx-auto mb-3 text-text-tertiary" />
                    <p className="text-sm text-text-secondary">Click "New Lead" to transfer a call to a closer.</p>
                  </div>
                </Card>
              )}
              <Card className="p-6">
                <h3 className="text-base font-bold mb-4 text-text flex items-center gap-2"><FileText size={17} /> My Leads</h3>
                {tLoading ? (
                  <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
                ) : myTransfers.length === 0 ? (
                  <p className="text-sm text-text-secondary text-center py-8">No leads yet.</p>
                ) : (
                  <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                    {myTransfers.map(t => {
                      const closerName = t.closer ? `${t.closer.first_name || ''} ${t.closer.last_name || ''}`.trim() : null;
                      const name = t.form_data?.FirstName
                        ? `${t.form_data.FirstName} ${t.form_data.LastName || ''}`.trim()
                        : t.form_data?.customer_name || 'Lead';
                      return (
                        <div key={t.id} className="p-3 rounded-xl border"
                          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}>
                          <div className="flex items-start justify-between mb-1">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-text truncate">{name}</p>
                              <p className="text-xs text-text-secondary mt-0.5">
                                {t.form_data?.Phone || ''}
                                {closerName && <> · <strong>{closerName}</strong></>}
                              </p>
                              {t.status === 'rejected' && t.rejection_reason && (
                                <p className="text-xs text-error-600 mt-0.5">↳ {t.rejection_reason}</p>
                              )}
                            </div>
                            <Badge variant={STATUS_COLORS[t.status] || 'secondary'} size="sm">{t.status}</Badge>
                          </div>
                          <p className="text-xs text-text-tertiary">{new Date(t.created_at).toLocaleDateString()}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}

        {/* ── ALL TRANSFERS ──────────────────────────────────────────────── */}
        {activeTab === 'transfers' && (
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-text">All Transfers</h3>
              <span className="text-xs text-text-secondary">{transfers.length} total</span>
            </div>
            {tLoading ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
            ) : transfers.length === 0 ? (
              <p className="text-sm text-text-secondary text-center py-8">No transfers in this period.</p>
            ) : (
              <>
                <div className="space-y-2">
                  {pagedTransfers.map(t => {
                    const closer = t.closer;
                    const closerName = closer ? `${closer.first_name || ''} ${closer.last_name || ''}`.trim() : null;
                    return (
                      <div key={t.id} className="p-4 rounded-xl border hover:shadow-sm transition-all"
                        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-text truncate">{t.form_data?.customer_name || 'Customer'}</p>
                            <p className="text-xs text-text-secondary mt-0.5">
                              {t.form_data?.customer_phone || t.form_data?.Phone || ''}
                              {closerName && <> · Closer: <strong>{closerName}</strong></>}
                            </p>
                            {t.status === 'rejected' && t.rejection_reason && (
                              <p className="text-xs text-error-600 mt-0.5">↳ {t.rejection_reason}</p>
                            )}
                            <p className="text-xs text-text-tertiary mt-1">{new Date(t.created_at).toLocaleString()}</p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {reviewMap[t.id] && (
                              <span className="px-2 py-0.5 rounded-full text-xs font-bold capitalize hidden sm:flex items-center gap-1"
                                style={{ backgroundColor: `${RATING_COLOR[reviewMap[t.id]]}20`, color: RATING_COLOR[reviewMap[t.id]] }}>
                                <Star size={9} /> {reviewMap[t.id].replace(/_/g, ' ')}
                              </span>
                            )}
                            <Badge variant={STATUS_COLORS[t.status] || 'secondary'} size="sm">{t.status}</Badge>
                            {t.status === 'rejected' && hasPermission('reassign_transfer') && (
                              <button onClick={() => { setReassignTarget(t); setReassignCloser(''); }}
                                className="px-2 py-1 rounded text-xs font-bold text-white"
                                style={{ background: 'var(--gradient-sidebar)' }}>
                                Reassign
                              </button>
                            )}
                            <button
                              onClick={() => { setDispoTarget(t); setDispoVal(''); setDispoNotes(''); setDispoMsg(''); }}
                              className="px-2 py-1 rounded-lg text-xs font-semibold transition-colors hover:opacity-80"
                              style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
                              title="Set disposition">
                              Dispo
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <Pagination page={transfersPage} total={transfers.length} onPage={setTransfersPage} />
              </>
            )}
          </Card>
        )}

        {/* ── LEADERBOARD ────────────────────────────────────────────────── */}
        {activeTab === 'leaderboard' && (
          <Card className="p-6">
            <h3 className="text-base font-bold text-text mb-5 flex items-center gap-2"><TrendingUp size={17} /> Fronter Leaderboard</h3>
            {lbLoading ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
            ) : fronters.length === 0 ? (
              <p className="text-sm text-text-secondary text-center py-8">No fronter data yet.</p>
            ) : (
              <div className="space-y-2">
                {fronters.map((f, i) => (
                  <div key={f.id} className="flex items-center gap-4 p-4 rounded-xl border"
                    style={{ borderColor: 'var(--color-border)', backgroundColor: i === 0 ? 'var(--color-warning-50)' : 'var(--color-bg)' }}>
                    <span className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                      style={{
                        background: i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : i === 2 ? '#b45309' : 'var(--color-bg-secondary)',
                        color: i < 3 ? 'white' : 'var(--color-text-secondary)',
                      }}>
                      {i + 1}
                    </span>
                    <div className="flex-1">
                      <p className="font-bold text-sm text-text">{f.name}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-text-secondary">{f.total} total</span>
                        <span className="text-xs text-info-600">{f.assigned} active</span>
                        <span className="text-xs text-success-600 font-semibold">{f.completed} won</span>
                        {f.rejected > 0 && <span className="text-xs text-error-600">{f.rejected} rejected</span>}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold text-success-600">{f.completed}</p>
                      <p className="text-xs text-text-tertiary">conversions</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* ── TEAM SALES ─────────────────────────────────────────────────── */}
        {activeTab === 'sales' && (
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-text flex items-center gap-2"><DollarSign size={17} /> Team Sales</h3>
              <span className="text-xs text-text-secondary">{sales.length} total</span>
            </div>
            {tLoading ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
            ) : sales.length === 0 ? (
              <p className="text-sm text-text-secondary text-center py-8">No sales in this period.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                        {['Customer', 'Phone', 'Reference', 'Plan', 'Monthly', 'Status', 'Date'].map(h => (
                          <th key={h} className="px-3 py-3 text-left text-xs font-bold text-text-secondary uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pagedSales.map(s => (
                        <tr key={s.id} className="hover:bg-bg-secondary transition-colors"
                          style={{ borderBottom: '1px solid var(--color-border)' }}>
                          <td className="px-3 py-3 font-semibold text-text text-sm">{s.customer_name || '—'}</td>
                          <td className="px-3 py-3 text-xs text-text-secondary">{s.customer_phone || '—'}</td>
                          <td className="px-3 py-3 font-mono text-xs text-text-secondary">{s.reference_no || '—'}</td>
                          <td className="px-3 py-3 text-xs text-text-secondary">{s.plan || '—'}</td>
                          <td className="px-3 py-3 text-xs font-semibold text-success-600">
                            {s.monthly_payment && hasPermission('view_financial_data') ? `$${s.monthly_payment}` : '—'}
                          </td>
                          <td className="px-3 py-3"><SaleStatusBadge sale={s} size="sm" /></td>
                          <td className="px-3 py-3 text-xs text-text-tertiary">{new Date(s.created_at).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination page={salesPage} total={sales.length} onPage={setSalesPage} />
              </>
            )}
          </Card>
        )}

        {/* ── ACTIVITY LOG ───────────────────────────────────────────────── */}
        {activeTab === 'activity_log' && (
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-text flex items-center gap-2">
                <Activity size={17} /> Disposition Activity Log
              </h3>
              <span className="text-xs text-text-secondary">{activityTotal} entries</span>
            </div>
            {activityLoading ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
            ) : activityLogs.length === 0 ? (
              <div className="text-center py-12">
                <Activity size={36} className="mx-auto mb-3 text-text-tertiary" />
                <p className="text-sm text-text-secondary">No activity in this period.</p>
                <p className="text-xs text-text-tertiary mt-1">Disposition changes by you and your team will appear here.</p>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {activityLogs.map(log => {
                    const actorName = log.actor
                      ? `${log.actor.first_name || ''} ${log.actor.last_name || ''}`.trim() || 'Unknown'
                      : 'Unknown';
                    const isUpdate = log.action === 'disposition_updated';
                    const newDispo = log.new_value?.disposition;
                    const oldDispo = log.old_value?.disposition;
                    const isManagerOverride = log.metadata?.manager_override;
                    return (
                      <div key={log.id} className="p-4 rounded-xl border"
                        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold text-text">{actorName}</span>
                              {isManagerOverride && (
                                <span className="px-1.5 py-0.5 rounded text-xs font-bold"
                                  style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>
                                  Manager
                                </span>
                              )}
                              <span className="text-xs text-text-secondary">
                                {isUpdate ? 'updated disposition' : 'set disposition'}
                              </span>
                              {log.metadata?.customer_name && (
                                <span className="text-xs font-medium text-text">
                                  for <strong>{log.metadata.customer_name}</strong>
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                              {oldDispo && (
                                <>
                                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                                    style={{ backgroundColor: `${DISPO_COLOR[oldDispo] || '#6b7280'}20`, color: DISPO_COLOR[oldDispo] || '#6b7280' }}>
                                    {DISPO_LABEL[oldDispo] || oldDispo}
                                  </span>
                                  <span className="text-xs text-text-tertiary">→</span>
                                </>
                              )}
                              {newDispo && (
                                <span className="px-2 py-0.5 rounded-full text-xs font-bold"
                                  style={{ backgroundColor: `${DISPO_COLOR[newDispo] || '#6b7280'}20`, color: DISPO_COLOR[newDispo] || '#6b7280' }}>
                                  {DISPO_LABEL[newDispo] || newDispo}
                                </span>
                              )}
                              {log.new_value?.notes && (
                                <span className="text-xs text-text-secondary italic">"{log.new_value.notes}"</span>
                              )}
                            </div>
                          </div>
                          <span className="text-xs text-text-tertiary whitespace-nowrap flex-shrink-0">
                            {new Date(log.created_at).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <Pagination page={activityPage} total={activityTotal} onPage={p => { setActivityPage(p); fetchActivityLogs(p); }} />
              </>
            )}
          </Card>
        )}

        {/* ── OTHER TABS ─────────────────────────────────────────────────── */}
        {activeTab === 'search'         && <SaleSearch companyId={companyId} />}
        {activeTab === 'tracked_numbers' && <CallbackNumbers user={user} />}
        {activeTab === 'callbacks'       && <CallbacksOverview user={user} />}
        {activeTab === 'number_lists'    && <NumberUploadManager user={user} />}
      </main>

      {/* ── REASSIGN MODAL ─────────────────────────────────────────────── */}
      {reassignTarget && (
        <div className="fixed inset-0 z-50 overflow-y-auto" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="w-full max-w-md rounded-2xl p-6 shadow-2xl"
              style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <h3 className="text-lg font-bold text-text mb-2">Reassign Transfer</h3>
              <p className="text-sm text-text-secondary mb-4">
                Customer: <strong>{reassignTarget.form_data?.customer_name || 'Unknown'}</strong>
                {reassignTarget.rejection_reason && (
                  <><br />Reason: <em>{reassignTarget.rejection_reason}</em></>
                )}
              </p>
              <label className="block text-sm font-medium text-text-secondary mb-1">Select new closer</label>
              <select value={reassignCloser} onChange={e => setReassignCloser(e.target.value)} className="input mb-4">
                <option value="">— Choose closer —</option>
                {closers.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.first_name} {c.last_name} {c.email ? `(${c.email})` : ''}
                  </option>
                ))}
              </select>
              <div className="flex gap-3">
                <button onClick={() => setReassignTarget(null)}
                  className="flex-1 py-2 rounded-lg border text-sm font-semibold"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                  Cancel
                </button>
                <button onClick={handleReassign} disabled={!reassignCloser || reassigning}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: 'var(--gradient-sidebar)' }}>
                  {reassigning ? 'Reassigning…' : 'Reassign'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── DISPOSITION MODAL ──────────────────────────────────────────── */}
      {dispoTarget && (
        <div className="fixed inset-0 z-50 overflow-y-auto" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={e => { if (e.target === e.currentTarget) { setDispoTarget(null); } }}>
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="w-full max-w-md rounded-2xl p-6 shadow-2xl"
              style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <h3 className="text-lg font-bold text-text mb-1">Set Disposition</h3>
              <p className="text-sm text-text-secondary mb-5">
                Customer: <strong>{dispoTarget.form_data?.customer_name || dispoTarget.form_data?.FirstName || 'Unknown'}</strong>
              </p>
              <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">Disposition</label>
              <div className="grid grid-cols-2 gap-2 mb-4">
                {DISPOSITIONS.map(d => (
                  <button key={d} onClick={() => setDispoVal(d)}
                    className="py-2 px-3 rounded-lg text-sm font-semibold text-left transition-all"
                    style={{
                      backgroundColor: dispoVal === d ? `${DISPO_COLOR[d]}15` : 'var(--color-bg-secondary)',
                      color:           dispoVal === d ? DISPO_COLOR[d] : 'var(--color-text-secondary)',
                      border:          `1px solid ${dispoVal === d ? DISPO_COLOR[d] : 'var(--color-border)'}`,
                    }}>
                    {DISPO_LABEL[d]}
                  </button>
                ))}
              </div>
              <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wide mb-1">Notes (optional)</label>
              <textarea
                className="input w-full mb-4 resize-none" rows={3}
                placeholder="Additional notes…"
                value={dispoNotes}
                onChange={e => setDispoNotes(e.target.value)}
              />
              {dispoMsg && <p className="text-xs text-error-600 mb-3">{dispoMsg}</p>}
              <div className="flex gap-3">
                <button onClick={() => { setDispoTarget(null); setDispoVal(''); setDispoNotes(''); }}
                  className="flex-1 py-2 rounded-lg border text-sm font-semibold"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                  Cancel
                </button>
                <button onClick={handleSetDispo} disabled={!dispoVal || dispoSaving}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: 'var(--gradient-sidebar)' }}>
                  {dispoSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>

    <TransferFormModal
      isOpen={showTransferModal}
      onClose={() => setShowTransferModal(false)}
      user={user}
      fields={fields}
      fieldsLoading={fieldsLoading}
      closers={linkedClosers}
      closersLoading={closersLoading}
      saleClients={saleClients}
      salePlans={salePlans}
      onSubmit={handleCreateTransfer}
      isLoading={transferSubmitting}
    />
    </>
  );
};

export default FronterManagerDashboard;

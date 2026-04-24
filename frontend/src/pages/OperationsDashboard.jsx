import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useNavigate } from "react-router-dom";
import {
  Settings, TrendingUp, Send, DollarSign, Users,
  Phone, Search, BarChart3, RefreshCw, CheckCircle,
  XCircle, Clock, AlertCircle, Star, PlusCircle, Trash2, Hash, Shield, FileText,
} from "lucide-react";
import { Card, Badge, Button } from "../components/UI";
import DateRangePicker, { getPresetRange } from "../components/UI/DateRangePicker";
import { AppHeader } from "../components/Layout";
import CreateUserModal from "../components/Admin/UserManagement/CreateUserModal";
import { useDashboardStats } from "../hooks/useDashboardStats";
import { useNotifications } from "../hooks/useNotifications";
import CallbacksOverview from "../components/Callbacks/CallbacksOverview";
import NumberUploadManager from "../components/Numbers/NumberUploadManager";
import SaleSearch from "../components/Sales/SaleSearch";
import CallbackNumbers from "../components/CallbackNumbers/CallbackNumbers";
import CrossRoleContent from "../components/Navigation/CrossRoleContent";
import client from "../api/client";

const TRANSFER_BADGE = { pending: 'warning', assigned: 'info', completed: 'success', cancelled: 'error', rejected: 'error' };
const SALE_BADGE     = { open: 'info', sold: 'success', cancelled: 'error', follow_up: 'warning', closed_won: 'success', closed_lost: 'error' };
const RATING_COLOR   = { excellent: '#16a34a', good: '#2563eb', average: '#d97706', below_average: '#ea580c', bad: '#dc2626' };

const OperationsDashboard = () => {
  const { user, logout, updateUser, hasPermission } = useAuth();
  const { theme, toggleTheme }         = useTheme();
  const navigate                       = useNavigate();
  const { stats, loading: statsLoading, fetchStats } = useDashboardStats();
  const notifHook                      = useNotifications();

  const [activeTab, setActiveTab] = useState('overview');
  const [activeNav, setActiveNav] = useState('dashboard');

  const crossNavItems = [
    ...(hasPermission('manage_roles')
      ? [{ key: 'roles', label: 'Roles', icon: Shield   }] : []),
    ...(hasPermission('manage_forms')
      ? [{ key: 'forms', label: 'Forms', icon: FileText }] : []),
  ];

  const [transfers, setTransfers]   = useState([]);
  const [sales, setSales]           = useState([]);
  const [fronters, setFronters]     = useState([]);
  const [closersLb, setClosersLb]   = useState([]);
  const [loading, setLoading]       = useState(false);

  // Reassign state
  const [availableClosers, setAvailableClosers] = useState([]);
  const [reassignTarget, setReassignTarget]     = useState(null);
  const [reassignCloser, setReassignCloser]     = useState('');
  const [reassigning, setReassigning]           = useState(false);

  // Reviews state
  const [reviews, setReviews]         = useState([]);
  const [dispos, setDispos]           = useState([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsSubTab, setReviewsSubTab]   = useState('ratings');

  // Team state
  const [teamMembers, setTeamMembers]   = useState([]);
  const [teamLoading, setTeamLoading]   = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [teamActionErr, setTeamActionErr] = useState('');

  const companyId = user?.company_id;
  const [dateRange, setDateRange] = useState(() => getPresetRange('30d'));
  const { date_from, date_to }    = dateRange;

  const loadReviews = useCallback(async () => {
    if (!companyId) return;
    setReviewsLoading(true);
    try {
      const [rRes, dRes] = await Promise.all([
        client.get('reviews',              { params: { company_id: companyId, limit: 100 } }),
        client.get('reviews/dispositions', { params: { company_id: companyId, limit: 100 } }),
      ]);
      setReviews(rRes.data.reviews || []);
      setDispos(dRes.data.dispositions || []);
    } catch { /* non-critical */ } finally {
      setReviewsLoading(false);
    }
  }, [companyId]);

  const loadAll = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    fetchStats();
    try {
      const [tRes, sRes, closersRes] = await Promise.all([
        client.get('transfers', { params: { company_id: companyId, limit: 200, date_from, date_to } }),
        client.get('sales',     { params: { company_id: companyId, limit: 200, date_from, date_to } }),
        client.get('transfers/closers', { params: { company_id: companyId } }),
      ]);

      const allT = tRes.data.transfers || [];
      const allS = sRes.data.sales     || [];
      setTransfers(allT);
      setSales(allS);
      setAvailableClosers(closersRes.data.closers || []);

      // Build fronter leaderboard
      const fm = {};
      allT.forEach(t => {
        const k = t.created_by;
        const name = t.user_profiles
          ? `${t.user_profiles.first_name || ''} ${t.user_profiles.last_name || ''}`.trim() || 'Unknown'
          : 'Unknown';
        if (!fm[k]) fm[k] = { id: k, name, total: 0, completed: 0, rejected: 0 };
        fm[k].total++;
        if (t.status === 'completed') fm[k].completed++;
        if (t.status === 'rejected')  fm[k].rejected++;
      });
      setFronters(Object.values(fm).sort((a, b) => b.completed - a.completed));

      // Build closer leaderboard
      const cm = {};
      allS.forEach(s => {
        const k = s.closer_id;
        if (!k) return;
        if (!cm[k]) cm[k] = { id: k, name: k.slice(0, 8), total: 0, won: 0 };
        cm[k].total++;
        if (['sold', 'closed_won'].includes(s.status)) cm[k].won++;
      });
      setClosersLb(Object.values(cm).sort((a, b) => b.won - a.won));
    } catch { /* non-critical */ } finally {
      setLoading(false);
    }
  }, [companyId, date_from, date_to]);

  const loadTeam = useCallback(() => {
    if (!companyId) return;
    setTeamLoading(true);
    client.get('users', { params: { company_id: companyId } })
      .then(r => setTeamMembers(r.data.users || []))
      .catch(() => {})
      .finally(() => setTeamLoading(false));
  }, [companyId]);

  const toggleTeamMember = async (u) => {
    setTeamActionErr('');
    try {
      await client.put(`users/${u.id}`, { is_active: !u.is_active });
      loadTeam();
    } catch (err) {
      setTeamActionErr(err.response?.data?.error || 'Action failed');
    }
  };

  const deleteTeamMember = async (id) => {
    if (!window.confirm('Permanently delete this member?')) return;
    setTeamActionErr('');
    try {
      await client.delete(`users/${id}`);
      loadTeam();
    } catch (err) {
      setTeamActionErr(err.response?.data?.error || 'Delete failed');
    }
  };

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { if (activeTab === 'reviews') loadReviews(); }, [activeTab, loadReviews]);
  useEffect(() => { if (activeTab === 'team') loadTeam(); }, [activeTab, loadTeam]);

  const handleLogout = () => { logout(); navigate('/login'); };

  const doReassign = async () => {
    if (!reassignCloser || !reassignTarget) return;
    setReassigning(true);
    try {
      await client.put(`transfers/${reassignTarget.id}`, { assigned_closer_id: reassignCloser });
      setReassignTarget(null);
      loadAll();
    } catch { /* non-critical */ } finally {
      setReassigning(false);
    }
  };

  const rejectedTransfers = transfers.filter(t => t.status === 'rejected');

  const TABS = [
    { key: 'overview',   label: 'Overview',    icon: BarChart3  },
    ...(hasPermission('view_company_members')                                    ? [{ key: 'team',            label: 'Team',            icon: Users      }] : []),
    ...(hasPermission('view_team_transfers')                                     ? [{ key: 'transfers',       label: 'Transfers',       icon: Send       }] : []),
    ...(hasPermission('view_team_sales')                                         ? [{ key: 'sales',           label: 'Sales',           icon: DollarSign }] : []),
    ...(hasPermission('view_fronter_stats') || hasPermission('view_closer_stats')? [{ key: 'leaderboard',     label: 'Leaderboard',     icon: TrendingUp }] : []),
    ...(hasPermission('view_call_reviews')                                       ? [{ key: 'reviews',         label: 'Reviews',         icon: Star       }] : []),
    ...(hasPermission('search_sales')                                            ? [{ key: 'search',          label: 'Search Sales',    icon: Search     }] : []),
    ...(hasPermission('manage_callback_numbers')                                 ? [{ key: 'tracked_numbers', label: 'Tracked Numbers', icon: Phone      }] : []),
    ...(hasPermission('view_team_callbacks')                                     ? [{ key: 'callbacks',       label: 'Team Callbacks',  icon: Phone      }] : []),
    ...(hasPermission('manage_callback_numbers')                                 ? [{ key: 'numbers',         label: 'Number Lists',    icon: Hash       }] : []),
  ];

  return (
    <div className="min-h-screen bg-bg">
      <AppHeader
        title="Operations Manager"
        logo={<div className="w-10 h-10 bg-gradient-sidebar rounded-lg flex items-center justify-center"><Settings className="text-white" size={24} /></div>}
        theme={theme} onThemeToggle={toggleTheme}
        userEmail={user?.email} userRole={user?.role_name || 'Operations Manager'} onLogout={handleLogout}
        user={user} onUpdateUser={updateUser}
        notifications={notifHook.notifications} unreadCount={notifHook.unreadCount}
        onMarkRead={notifHook.markRead} onMarkAllRead={notifHook.markAllRead}
        onDeleteNotification={notifHook.deleteNotification} onClearNotifications={notifHook.clearAll}
        navItems={crossNavItems} activeNav={activeNav} onNavChange={setActiveNav}
      />

      {activeNav !== 'dashboard' && <CrossRoleContent section={activeNav} user={user} />}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" style={{ display: activeNav !== 'dashboard' ? 'none' : undefined }}>
        <div className="mb-6 animate-fade-in flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold mb-1 text-text">Welcome, {user?.first_name || user?.email}!</h2>
            <p className="text-text-secondary"><strong>{user?.role_name || 'Operations Manager'}</strong> at <strong>{user?.company_name}</strong></p>
          </div>
          <button onClick={loadAll} className="p-2 rounded-lg hover:bg-bg-secondary transition-colors">
            <RefreshCw size={18} style={{ color: 'var(--color-text-secondary)' }} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
          <div className="flex flex-wrap gap-1 p-1 rounded-xl w-fit"
            style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            {TABS.map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150"
                style={{
                  background: activeTab === tab.key ? 'var(--gradient-sidebar)' : 'transparent',
                  color:      activeTab === tab.key ? 'white' : 'var(--color-text-secondary)',
                  boxShadow:  activeTab === tab.key ? 'var(--shadow-sm)' : 'none',
                }}>
                <tab.icon size={15} />
                {tab.label}
                {tab.key === 'transfers' && rejectedTransfers.length > 0 && (
                  <span className="ml-1 w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center text-white"
                    style={{ backgroundColor: 'var(--color-error-500)' }}>{rejectedTransfers.length}</span>
                )}
              </button>
            ))}
          </div>
          <DateRangePicker onChange={setDateRange} defaultPreset="30d" />
        </div>

        {/* ── OVERVIEW ──────────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Total Transfers', value: statsLoading ? '—' : stats.totalTransfers || 0,  icon: Send,        color: 'info'    },
                { label: 'Total Sales',     value: statsLoading ? '—' : stats.totalSales     || 0,  icon: DollarSign,  color: 'success' },
                { label: 'Conversion',      value: statsLoading ? '—' : `${stats.conversionRate || 0}%`, icon: TrendingUp, color: 'primary' },
                { label: 'Rejected',        value: rejectedTransfers.length,                          icon: XCircle,     color: 'error'   },
              ].map(s => (
                <Card key={s.label} className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-text-secondary mb-1">{s.label}</p>
                      <p className={`text-3xl font-bold text-${s.color}-600`}>{s.value}</p>
                    </div>
                    <div className={`p-3 rounded-xl bg-${s.color}-100 dark:bg-${s.color}-900`}>
                      <s.icon size={20} className={`text-${s.color}-600`} />
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            {/* Rejected alert */}
            {rejectedTransfers.length > 0 && (
              <Card className="p-5 border-2" style={{ borderColor: 'var(--color-error-200)' }}>
                <h3 className="font-bold text-error-600 flex items-center gap-2 mb-3">
                  <AlertCircle size={18} /> {rejectedTransfers.length} Rejected Transfer(s) Need Reassignment
                </h3>
                <div className="space-y-2">
                  {rejectedTransfers.slice(0, 5).map(t => (
                    <div key={t.id} className="flex items-center justify-between p-3 rounded-xl"
                      style={{ backgroundColor: 'var(--color-error-50)' }}>
                      <div>
                        <p className="font-semibold text-text text-sm">
                          {t.form_data?.FirstName
                            ? `${t.form_data.FirstName} ${t.form_data.LastName || ''}`.trim()
                            : t.form_data?.customer_name || 'Customer'}
                        </p>
                        <p className="text-xs text-error-600">{t.rejection_reason || 'No reason'}</p>
                      </div>
                      {hasPermission('reassign_transfer') && (
                      <button onClick={() => { setReassignTarget(t); setReassignCloser(''); }}
                        className="px-3 py-1.5 text-sm font-bold rounded-lg text-white"
                        style={{ background: 'var(--gradient-sidebar)' }}>
                        Reassign
                      </button>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Quick leaderboards */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="p-5">
                <h3 className="font-bold text-text mb-3 flex items-center gap-2"><Users size={16} /> Top Fronters</h3>
                {fronters.slice(0, 5).map((f, i) => (
                  <div key={f.id} className="flex items-center gap-3 py-2 border-b last:border-0"
                    style={{ borderColor: 'var(--color-border)' }}>
                    <span className="text-sm font-bold w-5 text-center" style={{ color: 'var(--color-text-tertiary)' }}>{i + 1}</span>
                    <span className="flex-1 text-sm font-semibold text-text">{f.name}</span>
                    <span className="text-xs text-text-secondary">{f.total} leads</span>
                    <span className="text-xs font-bold text-success-600">{f.completed} won</span>
                  </div>
                ))}
              </Card>
              <Card className="p-5">
                <h3 className="font-bold text-text mb-3 flex items-center gap-2"><TrendingUp size={16} /> Top Closers</h3>
                {closersLb.slice(0, 5).map((c, i) => (
                  <div key={c.id} className="flex items-center gap-3 py-2 border-b last:border-0"
                    style={{ borderColor: 'var(--color-border)' }}>
                    <span className="text-sm font-bold w-5 text-center" style={{ color: 'var(--color-text-tertiary)' }}>{i + 1}</span>
                    <span className="flex-1 text-sm font-semibold text-text">{c.name}</span>
                    <span className="text-xs text-text-secondary">{c.total} sales</span>
                    <span className="text-xs font-bold text-success-600">{c.won} won</span>
                  </div>
                ))}
              </Card>
            </div>
          </div>
        )}

        {/* ── TEAM ──────────────────────────────────────────────── */}
        {activeTab === 'team' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-text-secondary">{teamMembers.length} member{teamMembers.length !== 1 ? 's' : ''}</p>
              {hasPermission('create_user') && (
              <Button variant="primary" size="sm" onClick={() => setShowAddMember(true)} className="flex items-center gap-1.5">
                <PlusCircle size={15} /> Add Member
              </Button>
              )}
            </div>

            {teamActionErr && <p className="text-sm text-error-600">{teamActionErr}</p>}

            {teamLoading ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
            ) : teamMembers.length === 0 ? (
              <Card className="p-10 text-center">
                <Users size={40} className="mx-auto mb-3 text-text-tertiary" />
                <p className="text-text-secondary text-sm mb-4">No team members yet.</p>
                <Button variant="primary" size="sm" onClick={() => setShowAddMember(true)}>Add First Member</Button>
              </Card>
            ) : (
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                        {['Name','Email','Role','Level','Status','Actions'].map(h => (
                          <th key={h} className="px-3 py-2.5 text-left text-xs font-bold text-text-secondary uppercase">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {teamMembers.map(u => (
                        <tr key={u.id} className="hover:bg-bg-secondary" style={{ borderBottom: '1px solid var(--color-border)' }}>
                          <td className="px-3 py-2.5 font-semibold text-text">{[u.first_name,u.last_name].filter(Boolean).join(' ')||'—'}</td>
                          <td className="px-3 py-2.5 text-xs text-text-secondary">{u.email||'—'}</td>
                          <td className="px-3 py-2.5 text-xs text-text-secondary">{u.role||'—'}</td>
                          <td className="px-3 py-2.5 text-xs text-text-secondary capitalize">{u.role_level?.replace(/_/g,' ')||'—'}</td>
                          <td className="px-3 py-2.5">
                            <Badge variant={u.is_active?'success':'secondary'} size="sm">{u.is_active?'Active':'Inactive'}</Badge>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              {hasPermission('edit_user') && (
                              <button onClick={() => toggleTeamMember(u)} title={u.is_active?'Deactivate':'Activate'}
                                className="p-1 rounded hover:bg-bg-secondary transition-colors">
                                {u.is_active
                                  ? <XCircle size={15} className="text-warning-500" />
                                  : <CheckCircle size={15} className="text-success-500" />}
                              </button>
                              )}
                              {hasPermission('delete_user') && (
                              <button onClick={() => deleteTeamMember(u.id)} title="Delete"
                                className="p-1 rounded hover:bg-error-50 dark:hover:bg-error-900 transition-colors">
                                <Trash2 size={15} className="text-error-500" />
                              </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            <CreateUserModal
              isOpen={showAddMember}
              onClose={() => setShowAddMember(false)}
              companyId={companyId}
              onCreated={() => loadTeam()}
            />
          </div>
        )}

        {/* ── TRANSFERS ─────────────────────────────────────────── */}
        {activeTab === 'transfers' && (
          <Card className="p-6">
            <h3 className="text-xl font-bold text-text mb-4">All Transfers</h3>
            {loading ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
            ) : transfers.length === 0 ? (
              <p className="text-text-secondary text-center py-8">No transfers yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                      {['Customer', 'Phone', 'Status', 'Rejection Reason', 'Date', 'Action'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-bold text-text-secondary uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {transfers.map(t => (
                      <tr key={t.id} className="hover:bg-bg-secondary transition-colors"
                        style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td className="px-4 py-3 font-semibold text-text">
                          {t.form_data?.FirstName
                            ? `${t.form_data.FirstName} ${t.form_data.LastName || ''}`.trim()
                            : t.form_data?.customer_name || '—'}
                        </td>
                        <td className="px-4 py-3 text-text-secondary">{t.form_data?.Phone || t.form_data?.customer_phone || '—'}</td>
                        <td className="px-4 py-3"><Badge variant={TRANSFER_BADGE[t.status] || 'secondary'} size="sm">{t.status}</Badge></td>
                        <td className="px-4 py-3 text-xs text-error-600">{t.rejection_reason || '—'}</td>
                        <td className="px-4 py-3 text-xs text-text-tertiary">{new Date(t.created_at).toLocaleDateString()}</td>
                        <td className="px-4 py-3">
                          {(t.status === 'rejected' || t.status === 'pending') && hasPermission('reassign_transfer') && (
                            <button onClick={() => { setReassignTarget(t); setReassignCloser(''); }}
                              className="px-2 py-1 rounded text-xs font-bold text-white"
                              style={{ background: 'var(--gradient-sidebar)' }}>
                              Reassign
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {/* ── SALES ─────────────────────────────────────────────── */}
        {activeTab === 'sales' && (
          <Card className="p-6">
            <h3 className="text-xl font-bold text-text mb-4">All Sales</h3>
            {loading ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
            ) : sales.length === 0 ? (
              <p className="text-text-secondary text-center py-8">No sales yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                      {['Customer', 'Phone', 'Reference', 'Vehicle', 'Plan', 'Monthly', 'Status', 'Date'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-bold text-text-secondary uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sales.map(s => (
                      <tr key={s.id} className="hover:bg-bg-secondary transition-colors"
                        style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td className="px-4 py-3 font-semibold text-text">{s.customer_name || '—'}</td>
                        <td className="px-4 py-3 text-text-secondary">{s.customer_phone || '—'}</td>
                        <td className="px-4 py-3 font-mono text-xs text-text-secondary">{s.reference_no || '—'}</td>
                        <td className="px-4 py-3 text-xs text-text-secondary">{[s.car_year, s.car_make, s.car_model].filter(Boolean).join(' ') || '—'}</td>
                        <td className="px-4 py-3 text-xs text-text-secondary">{s.plan || '—'}</td>
                        <td className="px-4 py-3 text-xs font-semibold text-success-600">{s.monthly_payment && hasPermission('view_financial_data') ? `$${s.monthly_payment}` : '—'}</td>
                        <td className="px-4 py-3"><Badge variant={SALE_BADGE[s.status] || 'secondary'} size="sm">{s.status}</Badge></td>
                        <td className="px-4 py-3 text-xs text-text-tertiary">{new Date(s.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {/* ── LEADERBOARD ───────────────────────────────────────── */}
        {activeTab === 'leaderboard' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-6">
              <h3 className="text-xl font-bold text-text mb-4 flex items-center gap-2"><Users size={20} /> Fronter Leaderboard</h3>
              {fronters.length === 0 ? <p className="text-text-secondary text-center py-4">No data yet.</p> : (
                <div className="space-y-3">
                  {fronters.map((f, i) => (
                    <div key={f.id} className="flex items-center gap-3 p-3 rounded-xl border"
                      style={{ borderColor: 'var(--color-border)' }}>
                      <span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                        style={{ background: i < 3 ? 'var(--gradient-sidebar)' : 'var(--color-bg-secondary)',
                          color: i < 3 ? 'white' : 'var(--color-text-secondary)' }}>{i + 1}</span>
                      <span className="flex-1 font-semibold text-text text-sm">{f.name}</span>
                      <span className="text-xs text-text-secondary">{f.total}</span>
                      <span className="text-xs font-bold text-success-600">{f.completed} won</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card className="p-6">
              <h3 className="text-xl font-bold text-text mb-4 flex items-center gap-2"><TrendingUp size={20} /> Closer Leaderboard</h3>
              {closersLb.length === 0 ? <p className="text-text-secondary text-center py-4">No data yet.</p> : (
                <div className="space-y-3">
                  {closersLb.map((c, i) => (
                    <div key={c.id} className="flex items-center gap-3 p-3 rounded-xl border"
                      style={{ borderColor: 'var(--color-border)' }}>
                      <span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                        style={{ background: i < 3 ? 'var(--gradient-sidebar)' : 'var(--color-bg-secondary)',
                          color: i < 3 ? 'white' : 'var(--color-text-secondary)' }}>{i + 1}</span>
                      <span className="flex-1 font-semibold text-text text-sm">{c.name}</span>
                      <span className="text-xs text-text-secondary">{c.total} sales</span>
                      <span className="text-xs font-bold text-success-600">{c.won} won</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}

        {/* ── REVIEWS ──────────────────────────────────────────── */}
        {activeTab === 'reviews' && (
          <div className="space-y-4">
            {/* Sub-tab toggle */}
            <div className="flex gap-1 p-1 rounded-xl w-fit"
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

            <Card className="overflow-hidden">
              {reviewsLoading ? (
                <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>
              ) : reviewsSubTab === 'ratings' ? (
                reviews.length === 0 ? (
                  <div className="text-center py-16 text-text-secondary">No call ratings yet.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                          {['Customer', 'Closer', 'Rating', 'Notes', 'Date'].map(h => (
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
                  <div className="text-center py-16 text-text-secondary">No dispositions yet.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                          {['Customer', 'Closer', 'Disposition', 'Notes', 'Date'].map(h => (
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

        {activeTab === 'search'          && <SaleSearch companyId={companyId} />}
        {activeTab === 'tracked_numbers' && <CallbackNumbers user={user} />}
        {activeTab === 'callbacks'       && <CallbacksOverview user={user} />}
        {activeTab === 'numbers'         && <NumberUploadManager user={user} />}
      </main>

      {/* Reassign Modal */}
      {reassignTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-md mx-4 rounded-2xl p-6 shadow-2xl"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <h3 className="text-lg font-bold text-text mb-4">Reassign Transfer</h3>
            <p className="text-sm text-text-secondary mb-4">
              Customer: <strong>
                {reassignTarget.form_data?.FirstName
                  ? `${reassignTarget.form_data.FirstName} ${reassignTarget.form_data.LastName || ''}`.trim()
                  : reassignTarget.form_data?.customer_name || 'Unknown'}
              </strong>
            </p>
            <select value={reassignCloser} onChange={e => setReassignCloser(e.target.value)} className="input mb-4">
              <option value="">— Select closer —</option>
              {availableClosers.map(c => (
                <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
              ))}
            </select>
            <div className="flex gap-3">
              <button onClick={() => setReassignTarget(null)}
                className="flex-1 py-2 rounded-lg border font-semibold text-sm"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Cancel</button>
              <button onClick={doReassign} disabled={!reassignCloser || reassigning}
                className="flex-1 py-2 rounded-lg font-semibold text-sm text-white disabled:opacity-50"
                style={{ background: 'var(--gradient-sidebar)' }}>
                {reassigning ? 'Reassigning…' : 'Reassign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OperationsDashboard;

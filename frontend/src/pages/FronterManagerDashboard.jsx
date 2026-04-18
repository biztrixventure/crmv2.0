import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useNavigate } from "react-router-dom";
import {
  Users, Send, TrendingUp, Phone, BarChart3,
  RefreshCw, CheckCircle, XCircle, AlertCircle, ChevronRight, Star, Hash,
} from "lucide-react";
import { Card, Badge } from "../components/UI";
import { AppHeader } from "../components/Layout";
import { useNotifications } from "../hooks/useNotifications";
import CallbacksOverview from "../components/Callbacks/CallbacksOverview";
import NumberUploadManager from "../components/Numbers/NumberUploadManager";
import CallbackNumbers from "../components/CallbackNumbers/CallbackNumbers";
import client from "../api/client";

const STATUS_COLORS = { pending: 'warning', assigned: 'info', completed: 'success', cancelled: 'error', rejected: 'error' };
const RATING_COLOR  = { excellent: '#16a34a', good: '#2563eb', average: '#d97706', below_average: '#ea580c', bad: '#dc2626' };

const FronterManagerDashboard = () => {
  const { user, logout, updateUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const notifHook = useNotifications();

  const [activeTab, setActiveTab] = useState('overview');

  // ── Transfers state ──────────────────────────────────────────────────────
  const [transfers, setTransfers]     = useState([]);
  const [tLoading, setTLoading]       = useState(false);

  // ── Fronter leaderboard ──────────────────────────────────────────────────
  const [fronters, setFronters]       = useState([]);
  const [lbLoading, setLbLoading]     = useState(false);

  // ── Stats ────────────────────────────────────────────────────────────────
  const [stats, setStats]             = useState({});
  const [statsLoading, setStatsLoading] = useState(false);

  // ── Closers for reassignment ─────────────────────────────────────────────
  const [closers, setClosers]         = useState([]);

  // ── Reviews map: transfer_id → rating ───────────────────────────────────
  const [reviewMap, setReviewMap]     = useState({});

  // ── Reassign modal ───────────────────────────────────────────────────────
  const [reassignTarget, setReassignTarget] = useState(null); // transfer being reassigned
  const [reassignCloser, setReassignCloser] = useState('');
  const [reassigning, setReassigning]       = useState(false);
  const [reassignMsg, setReassignMsg]       = useState('');

  const companyId = user?.company_id;

  const loadAll = useCallback(async () => {
    if (!companyId) return;
    setTLoading(true);
    setLbLoading(true);
    setStatsLoading(true);

    try {
      const [tRes, statsRes, closersRes, reviewsRes] = await Promise.allSettled([
        client.get('transfers',         { params: { company_id: companyId, limit: 100 } }),
        client.get('stats',             { params: { company_id: companyId } }),
        client.get('transfers/closers', { params: { company_id: companyId } }),
        client.get('reviews',           { params: { company_id: companyId, limit: 200 } }),
      ]);

      const allTransfers = tRes.status === 'fulfilled' ? (tRes.value.data.transfers || []) : [];
      setTransfers(allTransfers);
      if (statsRes.status === 'fulfilled')   setStats(statsRes.value.data || {});
      if (closersRes.status === 'fulfilled') setClosers(closersRes.value.data.closers || []);

      const rMap = {};
      if (reviewsRes.status === 'fulfilled') {
        (reviewsRes.value.data.reviews || []).forEach(r => { rMap[r.transfer_id] = r.rating; });
      }
      setReviewMap(rMap);

      // Build fronter leaderboard from transfers
      const map = {};
      allTransfers.forEach(t => {
        const key = t.created_by;
        const name = t.user_profiles
          ? `${t.user_profiles.first_name || ''} ${t.user_profiles.last_name || ''}`.trim() || 'Unknown'
          : 'Unknown';
        if (!map[key]) map[key] = { id: key, name, total: 0, assigned: 0, completed: 0, rejected: 0 };
        map[key].total++;
        if (t.status === 'assigned')   map[key].assigned++;
        if (t.status === 'completed')  map[key].completed++;
        if (t.status === 'rejected')   map[key].rejected++;
      });
      const lb = Object.values(map).sort((a, b) => b.completed - a.completed);
      setFronters(lb);
    } catch { /* non-critical */ } finally {
      setTLoading(false);
      setLbLoading(false);
      setStatsLoading(false);
    }
  }, [companyId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleLogout = () => { logout(); navigate('/login'); };

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
    } finally {
      setReassigning(false);
    }
  };

  const rejected  = transfers.filter(t => t.status === 'rejected');
  const assigned  = transfers.filter(t => t.status === 'assigned');
  const completed = transfers.filter(t => t.status === 'completed');

  const TABS = [
    { key: 'overview',        label: 'Overview',         icon: BarChart3  },
    { key: 'transfers',       label: 'All Transfers',    icon: Send       },
    { key: 'leaderboard',     label: 'Leaderboard',      icon: TrendingUp },
    { key: 'tracked_numbers', label: 'Tracked Numbers',  icon: Phone      },
    { key: 'callbacks',       label: 'Team Callbacks',   icon: Phone      },
    { key: 'numbers',         label: 'Number Lists',     icon: Hash       },
  ];

  return (
    <div className="min-h-screen bg-bg">
      <AppHeader
        title="Fronter Manager"
        logo={<div className="w-10 h-10 bg-gradient-sidebar rounded-lg flex items-center justify-center"><Users className="text-white" size={24} /></div>}
        theme={theme} onThemeToggle={toggleTheme}
        userEmail={user?.email} userRole={user?.role_name || user?.role} onLogout={handleLogout}
        user={user} onUpdateUser={updateUser}
        notifications={notifHook.notifications} unreadCount={notifHook.unreadCount}
        onMarkRead={notifHook.markRead} onMarkAllRead={notifHook.markAllRead}
        onDeleteNotification={notifHook.deleteNotification} onClearNotifications={notifHook.clearAll}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6 animate-fade-in flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold mb-1 text-text">Welcome, {user?.first_name || user?.email}!</h2>
            <p className="text-text-secondary"><strong>{user?.role_name || 'Fronter Manager'}</strong> at <strong>{user?.company_name}</strong></p>
          </div>
          <button onClick={loadAll} className="p-2 rounded-lg transition-colors hover:bg-bg-secondary" title="Refresh">
            <RefreshCw size={18} style={{ color: 'var(--color-text-secondary)' }} />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 mb-6 p-1 rounded-xl w-fit"
          style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150"
              style={{
                backgroundColor: activeTab === tab.key ? 'var(--color-surface)' : 'transparent',
                color: activeTab === tab.key ? 'var(--color-primary-600)' : 'var(--color-text-secondary)',
                boxShadow: activeTab === tab.key ? 'var(--shadow-sm)' : 'none',
              }}>
              <tab.icon size={15} />
              {tab.label}
              {tab.key === 'transfers' && rejected.length > 0 && (
                <span className="ml-1 w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center text-white"
                  style={{ backgroundColor: 'var(--color-error-500)' }}>{rejected.length}</span>
              )}
            </button>
          ))}
        </div>

        {reassignMsg && (
          <div className="mb-4 p-3 rounded-xl text-sm font-medium"
            style={{ backgroundColor: reassignMsg.includes('Failed') ? 'var(--color-error-50)' : 'var(--color-success-50)',
              color: reassignMsg.includes('Failed') ? 'var(--color-error-700)' : 'var(--color-success-700)' }}>
            {reassignMsg}
          </div>
        )}

        {/* ── OVERVIEW TAB ─────────────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Stats row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Total Transfers',  value: transfers.length,    icon: Send,        color: 'info'    },
                { label: 'Assigned',         value: assigned.length,     icon: ChevronRight,color: 'primary' },
                { label: 'Completed/Won',    value: completed.length,    icon: CheckCircle, color: 'success' },
                { label: 'Rejected',         value: rejected.length,     icon: XCircle,     color: 'error'   },
              ].map(s => (
                <Card key={s.label} className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-text-secondary mb-1">{s.label}</p>
                      <p className={`text-3xl font-bold text-${s.color}-600`}>
                        {statsLoading ? '—' : s.value}
                      </p>
                    </div>
                    <div className={`p-3 rounded-xl bg-${s.color}-100 dark:bg-${s.color}-900`}>
                      <s.icon size={20} className={`text-${s.color}-600`} />
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            {/* Rejected transfers needing attention */}
            {rejected.length > 0 && (
              <Card className="p-6 border-2" style={{ borderColor: 'var(--color-error-200)' }}>
                <h3 className="text-lg font-bold text-error-600 flex items-center gap-2 mb-4">
                  <AlertCircle size={20} /> Rejected Transfers — Need Reassignment ({rejected.length})
                </h3>
                <div className="space-y-3">
                  {rejected.map(t => (
                    <div key={t.id} className="flex items-center justify-between p-3 rounded-xl"
                      style={{ backgroundColor: 'var(--color-error-50)', border: '1px solid var(--color-error-200)' }}>
                      <div>
                        <p className="font-semibold text-text">{t.form_data?.customer_name || 'Customer'}</p>
                        <p className="text-xs text-error-600 mt-0.5">Rejection reason: {t.rejection_reason || 'No reason given'}</p>
                      </div>
                      <button onClick={() => { setReassignTarget(t); setReassignCloser(''); }}
                        className="px-3 py-1.5 rounded-lg text-sm font-semibold text-white transition-all hover:scale-105"
                        style={{ background: 'var(--gradient-sidebar)' }}>
                        Reassign
                      </button>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Top fronters quick view */}
            <Card className="p-6">
              <h3 className="text-lg font-bold text-text mb-4 flex items-center gap-2"><TrendingUp size={18} /> Top Fronters</h3>
              {lbLoading ? (
                <div className="flex justify-center py-6"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
              ) : fronters.length === 0 ? (
                <p className="text-text-secondary text-center py-4">No data yet</p>
              ) : (
                <div className="space-y-2">
                  {fronters.slice(0, 5).map((f, i) => (
                    <div key={f.id} className="flex items-center gap-3 p-3 rounded-xl"
                      style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                      <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                        style={{ background: i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : 'var(--gradient-sidebar)' }}>
                        {i + 1}
                      </span>
                      <span className="flex-1 font-semibold text-text">{f.name}</span>
                      <span className="text-xs text-text-secondary">{f.total} transfers</span>
                      <span className="text-xs font-bold text-success-600">{f.completed} won</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}

        {/* ── TRANSFERS TAB ─────────────────────────────────────────────── */}
        {activeTab === 'transfers' && (
          <Card className="p-6">
            <h3 className="text-xl font-bold text-text mb-4">All Transfers</h3>
            {tLoading ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
            ) : transfers.length === 0 ? (
              <p className="text-text-secondary text-center py-8">No transfers yet.</p>
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                {transfers.map(t => {
                  const closer = t.closer;
                  const closerName = closer ? `${closer.first_name || ''} ${closer.last_name || ''}`.trim() : null;
                  return (
                    <div key={t.id} className="p-4 rounded-xl border transition-all hover:shadow-md"
                      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}>
                      <div className="flex items-start justify-between mb-1">
                        <div>
                          <p className="font-semibold text-text">{t.form_data?.customer_name || 'Customer'}</p>
                          <p className="text-xs text-text-secondary mt-0.5">
                            {t.form_data?.customer_phone || t.form_data?.Phone || ''}
                            {closerName && <> · Closer: <strong>{closerName}</strong></>}
                          </p>
                          {t.status === 'rejected' && t.rejection_reason && (
                            <p className="text-xs text-error-600 mt-0.5">Rejected: {t.rejection_reason}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap justify-end">
                          {reviewMap[t.id] && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-bold capitalize flex items-center gap-1"
                              style={{ backgroundColor: `${RATING_COLOR[reviewMap[t.id]]}20`, color: RATING_COLOR[reviewMap[t.id]] }}>
                              <Star size={10} />
                              {reviewMap[t.id].replace(/_/g, ' ')}
                            </span>
                          )}
                          <Badge variant={STATUS_COLORS[t.status] || 'secondary'} size="sm">{t.status}</Badge>
                          {t.status === 'rejected' && (
                            <button onClick={() => { setReassignTarget(t); setReassignCloser(''); }}
                              className="px-2 py-1 rounded text-xs font-bold text-white"
                              style={{ background: 'var(--gradient-sidebar)' }}>
                              Reassign
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-text-tertiary">{new Date(t.created_at).toLocaleString()}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        )}

        {/* ── LEADERBOARD TAB ───────────────────────────────────────────── */}
        {activeTab === 'leaderboard' && (
          <Card className="p-6">
            <h3 className="text-xl font-bold text-text mb-6 flex items-center gap-2"><TrendingUp size={20} /> Fronter Leaderboard</h3>
            {lbLoading ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
            ) : fronters.length === 0 ? (
              <p className="text-text-secondary text-center py-8">No fronter data yet.</p>
            ) : (
              <div className="space-y-3">
                {fronters.map((f, i) => (
                  <div key={f.id} className="flex items-center gap-4 p-4 rounded-xl border"
                    style={{ borderColor: 'var(--color-border)', backgroundColor: i === 0 ? 'var(--color-warning-50)' : 'var(--color-bg)' }}>
                    <span className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                      style={{ background: i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : i === 2 ? '#b45309' : 'var(--color-bg-secondary)',
                        color: i < 3 ? 'white' : 'var(--color-text-secondary)' }}>
                      {i + 1}
                    </span>
                    <div className="flex-1">
                      <p className="font-bold text-text">{f.name}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-text-secondary">{f.total} total</span>
                        <span className="text-xs text-info-600">{f.assigned} active</span>
                        <span className="text-xs text-success-600 font-semibold">{f.completed} won</span>
                        {f.rejected > 0 && <span className="text-xs text-error-600">{f.rejected} rejected</span>}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-success-600">{f.completed}</p>
                      <p className="text-xs text-text-tertiary">conversions</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* ── CALLBACKS TAB ─────────────────────────────────────────────── */}
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
            <h3 className="text-lg font-bold text-text mb-2">Reassign Transfer</h3>
            <p className="text-sm text-text-secondary mb-4">
              Customer: <strong>{reassignTarget.form_data?.customer_name || 'Unknown'}</strong>
              {reassignTarget.rejection_reason && (
                <><br />Rejection reason: <em>{reassignTarget.rejection_reason}</em></>
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
                className="flex-1 py-2 rounded-lg border font-semibold text-sm transition-colors"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                Cancel
              </button>
              <button onClick={handleReassign} disabled={!reassignCloser || reassigning}
                className="flex-1 py-2 rounded-lg font-semibold text-sm text-white transition-all disabled:opacity-50"
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

export default FronterManagerDashboard;

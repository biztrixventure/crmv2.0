import React, { useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useNavigate } from "react-router-dom";
import { Building2, Users, TrendingUp, DollarSign, ArrowUpRight, Activity } from "lucide-react";
import { Card, Badge } from "../components/UI";
import { AppHeader } from "../components/Layout";
import { useDashboardStats } from "../hooks/useDashboardStats";
import { useTransfers } from "../hooks/useTransfers";
import { useSales } from "../hooks/useSales";
import { useNotifications } from "../hooks/useNotifications";

const CompanyDashboard = () => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const { stats, loading: statsLoading, fetchStats } = useDashboardStats();
  const { transfers, loading: transfersLoading, fetchTransfers } = useTransfers(user?.company_id);
  const { sales, loading: salesLoading, fetchSales } = useSales(user?.company_id);
  const notifHook = useNotifications();

  useEffect(() => {
    fetchStats();
    fetchTransfers();
    fetchSales();
  }, []);

  const handleLogout = () => { logout(); navigate("/login"); };

  const statusColors = { pending: 'warning', assigned: 'info', completed: 'success', cancelled: 'error' };
  const saleStatusColors = { open: 'info', closed_won: 'success', closed_lost: 'error' };

  return (
    <div className="min-h-screen bg-bg">
      <AppHeader
        title="Company Admin"
        logo={<div className="w-10 h-10 bg-gradient-sidebar rounded-lg flex items-center justify-center"><Building2 className="text-white" size={24} /></div>}
        theme={theme} onThemeToggle={toggleTheme}
        userEmail={user?.email} userRole={user?.role_name || user?.role} onLogout={handleLogout}
        notifications={notifHook.notifications}
        unreadCount={notifHook.unreadCount}
        onMarkRead={notifHook.markRead}
        onMarkAllRead={notifHook.markAllRead}
        onDeleteNotification={notifHook.deleteNotification}
        onClearNotifications={notifHook.clearAll}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8 animate-fade-in">
          <h2 className="text-3xl font-bold mb-2 text-text">Company Overview</h2>
          <p className="text-lg text-text-secondary">
            Managing <strong>{user?.company_name}</strong>
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-text-secondary mb-1">Team Members</p>
                <p className="text-3xl font-bold text-text">{statsLoading ? '—' : stats.teamSize || stats.totalUsers || 0}</p>
              </div>
              <div className="p-3 rounded-xl bg-info-100 dark:bg-info-900"><Users size={22} className="text-info-600" /></div>
            </div>
          </Card>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-text-secondary mb-1">Active Transfers</p>
                <p className="text-3xl font-bold text-text">{statsLoading ? '—' : stats.totalTransfers || 0}</p>
              </div>
              <div className="p-3 rounded-xl bg-warning-100 dark:bg-warning-900"><Activity size={22} className="text-warning-600" /></div>
            </div>
          </Card>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-text-secondary mb-1">Total Sales</p>
                <p className="text-3xl font-bold text-success-600">{statsLoading ? '—' : stats.totalSales || 0}</p>
              </div>
              <div className="p-3 rounded-xl bg-success-100 dark:bg-success-900"><DollarSign size={22} className="text-success-600" /></div>
            </div>
          </Card>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-text-secondary mb-1">Conversion Rate</p>
                <p className="text-3xl font-bold text-info-600">{statsLoading ? '—' : `${stats.conversionRate || 0}%`}</p>
              </div>
              <div className="p-3 rounded-xl bg-info-100 dark:bg-info-900"><TrendingUp size={22} className="text-info-600" /></div>
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Transfers */}
          <Card className="p-6">
            <h3 className="text-xl font-bold mb-4 text-text flex items-center gap-2">
              <Activity size={20} /> Recent Transfers
            </h3>
            {transfersLoading ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div></div>
            ) : transfers.length === 0 ? (
              <p className="text-text-secondary text-center py-8">No transfers yet.</p>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {transfers.slice(0, 10).map(t => (
                  <div key={t.id} className="p-3 rounded-lg border border-border hover:border-primary-400 transition-colors">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-text">{t.form_data?.customer_name || 'Transfer'}</p>
                        <p className="text-xs text-text-tertiary">{new Date(t.created_at).toLocaleDateString()}</p>
                      </div>
                      <Badge variant={statusColors[t.status]} size="sm">{t.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Recent Sales */}
          <Card className="p-6">
            <h3 className="text-xl font-bold mb-4 text-text flex items-center gap-2">
              <DollarSign size={20} /> Recent Sales
            </h3>
            {salesLoading ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div></div>
            ) : sales.length === 0 ? (
              <p className="text-text-secondary text-center py-8">No sales yet.</p>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {sales.slice(0, 10).map(s => (
                  <div key={s.id} className="p-3 rounded-xl border transition-all hover:shadow-md"
                    style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-text">
                          {s.customer_name || s.transfers?.form_data?.customer_name || 'Sale'}
                        </p>
                        {s.car_year && (
                          <p className="text-xs text-text-secondary">{s.car_year} {s.car_make} {s.car_model}</p>
                        )}
                        <p className="text-xs text-text-tertiary mt-0.5">{new Date(s.created_at).toLocaleDateString()}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge variant={saleStatusColors[s.status] || 'secondary'} size="sm">
                          {s.status === 'closed_won' ? 'Won' : s.status === 'closed_lost' ? 'Lost' : s.status === 'sold' ? 'Sold' : 'Open'}
                        </Badge>
                        {s.monthly_payment && (
                          <span className="text-xs font-semibold text-success-600">${s.monthly_payment}/mo</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </main>
    </div>
  );
};

export default CompanyDashboard;

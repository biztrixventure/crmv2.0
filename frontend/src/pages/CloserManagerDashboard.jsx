import React, { useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useNavigate } from "react-router-dom";
import { Award, Users, DollarSign, TrendingUp, Target, BarChart3 } from "lucide-react";
import { Card, Badge } from "../components/UI";
import { AppHeader } from "../components/Layout";
import { useDashboardStats } from "../hooks/useDashboardStats";
import { useSales } from "../hooks/useSales";

const CloserManagerDashboard = () => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const { stats, loading: statsLoading, fetchStats } = useDashboardStats();
  const { sales, loading: salesLoading, fetchSales } = useSales(user?.company_id);

  useEffect(() => {
    fetchStats();
    fetchSales();
  }, []);

  const handleLogout = () => { logout(); navigate("/login"); };
  const saleStatusColors = { open: 'info', closed_won: 'success', closed_lost: 'error' };

  return (
    <div className="min-h-screen bg-bg">
      <AppHeader
        title="Closer Manager"
        logo={<div className="w-10 h-10 bg-gradient-sidebar rounded-lg flex items-center justify-center"><Award className="text-white" size={24} /></div>}
        theme={theme} onThemeToggle={toggleTheme}
        userEmail={user?.email} userRole={user?.role_name || user?.role} onLogout={handleLogout}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8 animate-fade-in">
          <h2 className="text-3xl font-bold mb-2 text-text">Team Management</h2>
          <p className="text-lg text-text-secondary">
            Closer team performance at <strong>{user?.company_name}</strong>
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-text-secondary mb-1">Team Size</p>
                <p className="text-3xl font-bold text-text">{statsLoading ? '—' : stats.teamSize || 0}</p>
              </div>
              <div className="p-3 rounded-xl bg-info-100 dark:bg-info-900"><Users size={22} className="text-info-600" /></div>
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
              <div className="p-3 rounded-xl bg-info-100 dark:bg-info-900"><Target size={22} className="text-info-600" /></div>
            </div>
          </Card>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-text-secondary mb-1">Won Deals</p>
                <p className="text-3xl font-bold text-success-600">{statsLoading ? '—' : stats.closedWon || 0}</p>
              </div>
              <div className="p-3 rounded-xl bg-success-100 dark:bg-success-900"><TrendingUp size={22} className="text-success-600" /></div>
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Team Sales */}
          <Card className="p-6">
            <h3 className="text-xl font-bold mb-4 text-text flex items-center gap-2">
              <BarChart3 size={20} /> Team Sales
            </h3>
            {salesLoading ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div></div>
            ) : sales.length === 0 ? (
              <p className="text-text-secondary text-center py-8">No sales recorded yet.</p>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {sales.slice(0, 15).map(s => (
                  <div key={s.id} className="p-3 rounded-lg border border-border hover:border-primary-400 transition-colors">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-text">{s.transfers?.form_data?.customer_name || 'Sale'}</p>
                        <p className="text-xs text-text-tertiary">{new Date(s.created_at).toLocaleDateString()}</p>
                      </div>
                      <Badge variant={saleStatusColors[s.status]} size="sm">
                        {s.status === 'closed_won' ? 'Won' : s.status === 'closed_lost' ? 'Lost' : 'Open'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Performance Summary */}
          <Card className="p-6">
            <h3 className="text-xl font-bold mb-4 text-text flex items-center gap-2">
              <Award size={20} /> Performance Summary
            </h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-bg-secondary">
                <span className="text-text-secondary">Open Deals</span>
                <span className="text-xl font-bold text-info-600">{stats.openSales || 0}</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-bg-secondary">
                <span className="text-text-secondary">Won Deals</span>
                <span className="text-xl font-bold text-success-600">{stats.closedWon || 0}</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-bg-secondary">
                <span className="text-text-secondary">Lost Deals</span>
                <span className="text-xl font-bold text-error-600">{stats.closedLost || 0}</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-bg-secondary">
                <span className="text-text-secondary">Total Transfers</span>
                <span className="text-xl font-bold text-text">{stats.totalTransfers || 0}</span>
              </div>
              {/* Visual bar */}
              <div className="mt-4">
                <p className="text-sm text-text-secondary mb-2">Win/Loss Ratio</p>
                <div className="w-full h-4 bg-bg rounded-full overflow-hidden flex">
                  {(stats.closedWon || 0) + (stats.closedLost || 0) > 0 ? (
                    <>
                      <div className="h-full bg-success-500 transition-all" style={{ width: `${((stats.closedWon || 0) / ((stats.closedWon || 0) + (stats.closedLost || 0))) * 100}%` }}></div>
                      <div className="h-full bg-error-500 transition-all" style={{ width: `${((stats.closedLost || 0) / ((stats.closedWon || 0) + (stats.closedLost || 0))) * 100}%` }}></div>
                    </>
                  ) : (
                    <div className="h-full bg-border w-full"></div>
                  )}
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-xs text-success-600">Won</span>
                  <span className="text-xs text-error-600">Lost</span>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default CloserManagerDashboard;

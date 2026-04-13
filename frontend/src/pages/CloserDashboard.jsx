import React, { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useNavigate } from "react-router-dom";
import { TrendingUp, DollarSign, Target, Clock, CheckCircle, XCircle, ArrowUpRight } from "lucide-react";
import { Card, Badge } from "../components/UI";
import { AppHeader } from "../components/Layout";
import { useDashboardStats } from "../hooks/useDashboardStats";
import { useTransfers } from "../hooks/useTransfers";
import { useSales } from "../hooks/useSales";

const CloserDashboard = () => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const { stats, loading: statsLoading, fetchStats } = useDashboardStats();
  const { transfers, loading: transfersLoading, fetchTransfers } = useTransfers(user?.company_id);
  const { sales, loading: salesLoading, fetchSales, createSale, updateSale } = useSales(user?.company_id);

  useEffect(() => {
    fetchStats();
    fetchTransfers();
    fetchSales();
  }, []);

  const handleLogout = () => { logout(); navigate("/login"); };

  const handleCreateSale = async (transferId) => {
    try {
      await createSale(transferId);
      fetchStats(); // Refresh stats
      fetchTransfers();
    } catch (err) { /* hook handles */ }
  };

  const handleUpdateSale = async (saleId, status) => {
    try {
      await updateSale(saleId, { status });
      fetchStats();
    } catch (err) { /* hook handles */ }
  };

  const statusColors = { pending: 'warning', assigned: 'info', completed: 'success', cancelled: 'error' };
  const saleStatusColors = { open: 'info', closed_won: 'success', closed_lost: 'error' };

  return (
    <div className="min-h-screen bg-bg">
      <AppHeader
        title="Closer Dashboard"
        logo={<div className="w-10 h-10 bg-gradient-sidebar rounded-lg flex items-center justify-center"><TrendingUp className="text-white" size={24} /></div>}
        theme={theme} onThemeToggle={toggleTheme}
        userEmail={user?.email} userRole={user?.role_name || user?.role} onLogout={handleLogout}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8 animate-fade-in">
          <h2 className="text-3xl font-bold mb-2 text-text">Welcome back, {user?.first_name || user?.email}!</h2>
          <p className="text-lg text-text-secondary">
            <strong>{user?.role_name || user?.role}</strong> at <strong>{user?.company_name}</strong>
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-text-secondary mb-1">My Sales</p>
                <p className="text-3xl font-bold text-text">{statsLoading ? '—' : stats.totalSales || 0}</p>
              </div>
              <div className="p-3 rounded-xl bg-success-100 dark:bg-success-900"><DollarSign size={22} className="text-success-600" /></div>
            </div>
          </Card>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-text-secondary mb-1">Won Deals</p>
                <p className="text-3xl font-bold text-success-600">{statsLoading ? '—' : stats.closedWon || 0}</p>
              </div>
              <div className="p-3 rounded-xl bg-success-100 dark:bg-success-900"><CheckCircle size={22} className="text-success-600" /></div>
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
                <p className="text-sm text-text-secondary mb-1">Assigned Transfers</p>
                <p className="text-3xl font-bold text-warning-600">{statsLoading ? '—' : stats.assignedTransfers || 0}</p>
              </div>
              <div className="p-3 rounded-xl bg-warning-100 dark:bg-warning-900"><Clock size={22} className="text-warning-600" /></div>
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Assigned Transfers */}
          <Card className="p-6">
            <h3 className="text-xl font-bold mb-4 text-text flex items-center gap-2">
              <Clock size={20} /> Assigned Transfers
            </h3>
            {transfersLoading ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div></div>
            ) : transfers.length === 0 ? (
              <p className="text-text-secondary text-center py-8">No transfers assigned to you yet.</p>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {transfers.slice(0, 10).map(t => (
                  <div key={t.id} className="p-4 rounded-lg border border-border hover:border-primary-400 transition-colors">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-semibold text-text">{t.form_data?.customer_name || 'Unknown Customer'}</p>
                        <p className="text-sm text-text-secondary">{t.form_data?.customer_email || t.form_data?.customer_phone || ''}</p>
                      </div>
                      <Badge variant={statusColors[t.status] || 'secondary'} size="sm">{t.status}</Badge>
                    </div>
                    {t.form_data?.deal_value && (
                      <p className="text-sm text-success-600 font-medium mb-2">${t.form_data.deal_value} {t.form_data?.deal_currency || ''}</p>
                    )}
                    {t.status === 'assigned' && (
                      <button onClick={() => handleCreateSale(t.id)} className="btn-primary text-sm py-1.5 px-3 w-full mt-2">
                        Convert to Sale
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* My Sales */}
          <Card className="p-6">
            <h3 className="text-xl font-bold mb-4 text-text flex items-center gap-2">
              <DollarSign size={20} /> My Sales
            </h3>
            {salesLoading ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div></div>
            ) : sales.length === 0 ? (
              <p className="text-text-secondary text-center py-8">No sales yet. Convert assigned transfers to get started.</p>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {sales.slice(0, 10).map(s => (
                  <div key={s.id} className="p-4 rounded-lg border border-border hover:border-primary-400 transition-colors">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-semibold text-text">{s.transfers?.form_data?.customer_name || 'Sale'}</p>
                        <p className="text-xs text-text-tertiary">{new Date(s.created_at).toLocaleDateString()}</p>
                      </div>
                      <Badge variant={saleStatusColors[s.status] || 'secondary'} size="sm">
                        {s.status === 'closed_won' ? 'Won' : s.status === 'closed_lost' ? 'Lost' : 'Open'}
                      </Badge>
                    </div>
                    {s.status === 'open' && (
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => handleUpdateSale(s.id, 'closed_won')} className="flex-1 btn-primary text-sm py-1.5 bg-success-600 hover:bg-success-700">
                          <CheckCircle size={14} className="inline mr-1" /> Won
                        </button>
                        <button onClick={() => handleUpdateSale(s.id, 'closed_lost')} className="flex-1 btn-secondary text-sm py-1.5 text-error-600">
                          <XCircle size={14} className="inline mr-1" /> Lost
                        </button>
                      </div>
                    )}
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

export default CloserDashboard;

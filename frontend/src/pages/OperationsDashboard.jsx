import React, { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useNavigate } from "react-router-dom";
import { Settings, Activity, Clock, CheckCircle, Users as UsersIcon, UserPlus } from "lucide-react";
import { Card, Badge, Button } from "../components/UI";
import { AppHeader } from "../components/Layout";
import { useDashboardStats } from "../hooks/useDashboardStats";
import { useTransfers } from "../hooks/useTransfers";
import client from "../api/client";

const OperationsDashboard = () => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const { stats, loading: statsLoading, fetchStats } = useDashboardStats();
  const { transfers, loading: transfersLoading, fetchTransfers, updateTransfer } = useTransfers(user?.company_id);
  const [closers, setClosers] = useState([]);
  const [assigning, setAssigning] = useState(null); // transferId being assigned

  useEffect(() => {
    fetchStats();
    fetchTransfers();
    fetchClosers();
  }, []);

  const fetchClosers = async () => {
    try {
      const response = await client.get('users', { params: { company_id: user?.company_id } });
      const allUsers = response.data.users || [];
      setClosers(allUsers.filter(u => u.role_level === 'closer' || u.role === 'Closer'));
    } catch (err) {
      console.error('Failed to fetch closers:', err);
    }
  };

  const handleLogout = () => { logout(); navigate("/login"); };

  const handleAssignTransfer = async (transferId, closerId) => {
    setAssigning(transferId);
    try {
      await updateTransfer(transferId, { assigned_to: closerId });
      fetchStats();
    } catch (err) { /* hook handles */ }
    setAssigning(null);
  };

  const pendingTransfers = transfers.filter(t => t.status === 'pending');
  const assignedTransfers = transfers.filter(t => t.status === 'assigned');
  const statusColors = { pending: 'warning', assigned: 'info', completed: 'success', cancelled: 'error' };

  return (
    <div className="min-h-screen bg-bg">
      <AppHeader
        title="Operations Center"
        logo={<div className="w-10 h-10 bg-gradient-sidebar rounded-lg flex items-center justify-center"><Settings className="text-white" size={24} /></div>}
        theme={theme} onThemeToggle={toggleTheme}
        userEmail={user?.email} userRole={user?.role_name || user?.role} onLogout={handleLogout}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8 animate-fade-in">
          <h2 className="text-3xl font-bold mb-2 text-text">Operations Center</h2>
          <p className="text-lg text-text-secondary">Manage transfer assignments and workflow</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-text-secondary mb-1">Total Transfers</p>
                <p className="text-3xl font-bold text-text">{statsLoading ? '—' : stats.totalTransfers || 0}</p>
              </div>
              <div className="p-3 rounded-xl bg-info-100 dark:bg-info-900"><Activity size={22} className="text-info-600" /></div>
            </div>
          </Card>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-text-secondary mb-1">Pending Assignment</p>
                <p className="text-3xl font-bold text-warning-600">{statsLoading ? '—' : stats.pendingTransfers || 0}</p>
              </div>
              <div className="p-3 rounded-xl bg-warning-100 dark:bg-warning-900"><Clock size={22} className="text-warning-600" /></div>
            </div>
          </Card>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-text-secondary mb-1">Assigned</p>
                <p className="text-3xl font-bold text-info-600">{statsLoading ? '—' : stats.assignedTransfers || 0}</p>
              </div>
              <div className="p-3 rounded-xl bg-info-100 dark:bg-info-900"><UserPlus size={22} className="text-info-600" /></div>
            </div>
          </Card>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-text-secondary mb-1">Completed</p>
                <p className="text-3xl font-bold text-success-600">{statsLoading ? '—' : stats.completedTransfers || 0}</p>
              </div>
              <div className="p-3 rounded-xl bg-success-100 dark:bg-success-900"><CheckCircle size={22} className="text-success-600" /></div>
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pending Transfers — need assignment */}
          <Card className="p-6">
            <h3 className="text-xl font-bold mb-4 text-text flex items-center gap-2">
              <Clock size={20} className="text-warning-600" /> Pending Assignment
              {pendingTransfers.length > 0 && <Badge variant="warning" size="sm">{pendingTransfers.length}</Badge>}
            </h3>
            {transfersLoading ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div></div>
            ) : pendingTransfers.length === 0 ? (
              <p className="text-text-secondary text-center py-8">All transfers have been assigned! 🎉</p>
            ) : (
              <div className="space-y-4 max-h-[500px] overflow-y-auto">
                {pendingTransfers.map(t => (
                  <div key={t.id} className="p-4 rounded-lg border border-warning-200 dark:border-warning-800 bg-warning-50 dark:bg-warning-900/20">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="font-semibold text-text">{t.form_data?.customer_name || 'Transfer'}</p>
                        <p className="text-sm text-text-secondary">{t.form_data?.customer_email || ''}</p>
                        {t.form_data?.deal_value && <p className="text-sm text-success-600 font-medium">${t.form_data.deal_value}</p>}
                      </div>
                      <Badge variant="warning" size="sm">Pending</Badge>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-text-secondary mb-1 block">Assign to Closer:</label>
                      <select
                        className="input text-sm"
                        defaultValue=""
                        onChange={e => e.target.value && handleAssignTransfer(t.id, e.target.value)}
                        disabled={assigning === t.id}
                      >
                        <option value="">Select closer...</option>
                        {closers.map(c => (
                          <option key={c.user_id} value={c.user_id}>{c.first_name} {c.last_name} ({c.email})</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Active (Assigned) Transfers */}
          <Card className="p-6">
            <h3 className="text-xl font-bold mb-4 text-text flex items-center gap-2">
              <UsersIcon size={20} className="text-info-600" /> Active Assignments
            </h3>
            {transfersLoading ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div></div>
            ) : assignedTransfers.length === 0 ? (
              <p className="text-text-secondary text-center py-8">No active assignments.</p>
            ) : (
              <div className="space-y-3 max-h-[500px] overflow-y-auto">
                {assignedTransfers.map(t => (
                  <div key={t.id} className="p-3 rounded-lg border border-border hover:border-primary-400 transition-colors">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-text">{t.form_data?.customer_name || 'Transfer'}</p>
                        <p className="text-xs text-text-tertiary">{new Date(t.created_at).toLocaleDateString()}</p>
                      </div>
                      <Badge variant="info" size="sm">Assigned</Badge>
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

export default OperationsDashboard;

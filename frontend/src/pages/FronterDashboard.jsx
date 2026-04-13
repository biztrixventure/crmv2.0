import React, { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useNavigate } from "react-router-dom";
import { Users, Send, CheckCircle, PlusCircle, FileText, Clock } from "lucide-react";
import { Card, Badge, Button } from "../components/UI";
import { AppHeader } from "../components/Layout";
import { useDashboardStats } from "../hooks/useDashboardStats";
import { useTransfers } from "../hooks/useTransfers";
import { useFormFields } from "../hooks/useFormFields";

const FronterDashboard = () => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const { stats, loading: statsLoading, fetchStats } = useDashboardStats();
  const { transfers, loading: transfersLoading, fetchTransfers, createTransfer } = useTransfers(user?.company_id);
  const { fields, loading: fieldsLoading, fetchFields } = useFormFields();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchStats();
    fetchTransfers();
    fetchFields();
  }, []);

  const handleLogout = () => { logout(); navigate("/login"); };

  const handleSubmitTransfer = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await createTransfer(formData);
      setShowCreateForm(false);
      setFormData({});
      fetchStats();
    } catch (err) { /* hook handles */ }
    setSubmitting(false);
  };

  const statusColors = { pending: 'warning', assigned: 'info', completed: 'success', cancelled: 'error' };

  return (
    <div className="min-h-screen bg-bg">
      <AppHeader
        title="Fronter Dashboard"
        logo={<div className="w-10 h-10 bg-gradient-sidebar rounded-lg flex items-center justify-center"><Users className="text-white" size={24} /></div>}
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

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-text-secondary mb-1">Total Leads Created</p>
                <p className="text-3xl font-bold text-text">{statsLoading ? '—' : stats.totalTransfers || 0}</p>
              </div>
              <div className="p-3 rounded-xl bg-info-100 dark:bg-info-900"><FileText size={22} className="text-info-600" /></div>
            </div>
          </Card>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-text-secondary mb-1">Assigned to Closers</p>
                <p className="text-3xl font-bold text-success-600">{statsLoading ? '—' : stats.assignedTransfers || 0}</p>
              </div>
              <div className="p-3 rounded-xl bg-success-100 dark:bg-success-900"><Send size={22} className="text-success-600" /></div>
            </div>
          </Card>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-text-secondary mb-1">Pending Review</p>
                <p className="text-3xl font-bold text-warning-600">{statsLoading ? '—' : stats.pendingTransfers || 0}</p>
              </div>
              <div className="p-3 rounded-xl bg-warning-100 dark:bg-warning-900"><Clock size={22} className="text-warning-600" /></div>
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Create New Lead */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-text flex items-center gap-2"><PlusCircle size={20} /> Create New Lead</h3>
              {!showCreateForm && (
                <Button variant="primary" size="sm" onClick={() => setShowCreateForm(true)} className="flex items-center gap-1">
                  <PlusCircle size={16} /> New Lead
                </Button>
              )}
            </div>

            {showCreateForm ? (
              fieldsLoading ? (
                <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div></div>
              ) : (
                <form onSubmit={handleSubmitTransfer} className="space-y-4 animate-slide-up">
                  {fields.sort((a, b) => (a.order || 0) - (b.order || 0)).map(field => (
                    <div key={field.id}>
                      <label className="block text-sm font-medium text-text-secondary mb-1">
                        {field.label} {field.is_required && <span className="text-error-500">*</span>}
                      </label>
                      {field.field_type === 'textarea' ? (
                        <textarea value={formData[field.name] || ''} onChange={e => setFormData({ ...formData, [field.name]: e.target.value })}
                          className="input" rows="3" required={field.is_required} placeholder={`Enter ${field.label.toLowerCase()}`} />
                      ) : field.field_type === 'select' ? (
                        <select value={formData[field.name] || ''} onChange={e => setFormData({ ...formData, [field.name]: e.target.value })}
                          className="input" required={field.is_required}>
                          <option value="">Select {field.label}</option>
                          {(field.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      ) : (
                        <input type={field.field_type === 'phone' ? 'tel' : field.field_type}
                          value={formData[field.name] || ''} onChange={e => setFormData({ ...formData, [field.name]: e.target.value })}
                          className="input" required={field.is_required} placeholder={`Enter ${field.label.toLowerCase()}`} />
                      )}
                    </div>
                  ))}
                  <div className="flex gap-3 pt-4 border-t border-border">
                    <Button type="button" variant="secondary" onClick={() => { setShowCreateForm(false); setFormData({}); }}>Cancel</Button>
                    <Button type="submit" variant="primary" loading={submitting} disabled={submitting}>
                      {submitting ? 'Submitting...' : 'Submit Lead'}
                    </Button>
                  </div>
                </form>
              )
            ) : (
              <div className="text-center py-8">
                <FileText size={48} className="mx-auto mb-4 text-text-tertiary" />
                <p className="text-text-secondary">Click "New Lead" to create a transfer for a closer.</p>
              </div>
            )}
          </Card>

          {/* My Leads / Transfers */}
          <Card className="p-6">
            <h3 className="text-xl font-bold mb-4 text-text flex items-center gap-2"><FileText size={20} /> My Leads</h3>
            {transfersLoading ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div></div>
            ) : transfers.length === 0 ? (
              <p className="text-text-secondary text-center py-8">No leads created yet. Start by creating your first lead!</p>
            ) : (
              <div className="space-y-3 max-h-[500px] overflow-y-auto">
                {transfers.map(t => (
                  <div key={t.id} className="p-4 rounded-lg border border-border hover:border-primary-400 transition-colors">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-semibold text-text">{t.form_data?.customer_name || 'Lead'}</p>
                        <p className="text-sm text-text-secondary">{t.form_data?.customer_email || t.form_data?.customer_phone || ''}</p>
                      </div>
                      <Badge variant={statusColors[t.status] || 'secondary'} size="sm">{t.status}</Badge>
                    </div>
                    {t.form_data?.product_service && (
                      <p className="text-sm text-text-tertiary">{t.form_data.product_service}</p>
                    )}
                    <p className="text-xs text-text-tertiary mt-1">{new Date(t.created_at).toLocaleDateString()}</p>
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

export default FronterDashboard;

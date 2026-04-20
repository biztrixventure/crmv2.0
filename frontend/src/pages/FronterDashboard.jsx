import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useNavigate } from "react-router-dom";
import { Users, Send, CheckCircle, PlusCircle, FileText, Clock, Phone, TrendingUp, Hash, Shield, Star, BarChart3 } from "lucide-react";
import { Card, Badge, Button } from "../components/UI";
import DateRangePicker, { getPresetRange } from "../components/UI/DateRangePicker";
import { AppHeader } from "../components/Layout";
import { useDashboardStats } from "../hooks/useDashboardStats";
import { useTransfers } from "../hooks/useTransfers";
import { useFormFields } from "../hooks/useFormFields";
import { useNotifications } from "../hooks/useNotifications";
import { useClosers } from "../hooks/useClosers";
import { useSaleConfigs } from "../hooks/useSaleConfigs";
import CallbacksPage from "../components/Callbacks/CallbacksPage";
import AssignedNumbersList from "../components/Numbers/AssignedNumbersList";
import CallbackNumbers from "../components/CallbackNumbers/CallbackNumbers";
import CrossRoleContent from "../components/Navigation/CrossRoleContent";

const FronterDashboard = () => {
  const { user, logout, updateUser, hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState('transfers');
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const { stats, loading: statsLoading, fetchStats } = useDashboardStats();
  const { transfers, loading: transfersLoading, fetchTransfers, createTransfer } = useTransfers(user?.company_id);
  const { fields, loading: fieldsLoading, fetchFields } = useFormFields();
  const { closers, loading: closersLoading, fetchClosers } = useClosers(user?.company_id);
  const { clients: saleClients, plans: salePlans, fetchConfigs } = useSaleConfigs(user?.company_id);
  const notifHook = useNotifications();

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
    ...(hasPermission('view_fronter_stats') || hasPermission('view_closer_stats') || hasPermission('view_company_reports')
      ? [{ key: 'reports', label: 'Reports', icon: BarChart3}] : []),
  ];

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData]             = useState({});
  const [selectedCloser, setSelectedCloser] = useState('');
  const [submitting, setSubmitting]         = useState(false);
  const [submitError, setSubmitError]       = useState('');
  const [dateRange, setDateRange]           = useState(() => getPresetRange('30d'));
  const { date_from, date_to }              = dateRange;

  useEffect(() => { fetchStats(); fetchFields(); fetchClosers(); fetchConfigs(); }, []);
  useEffect(() => { fetchTransfers({ date_from, date_to }); }, [fetchTransfers, date_from, date_to]);

  const handleLogout = () => { logout(); navigate("/login"); };

  const handleSubmitTransfer = async (e) => {
    e.preventDefault();
    setSubmitError('');
    if (!selectedCloser) { setSubmitError('Please select a closer.'); return; }
    setSubmitting(true);
    try {
      await createTransfer({ ...formData, assigned_closer_id: selectedCloser });
      setShowCreateForm(false);
      setFormData({});
      setSelectedCloser('');
      fetchStats();
      fetchTransfers({ date_from, date_to });
    } catch (err) {
      setSubmitError(err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Failed to submit');
    }
    setSubmitting(false);
  };

  const statusColors = { pending: 'warning', assigned: 'info', completed: 'success', cancelled: 'error', rejected: 'error' };

  // Derived conversion rate
  const conversionRate = transfers.length > 0
    ? Math.round((transfers.filter(t => t.status === 'completed').length / transfers.length) * 100)
    : 0;

  const TABS = [
    { key: 'transfers',       label: 'My Transfers',    icon: Send  },
    ...(hasPermission('view_callbacks')           ? [{ key: 'callbacks',       label: 'Callbacks',       icon: Phone }] : []),
    ...(hasPermission('manage_callback_numbers')  ? [{ key: 'tracked_numbers', label: 'Tracked Numbers', icon: Users }] : []),
    { key: 'numbers',         label: 'My Numbers',      icon: Hash  },
  ];

  return (
    <div className="min-h-screen bg-bg">
      <AppHeader
        title="Fronter Dashboard"
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
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" style={{ display: activeNav !== 'dashboard' ? 'none' : undefined }}>
        <div className="mb-6 animate-fade-in">
          <h2 className="text-3xl font-bold mb-1 text-text">Welcome back, {user?.first_name || user?.email}!</h2>
          <p className="text-text-secondary">
            <strong>{user?.role_name || user?.role}</strong> at <strong>{user?.company_name}</strong>
          </p>
        </div>

        {/* Tab bar */}
        <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
          <div className="flex gap-1 p-1 rounded-xl w-fit"
            style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            {TABS.map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150"
                style={{
                  backgroundColor: activeTab === tab.key ? 'var(--color-surface)' : 'transparent',
                  color:            activeTab === tab.key ? 'var(--color-primary-600)' : 'var(--color-text-secondary)',
                  boxShadow:        activeTab === tab.key ? 'var(--shadow-sm)' : 'none',
                }}>
                <tab.icon size={15} />
                {tab.label}
              </button>
            ))}
          </div>
          <DateRangePicker onChange={setDateRange} defaultPreset="30d" />
        </div>

        {activeTab === 'callbacks'       && <CallbacksPage user={user} />}
        {activeTab === 'tracked_numbers' && <CallbackNumbers user={user} />}
        {activeTab === 'numbers'         && <AssignedNumbersList user={user} />}

        {activeTab === 'transfers' && <div>
          {/* Stats — 4 cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <Card className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-text-secondary mb-1">Total Leads</p>
                  <p className="text-3xl font-bold text-text">{statsLoading ? '—' : stats.totalTransfers || 0}</p>
                </div>
                <div className="p-3 rounded-xl bg-info-100 dark:bg-info-900"><FileText size={20} className="text-info-600" /></div>
              </div>
            </Card>
            <Card className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-text-secondary mb-1">Assigned</p>
                  <p className="text-3xl font-bold text-success-600">{statsLoading ? '—' : stats.assignedTransfers || 0}</p>
                </div>
                <div className="p-3 rounded-xl bg-success-100 dark:bg-success-900"><Send size={20} className="text-success-600" /></div>
              </div>
            </Card>
            <Card className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-text-secondary mb-1">Won / Sales</p>
                  <p className="text-3xl font-bold text-primary-600">
                    {statsLoading ? '—' : transfers.filter(t => t.status === 'completed').length}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-primary-100 dark:bg-primary-900"><CheckCircle size={20} className="text-primary-600" /></div>
              </div>
            </Card>
            <Card className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-text-secondary mb-1">Conversion</p>
                  <p className="text-3xl font-bold text-warning-600">{statsLoading ? '—' : `${conversionRate}%`}</p>
                </div>
                <div className="p-3 rounded-xl bg-warning-100 dark:bg-warning-900"><TrendingUp size={20} className="text-warning-600" /></div>
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Create New Lead */}
            {hasPermission('create_transfer') && <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-text flex items-center gap-2"><PlusCircle size={20} /> Create New Lead</h3>
                {!showCreateForm && (
                  <Button variant="primary" size="sm" onClick={() => setShowCreateForm(true)} className="flex items-center gap-1">
                    <PlusCircle size={16} /> New Lead
                  </Button>
                )}
              </div>

              {showCreateForm ? (
                fieldsLoading || closersLoading ? (
                  <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
                ) : (
                  <form onSubmit={handleSubmitTransfer} className="space-y-4 animate-slide-up">

                    {/* Dynamic fields — fronter-visible only */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {fields
                      .filter(f => f.show_to_fronter !== false)
                      .sort((a, b) => (a.order || 0) - (b.order || 0))
                      .map(field => {
                        const spanClass = { 1: 'sm:col-span-1', 2: 'sm:col-span-2', 3: 'sm:col-span-3' }[field.column_span] || 'sm:col-span-1';

                        // Cascading plan options based on selected client
                        let planOptions = salePlans;
                        if (field.field_type === 'sale_plan') {
                          const clientField = fields.find(f => f.field_type === 'sale_client');
                          const selectedClient = clientField ? (formData[clientField.name] || '') : '';
                          if (selectedClient && Array.isArray(field.options) && field.options.length > 0) {
                            const mapping = field.options.find(m => m.client === selectedClient);
                            if (mapping) planOptions = salePlans.filter(p => mapping.plans.includes(p.value));
                          }
                        }

                        return (
                          <div key={field.id} className={spanClass}>
                            <label className="block text-sm font-medium text-text-secondary mb-1">
                              {field.label} {field.is_required && <span className="text-error-500">*</span>}
                            </label>
                            {field.field_type === 'textarea' ? (
                              <textarea value={formData[field.name] || ''} onChange={e => setFormData({ ...formData, [field.name]: e.target.value })}
                                className="input" rows="3" required={field.is_required} placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`} />
                            ) : field.field_type === 'select' ? (
                              <select value={formData[field.name] || ''} onChange={e => setFormData({ ...formData, [field.name]: e.target.value })}
                                className="input" required={field.is_required}>
                                <option value="">Select {field.label}</option>
                                {(field.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                              </select>
                            ) : field.field_type === 'sale_client' ? (
                              <select value={formData[field.name] || ''} onChange={e => setFormData({ ...formData, [field.name]: e.target.value })}
                                className="input" required={field.is_required}>
                                <option value="">Select client…</option>
                                {saleClients.map(c => <option key={c.id} value={c.value}>{c.value}</option>)}
                              </select>
                            ) : field.field_type === 'sale_plan' ? (
                              <select value={formData[field.name] || ''} onChange={e => setFormData({ ...formData, [field.name]: e.target.value })}
                                className="input" required={field.is_required}>
                                <option value="">Select plan…</option>
                                {planOptions.map(p => <option key={p.id} value={p.value}>{p.value}</option>)}
                              </select>
                            ) : (
                              <input type={field.field_type === 'phone' || field.field_type === 'tel' ? 'tel' : field.field_type === 'zip' ? 'text' : field.field_type}
                                value={formData[field.name] || ''} onChange={e => setFormData({ ...formData, [field.name]: e.target.value })}
                                className="input" required={field.is_required} placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`} />
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Closer selection */}
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-1">
                        Transfer to Closer <span className="text-error-500">*</span>
                      </label>
                      <select value={selectedCloser} onChange={e => setSelectedCloser(e.target.value)} className="input" required>
                        <option value="">— Select a closer —</option>
                        {closers.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.first_name} {c.last_name}{c.company_name ? ` · ${c.company_name}` : ''}
                          </option>
                        ))}
                      </select>
                      {closers.length === 0 && (
                        <p className="text-xs text-warning-600 mt-1">No closers available in your company yet.</p>
                      )}
                    </div>

                    {submitError && (
                      <p className="text-sm text-error-600">{submitError}</p>
                    )}

                    <div className="flex gap-3 pt-4 border-t border-border">
                      <Button type="button" variant="secondary" onClick={() => { setShowCreateForm(false); setFormData({}); setSelectedCloser(''); setSubmitError(''); }}>Cancel</Button>
                      <Button type="submit" variant="primary" loading={submitting} disabled={submitting}>
                        {submitting ? 'Submitting…' : 'Transfer Lead'}
                      </Button>
                    </div>
                  </form>
                )
              ) : (
                <div className="text-center py-8">
                  <FileText size={48} className="mx-auto mb-4 text-text-tertiary" />
                  <p className="text-text-secondary">Click "New Lead" to transfer a call to a closer.</p>
                </div>
              )}
            </Card>}

            {/* My Leads / Transfers */}
            <Card className="p-6">
              <h3 className="text-xl font-bold mb-4 text-text flex items-center gap-2"><FileText size={20} /> My Leads</h3>
              {transfersLoading ? (
                <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
              ) : transfers.length === 0 ? (
                <p className="text-text-secondary text-center py-8">No leads yet. Create your first lead!</p>
              ) : (
                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                  {transfers.map(t => {
                    const closer = t.closer;
                    const closerName = closer ? `${closer.first_name || ''} ${closer.last_name || ''}`.trim() : null;
                    return (
                      <div key={t.id} className="p-4 rounded-xl border transition-all duration-150 hover:shadow-md"
                        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}>
                        <div className="flex items-start justify-between mb-1">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-text truncate">{t.form_data?.customer_name || t.form_data?.FirstName ? `${t.form_data.FirstName || ''} ${t.form_data.LastName || ''}`.trim() : 'Lead'}</p>
                            <p className="text-xs text-text-secondary mt-0.5">
                              {t.form_data?.Phone || t.form_data?.customer_phone || ''}
                              {closerName && <> · <strong>{closerName}</strong></>}
                            </p>
                            {t.status === 'rejected' && t.rejection_reason && (
                              <p className="text-xs text-error-600 mt-0.5">Rejected: {t.rejection_reason}</p>
                            )}
                          </div>
                          <Badge variant={statusColors[t.status] || 'secondary'} size="sm">{t.status}</Badge>
                        </div>
                        <div className="flex items-center justify-between mt-2">
                          <div className="flex items-center gap-3">
                            {t.status === 'assigned' && (
                              <span className="text-xs text-info-600 font-medium flex items-center gap-1">
                                <Send size={10} /> Assigned to closer
                              </span>
                            )}
                            {t.status === 'completed' && (
                              <span className="text-xs text-success-600 font-medium flex items-center gap-1">
                                <CheckCircle size={10} /> Converted to sale
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-text-tertiary">{new Date(t.created_at).toLocaleDateString()}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        </div>}
      </main>
    </div>
  );
};

export default FronterDashboard;

import { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useNavigate } from "react-router-dom";
import { Card, Badge } from "../components/UI";
import AdminHeader from "../components/Admin/Layout/AdminHeader";
import AdminSidebar from "../components/Admin/Layout/AdminSidebar";
import { CompanyManagement } from "../components/Admin/CompanyManagement";
import { useDashboardStats } from "../hooks/useDashboardStats";
import { useNotifications } from "../hooks/useNotifications";
import { useSaleConfigs } from "../hooks/useSaleConfigs";
import SaleSearch from "../components/Sales/SaleSearch";
import FormBuilder from "../components/Admin/FormBuilder/FormBuilder";
import {
  BarChart3, Users, Shield, Building2, FileText,
  Activity, Plus, DollarSign, Target,
  CheckCircle, Layers, Search, Tag, ListChecks, X,
} from "lucide-react";

// FormFieldManagement replaced by FormBuilder (drag-drop 3-col) — see FormBuilder.jsx

// ============================================================================
// SaleConfigManager — manage Plans and Client options
// ============================================================================
const SaleConfigManager = () => {
  const { user } = useAuth();
  const { plans, clients, loading, fetchConfigs, addConfig, deleteConfig } = useSaleConfigs(user?.company_id);
  const [newPlan,   setNewPlan]   = useState('');
  const [newClient, setNewClient] = useState('');
  const [saving, setSaving]  = useState(false);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  const handleAdd = async (type, value, setter) => {
    if (!value.trim()) return;
    setSaving(true);
    try {
      await addConfig(type, value.trim());
      setter('');
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally { setSaving(false); }
  };

  const handleDelete = async (id, type) => {
    setDeleting(id);
    try { await deleteConfig(id, type); }
    catch (err) { alert(err.response?.data?.error || err.message); }
    finally { setDeleting(null); }
  };

  const ConfigList = ({ items, type, newVal, setNewVal }) => (
    <div className="rounded-2xl border overflow-hidden"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4"
        style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
        <div className="flex items-center gap-2">
          {type === 'plan' ? <ListChecks size={17} style={{ color: 'var(--color-primary-600)' }} />
                           : <Tag size={17} style={{ color: '#f59e0b' }} />}
          <h3 className="font-bold text-text text-sm">
            {type === 'plan' ? 'Plans' : 'Client Options'}
          </h3>
          <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
            style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>
            {items.length}
          </span>
        </div>
      </div>
      {/* Items */}
      <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-600" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-center py-6 text-sm text-text-secondary">No {type}s yet. Add one below.</p>
        ) : items.map(item => (
          <div key={item.id} className="flex items-center justify-between px-5 py-3 group hover:bg-bg-secondary transition-colors">
            <span className="text-sm font-medium text-text">{item.value}</span>
            <div className="flex items-center gap-2">
              {item.company_id === null && (
                <span className="text-xs text-text-tertiary">global</span>
              )}
              <button
                onClick={() => handleDelete(item.id, type)}
                disabled={deleting === item.id}
                className="w-7 h-7 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:bg-red-100"
                title="Delete">
                {deleting === item.id
                  ? <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-red-500" />
                  : <X size={13} style={{ color: '#ef4444' }} />}
              </button>
            </div>
          </div>
        ))}
      </div>
      {/* Add new */}
      <div className="px-4 py-3 flex gap-2"
        style={{ borderTop: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
        <input
          type="text" value={newVal} onChange={e => setNewVal(e.target.value)}
          placeholder={`Add ${type}…`}
          className="input flex-1 text-sm h-9"
          onKeyDown={e => e.key === 'Enter' && handleAdd(type, newVal, setNewVal)}
        />
        <button
          onClick={() => handleAdd(type, newVal, setNewVal)}
          disabled={saving || !newVal.trim()}
          className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
          style={{ background: 'var(--gradient-sidebar)' }}>
          <Plus size={14} />
          Add
        </button>
      </div>
    </div>
  );

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-text">Sale Configuration</h2>
        <p className="text-text-secondary text-sm mt-0.5">
          Manage Plans and Client options available in the sale form. Deleting an option does not affect existing sale records.
        </p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ConfigList items={plans}   type="plan"   newVal={newPlan}   setNewVal={setNewPlan}   />
        <ConfigList items={clients} type="client" newVal={newClient} setNewVal={setNewClient} />
      </div>
    </div>
  );
};

// ============================================================================
// SaleSearchPanel — permission-gated sale record search
// ============================================================================
const SaleSearchPanel = () => {
  const { user } = useAuth();
  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-text flex items-center gap-2">
          <Search size={22} style={{ color: 'var(--color-primary-600)' }} />
          Sale Record Search
        </h2>
        <p className="text-text-secondary text-sm mt-0.5">
          Search by customer name, phone, reference no, VIN, or email. Access controlled via <strong>search_sales</strong> permission.
        </p>
      </div>
      <div className="rounded-2xl border p-6"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <SaleSearch companyId={user?.company_id} user={user} />
      </div>
    </div>
  );
};

// ============================================================================
// AdminPanel — main component
// ============================================================================
const AdminPanel = () => {
  const { user, logout, hasPermission } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("dashboard");
  const { stats, loading: statsLoading, fetchStats } = useDashboardStats();
  const notifHook = useNotifications();

  useEffect(() => { fetchStats(); }, []);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const navItems = [
    { id: "dashboard",    label: "Dashboard"   },
    { id: "companies",    label: "Companies"   },
    { id: "forms",        label: "Form Builder" },
    { id: "sale-configs", label: "Sale Config"  },
    ...(hasPermission('search_sales') ? [{ id: "sale-search", label: "Sale Search" }] : []),
  ];

  // ── Stat metric cards ──
  const metrics = [
    { icon: Users,      label: 'Total Users',      value: stats.totalUsers,      sub: 'Active accounts',       accent: '#6366f1' },
    { icon: Building2,  label: 'Companies',         value: stats.totalCompanies,  sub: 'Registered companies',  accent: '#10b981' },
    { icon: Activity,   label: 'Transfers',         value: stats.totalTransfers,  sub: 'All time',              accent: '#f59e0b' },
    { icon: DollarSign, label: 'Total Sales',       value: stats.totalSales,      sub: 'All closers',           accent: '#8b5cf6' },
    { icon: CheckCircle,label: 'Won',               value: stats.closedWon,       sub: 'Closed won',            accent: '#10b981' },
    { icon: Target,     label: 'Conversion',        value: stats.conversionRate ? `${stats.conversionRate}%` : '0%', sub: 'Transfer → sale', accent: '#3b82f6' },
    { icon: Shield,     label: 'Roles',             value: stats.totalRoles,      sub: 'Permission groups',     accent: '#f59e0b' },
    { icon: Layers,     label: 'Pending Transfers', value: stats.pendingTransfers, sub: 'Awaiting assignment',  accent: '#ef4444' },
  ];

  const quickActions = [
    { id: 'companies',    label: 'Companies',       desc: 'Create and manage companies, members and roles', icon: Building2,  accent: '#10b981' },
    { id: 'forms',        label: 'Form Builder',    desc: 'Customize transfer intake fields',               icon: FileText,   accent: '#8b5cf6' },
    { id: 'sale-configs', label: 'Sale Config',     desc: 'Manage Plans and Client options',                icon: ListChecks, accent: '#f59e0b' },
    { id: 'sale-search',  label: 'Sale Search',     desc: 'Search all sale records',                        icon: Search,     accent: '#6366f1' },
  ];

  return (
    <div className="min-h-screen bg-bg">
      <AdminHeader
        theme={theme} onToggleTheme={toggleTheme} onLogout={handleLogout}
        notifications={notifHook.notifications}
        unreadCount={notifHook.unreadCount}
        onMarkRead={notifHook.markRead}
        onMarkAllRead={notifHook.markAllRead}
        onDeleteNotification={notifHook.deleteNotification}
        onClearNotifications={notifHook.clearAll}
      />

      <div className="flex" style={{ height: 'calc(100vh - 64px)' }}>
        <AdminSidebar navItems={navItems} activeTab={activeTab} onTabChange={setActiveTab} />

        <main className="flex-1 overflow-auto bg-bg">
          <div className="p-6 lg:p-8 max-w-7xl">

            {/* ── Dashboard ── */}
            {activeTab === "dashboard" && (
              <div className="animate-fade-in space-y-8">

                {/* Page header */}
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-2xl font-bold text-text">
                      Good day, {user?.first_name || 'Admin'}
                    </h2>
                    <p className="text-text-secondary mt-0.5 text-sm">
                      Here's what's happening across BizTrix CRM
                    </p>
                  </div>
                  <div className="text-right hidden sm:block">
                    <p className="text-xs text-text-tertiary">
                      {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                    </p>
                  </div>
                </div>

                {/* Metrics grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {metrics.map((m, i) => (
                    <div key={i} className="rounded-2xl p-5 transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5"
                      style={{
                        backgroundColor: 'var(--color-surface)',
                        border: '1px solid var(--color-border)',
                        boxShadow: 'var(--shadow-sm)',
                      }}>
                      <div className="flex items-start justify-between mb-3">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                          style={{ backgroundColor: `${m.accent}18` }}>
                          <m.icon size={19} style={{ color: m.accent }} />
                        </div>
                        {!statsLoading && (
                          <div className="w-2 h-2 rounded-full mt-1" style={{ backgroundColor: m.accent }} />
                        )}
                      </div>
                      <p className="text-2xl font-bold text-text mb-0.5">
                        {statsLoading ? <span className="opacity-30">—</span> : (m.value ?? 0)}
                      </p>
                      <p className="text-xs font-semibold text-text truncate">{m.label}</p>
                      <p className="text-xs text-text-tertiary truncate">{m.sub}</p>
                    </div>
                  ))}
                </div>

                {/* Sales pipeline bar */}
                {!statsLoading && ((stats.closedWon || 0) + (stats.closedLost || 0)) > 0 && (
                  <div className="rounded-2xl p-6"
                    style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="font-bold text-text">Sales Pipeline</h3>
                        <p className="text-xs text-text-secondary">Won vs Lost breakdown</p>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="flex items-center gap-1.5">
                          <div className="w-3 h-3 rounded-full bg-success-500" />
                          <span className="text-text-secondary">Won <strong className="text-success-600">{stats.closedWon || 0}</strong></span>
                        </span>
                        <span className="flex items-center gap-1.5">
                          <div className="w-3 h-3 rounded-full bg-error-500" />
                          <span className="text-text-secondary">Lost <strong className="text-error-600">{stats.closedLost || 0}</strong></span>
                        </span>
                        <span className="flex items-center gap-1.5">
                          <div className="w-3 h-3 rounded-full bg-info-500" />
                          <span className="text-text-secondary">Open <strong className="text-info-600">{stats.openSales || 0}</strong></span>
                        </span>
                      </div>
                    </div>
                    <div className="w-full h-3 rounded-full overflow-hidden flex gap-0.5"
                      style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                      {(() => {
                        const total = (stats.closedWon || 0) + (stats.closedLost || 0) + (stats.openSales || 0);
                        return total > 0 ? (
                          <>
                            <div className="h-full rounded-l-full bg-success-500 transition-all"
                              style={{ width: `${((stats.closedWon || 0) / total) * 100}%` }} />
                            <div className="h-full bg-info-500 transition-all"
                              style={{ width: `${((stats.openSales || 0) / total) * 100}%` }} />
                            <div className="h-full rounded-r-full bg-error-500 transition-all"
                              style={{ width: `${((stats.closedLost || 0) / total) * 100}%` }} />
                          </>
                        ) : <div className="h-full w-full rounded-full bg-gray-200" />;
                      })()}
                    </div>
                  </div>
                )}

                {/* Quick Actions */}
                <div>
                  <h3 className="font-bold text-text mb-3 flex items-center gap-2">
                    <span>Quick Actions</span>
                  </h3>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {quickActions.map(action => (
                      <button key={action.id} onClick={() => setActiveTab(action.id)}
                        className="text-left p-4 rounded-2xl transition-all duration-150 hover:shadow-md hover:-translate-y-0.5 group"
                        style={{
                          backgroundColor: 'var(--color-surface)',
                          border: '1px solid var(--color-border)',
                          boxShadow: 'var(--shadow-sm)',
                        }}>
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3 transition-transform group-hover:scale-110"
                          style={{ backgroundColor: `${action.accent}18` }}>
                          <action.icon size={18} style={{ color: action.accent }} />
                        </div>
                        <p className="font-semibold text-sm text-text">{action.label}</p>
                        <p className="text-xs text-text-secondary mt-0.5 leading-snug">{action.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Role access legend */}
                <div className="rounded-2xl p-5"
                  style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
                  <h3 className="font-bold text-text mb-3 text-sm">Role Hierarchy</h3>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: 'Super Admin',       color: '#6366f1' },
                      { label: 'Company Admin',     color: '#8b5cf6' },
                      { label: 'Closer Manager',    color: '#3b82f6' },
                      { label: 'Operations Mgr',    color: '#f59e0b' },
                      { label: 'Fronter',           color: '#10b981' },
                      { label: 'Closer',            color: '#10b981' },
                      { label: 'Operations',        color: '#6b7280' },
                    ].map(r => (
                      <span key={r.label} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium"
                        style={{ backgroundColor: `${r.color}15`, color: r.color, border: `1px solid ${r.color}30` }}>
                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: r.color }} />
                        {r.label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "companies"    && <CompanyManagement />}
            {activeTab === "forms"        && <FormBuilder />}
            {activeTab === "sale-configs" && <SaleConfigManager />}
            {activeTab === "sale-search"  && <SaleSearchPanel />}
          </div>
        </main>
      </div>
    </div>
  );
};

export default AdminPanel;

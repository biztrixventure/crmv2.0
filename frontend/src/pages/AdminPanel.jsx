import React, { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useNavigate } from "react-router-dom";
import { Card, Badge } from "../components/UI";
import AdminHeader from "../components/Admin/Layout/AdminHeader";
import AdminSidebar from "../components/Admin/Layout/AdminSidebar";
import { UserManagement } from "../components/Admin/UserManagement";
import RoleManagement from "../components/Admin/RoleManagement/RoleManagement";
import { CompanyManagement } from "../components/Admin/CompanyManagement";
import { useDashboardStats } from "../hooks/useDashboardStats";
import { useFormFields } from "../hooks/useFormFields";
import {
  BarChart3, Users, Shield, Building2, FileText, TrendingUp, ArrowUpRight,
  Activity, Plus, Edit2, Trash2, GripVertical
} from "lucide-react";

// ============================================================================
// FormFieldManagement — inline in AdminPanel for simplicity
// ============================================================================
const FormFieldManagement = () => {
  const { fields, loading, error, fetchFields, createField, updateField, deleteField } = useFormFields();
  const [showForm, setShowForm] = useState(false);
  const [editingField, setEditingField] = useState(null);
  const [formData, setFormData] = useState({ name: '', label: '', field_type: 'text', is_required: false, order: 0, options: null });

  useEffect(() => { fetchFields(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingField) {
        await updateField(editingField.id, formData);
      } else {
        await createField(formData);
      }
      setShowForm(false);
      setEditingField(null);
      setFormData({ name: '', label: '', field_type: 'text', is_required: false, order: 0, options: null });
    } catch (err) { /* hook handles error */ }
  };

  const handleEdit = (field) => {
    setEditingField(field);
    setFormData({ name: field.name, label: field.label, field_type: field.field_type, is_required: field.is_required, order: field.order || 0, options: field.options });
    setShowForm(true);
  };

  const handleDelete = async (fieldId) => {
    if (window.confirm('Delete this form field?')) {
      try { await deleteField(fieldId); } catch (err) { /* hook handles error */ }
    }
  };

  const fieldTypes = ['text', 'email', 'number', 'textarea', 'select', 'date', 'phone'];

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-3xl font-bold text-text">Form Fields</h2>
        <button onClick={() => { setShowForm(!showForm); setEditingField(null); setFormData({ name: '', label: '', field_type: 'text', is_required: false, order: 0, options: null }); }}
          className="btn-primary flex items-center gap-2">
          <Plus size={20} />
          <span>{showForm ? 'Cancel' : 'Add Field'}</span>
        </button>
      </div>

      {error && <div className="alert alert-error mb-4"><p>{error}</p></div>}

      {showForm && (
        <Card className="p-6 mb-6 animate-slide-up">
          <h3 className="text-xl font-bold mb-4 text-text">{editingField ? 'Edit Field' : 'New Field'}</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Field Name (key)</label>
              <input type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })}
                className="input" placeholder="customer_name" required disabled={!!editingField} />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Display Label</label>
              <input type="text" value={formData.label} onChange={e => setFormData({ ...formData, label: e.target.value })}
                className="input" placeholder="Customer Name" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Field Type</label>
              <select value={formData.field_type} onChange={e => setFormData({ ...formData, field_type: e.target.value })}
                className="input">
                {fieldTypes.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Display Order</label>
              <input type="number" value={formData.order} onChange={e => setFormData({ ...formData, order: parseInt(e.target.value) || 0 })}
                className="input" />
            </div>
            <div className="flex items-center gap-2 col-span-full">
              <input type="checkbox" id="required" checked={formData.is_required}
                onChange={e => setFormData({ ...formData, is_required: e.target.checked })}
                className="rounded border-border" />
              <label htmlFor="required" className="text-sm text-text">Required field</label>
            </div>
            <div className="col-span-full flex justify-end gap-3">
              <button type="button" onClick={() => { setShowForm(false); setEditingField(null); }} className="btn-secondary">Cancel</button>
              <button type="submit" className="btn-primary">{editingField ? 'Update' : 'Create'} Field</button>
            </div>
          </form>
        </Card>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>
      ) : (
        <div className="space-y-3">
          {fields.length === 0 ? (
            <Card className="p-8 text-center"><p className="text-text-secondary">No form fields configured yet.</p></Card>
          ) : fields.sort((a, b) => (a.order || 0) - (b.order || 0)).map(field => (
            <Card key={field.id} className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <GripVertical size={18} className="text-text-tertiary" />
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-text">{field.label}</p>
                    {field.is_required && <Badge variant="error" size="sm">Required</Badge>}
                  </div>
                  <p className="text-sm text-text-secondary">{field.name} • {field.field_type}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleEdit(field)} className="p-2 rounded-lg hover:bg-primary-100 transition-colors"><Edit2 size={16} /></button>
                <button onClick={() => handleDelete(field.id)} className="p-2 rounded-lg hover:bg-error-100 transition-colors text-error-600"><Trash2 size={16} /></button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// AdminPanel — main component
// ============================================================================
const AdminPanel = () => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("dashboard");
  const { stats, loading: statsLoading, fetchStats } = useDashboardStats();

  useEffect(() => { fetchStats(); }, []);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const navItems = [
    { id: "dashboard", label: "Dashboard" },
    { id: "users", label: "Users" },
    { id: "roles", label: "Roles" },
    { id: "companies", label: "Companies" },
    { id: "forms", label: "Form Builder" },
  ];

  // Stat card component for dashboard
  const StatCard = ({ icon: Icon, label, value, color = "primary", trend = null }) => (
    <Card className="p-6 group hover:scale-[1.02] transition-transform duration-200">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-text-secondary mb-1">{label}</p>
          <p className="text-3xl font-bold text-text">
            {statsLoading ? <span className="animate-pulse-slow">—</span> : (value ?? 0)}
          </p>
          {trend !== null && (
            <div className="flex items-center gap-1 mt-2">
              <ArrowUpRight size={14} className="text-success-500" />
              <span className="text-sm text-success-600">{trend}</span>
            </div>
          )}
        </div>
        <div className={`p-3 rounded-xl bg-${color}-100 dark:bg-${color}-900`}>
          <Icon size={22} className={`text-${color}-600`} />
        </div>
      </div>
    </Card>
  );

  return (
    <div className="min-h-screen bg-bg">
      {/* Header */}
      <AdminHeader theme={theme} onToggleTheme={toggleTheme} onLogout={handleLogout} />

      <div className="flex" style={{ height: 'calc(100vh - 64px)' }}>
        {/* Sidebar */}
        <AdminSidebar navItems={navItems} activeTab={activeTab} onTabChange={setActiveTab} />

        {/* Main Content */}
        <main className="flex-1 overflow-auto">
          <div className="p-8">
            {activeTab === "dashboard" && (
              <div className="animate-fade-in">
                <div className="mb-8">
                  <h2 className="text-3xl font-bold text-text">Admin Dashboard</h2>
                  <p className="text-text-secondary mt-1">System overview and quick metrics</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                  <StatCard icon={Users} label="Total Users" value={stats.totalUsers} color="info" />
                  <StatCard icon={Building2} label="Companies" value={stats.totalCompanies} color="success" />
                  <StatCard icon={Shield} label="Roles" value={stats.totalRoles} color="warning" />
                  <StatCard icon={Activity} label="Active Transfers" value={stats.totalTransfers} color="primary" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                  <StatCard icon={TrendingUp} label="Total Sales" value={stats.totalSales} color="success" />
                  <StatCard icon={BarChart3} label="Won" value={stats.closedWon} color="success" />
                  <StatCard icon={Activity} label="Conversion Rate" value={stats.conversionRate ? `${stats.conversionRate}%` : '0%'} color="info" />
                </div>

                {/* Quick Actions */}
                <h3 className="text-xl font-bold text-text mb-4">Quick Actions</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <button onClick={() => setActiveTab('users')} className="card text-left hover:border-primary-500 group cursor-pointer p-5">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-info-100 dark:bg-info-900"><Users size={20} className="text-info-600" /></div>
                      <div>
                        <p className="font-semibold text-text">Manage Users</p>
                        <p className="text-sm text-text-secondary">Add, edit, or remove users</p>
                      </div>
                    </div>
                  </button>
                  <button onClick={() => setActiveTab('roles')} className="card text-left hover:border-primary-500 group cursor-pointer p-5">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-warning-100 dark:bg-warning-900"><Shield size={20} className="text-warning-600" /></div>
                      <div>
                        <p className="font-semibold text-text">Manage Roles</p>
                        <p className="text-sm text-text-secondary">Configure permissions</p>
                      </div>
                    </div>
                  </button>
                  <button onClick={() => setActiveTab('companies')} className="card text-left hover:border-primary-500 group cursor-pointer p-5">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-success-100 dark:bg-success-900"><Building2 size={20} className="text-success-600" /></div>
                      <div>
                        <p className="font-semibold text-text">Manage Companies</p>
                        <p className="text-sm text-text-secondary">Company configuration</p>
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            )}

            {activeTab === "users" && <UserManagement />}
            {activeTab === "roles" && <RoleManagement />}
            {activeTab === "companies" && <CompanyManagement />}
            {activeTab === "forms" && <FormFieldManagement />}
          </div>
        </main>
      </div>
    </div>
  );
};

export default AdminPanel;

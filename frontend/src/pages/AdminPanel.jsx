import React, { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useNavigate } from "react-router-dom";
import AdminHeader from "../components/Admin/Layout/AdminHeader";
import AdminSidebar from "../components/Admin/Layout/AdminSidebar";
import RoleManagement from "../components/Admin/RoleManagement/RoleManagement";

const AdminPanel = () => {
  const { logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("roles");

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const navItems = [
    { id: "dashboard", label: "Dashboard" },
    { id: "users", label: "Users" },
    { id: "roles", label: "Roles" },
    { id: "companies", label: "Companies" },
    { id: "forms", label: "Forms" },
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--color-bg)", color: "var(--color-text)" }}>
      {/* Header */}
      <AdminHeader
        theme={theme}
        onToggleTheme={toggleTheme}
        onLogout={handleLogout}
      />

      <div className="flex h-screen-minus-64">
        {/* Sidebar Navigation */}
        <AdminSidebar
          navItems={navItems}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />

        {/* Main Content */}
        <main className="flex-1 overflow-auto">
          <div className="p-8">
            {activeTab === "dashboard" && (
              <div>
                <h2 className="text-3xl font-bold mb-6">Admin Dashboard</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="card p-6">
                    <p className="text-sm opacity-75 mb-1">Total Users</p>
                    <p className="text-3xl font-bold">0</p>
                  </div>
                  <div className="card p-6">
                    <p className="text-sm opacity-75 mb-1">Total Companies</p>
                    <p className="text-3xl font-bold">0</p>
                  </div>
                  <div className="card p-6">
                    <p className="text-sm opacity-75 mb-1">Total Roles</p>
                    <p className="text-3xl font-bold">0</p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "users" && (
              <div>
                <h2 className="text-3xl font-bold mb-6">Users Management</h2>
                <div className="card p-6">
                  <p className="opacity-75">Users management interface coming soon...</p>
                </div>
              </div>
            )}

            {activeTab === "roles" && <RoleManagement />}

            {activeTab === "companies" && (
              <div>
                <h2 className="text-3xl font-bold mb-6">Companies</h2>
                <div className="card p-6">
                  <p className="opacity-75">Companies management interface coming soon...</p>
                </div>
              </div>
            )}

            {activeTab === "forms" && (
              <div>
                <h2 className="text-3xl font-bold mb-6">Form Fields</h2>
                <div className="card p-6">
                  <p className="opacity-75">Form management interface coming soon...</p>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default AdminPanel;


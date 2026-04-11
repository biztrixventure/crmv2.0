import React, { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useNavigate } from "react-router-dom";
import { Card } from "../components/UI";
import AdminHeader from "../components/Admin/Layout/AdminHeader";
import AdminSidebar from "../components/Admin/Layout/AdminSidebar";
import { UserManagement } from "../components/Admin/UserManagement";
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
    <div className="min-h-screen bg-bg">
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
                <h2 className="text-3xl font-bold mb-6 text-text">Admin Dashboard</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <Card className="p-6">
                    <p className="text-sm text-text-secondary mb-1">Total Users</p>
                    <p className="text-3xl font-bold text-text">0</p>
                  </Card>
                  <Card className="p-6">
                    <p className="text-sm text-text-secondary mb-1">Total Companies</p>
                    <p className="text-3xl font-bold text-text">0</p>
                  </Card>
                  <Card className="p-6">
                    <p className="text-sm text-text-secondary mb-1">Total Roles</p>
                    <p className="text-3xl font-bold text-text">0</p>
                  </Card>
                </div>
              </div>
            )}

            {activeTab === "users" && <UserManagement />}

            {activeTab === "roles" && <RoleManagement />}

            {activeTab === "companies" && (
              <div>
                <h2 className="text-3xl font-bold mb-6 text-text">Companies</h2>
                <Card className="p-6">
                  <p className="text-text-secondary">Companies management interface coming soon...</p>
                </Card>
              </div>
            )}

            {activeTab === "forms" && (
              <div>
                <h2 className="text-3xl font-bold mb-6 text-text">Form Fields</h2>
                <Card className="p-6">
                  <p className="text-text-secondary">Form management interface coming soon...</p>
                </Card>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default AdminPanel;


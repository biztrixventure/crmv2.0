import React, { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useNavigate } from "react-router-dom";

const AdminPanel = () => {
  const { logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("dashboard");

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const navItems = [
    { id: "dashboard", label: "📊 Dashboard", icon: "📊" },
    { id: "users", label: "👥 Users", icon: "👥" },
    { id: "roles", label: "🔐 Roles", icon: "🔐" },
    { id: "companies", label: "🏢 Companies", icon: "🏢" },
    { id: "forms", label: "📋 Forms", icon: "📋" },
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--color-bg)", color: "var(--color-text)" }}>
      {/* Header */}
      <nav className="header shadow-sm border-b" style={{ borderColor: "var(--color-border)" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <div className="w-10 h-10 bg-gradient-sidebar rounded-lg flex items-center justify-center">
                <span className="text-xl font-bold text-white">⚙️</span>
              </div>
              <h1 className="text-2xl font-bold">Admin Panel</h1>
            </div>

            <div className="flex items-center space-x-4">
              <button
                onClick={toggleTheme}
                className="p-2 rounded-lg btn-secondary"
                title="Toggle dark mode"
              >
                {theme === "light" ? "🌙" : "☀️"}
              </button>
              <button
                onClick={handleLogout}
                className="px-4 py-2 rounded-lg"
                style={{
                  backgroundColor: "var(--color-primary-600)",
                  color: "white",
                }}
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="flex h-screen-minus-64">
        {/* Sidebar Navigation */}
        <aside className="sidebar w-64 border-r shadow-sm" style={{ borderColor: "var(--color-border)" }}>
          <nav className="p-6 space-y-2">
            <h3 className="text-lg font-semibold mb-6 px-4">Admin Menu</h3>
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className="w-full text-left px-4 py-3 rounded-lg transition-all smooth-transition"
                style={{
                  backgroundColor:
                    activeTab === item.id ? "var(--color-primary-600)" : "transparent",
                  color: activeTab === item.id ? "white" : "var(--color-text)",
                }}
                onMouseEnter={(e) => {
                  if (activeTab !== item.id) {
                    e.target.style.backgroundColor = "var(--color-primary-100)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeTab !== item.id) {
                    e.target.style.backgroundColor = "transparent";
                  }
                }}
              >
                <span className="mr-3">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

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
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-3xl font-bold">Users Management</h2>
                  <button className="btn-primary">➕ Add User</button>
                </div>
                <div className="card p-6">
                  <p className="opacity-75">Users management interface coming soon...</p>
                </div>
              </div>
            )}

            {activeTab === "roles" && (
              <div>
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-3xl font-bold">Roles & Permissions</h2>
                  <button className="btn-primary">➕ Create Role</button>
                </div>
                <div className="card p-6">
                  <p className="opacity-75">Roles management interface coming soon...</p>
                </div>
              </div>
            )}

            {activeTab === "companies" && (
              <div>
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-3xl font-bold">Companies</h2>
                  <button className="btn-primary">➕ Create Company</button>
                </div>
                <div className="card p-6">
                  <p className="opacity-75">Companies management interface coming soon...</p>
                </div>
              </div>
            )}

            {activeTab === "forms" && (
              <div>
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-3xl font-bold">Form Fields</h2>
                  <button className="btn-primary">➕ Add Field</button>
                </div>
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


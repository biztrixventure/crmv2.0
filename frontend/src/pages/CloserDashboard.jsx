import React from "react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useNavigate } from "react-router-dom";
import { Moon, Sun, LogOut, TrendingUp } from "lucide-react";

const CloserDashboard = () => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--color-bg)", color: "var(--color-text)" }}>
      {/* Navigation */}
      <nav className="header shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <div className="w-10 h-10 bg-gradient-sidebar rounded-lg flex items-center justify-center">
                <TrendingUp className="text-white" size={24} />
              </div>
              <h1 className="text-2xl font-bold">Closer Dashboard</h1>
            </div>

            <div className="flex items-center space-x-6">
              <button
                onClick={toggleTheme}
                className="p-2 rounded-lg btn-secondary"
                title="Toggle dark mode"
              >
                {theme === "light" ? <Moon size={20} /> : <Sun size={20} />}
              </button>

              <div className="flex items-center space-x-4">
                <div className="text-right">
                  <p className="font-semibold">{user?.email}</p>
                  <p className="text-sm" style={{ color: "var(--color-primary-600)" }}>
                    {user?.role_name || user?.role}
                  </p>
                </div>
                <button
                  onClick={handleLogout}
                  className="px-4 py-2 rounded-lg flex items-center space-x-2"
                  style={{
                    backgroundColor: "var(--color-primary-600)",
                    color: "white",
                  }}
                >
                  <LogOut size={18} />
                  <span>Logout</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-8">
          <h2 className="text-3xl font-bold mb-2">Welcome back, {user?.first_name || user?.email}!</h2>
          <p className="text-lg opacity-75">You're logged in as <strong>{user?.role_name || user?.role}</strong> in <strong>{user?.company_name}</strong></p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <div className="card p-6">
            <p className="text-sm opacity-75 mb-1">My Sales</p>
            <p className="text-3xl font-bold">0</p>
          </div>
          <div className="card p-6">
            <p className="text-sm opacity-75 mb-1">Conversion Rate</p>
            <p className="text-3xl font-bold">0%</p>
          </div>
          <div className="card p-6">
            <p className="text-sm opacity-75 mb-1">Pending Transfers</p>
            <p className="text-3xl font-bold">0</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="card p-6">
            <h3 className="text-xl font-bold mb-4">My Transfers</h3>
            <p className="opacity-75">Your transfer list coming soon...</p>
          </div>
          <div className="card p-6">
            <h3 className="text-xl font-bold mb-4">Performance</h3>
            <p className="opacity-75">Performance analytics coming soon...</p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default CloserDashboard;

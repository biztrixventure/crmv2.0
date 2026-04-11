import React from "react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useNavigate } from "react-router-dom";

const Dashboard = () => {
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
                <span className="text-xl font-bold text-white">B</span>
              </div>
              <h1 className="text-2xl font-bold">BizTrix CRM</h1>
            </div>

            <div className="flex items-center space-x-6">
              <button
                onClick={toggleTheme}
                className="p-2 rounded-lg btn-secondary"
                title="Toggle dark mode"
              >
                {theme === "light" ? "🌙" : "☀️"}
              </button>

              <div className="flex items-center space-x-4">
                <div className="text-right">
                  <p className="font-semibold">{user?.email}</p>
                  <p className="text-sm" style={{ color: "var(--color-primary-600)" }}>
                    {user?.role_name}
                  </p>
                </div>
                <button
                  onClick={handleLogout}
                  className="px-4 py-2 rounded-lg"
                  style={{
                    backgroundColor: "var(--color-primary-600)",
                    color: "white",
                  }}
                  onMouseEnter={(e) => {
                    e.target.style.backgroundColor = "var(--color-primary-700)";
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.backgroundColor = "var(--color-primary-600)";
                  }}
                >
                  Logout
                </button>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome Section */}
        <div className="card p-8 mb-8" style={{ backgroundImage: "var(--gradient-warm)" }}>
          <h2 className="text-3xl font-bold mb-2 text-white">Welcome back, {user?.first_name}!</h2>
          <p className="text-white opacity-90">
            You're logged in as <strong>{user?.role_name}</strong> in{" "}
            <strong>{user?.company_name}</strong>
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="card p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-75 mb-1">Total Transfers</p>
                <p className="text-3xl font-bold">0</p>
              </div>
              <div className="text-4xl">📋</div>
            </div>
          </div>

          <div className="card p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-75 mb-1">Pending</p>
                <p className="text-3xl font-bold">0</p>
              </div>
              <div className="text-4xl">⏳</div>
            </div>
          </div>

          <div className="card p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-75 mb-1">Total Sales</p>
                <p className="text-3xl font-bold">0</p>
              </div>
              <div className="text-4xl">💰</div>
            </div>
          </div>

          <div className="card p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-75 mb-1">Conversion Rate</p>
                <p className="text-3xl font-bold">0%</p>
              </div>
              <div className="text-4xl">📈</div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <button className="card p-6 text-left hover:shadow-lg transition-all">
            <h3 className="text-lg font-semibold mb-2">📝 Create Transfer</h3>
            <p className="text-sm opacity-75">Submit a new customer transfer</p>
          </button>

          <button className="card p-6 text-left hover:shadow-lg transition-all">
            <h3 className="text-lg font-semibold mb-2">💳 Create Sale</h3>
            <p className="text-sm opacity-75">Convert a transfer to a sale</p>
          </button>

          <button className="card p-6 text-left hover:shadow-lg transition-all">
            <h3 className="text-lg font-semibold mb-2">📊 View Reports</h3>
            <p className="text-sm opacity-75">Check your performance metrics</p>
          </button>
        </div>

        {/* Coming Soon Message */}
        <div className="mt-12 card p-8 text-center">
          <p className="text-lg opacity-75">
            🚀 Dashboard features coming soon...
          </p>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;


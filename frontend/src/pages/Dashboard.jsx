import React from "react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useNavigate } from "react-router-dom";
import { ClipboardList, Clock, DollarSign, TrendingUp, FileText, CreditCard, BarChart3, Rocket } from "lucide-react";
import { Button, Card } from "../components/UI";
import { AppHeader } from "../components/Layout";

const Dashboard = () => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-bg">
      <AppHeader
        title="BizTrix CRM"
        theme={theme}
        onThemeToggle={toggleTheme}
        userEmail={user?.email}
        userRole={user?.role_name}
        onLogout={handleLogout}
      />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome Section */}
        <Card className="p-8 mb-8" style={{ backgroundImage: "var(--gradient-warm)" }}>
          <h2 className="text-3xl font-bold mb-2 text-white">Welcome back, {user?.first_name}!</h2>
          <p className="text-white opacity-90">
            You're logged in as <strong>{user?.role_name}</strong> in{" "}
            <strong>{user?.company_name}</strong>
          </p>
        </Card>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary mb-1">Total Transfers</p>
                <p className="text-3xl font-bold text-text">0</p>
              </div>
              <div className="text-4xl text-primary-600">
                <ClipboardList size={40} />
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary mb-1">Pending</p>
                <p className="text-3xl font-bold text-text">0</p>
              </div>
              <div className="text-4xl text-orange-600">
                <Clock size={40} />
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary mb-1">Total Sales</p>
                <p className="text-3xl font-bold text-text">0</p>
              </div>
              <div className="text-4xl text-success-600">
                <DollarSign size={40} />
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary mb-1">Conversion Rate</p>
                <p className="text-3xl font-bold text-text">0%</p>
              </div>
              <div className="text-4xl text-blue-600">
                <TrendingUp size={40} />
              </div>
            </div>
          </Card>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="p-6 text-left" onClick={() => {}}>
            <div className="flex items-center gap-3 mb-2">
              <FileText size={24} className="text-primary-600" />
              <h3 className="text-lg font-semibold text-text">Create Transfer</h3>
            </div>
            <p className="text-sm text-text-secondary">Submit a new customer transfer</p>
          </Card>

          <Card className="p-6 text-left" onClick={() => {}}>
            <div className="flex items-center gap-3 mb-2">
              <CreditCard size={24} className="text-success-600" />
              <h3 className="text-lg font-semibold text-text">Create Sale</h3>
            </div>
            <p className="text-sm text-text-secondary">Convert a transfer to a sale</p>
          </Card>

          <Card className="p-6 text-left" onClick={() => {}}>
            <div className="flex items-center gap-3 mb-2">
              <BarChart3 size={24} className="text-blue-600" />
              <h3 className="text-lg font-semibold text-text">View Reports</h3>
            </div>
            <p className="text-sm text-text-secondary">Check your performance metrics</p>
          </Card>
        </div>

        {/* Coming Soon Message */}
        <Card className="mt-12 p-8 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Rocket size={32} className="text-primary-600" />
          </div>
          <p className="text-lg text-text-secondary">
            Dashboard features coming soon...
          </p>
        </Card>
      </main>
    </div>
  );
};

export default Dashboard;


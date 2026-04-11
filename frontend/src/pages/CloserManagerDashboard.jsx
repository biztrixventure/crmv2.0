import React from "react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useNavigate } from "react-router-dom";
import { Award } from "lucide-react";
import { Card } from "../components/UI";
import { AppHeader } from "../components/Layout";

const CloserManagerDashboard = () => {
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
        title="Closer Manager Dashboard"
        logo={
          <div className="w-10 h-10 bg-gradient-sidebar rounded-lg flex items-center justify-center">
            <Award className="text-white" size={24} />
          </div>
        }
        theme={theme}
        onThemeToggle={toggleTheme}
        userEmail={user?.email}
        userRole={user?.role_name || user?.role}
        onLogout={handleLogout}
      />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-8">
          <h2 className="text-3xl font-bold mb-2 text-text">Welcome back, {user?.first_name || user?.email}!</h2>
          <p className="text-lg text-text-secondary">You're logged in as <strong>{user?.role_name || user?.role}</strong> in <strong>{user?.company_name}</strong></p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
          <Card className="p-6">
            <p className="text-sm text-text-secondary mb-1">Team Size</p>
            <p className="text-3xl font-bold text-text">0</p>
          </Card>
          <Card className="p-6">
            <p className="text-sm text-text-secondary mb-1">Total Sales</p>
            <p className="text-3xl font-bold text-text">0</p>
          </Card>
          <Card className="p-6">
            <p className="text-sm text-text-secondary mb-1">Team Conversion</p>
            <p className="text-3xl font-bold text-text">0%</p>
          </Card>
          <Card className="p-6">
            <p className="text-sm text-text-secondary mb-1">Avg per Closer</p>
            <p className="text-3xl font-bold text-text">0</p>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="p-6">
            <h3 className="text-xl font-bold mb-4 text-text">Team Performance</h3>
            <p className="text-text-secondary">Team performance metrics coming soon...</p>
          </Card>
          <Card className="p-6">
            <h3 className="text-xl font-bold mb-4 text-text">Manage Closers</h3>
            <p className="text-text-secondary">Closer management tools coming soon...</p>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default CloserManagerDashboard;

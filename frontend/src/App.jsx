import React, { useEffect, useState } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ThemeProvider, useTheme } from "./contexts/ThemeContext";
import { hasRoleAccess } from "./utils/roleRouting";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import AdminPanel from "./pages/AdminPanel";
import CompanyDashboard from "./pages/CompanyDashboard";
import CloserDashboard from "./pages/CloserDashboard";
import FronterDashboard from "./pages/FronterDashboard";
import OperationsDashboard from "./pages/OperationsDashboard";
import CloserManagerDashboard from "./pages/CloserManagerDashboard";
import NotFound from "./pages/NotFound";
import "./styles/global.css";

// Protected Route Component
const ProtectedRoute = ({ children, requiredRole = null }) => {
  const { user, isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }

  if (requiredRole && !hasRoleAccess(user?.role, requiredRole)) {
    return <Navigate to="/dashboard" />;
  }

  return children;
};

// App Content (inside context providers)
const AppContent = () => {
  const { isAuthenticated } = useAuth();

  return (
    <Router>
      <Routes>
        <Route path="/login" element={!isAuthenticated ? <Login /> : <Navigate to="/dashboard" />} />

        {/* Default dashboard - accessible to all authenticated users */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />

        {/* Admin Dashboard */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute requiredRole="admin">
              <AdminPanel />
            </ProtectedRoute>
          }
        />

        {/* Company Admin Dashboard */}
        <Route
          path="/company"
          element={
            <ProtectedRoute requiredRole="company_admin">
              <CompanyDashboard />
            </ProtectedRoute>
          }
        />

        {/* Closer Dashboard */}
        <Route
          path="/closer"
          element={
            <ProtectedRoute requiredRole="closer">
              <CloserDashboard />
            </ProtectedRoute>
          }
        />

        {/* Fronter Dashboard */}
        <Route
          path="/fronter"
          element={
            <ProtectedRoute requiredRole="fronter">
              <FronterDashboard />
            </ProtectedRoute>
          }
        />

        {/* Operations Manager Dashboard */}
        <Route
          path="/operations"
          element={
            <ProtectedRoute requiredRole="operations_manager">
              <OperationsDashboard />
            </ProtectedRoute>
          }
        />

        {/* Closer Manager Dashboard */}
        <Route
          path="/closer-manager"
          element={
            <ProtectedRoute requiredRole="closer_manager">
              <CloserManagerDashboard />
            </ProtectedRoute>
          }
        />

        <Route path="/" element={<Navigate to={isAuthenticated ? "/dashboard" : "/login"} />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Router>
  );
};

// Main App with all providers
function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;


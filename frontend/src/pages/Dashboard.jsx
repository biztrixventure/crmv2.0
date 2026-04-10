import React from "react";
import { useAuth } from "../contexts/AuthContext";
import { useNavigate } from "react-router-dom";

const Dashboard = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-white">
      <nav className="border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <h1 className="text-2xl font-bold text-gray-900">BizTrix CRM</h1>
            <div className="flex items-center space-x-4">
              <span className="text-gray-600">{user?.email}</span>
              <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium">
                {user?.role}
              </span>
              <button
                onClick={handleLogout}
                className="px-4 py-2 text-red-600 border border-red-300 rounded hover:bg-red-50"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Welcome to Dashboard</h2>
          <p className="text-gray-600">
            Dashboard for role: <strong>{user?.role}</strong>
          </p>
          <p className="text-gray-600 mt-2">
            Company: <strong>{user?.company_id || "N/A"}</strong>
          </p>
        </div>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-lg border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">Feature 1</h3>
            <p className="text-gray-600 mt-2">Coming soon...</p>
          </div>
          <div className="bg-white p-6 rounded-lg border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">Feature 2</h3>
            <p className="text-gray-600 mt-2">Coming soon...</p>
          </div>
          <div className="bg-white p-6 rounded-lg border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">Feature 3</h3>
            <p className="text-gray-600 mt-2">Coming soon...</p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;

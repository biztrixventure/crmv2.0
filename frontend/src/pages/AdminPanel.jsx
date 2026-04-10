import React from "react";
import { useAuth } from "../contexts/AuthContext";
import { useNavigate } from "react-router-dom";

const AdminPanel = () => {
  const { logout } = useAuth();
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
            <h1 className="text-2xl font-bold text-gray-900">Admin Panel</h1>
            <button
              onClick={handleLogout}
              className="px-4 py-2 text-red-600 border border-red-300 rounded hover:bg-red-50"
            >
              Logout
            </button>
          </div>
        </div>
      </nav>

      <div className="flex">
        <aside className="w-64 border-r border-gray-200 p-6">
          <nav className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Admin Menu</h3>
            <a href="#" className="block px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">
              Users
            </a>
            <a href="#" className="block px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">
              Roles
            </a>
            <a href="#" className="block px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">
              Companies
            </a>
            <a href="#" className="block px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">
              Forms
            </a>
          </nav>
        </aside>

        <main className="flex-1 p-6">
          <div className="rounded-lg bg-blue-50 border border-blue-200 p-6">
            <h2 className="text-xl font-semibold text-gray-900">Admin Dashboard</h2>
            <p className="text-gray-600 mt-2">Select an option from the menu on the left.</p>
          </div>
        </main>
      </div>
    </div>
  );
};

export default AdminPanel;

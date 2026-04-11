import React, { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { Button, Alert } from '../../../components/UI';
import { useAuth } from '../../../contexts/AuthContext';
import { useUsers } from '../../../hooks/useUsers';
import UserList from './UserList';
import UserModal from './UserModal';

/**
 * UserManagement Component
 * Main container for user management features
 * Handles CRUD operations for users
 */
const UserManagement = () => {
  const { user } = useAuth();
  const { users, loading, error, fetchUsers, createUser, updateUser, deleteUser } = useUsers(user?.company_id);
  const [showModal, setShowModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState('');

  // Fetch users on component mount
  useEffect(() => {
    if (user?.company_id) {
      fetchUsers();
    }
  }, [user?.company_id]);

  // Handle add user button click
  const handleAddUser = () => {
    setSelectedUser(null);
    setShowModal(true);
  };

  // Handle edit user
  const handleEditUser = (userItem) => {
    setSelectedUser(userItem);
    setShowModal(true);
  };

  // Handle delete user with confirmation
  const handleDeleteUser = async (userId) => {
    if (window.confirm('Are you sure you want to deactivate this user?')) {
      try {
        await deleteUser(userId);
      } catch (err) {
        // Error handled in hook
      }
    }
  };

  // Handle modal save
  const handleSaveUser = async (userData) => {
    try {
      if (selectedUser) {
        // Update existing user (password is optional)
        await updateUser(selectedUser.id, {
          first_name: userData.first_name,
          last_name: userData.last_name,
          role_id: userData.role_id,
          password: userData.password, // Optional - only sent if user provided it
        });
      } else {
        // Create new user with company assignment
        await createUser(
          userData.email,
          userData.first_name,
          userData.last_name,
          userData.role_id,
          userData.password,  // Required for new users
          userData.company_id  // NEW - pass company selection
        );
      }
      setShowModal(false);
      setSelectedUser(null);
    } catch (err) {
      // Error handled in hook
    }
  };

  // Filter users based on search and role
  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      !searchTerm ||
      u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.first_name && u.first_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (u.last_name && u.last_name.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesRole = !filterRole || u.role === filterRole;

    return matchesSearch && matchesRole;
  });

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-6 flex-wrap gap-4">
        <h2 className="text-3xl font-bold text-text">Users & Permissions</h2>
        <Button
          onClick={handleAddUser}
          variant="primary"
          size="md"
          className="flex items-center gap-2"
        >
          <Plus size={20} />
          <span>Add User</span>
        </Button>
      </div>

      {/* Search & Filter */}
      <div className="flex gap-4 mb-6 flex-wrap items-center">
        <input
          type="text"
          placeholder="Search by email, name..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="input flex-1 min-w-64"
        />
        <select
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
          className="input"
        >
          <option value="">All Roles</option>
          <option value="SuperAdmin">SuperAdmin</option>
          <option value="Company Admin">Company Admin</option>
          <option value="Manager">Manager</option>
          <option value="Operations">Operations</option>
          <option value="Fronter">Fronter</option>
          <option value="Closer">Closer</option>
        </select>
      </div>

      {/* Error message */}
      {error && (
        <Alert
          type="error"
          title="Error"
          message={error}
          className="mb-6"
        />
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      )}

      {/* User list */}
      {!loading && (
        <UserList
          users={filteredUsers}
          onEdit={handleEditUser}
          onDelete={handleDeleteUser}
        />
      )}

      {/* User modal */}
      {showModal && (
        <UserModal
          user={selectedUser}
          onClose={() => {
            setShowModal(false);
            setSelectedUser(null);
          }}
          onSave={handleSaveUser}
        />
      )}
    </div>
  );
};

export default UserManagement;

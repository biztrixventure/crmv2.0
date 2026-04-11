import React from 'react';
import { Edit2, Trash2, Mail } from 'lucide-react';
import { Badge, Button, Card } from '../../../components/UI';
import { Table } from '../../../components/UI';

/**
 * UserList Component
 * Displays users in a table with edit/delete actions
 */
const UserList = ({ users, onEdit, onDelete }) => {
  if (users.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="text-text-secondary">No users found</p>
      </Card>
    );
  }

  // Get unique roles for badge colors
  const roleColors = {
    SuperAdmin: 'error',
    'Company Admin': 'primary',
    Manager: 'warning',
    Operations: 'info',
    Fronter: 'success',
    Closer: 'secondary',
  };

  // Transform users for table
  const tableRows = users.map((user) => ({
    id: user.id,
    user_id: user.user_id,
    email: user.email,
    name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
    role: user.role,
    role_level: user.role_level,
    status: user.is_active ? 'Active' : 'Inactive',
    created: new Date(user.created_at).toLocaleDateString(),
  }));

  // Define columns
  const columns = [
    { key: 'email', label: 'Email', width: '200px' },
    { key: 'name', label: 'Name', width: '150px' },
    {
      key: 'role',
      label: 'Role',
      width: '120px',
      render: (value) => (
        <Badge
          variant={roleColors[value] || 'secondary'}
          size="sm"
        >
          {value}
        </Badge>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      width: '100px',
      render: (value) => (
        <Badge
          variant={value === 'Active' ? 'success' : 'secondary'}
          size="sm"
        >
          {value}
        </Badge>
      ),
    },
    { key: 'created', label: 'Created', width: '120px' },
  ];

  // Define actions
  const actions = [
    {
      label: 'Edit',
      icon: <Edit2 size={16} />,
      onClick: (row) => onEdit(row),
      variant: 'ghost',
      size: 'sm',
    },
    {
      label: 'Delete',
      icon: <Trash2 size={16} />,
      onClick: (row) => onDelete(row.id),
      variant: 'ghost',
      size: 'sm',
      className: 'text-error-600 hover:text-error-700',
    },
  ];

  return (
    <Card variant="outlined">
      <Table
        columns={columns}
        data={tableRows}
        rowActions={actions}
        sortable
        hover
      />
    </Card>
  );
};

export default UserList;

import React from 'react';
import { Edit2, Trash2 } from 'lucide-react';
import { Card, Button, Badge } from '../../../components/UI';
import { Table } from '../../../components/UI';

/**
 * RoleList Component
 * Displays roles in a table format
 */
const RoleList = ({ roles, onEdit, onDelete }) => {
  if (!roles || roles.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="text-text-secondary">No roles found. Create your first role!</p>
      </Card>
    );
  }

  const columns = [
    { key: 'name', label: 'Role Name' },
    { key: 'level', label: 'Level' },
    { key: 'description', label: 'Description' },
    {
      key: 'permissions',
      label: 'Permissions',
      render: (row) => (
        <span className="text-text-secondary">
          {row.permissions ? row.permissions.length : 0} permissions
        </span>
      )
    },
  ];

  const rowActions = [
    {
      label: 'Edit',
      icon: <Edit2 size={18} />,
      onClick: (row) => {
        // Find the original role object from the roles array to pass pure data, not JSX
        const originalRole = roles.find((r) => r.id === row.id);
        onEdit(originalRole || row);
      },
    },
    {
      label: 'Delete',
      icon: <Trash2 size={18} className="text-error-600" />,
      onClick: (row) => onDelete(row.id),
    },
  ];

  const tableData = roles.map((role) => ({
    ...role,
    name: <span className="font-semibold text-text">{role.name}</span>,
    level: (
      <Badge variant="info" size="sm">
        {role.level}
      </Badge>
    ),
    description: <span className="text-text-secondary">{role.description || '-'}</span>,
  }));

  return (
    <Card>
      <Table
        columns={columns}
        data={tableData}
        rowActions={rowActions}
        emptyMessage="No roles found"
      />
    </Card>
  );
};

export default RoleList;

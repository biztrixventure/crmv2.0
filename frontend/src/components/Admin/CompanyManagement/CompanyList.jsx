import React from 'react';
import { Edit2, Trash2, Eye } from 'lucide-react';
import { Badge, Table, Button, Card } from '../../../components/UI';

/**
 * CompanyList Component
 * Displays companies in a table with actions
 */
const CompanyList = ({ companies, onEdit, onDelete, onView, loading = false }) => {
  if (!companies || companies.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="text-text-secondary">No companies found</p>
      </Card>
    );
  }

  // Transform companies for table display
  const tableRows = companies.map((company) => ({
    id: company.id,
    name: company.name,
    logo_url: company.logo_url,
    status: company.is_active ? 'Active' : 'Inactive',
    created_at: new Date(company.created_at).toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }),
  }));

  // Define columns
  const columns = [
    {
      key: 'name',
      label: 'Name',
      width: '250px',
      render: (row) => (
        <div className="flex items-center gap-3">
          {row.logo_url && (
            <img
              src={row.logo_url}
              alt={row.name}
              className="w-8 h-8 rounded object-cover"
              onError={(e) => {
                e.target.style.display = 'none';
              }}
            />
          )}
          <span className="font-medium text-text">{row.name}</span>
        </div>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      width: '120px',
      render: (row) => (
        <Badge variant={row.status === 'Active' ? 'success' : 'secondary'} size="sm">
          {row.status}
        </Badge>
      ),
    },
    {
      key: 'created_at',
      label: 'Created',
      width: '120px',
    },
  ];

  // Define actions
  const actions = [
    {
      label: 'View',
      icon: <Eye size={16} />,
      onClick: (row) => onView(companies.find((c) => c.id === row.id)),
      variant: 'ghost',
      size: 'sm',
    },
    {
      label: 'Edit',
      icon: <Edit2 size={16} />,
      onClick: (row) => onEdit(companies.find((c) => c.id === row.id)),
      variant: 'ghost',
      size: 'sm',
    },
    {
      label: 'Deactivate',
      icon: <Trash2 size={16} />,
      onClick: (row) => {
        if (window.confirm('Are you sure you want to deactivate this company?')) {
          onDelete(row.id);
        }
      },
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

export default CompanyList;

import React from 'react';
import { Badge, Table, Button } from '../../../components/UI';

/**
 * CompanyList Component
 * Displays companies in a table with actions
 */
const CompanyList = ({ companies, onEdit, onDelete, loading = false }) => {
  if (!companies || companies.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-text-secondary mb-4">No companies found</p>
      </div>
    );
  }

  const columns = [
    {
      header: 'Name',
      accessor: 'name',
      render: (value, row) => (
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
          <span className="font-medium text-text">{value}</span>
        </div>
      ),
    },
    {
      header: 'Status',
      accessor: 'is_active',
      render: (value) => (
        <Badge variant={value ? 'success' : 'secondary'}>
          {value ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      header: 'Created',
      accessor: 'created_at',
      render: (value) => {
        if (!value) return 'N/A';
        return new Date(value).toLocaleDateString('en-US', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        });
      },
    },
    {
      header: 'Actions',
      accessor: 'id',
      render: (value, row) => (
        <div className="flex gap-2">
          <Button
            onClick={() => onEdit(row)}
            variant="ghost"
            size="sm"
          >
            Edit
          </Button>
          <Button
            onClick={() => {
              if (window.confirm('Are you sure you want to deactivate this company?')) {
                onDelete(value);
              }
            }}
            variant="ghost"
            size="sm"
            className="text-error"
          >
            Deactivate
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Table
      data={companies}
      columns={columns}
      loading={loading}
    />
  );
};

export default CompanyList;

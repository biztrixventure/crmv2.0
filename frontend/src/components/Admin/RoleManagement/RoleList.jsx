import React from 'react';
import { Edit2, Trash2 } from 'lucide-react';

/**
 * RoleList Component
 * Displays roles in a table format
 */
const RoleList = ({ roles, onEdit, onDelete }) => {
  if (!roles || roles.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="opacity-75">No roles found. Create your first role!</p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <table className="w-full">
        <thead>
          <tr style={{ backgroundColor: 'var(--color-primary-50)' }}>
            <th className="px-6 py-4 text-left text-sm font-semibold">Role Name</th>
            <th className="px-6 py-4 text-left text-sm font-semibold">Level</th>
            <th className="px-6 py-4 text-left text-sm font-semibold">Description</th>
            <th className="px-6 py-4 text-left text-sm font-semibold">Permissions</th>
            <th className="px-6 py-4 text-left text-sm font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {roles.map((role, index) => (
            <tr
              key={role.id}
              style={{
                backgroundColor:
                  index % 2 === 0
                    ? 'var(--color-bg)'
                    : 'var(--color-bg-secondary)',
                borderBottom: '1px solid var(--color-border)',
              }}
            >
              <td className="px-6 py-4">
                <span className="font-semibold">{role.name}</span>
              </td>
              <td className="px-6 py-4">
                <span
                  className="px-3 py-1 rounded-full text-sm font-medium"
                  style={{
                    backgroundColor: 'var(--color-primary-100)',
                    color: 'var(--color-primary-700)',
                  }}
                >
                  {role.level}
                </span>
              </td>
              <td className="px-6 py-4 text-sm opacity-75">
                {role.description || '-'}
              </td>
              <td className="px-6 py-4 text-sm">
                <span className="opacity-75">
                  {role.permissions ? role.permissions.length : 0} permissions
                </span>
              </td>
              <td className="px-6 py-4">
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => onEdit(role)}
                    className="p-2 rounded-lg transition-colors"
                    style={{
                      backgroundColor: 'var(--color-primary-100)',
                      color: 'var(--color-primary-700)',
                    }}
                    title="Edit role"
                  >
                    <Edit2 size={18} />
                  </button>
                  <button
                    onClick={() => onDelete(role.id)}
                    className="p-2 rounded-lg transition-colors"
                    style={{
                      backgroundColor: 'var(--color-error-100)',
                      color: 'var(--color-error-700)',
                    }}
                    title="Delete role"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default RoleList;

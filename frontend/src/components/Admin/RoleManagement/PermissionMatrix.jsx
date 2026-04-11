import React, { useState, useEffect } from 'react';
import { usePermissions } from '../../../hooks/usePermissions';

/**
 * PermissionMatrix Component
 * Displays permissions grouped by category with checkboxes
 */
const PermissionMatrix = ({ selectedPermissions = [], onChange }) => {
  const { permissions, loading, error, fetchPermissions } = usePermissions();
  const [localSelected, setLocalSelected] = useState(selectedPermissions);

  useEffect(() => {
    fetchPermissions();
  }, []);

  useEffect(() => {
    setLocalSelected(selectedPermissions);
  }, [selectedPermissions]);

  // Handle individual permission toggle
  const handleToggle = (permissionName) => {
    const updated = localSelected.includes(permissionName)
      ? localSelected.filter(p => p !== permissionName)
      : [...localSelected, permissionName];
    setLocalSelected(updated);
    onChange(updated);
  };

  // Handle select/deselect all for a category
  const handleToggleCategory = (category) => {
    const categoryPerms = permissions[category] || [];
    const categoryNames = categoryPerms.map(p => p.name);
    const allSelected = categoryNames.every(name => localSelected.includes(name));

    let updated;
    if (allSelected) {
      updated = localSelected.filter(p => !categoryNames.includes(p));
    } else {
      updated = [...new Set([...localSelected, ...categoryNames])];
    }
    setLocalSelected(updated);
    onChange(updated);
  };

  if (loading) {
    return <div className="text-center py-4">Loading permissions...</div>;
  }

  if (error) {
    return <div className="text-red-600 py-4">Error loading permissions: {error}</div>;
  }

  return (
    <div className="space-y-6">
      <h3 className="font-semibold text-lg">Assign Permissions</h3>

      {Object.entries(permissions).map(([category, perms]) => {
        const categoryNames = perms.map(p => p.name);
        const categorySelected = categoryNames.filter(name => localSelected.includes(name)).length;
        const allSelected = categorySelected === categoryNames.length;

        return (
          <div key={category} className="border rounded-lg p-4" style={{ borderColor: 'var(--color-border)' }}>
            {/* Category header with select all */}
            <div className="flex items-center space-x-3 mb-4">
              <input
                type="checkbox"
                id={`category-${category}`}
                checked={allSelected}
                onChange={() => handleToggleCategory(category)}
                className="w-4 h-4 rounded cursor-pointer"
              />
              <label
                htmlFor={`category-${category}`}
                className="font-semibold capitalize cursor-pointer flex-1"
              >
                {category.replace(/_/g, ' ')}
              </label>
              <span className="text-sm opacity-75">
                {categorySelected} of {categoryNames.length}
              </span>
            </div>

            {/* Permissions list */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 ml-6">
              {perms.map(perm => (
                <div key={perm.id} className="flex items-start space-x-2">
                  <input
                    type="checkbox"
                    id={`perm-${perm.id}`}
                    checked={localSelected.includes(perm.name)}
                    onChange={() => handleToggle(perm.name)}
                    className="w-4 h-4 rounded cursor-pointer mt-1"
                  />
                  <label
                    htmlFor={`perm-${perm.id}`}
                    className="cursor-pointer flex-1"
                  >
                    <div className="font-mono text-sm">{perm.name}</div>
                    {perm.description && (
                      <div className="text-xs opacity-60">{perm.description}</div>
                    )}
                  </label>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default PermissionMatrix;

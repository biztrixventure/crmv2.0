import React from 'react';

/**
 * Global Table Component
 *
 * Features:
 * - Responsive data table
 * - Sortable columns
 * - Row actions
 * - Loading state
 * - Empty state
 * - Accessibility-first (semantic table, headers)
 * - Alternating row colors
 * - Hover effects
 */
const Table = ({
  columns = [], // Array of { key, label, render?, sortable? }
  data = [],
  rowActions = [], // Array of { label, onClick, icon?, variant? }
  loading = false,
  emptyMessage = 'No data available',
  onSort = null,
  sortKey = null,
  sortOrder = 'asc',
  onRowClick = null,
  className = '',
  ...props
}) => {
  const handleSort = (key) => {
    if (onSort && columns.find(col => col.key === key)?.sortable) {
      onSort(key, sortOrder === 'asc' ? 'desc' : 'asc');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="spinner" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="text-center p-8">
        <p className="text-text-secondary">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={`overflow-x-auto rounded-lg border border-border shadow-sm ${className}`} {...props}>
      <table className="table w-full">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                onClick={() => handleSort(column.key)}
                className={column.sortable ? 'cursor-pointer hover:bg-primary-100 dark:hover:bg-primary-800' : ''}
              >
                <div className="flex items-center gap-2">
                  {column.label}
                  {column.sortable && (
                    <span className="text-xs text-text-tertiary">
                      {sortKey === column.key && (sortOrder === 'asc' ? '↑' : '↓')}
                    </span>
                  )}
                </div>
              </th>
            ))}
            {rowActions.length > 0 && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {data.map((row, rowIdx) => (
            <tr key={rowIdx}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={onRowClick ? 'cursor-pointer' : ''}>
              {columns.map((column) => (
                <td key={`${rowIdx}-${column.key}`}>
                  {column.render ? column.render(row) : row[column.key]}
                </td>
              ))}
              {rowActions.length > 0 && (
                <td>
                  <div className="flex items-center gap-2">
                    {rowActions.map((action, idx) => (
                      <button
                        key={idx}
                        onClick={(e) => { e.stopPropagation(); action.onClick(row); }}
                        className="p-1.5 rounded hover:bg-primary-100 dark:hover:bg-primary-800 transition-colors"
                        title={action.label}
                      >
                        {action.icon || action.label}
                      </button>
                    ))}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default Table;

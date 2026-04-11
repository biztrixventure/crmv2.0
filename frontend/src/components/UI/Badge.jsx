import React from 'react';

/**
 * Global Badge Component
 *
 * Features:
 * - Multiple variants (primary, success, error, warning, info)
 * - Multiple sizes (sm, md, lg)
 * - Can display icons next to text
 * - Consistent styling via CSS variables
 */
const Badge = ({
  variant = 'primary',
  size = 'md',
  children,
  icon: Icon = null,
  className = '',
  ...props
}) => {
  const baseClasses = 'inline-flex items-center font-medium rounded-full transition-colors duration-300 gap-1';

  const variantClasses = {
    primary: 'bg-primary-100 text-primary-700 dark:bg-primary-800 dark:text-primary-200',
    success: 'badge badge-success',
    error: 'badge badge-error',
    warning: 'badge badge-warning',
    info: 'badge badge-info',
  };

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-3 py-1 text-sm',
    lg: 'px-4 py-1.5 text-base',
  };

  const allClasses = `${baseClasses} ${variantClasses[variant] || variantClasses.primary} ${sizeClasses[size] || sizeClasses.md} ${className}`;

  return (
    <span className={allClasses} {...props}>
      {Icon && <Icon size={size === 'sm' ? 12 : size === 'md' ? 14 : 16} />}
      {children}
    </span>
  );
};

export default Badge;

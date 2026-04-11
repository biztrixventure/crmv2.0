import React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Global Button Component
 *
 * Features:
 * - Multiple variants: primary, secondary, ghost, danger
 * - Multiple sizes: xs, sm, md, lg
 * - States: normal, hover, active, disabled, loading, focus
 * - Consistent styling via CSS variables
 * - Accessibility-first (focus rings, disabled states)
 */
const Button = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  children,
  className = '',
  ...props
}) => {
  const baseClasses = 'inline-flex items-center justify-center font-medium transition-all duration-300 rounded-lg cursor-pointer focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60';

  const variantClasses = {
    primary: 'bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800 shadow-sm hover:shadow-md disabled:bg-disabled-bg disabled:text-disabled-text focus-visible:outline-2 focus-visible:outline-offset-2',
    secondary: 'bg-primary-100 text-primary-900 border border-primary-200 hover:bg-primary-200 active:bg-primary-300 shadow-xs dark:bg-primary-800 dark:text-primary-100 dark:border-primary-600 dark:hover:bg-primary-700 focus-visible:outline-2',
    ghost: 'text-primary-600 hover:bg-primary-50 active:bg-primary-100 dark:text-primary-300 dark:hover:bg-primary-800 focus-visible:outline-2',
    danger: 'bg-error-600 text-white hover:bg-error-700 active:bg-error-800 shadow-sm hover:shadow-md focus-visible:outline-2',
  };

  const sizeClasses = {
    xs: 'px-2 py-1 text-xs gap-1',
    sm: 'px-3 py-1.5 text-sm gap-1.5',
    md: 'px-4 py-2 text-base gap-2',
    lg: 'px-6 py-3 text-lg gap-2.5',
  };

  const allClasses = `${baseClasses} ${variantClasses[variant] || variantClasses.primary} ${sizeClasses[size] || sizeClasses.md} ${className}`;

  return (
    <button
      className={allClasses}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="animate-spin" size={16} />
          {children}
        </>
      ) : (
        children
      )}
    </button>
  );
};

export default Button;

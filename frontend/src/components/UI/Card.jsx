import React from 'react';

/**
 * Global Card Component
 *
 * Features:
 * - Generic wrapper for grouped content
 * - Variants: default, elevated, outlined
 * - Consistent shadows and borders
 * - Hover effects
 * - Responsive padding
 */
const Card = ({
  variant = 'default',
  children,
  className = '',
  onClick = null,
  ...props
}) => {
  const baseClasses = 'rounded-lg transition-all duration-300 border';

  const variantClasses = {
    default: 'bg-surface border-border shadow-sm hover:shadow-md dark:bg-surface dark:border-primary-700',
    elevated: 'bg-surface border-border shadow-md hover:shadow-lg dark:bg-surface dark:border-primary-700',
    outlined: 'bg-transparent border-border hover:border-primary-400 shadow-none dark:border-primary-600',
  };

  const interactiveClasses = onClick ? 'cursor-pointer' : '';

  const allClasses = `${baseClasses} ${variantClasses[variant] || variantClasses.default} ${interactiveClasses} ${className}`;

  return (
    <div
      className={allClasses}
      onClick={onClick}
      role={onClick ? 'button' : 'region'}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
      {...props}
    >
      {children}
    </div>
  );
};

export default Card;

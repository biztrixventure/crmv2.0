import React from 'react';

/**
 * Skeleton Loader Component
 *
 * Features:
 * - Placeholder loading state animations
 * - Multiple variants (text, card, table, avatar)
 * - Shimmer animation effect
 * - Responsive sizing
 */
const Skeleton = ({
  variant = 'text',
  width = '100%',
  height = '1rem',
  count = 1,
  className = '',
  ...props
}) => {
  const baseClasses = 'rounded-lg bg-skeleton animate-shimmer';

  const variantClasses = {
    text: 'h-4',
    heading: 'h-8',
    card: 'rounded-lg',
    avatar: 'rounded-full',
    button: 'h-10',
    line: 'h-2',
  };

  const skeletons = [];
  for (let i = 0; i < count; i++) {
    skeletons.push(
      <div
        key={i}
        className={`${baseClasses} ${variantClasses[variant] || variantClasses.text} ${className}`}
        style={{
          width,
          height: variant !== 'text' && variant !== 'heading' && variant !== 'line' ? height : undefined,
          backgroundColor: 'var(--color-skeleton)',
        }}
        {...props}
      />
    );
  }

  return count === 1 ? skeletons[0] : <div className="space-y-3">{skeletons}</div>;
};

export default Skeleton;

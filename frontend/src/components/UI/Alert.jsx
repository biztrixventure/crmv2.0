import React, { useState } from 'react';
import { X, AlertCircle, CheckCircle2, AlertTriangle, Info } from 'lucide-react';

/**
 * Global Alert Component
 *
 * Features:
 * - Multiple types (success, error, warning, info)
 * - Semantic icons for each type
 * - Dismissible with close button
 * - Smooth animations
 * - Accessible (role="alert")
 */
const Alert = ({
  type = 'info',
  title,
  message,
  dismissible = true,
  onDismiss = null,
  className = '',
  ...props
}) => {
  const [isVisible, setIsVisible] = useState(true);

  const iconMap = {
    success: CheckCircle2,
    error: AlertCircle,
    warning: AlertTriangle,
    info: Info,
  };

  const Icon = iconMap[type] || Info;

  const handleDismiss = () => {
    setIsVisible(false);
    if (onDismiss) onDismiss();
  };

  if (!isVisible) return null;

  const alertClasses = `alert alert-${type} animate-slide-up ${className}`;

  return (
    <div role="alert" className={alertClasses} {...props}>
      <div className="flex items-start gap-3">
        <Icon size={20} className="flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          {title && <p className="font-semibold">{title}</p>}
          {message && <p className={title ? 'text-sm mt-1' : ''}>{message}</p>}
        </div>
        {dismissible && (
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
            aria-label="Dismiss alert"
          >
            <X size={18} />
          </button>
        )}
      </div>
    </div>
  );
};

export default Alert;

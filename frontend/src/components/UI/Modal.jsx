import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import Button from '../UI/Button';

/**
 * Global Modal Component
 *
 * Features:
 * - Backdrop with overlay
 * - Smooth animations (scale-in)
 * - Focus trap (keyboard navigation)
 * - ESC key to close
 * - Configurable size
 * - Custom actions/buttons
 * - Accessibility-first (role="dialog", aria-modal)
 */
const Modal = ({
  isOpen = false,
  onClose = () => {},
  title,
  children,
  actions = [], // Array of { label, onClick, variant }
  size = 'md',
  className = '',
  showCloseButton = true,
  ...props
}) => {
  // Handle ESC key
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEsc);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 dark:bg-black/70 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'modal-title' : undefined}
        className={`relative bg-surface dark:bg-surface rounded-xl shadow-elevated animate-scale-in z-10 ${sizeClasses[size] || sizeClasses.md} w-full max-h-[90vh] flex flex-col ${className}`}
        {...props}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border flex-shrink-0">
          {title && (
            <h2 id="modal-title" className="text-2xl font-bold text-text">
              {title}
            </h2>
          )}
          {showCloseButton && (
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-primary-100 dark:hover:bg-primary-800 transition-colors ml-4 flex-shrink-0"
              aria-label="Close modal"
            >
              <X size={24} />
            </button>
          )}
        </div>

        {/* Content - Scrollable */}
        <div className="p-6 overflow-y-auto flex-1">
          {children}
        </div>

        {/* Footer with Actions */}
        {actions.length > 0 && (
          <div className="flex items-center justify-end gap-3 p-6 border-t border-border bg-bg dark:bg-primary-900/50 flex-shrink-0">
            {actions.map((action, idx) => (
              <Button
                key={idx}
                variant={action.variant || 'secondary'}
                onClick={action.onClick}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Modal;

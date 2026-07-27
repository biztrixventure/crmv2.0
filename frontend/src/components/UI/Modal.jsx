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
 *
 * Responsive: below `sm` it is a full-screen sheet, not a shrunken desktop
 * dialog. A centered `max-w-md` card on a 390px phone wastes the width it does
 * have on margins while its own content still scrolls — the sheet gives that
 * space back. At `sm` and up it is exactly the dialog it always was.
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
    sm: 'sm:max-w-sm',
    md: 'sm:max-w-md',
    lg: 'sm:max-w-lg',
    xl: 'sm:max-w-xl',
    '2xl': 'sm:max-w-2xl',
  };

  return (
    // No padding below `sm`: the dialog is full-screen there, and padding would
    // leave a hairline of page showing around something meant to be edge-to-edge.
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 overflow-y-auto">
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
        className={`relative bg-surface dark:bg-surface shadow-elevated animate-scale-in z-10 w-full flex flex-col
          h-dvh max-h-dvh rounded-none
          sm:h-auto sm:max-h-[90vh] sm:rounded-xl
          ${sizeClasses[size] || sizeClasses.md} ${className}`}
        {...props}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-border flex-shrink-0">
          {title && (
            <h2 id="modal-title" className="text-lg sm:text-2xl font-bold text-text min-w-0 truncate">
              {title}
            </h2>
          )}
          {showCloseButton && (
            <button
              onClick={onClose}
              className="w-11 h-11 sm:w-auto sm:h-auto sm:p-2 flex items-center justify-center rounded-lg hover:bg-primary-100 dark:hover:bg-primary-800 transition-colors ml-4 flex-shrink-0"
              aria-label="Close modal"
            >
              <X size={24} />
            </button>
          )}
        </div>

        {/* Content - Scrollable */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1">
          {children}
        </div>

        {/* Footer with Actions — stacked and full-width on a phone, where a row
            of side-by-side buttons ends up with sub-44px tap targets. */}
        {actions.length > 0 && (
          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center sm:justify-end gap-2 sm:gap-3 p-4 sm:p-6 border-t border-border bg-bg-secondary flex-shrink-0">
            {actions.map((action, idx) => (
              <Button
                key={idx}
                variant={action.variant || 'secondary'}
                onClick={action.onClick}
                className="w-full sm:w-auto"
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

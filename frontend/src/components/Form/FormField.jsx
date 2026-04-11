import React from 'react';

/**
 * Global FormField Component
 *
 * Features:
 * - Wraps label, input, error, and hint
 * - Consistent spacing and styling
 * - Required field indicator (*)
 * - Error message display
 * - Hint/helper text
 * - Proper accessibility (label + input connection)
 */
const FormField = ({
  label,
  hint,
  error,
  required = false,
  children,
  className = '',
  ...props
}) => {
  const fieldId = props.id || `field-${Math.random().toString(36).substr(2, 9)}`;

  return (
    <div className={`form-group ${className}`}>
      {label && (
        <label
          htmlFor={fieldId}
          className={`form-label ${required ? 'required' : ''}`}
        >
          {label}
          {required && <span className="text-error-600 ml-1">*</span>}
        </label>
      )}

      <div className="flex-1">
        {React.cloneElement(children, {
          id: fieldId,
          className: `${children.props.className || ''} ${error ? 'error' : ''}`.trim(),
        })}
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {hint && !error && (
        <p className="form-hint">
          {hint}
        </p>
      )}
    </div>
  );
};

export default FormField;

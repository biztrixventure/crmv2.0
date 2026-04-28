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

  // Support multiple children: only the first gets id/className injected; rest render as-is.
  const childArray = React.Children.toArray(children);
  const inputChild = childArray[0];
  const extraChildren = childArray.slice(1);

  return (
    <div className={`form-group ${className}`}>
      {label && (
        <label
          htmlFor={fieldId}
          className={`form-label ${required ? 'required' : ''}`}
        >
          {label}
        </label>
      )}

      <div className="flex-1">
        {inputChild && React.cloneElement(inputChild, {
          id: fieldId,
          className: `${inputChild.props.className || ''} ${error ? 'error' : ''}`.trim(),
        })}
        {extraChildren}
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

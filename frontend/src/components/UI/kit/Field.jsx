// Field — the ONE labelled control wrapper. Unifies the 4 label idioms found
// across the admin surfaces (text-[11px] sm:text-[10px] / text-[11px] / text-xs, uppercase or
// not). Wraps anything: ThemedSelect, ThemedDate, an `.input`, a checkbox grid.
//
// It is a WRAPPER, not a form-field renderer — components/Form/FormField.jsx is
// the dynamic, `form_fields`-config-driven renderer and stays as it is.
//
//   <Field label="Company context" hint="Drives the company-scoped tabs">
//     <ThemedSelect …>…</ThemedSelect>
//   </Field>
//
// Renders a <label> by default (one control). Pass as="div" for groups (radio
// sets, checkbox grids) where wrapping many inputs in one label would be wrong.
export default function Field({
  label,
  hint,
  error,
  required = false,
  as: Tag = 'label',
  className = '',
  children,
}) {
  return (
    <Tag className={`block ${className}`}>
      {label && (
        <span className="text-[11px] sm:text-[10px] font-bold uppercase tracking-wider block mb-1"
          style={{ color: 'var(--color-text-secondary)' }}>
          {label}
          {required && <span style={{ color: 'var(--color-error-600)' }}> *</span>}
        </span>
      )}
      {children}
      {error
        ? <span className="text-[11px] mt-1 block" style={{ color: 'var(--color-error-600)' }}>{error}</span>
        : hint
          ? <span className="text-[11px] mt-1 block" style={{ color: 'var(--color-text-tertiary)' }}>{hint}</span>
          : null}
    </Tag>
  );
}

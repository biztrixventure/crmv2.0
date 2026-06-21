import { useRef } from 'react';
import { canonicalizeToOption } from '../../utils/canonicalizeOption';

// Combobox: a normal text input backed by a <datalist> of options. The user can
// SELECT an option, or TYPE / PASTE freely. On blur the value is snapped to the
// matching option's canonical spelling (case/space/punctuation insensitive) via
// canonicalizeToOption, so saved data stays consistent for the analyzer. Free
// text that matches no option is kept as-is.
//
// onChange is called with the STRING value (not an event).
export default function ComboInput({
  value,
  onChange,
  options = [],
  onBlur,
  className = 'input',
  required = false,
  placeholder,
  ...rest
}) {
  const id = useRef(`combo-${Math.random().toString(36).slice(2)}`).current;
  const opts = (options || []).filter((o) => o != null && o !== '');

  const handleBlur = (e) => {
    const canon = canonicalizeToOption(e.target.value, opts);
    if (canon !== (value || '')) onChange(canon);
    onBlur?.(canon);
  };

  return (
    <>
      <input
        list={id}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        onBlur={handleBlur}
        className={className}
        required={required}
        placeholder={placeholder || 'Select or type…'}
        autoComplete="off"
        {...rest}
      />
      <datalist id={id}>
        {opts.map((o) => <option key={o} value={o} />)}
      </datalist>
    </>
  );
}

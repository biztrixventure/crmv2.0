// Snap a typed/pasted value to the canonical spelling of a matching option, so
// the data analyzer gets ONE consistent value instead of "S-Class", "s-class",
// "s class" all as separate strings. Matching is case-insensitive and ignores
// spaces/punctuation. A value that matches no option is kept exactly as typed
// (free text is still allowed).
//
//   canonicalizeToOption('s-class', ['S-Class', 'E-Class']) === 'S-Class'
//   canonicalizeToOption('s class', ['S-Class'])            === 'S-Class'
//   canonicalizeToOption('something else', ['S-Class'])     === 'something else'

const squash = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

export function canonicalizeToOption(value, options) {
  const v = String(value ?? '').trim();
  if (!v || !Array.isArray(options) || !options.length) return v;
  // 1) exact, case-insensitive (after trim)
  let m = options.find((o) => String(o).trim().toLowerCase() === v.toLowerCase());
  if (m != null) return m;
  // 2) loose: ignore spaces + punctuation ("s class" / "sclass" → "S-Class")
  const sv = squash(v);
  if (!sv) return v;
  m = options.find((o) => squash(o) === sv);
  return m != null ? m : v;
}

// Submit-time safety net: canonicalize every option-bearing field in a form_data
// object against its field definition (covers Enter-to-submit, which skips the
// input's blur). Only string-option fields are touched; entity/object options
// (e.g. client mappings) are left alone.
export function canonicalizeFormData(formData, fields) {
  if (!formData || !Array.isArray(fields)) return formData;
  const out = { ...formData };
  for (const f of fields) {
    if (!f || !f.name) continue;
    const opts = Array.isArray(f.options) ? f.options.filter((o) => typeof o === 'string') : [];
    if (opts.length && out[f.name] != null && out[f.name] !== '') {
      out[f.name] = canonicalizeToOption(out[f.name], opts);
    }
  }
  return out;
}


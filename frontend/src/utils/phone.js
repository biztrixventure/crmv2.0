// Phone resolution for transfer/lead rows.
//
// A transfer's phone can live in form_data (manual/CRM rows, under any of these
// keys) OR in the normalized_phone column (VICIDIAL rows, derived from
// cli_number — migration 048). Most grids only read form_data and showed blank
// for dialer leads even though normalized_phone was populated. Always prefer the
// as-entered form_data value, then fall back to normalized_phone.
const FD_PHONE_KEYS = ['customer_phone', 'Phone', 'phone', 'Mobile', 'CellPhone', 'PhoneNumber', 'phone_number', 'cli_number'];

export function transferPhone(t) {
  if (!t) return '';
  const fd = t.form_data || {};
  for (const k of FD_PHONE_KEYS) {
    const v = fd[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  if (t.normalized_phone != null && String(t.normalized_phone).trim() !== '') return String(t.normalized_phone).trim();
  return '';
}

export default transferPhone;

// ============================================================================
// Closer-disposition helpers — the single source for the dynamic, disposition
// driven tabs (e.g. "Post Date") and the post-date charging behaviour.
//
// The sale-disposition form field (field_type 'sale_disposition' | 'sale_status')
// holds the configured options. Every configured option EXCEPT "sale" becomes
// its own tab on the closer + compliance dashboards; "sale" stays the existing
// All Sales / My Sales view. Reading the options live means renaming a
// disposition in Form Builder reflects on both sides automatically.
// ============================================================================

// Recognise the "post date" disposition regardless of casing / separator, so a
// rename within the post-date family ("Post Date", "post_date", "Post-Dated")
// still triggers the charging-date field + reminder.
export const isPostDateDispo = (v) => /post[\s_-]?date|postdate/i.test(String(v || ''));

const findDispoField = (fields) =>
  (fields || []).find(f => f.field_type === 'sale_disposition' || f.field_type === 'sale_status');

// The explicitly-configured disposition options (empty when the admin hasn't set
// any — we don't invent tabs from the built-in fallback list).
export function dispositionOptions(fields) {
  const f = findDispoField(fields);
  return Array.isArray(f?.options) ? f.options.filter(Boolean) : [];
}

// Non-"sale" options → the extra dashboard tabs. Each entry: { value, label }.
export function dispositionTabs(fields) {
  return dispositionOptions(fields)
    .filter(v => String(v).trim().toLowerCase() !== 'sale')
    .map(v => ({ value: v, label: prettyDispo(v) }));
}

// Display label for a disposition value ("post date" → "Post Date").
export function prettyDispo(v) {
  return String(v || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

// Shared form-entry helpers used by the transfer (fronter) + sale (closer) forms:
//   smartFormat  — auto-capitalization on blur, aware of the field's type/name
//   suggestionsFor / rememberValues — native-datalist autocomplete from past
//                    entries, limited to repeatable, low-PII fields.

const capFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Proper-noun title case: "john o'neil-smith" → "John O'Neil-Smith", "NISSAN" → "Nissan".
function titleCaseName(s) {
  return s.toLowerCase()
    .replace(/([a-zà-ÿ])([a-zà-ÿ'’]*)/g, (_, a, b) => a.toUpperCase() + b)
    .replace(/\bMc([a-zà-ÿ])/g, (_, c) => 'Mc' + c.toUpperCase())
    .replace(/\bMac([a-zà-ÿ])/g, (_, c) => 'Mac' + c.toUpperCase());
}

// Capitalize the first letter of each sentence; leave the rest as typed.
function capitalizeSentences(s) {
  return s.replace(/(^\s*|[.!?]\s+)([a-zà-ÿ])/g, (_, lead, c) => lead + c.toUpperCase());
}

const hay = (f) => `${(f?.name || '')} ${(f?.label || '')}`.toLowerCase();

// Auto-capitalize a value based on the field. Pure formatting — applied on blur
// so it never fights mid-word typing. Codes / numbers / emails are left correct.
export function smartFormat(field, raw) {
  const v = (raw ?? '').toString();
  if (!v.trim()) return v;
  const t = field?.field_type || 'text';
  const h = hay(field);

  if (t === 'email' || /email/.test(h)) return v.trim().toLowerCase();
  if (['number', 'zip', 'phone', 'tel', 'date', 'select'].includes(t)) return v;
  if (['sale_date', 'sale_down_payment', 'sale_monthly_payment', 'sale_reference_no', 'sale_status', 'sale_call_review'].includes(t)) return v;
  if (/\bvin\b|reference|ref_?no|\bcli\b|number|mobile|phone|url|link|password|zip|postal/.test(h)) return v;

  if (t === 'textarea' || /note|comment|description|message|remark/.test(h)) return capitalizeSentences(v);
  if (/\bstate\b/.test(h)) { const s = v.trim(); return s.length <= 3 ? s.toUpperCase() : titleCaseName(s); }
  if (/address|street|addr/.test(h)) return capitalizeSentences(v);
  if (t === 'sale_client' || /name|city|make|model|client|customer|contact|company|country|plan/.test(h) || t === 'text') return titleCaseName(v);
  return capFirst(v);
}

// ── Autocomplete (native datalist) — only for repeatable, non-PII fields ───────
const SUGGESTABLE = /city|state|make|model|company|client|plan|condition|country|carrier|source/;
export function isSuggestable(field) {
  if (!field) return false;
  const t = field.field_type;
  if (['select', 'sale_plan', 'sale_client'].includes(t)) return true;
  return SUGGESTABLE.test(hay(field));
}

const KEY = 'ff_field_history_v1';
const CAP = 15;
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const write = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* quota */ } };

export function suggestionsFor(name) { return read()[name] || []; }

// Record suggestable field values after a successful submit (most-recent first).
export function rememberValues(fields, values) {
  const o = read();
  (fields || []).forEach((f) => {
    if (!isSuggestable(f)) return;
    const v = (values?.[f.name] ?? '').toString().trim();
    if (v.length < 2 || v.length > 80) return;
    const arr = o[f.name] || [];
    o[f.name] = [v, ...arr.filter((x) => x.toLowerCase() !== v.toLowerCase())].slice(0, CAP);
  });
  write(o);
}

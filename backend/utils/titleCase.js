// ============================================================================
// titleCase — server-side backstop for proper-casing customer / client names
// as they enter the DB. Frontend normalizes on type, but compliance edits,
// imports, and bulk uploads bypass that path, so write handlers run this
// before persisting. Matches the SQL `app_title_case` helper in migration 059.
// ============================================================================

function titleCase(input) {
  if (input == null) return input;
  const s = String(input).replace(/\s+/g, ' ').trim();
  if (!s) return s;
  return s
    .split(' ')
    .map(w => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// Identifier-shaped keys whose casing carries meaning. Mirrors the SQL
// `app_key_titlecasable` denylist in migration 059 so behavior is identical
// between the bulk-upload write path and the back-fill UPDATE.
const KEY_SKIP_RE = /(^|_)(vin|email|mail|phone|mobile|tel|cli|zip|postal|url|link|website|password|reference|ref_no|refno|code|id|sku)($|_)/i;

// Same value-shape guards: don't re-case URLs, emails, phone/zip-shaped
// strings, or VIN-shaped tokens even if the key was generic.
function valueLooksIdentifierish(v) {
  const s = String(v);
  if (!s) return true;
  if (s.includes('@')) return true;
  if (/^https?:\/\//.test(s)) return true;
  if (/^[0-9+()\-\s.]+$/.test(s)) return true;
  if (/^[A-HJ-NPR-Z0-9]{17}$/.test(s)) return true;
  if (!/[a-zA-Z]/.test(s)) return true;
  return false;
}

// Title-case string values inside a flat object (form_data shape) where the
// key isn't identifier-like and the value isn't shaped like an identifier.
// Non-string values pass through untouched.
function titleCaseFormData(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && !KEY_SKIP_RE.test(k) && !valueLooksIdentifierish(v)) {
      out[k] = titleCase(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

module.exports = { titleCase, titleCaseFormData };

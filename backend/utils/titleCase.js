// ============================================================================
// titleCase — server-side backstop for proper-casing customer / client names
// as they enter the DB. Frontend normalizes on type, but compliance edits,
// imports, and bulk uploads bypass that path, so write handlers run this
// before persisting. Matches the SQL `app_title_case` helper in migration 059.
// ============================================================================

// HTML entity decoder — bulk-upload + manual ingestion both sometimes
// receive form_data values where the spreadsheet (or upstream HTML form)
// left raw entities in the string ("Town &amp Countr Limited", "Smith
// &amp; Sons", "Tom &#39;Doc&#39; Jones"). Without this, the dirty
// strings get title-cased into the DB and stay forever. Decode only the
// most common entities — keep the regex tight so we never accidentally
// rewrite something that was meant as a literal "&amp" string.
const HTML_ENTITIES = {
  '&amp;': '&', '&AMP;': '&',
  '&quot;': '"', '&QUOT;': '"',
  '&apos;': "'", '&#39;':  "'",
  '&lt;':   '<', '&gt;':   '>',
  '&nbsp;': ' ',
  // Trailing-semicolon-missing variants — sheet exports drop them.
  '&amp':   '&',
  '&quot':  '"',
  '&apos':  "'",
};
function decodeEntities(s) {
  if (!s || typeof s !== 'string') return s;
  // Numeric refs (&#39; / &#x27;) handled inline.
  return s
    .replace(/&#x([0-9a-fA-F]+);?/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&[a-zA-Z]+;?/g, (m) => HTML_ENTITIES[m] ?? m);
}

function titleCase(input) {
  if (input == null) return input;
  const s = decodeEntities(String(input)).replace(/\s+/g, ' ').trim();
  if (!s) return s;
  return s
    .split(' ')
    .map(w => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// Identifier-shaped keys whose casing carries meaning. Mirrors the SQL
// `app_key_titlecasable` denylist in migration 059 so behavior is identical
// between the bulk-upload write path and the back-fill UPDATE.
const KEY_SKIP_RE = /(^|_)(vin|email|mail|phone|mobile|tel|cli|zip|postal|state|url|link|website|password|reference|ref_no|refno|policy|code|id|sku)($|_)/i;

// Same value-shape guards: don't re-case URLs, emails, phone/zip-shaped
// strings, or VIN-shaped tokens even if the key was generic.
function valueLooksIdentifierish(v) {
  const s = String(v).trim();
  if (!s) return true;
  if (s.includes('@')) return true;
  if (/^https?:\/\//.test(s)) return true;
  if (/^[0-9+()\-\s.]+$/.test(s)) return true;
  if (/^[A-HJ-NPR-Z0-9]{17}$/.test(s)) return true;
  if (!/[a-zA-Z]/.test(s)) return true;
  // Alphanumeric code — contains BOTH a letter and a digit (reference / policy
  // numbers, SKUs, "MBH4220SBN"). Casing carries meaning; never title-case.
  if (/[a-zA-Z]/.test(s) && /\d/.test(s)) return true;
  // A single uppercase token with no spaces (a code the user typed
  // deliberately, e.g. "MBHSBN", "REF-22/A"). Multi-word prose like a name
  // shouted in caps still gets cleaned up, since it contains spaces.
  if (!/\s/.test(s) && /^[A-Z][A-Z0-9._/\-]*$/.test(s)) return true;
  return false;
}

// Title-case string values inside a flat object (form_data shape) where the
// key isn't identifier-like and the value isn't shaped like an identifier.
// Non-string values pass through untouched.
function titleCaseFormData(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') {
      // HTML-entity decode unconditionally — entity-encoded text in any
      // string field (identifier or not) is always wrong. Title-casing
      // is still gated by the key/value identifier checks.
      const decoded = decodeEntities(v);
      out[k] = (!KEY_SKIP_RE.test(k) && !valueLooksIdentifierish(decoded))
        ? titleCase(decoded)
        : decoded;
    } else {
      out[k] = v;
    }
  }
  return out;
}

module.exports = { titleCase, titleCaseFormData, decodeEntities };

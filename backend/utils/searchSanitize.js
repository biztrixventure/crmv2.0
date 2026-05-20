/**
 * Sanitize user-provided values that get interpolated into PostgREST `.or()` filter strings.
 *
 * PostgREST uses these characters as syntax inside an `.or()` filter:
 *   `,` — separates filter clauses
 *   `(` `)` — group clauses
 *   `*` — wildcard in URL (becomes %)
 *   `"` `\` — escape/quote characters
 *
 * Allowing user input to contain these characters lets a caller inject additional
 * filter clauses, breaking row-level scoping. Strip them before interpolation.
 */
function escapeOrValue(v) {
  return String(v ?? '').replace(/[,()*"\\]/g, '');
}

/**
 * Stricter UUID check — returns the value only if it matches the UUID v4 shape,
 * otherwise null. Use for query-string IDs that get interpolated into filters
 * without express-validator running.
 */
function safeUuid(v) {
  const s = String(v ?? '');
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
}

module.exports = { escapeOrValue, safeUuid };

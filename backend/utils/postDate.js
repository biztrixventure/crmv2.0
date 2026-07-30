/*
 * postDate.js — the ONE definition of "this sale is an un-charged post-date".
 *
 * A post-dated sale is a REMINDER, not a sale. The card has not been charged.
 * It sits in the closer's Post Date tab until the chosen day, when the closer
 * calls the customer and either takes the payment (→ it becomes a real sale) or
 * records why it failed and picks a new date.
 *
 * Until that charge happens it must not be counted as a sale ANYWHERE. Three
 * surfaces already knew this and each re-implemented the test by hand:
 *   routes/compliance.js  — `exclude_post_date` on All Sales + the review Queue
 *   routes/portal.js      — `isPostDate()`, sales-only client portal
 *   mig 161               — the recording-review queue
 * …and the stat counters knew nothing about it, so `todaySales` /
 * `monthClosedWon` / quota / SPIFF happily counted money nobody had collected.
 * This module is that shared test, so the next surface inherits it instead of
 * forgetting it.
 *
 * ── WHY A STRING MATCH ──────────────────────────────────────────────────────
 * There is no is_post_date flag. A sale is post-dated iff its
 * closer_disposition matches /post[\s_-]?date|postdate/i — the disposition
 * value comes from the live form_fields options, so the frontend resolves which
 * option is "the post-date one" at render time (isPostDateDispo in
 * frontend/src/utils/dispositions.js). Keep the two regexes identical.
 *
 * ── THE NULL TRAP (read before touching excludePostDate) ────────────────────
 * `q.not('closer_disposition','ilike','%post%date%')` compiles to
 * `NOT (col ILIKE …)`, which is NULL — not TRUE — when the column is NULL, so
 * PostgREST drops every sale with no disposition set. That is most of the
 * table. The .or(is.null, not.ilike) form below is the NULL-safe one and is
 * exactly what compliance.js already uses.
 */

// ILIKE pattern equivalent of the regex. '%post%date%' also catches
// 'post_date', 'post-date', 'Post Date', 'postdate'.
const POST_DATE_ILIKE = '%post%date%';

// PostgREST .or() clause: keep rows with no disposition, drop post-dates.
const POST_DATE_OR = 'closer_disposition.is.null,closer_disposition.not.ilike.%post%date%';

// Is this disposition VALUE the post-date one? (string test, no DB)
const isPostDateDispo = (d) => /post[\s_-]?date|postdate/i.test(String(d || ''));

/**
 * Drop un-charged post-dated sales from a PostgREST `sales` query.
 * NULL-safe. Chainable. Charged post-dates have already had their disposition
 * flipped to 'sale', so they are kept — which is the whole point.
 */
const excludePostDate = (q) => q.or(POST_DATE_OR);

module.exports = { POST_DATE_ILIKE, POST_DATE_OR, isPostDateDispo, excludePostDate };

-- ============================================================================
-- 327_dialer_box_catalog.sql
--
-- The Dialer column filter is a tick-list, not a text box: nobody should have
-- to already know that the prefix is spelled "WTI" to ask for WaveTech's
-- transfers. This view is where that list comes from.
--
-- It is derived from the DATA, not from a hardcoded vocabulary, because there
-- are three separate sources of a box name and they drift:
--   * utils/dialerBoxes.js config  — only the boxes still being polled
--   * fn_dialer_box (mig 325)      — the prefixes it recognizes
--   * the rows themselves          — includes OAT (2) and INB (16), historical
--                                    prefixes no live box claims any more
-- A list built from either of the first two would silently omit boxes that
-- really are in the table, and a filter that cannot name a value is worse than
-- no filter: it reads as "there are none".
--
-- Two index-only scans over idx_transfers_dialer_box / idx_sales_dialer_box.
-- The route caches the result, so this runs about once every few minutes.
-- ============================================================================

CREATE OR REPLACE VIEW app_dialer_boxes AS
SELECT box, sum(n)::bigint AS records
FROM (
  SELECT dialer_box AS box, count(*) AS n
    FROM transfers WHERE dialer_box IS NOT NULL GROUP BY 1
  UNION ALL
  SELECT dialer_box AS box, count(*) AS n
    FROM sales     WHERE dialer_box IS NOT NULL GROUP BY 1
) s
GROUP BY box
ORDER BY records DESC, box;

-- Same posture as every other app_* view (mig 176): service_role only. The
-- backend reads it with the service key and hands the browser the names.
REVOKE ALL ON app_dialer_boxes FROM anon, authenticated;
GRANT SELECT ON app_dialer_boxes TO service_role;

-- ============================================================================
-- 292_repair_blanked_transfer_names.sql
--
-- Repairs the transfers left showing the literal word "Lead" instead of a
-- customer, which is what routes/vicidial.js renders when both customer_name
-- and FirstName are empty.
--
-- TWO THINGS PUT THEM IN THAT STATE:
--
--  1. The overwrite introduced in a775261 (2026-08-14). When a fronter
--     re-transferred a recycled lead, /fronter-xfer updated the EARLIER row and
--     merged the incoming payload over its form_data. A dialer XFER whose
--     first/last tokens are empty therefore wrote nulls straight over a name the
--     row already had. Fixed at source in 9b79a16 (blanks are stripped now, and
--     a re-transfer inserts its own row instead of editing the old one).
--
--  2. The dialer simply having no name on the lead. Measured across 30 days:
--     16.5% of never-overwritten rows have no name vs 16.3% of overwritten ones
--     — statistically identical, so most blanks were never damage at all, they
--     arrived blank. Roughly one XFER in six carries empty name tokens.
--
-- Cause (1) is not separable from cause (2) after the fact — the overwrite left
-- no record of what it replaced. It does not need to be: the repair is the same
-- either way and is safe for both, because it only ever FILLS a blank.
--
-- METHOD: for each transfer with no FirstName, find that same customer's most
-- recent transfer IN THE SAME COMPANY that does have one, and copy across only
-- the blank fields. Never overwrites a value the row already holds. Company
-- scoped so a name can never cross a tenant boundary — the identical phone can
-- sit in another company's leads, and copying between them would leak one
-- company's data onto another's dashboard. Measured cost of that scope on the
-- live data: 926 of 965 otherwise-repairable rows still repair.
--
-- Expected: ~926 rows updated (90-day window, measured 2026-08-23).
--
-- REVERSIBLE: every row's original form_data is copied to
-- transfers_name_backfill_292 first. To undo:
--   UPDATE transfers t SET form_data = b.old_form_data
--   FROM transfers_name_backfill_292 b WHERE b.id = t.id;
-- ============================================================================

-- Only the customer-identity and vehicle fields a fronter XFER would have
-- carried. Deliberately NOT "everything the donor row has" — a donor can hold
-- sale-stage or hand-entered keys that do not belong on a different transfer.
CREATE TEMP TABLE _fill_keys(k text) ON COMMIT DROP;
INSERT INTO _fill_keys(k) VALUES
  ('FirstName'), ('LastName'), ('customer_name'),
  ('CarMake'), ('CarModel'), ('CarYear'), ('Miles'), ('Condition'),
  ('Address'), ('City'), ('State'), ('Zip'), ('Email');

-- Strip JSON nulls and empty strings. A key present but blank must not win over
-- the donor's real value — that blank is precisely what we are repairing.
CREATE OR REPLACE FUNCTION pg_temp.strip_blank(j jsonb) RETURNS jsonb AS $$
  SELECT coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
  FROM jsonb_each(coalesce(j, '{}'::jsonb)) AS e(k, v)
  WHERE v <> 'null'::jsonb
    AND btrim(CASE WHEN jsonb_typeof(v) = 'string' THEN v #>> '{}' ELSE v::text END) <> '';
$$ LANGUAGE sql IMMUTABLE;

CREATE TABLE IF NOT EXISTS transfers_name_backfill_292 (
  id            uuid PRIMARY KEY,
  old_form_data jsonb,
  donor_id      uuid,
  backfilled_at timestamptz NOT NULL DEFAULT now()
);

WITH target AS (
  SELECT t.id, t.company_id, t.normalized_phone, t.form_data
  FROM transfers t
  WHERE t.normalized_phone IS NOT NULL
    AND nullif(btrim(coalesce(t.form_data->>'FirstName', '')), '') IS NULL
    AND t.created_at >= now() - interval '90 days'
),
donor AS (
  SELECT tg.id, tg.form_data AS old_form_data,
         d.id AS donor_id, d.form_data AS donor_form_data
  FROM target tg
  CROSS JOIN LATERAL (
    SELECT s.id, s.form_data
    FROM transfers s
    WHERE s.normalized_phone = tg.normalized_phone
      AND s.company_id       = tg.company_id
      AND s.id <> tg.id
      AND nullif(btrim(coalesce(s.form_data->>'FirstName', '')), '') IS NOT NULL
    ORDER BY s.created_at DESC
    LIMIT 1
  ) d
),
prepared AS (
  SELECT dn.id, dn.old_form_data, dn.donor_id,
         -- donor values restricted to the safe key list, blanks stripped
         (SELECT coalesce(jsonb_object_agg(e.k, e.v), '{}'::jsonb)
          FROM jsonb_each(pg_temp.strip_blank(dn.donor_form_data)) AS e(k, v)
          WHERE e.k IN (SELECT k FROM _fill_keys)) AS donor_slice,
         pg_temp.strip_blank(dn.old_form_data) AS target_clean
  FROM donor dn
),
final AS (
  SELECT p.id, p.old_form_data, p.donor_id,
         -- base keeps the row's own shape; donor_slice fills the blanks;
         -- target_clean puts the row's own REAL values back on top, so nothing
         -- the transfer already knew is ever replaced by the donor.
         (p.old_form_data || p.donor_slice || p.target_clean) AS merged
  FROM prepared p
  WHERE p.donor_slice <> '{}'::jsonb
),
withname AS (
  SELECT f.id, f.old_form_data, f.donor_id,
         CASE
           WHEN nullif(btrim(coalesce(f.merged->>'customer_name', '')), '') IS NOT NULL
             THEN f.merged
           ELSE f.merged || jsonb_build_object('customer_name',
                  nullif(btrim(concat_ws(' ', f.merged->>'FirstName', f.merged->>'LastName')), ''))
         END AS merged
  FROM final f
),
saved AS (
  INSERT INTO transfers_name_backfill_292 (id, old_form_data, donor_id)
  SELECT w.id, w.old_form_data, w.donor_id FROM withname w
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
UPDATE transfers t
SET form_data = w.merged
FROM withname w
WHERE t.id = w.id
  AND w.merged IS DISTINCT FROM t.form_data;

INSERT INTO schema_migrations (filename, note)
VALUES ('292_repair_blanked_transfer_names.sql',
        'backfilled blank customer name/vehicle fields on transfers from the same customer''s most recent named transfer in the SAME company; originals saved to transfers_name_backfill_292 for rollback')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- Verify after applying:
--   SELECT count(*) FROM transfers_name_backfill_292;                  -- rows repaired
--   SELECT count(*) FROM transfers
--    WHERE vicidial_vendor_code IS NOT NULL
--      AND created_at >= now() - interval '90 days'
--      AND nullif(btrim(coalesce(form_data->>'FirstName','')),'') IS NULL;   -- remaining blanks

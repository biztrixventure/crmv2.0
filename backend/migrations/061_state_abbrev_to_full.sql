-- ============================================================================
-- 061_state_abbrev_to_full.sql
--
-- Convert 2-letter USPS state abbreviations to full state names everywhere a
-- "state" field lives: the direct callbacks.customer_state column, and any
-- JSONB form_data key whose name matches /^state$/ or *_state on transfers
-- and sales. Covers all 50 states + DC + 5 US territories (PR, VI, GU, AS, MP).
--
-- Safe:
--   * Only touches values that are EXACTLY 2 alphabetic chars (after trim).
--   * Anything already full ("New York"), partial, numeric, or unknown is left
--     alone. No data loss.
--   * Idempotent — re-running converts nothing on the second pass.
--   * Audit-log snapshots are NOT rewritten.
-- ============================================================================

-- ── helpers ─────────────────────────────────────────────────────────────────

-- Map a 2-letter abbreviation (case-insensitive) to its full name. Returns
-- NULL on unknown input so callers can fall back to the original value.
CREATE OR REPLACE FUNCTION app_state_expand(abbr text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE upper(trim(abbr))
    WHEN 'AL' THEN 'Alabama'        WHEN 'AK' THEN 'Alaska'
    WHEN 'AZ' THEN 'Arizona'        WHEN 'AR' THEN 'Arkansas'
    WHEN 'CA' THEN 'California'     WHEN 'CO' THEN 'Colorado'
    WHEN 'CT' THEN 'Connecticut'    WHEN 'DE' THEN 'Delaware'
    WHEN 'FL' THEN 'Florida'        WHEN 'GA' THEN 'Georgia'
    WHEN 'HI' THEN 'Hawaii'         WHEN 'ID' THEN 'Idaho'
    WHEN 'IL' THEN 'Illinois'       WHEN 'IN' THEN 'Indiana'
    WHEN 'IA' THEN 'Iowa'           WHEN 'KS' THEN 'Kansas'
    WHEN 'KY' THEN 'Kentucky'       WHEN 'LA' THEN 'Louisiana'
    WHEN 'ME' THEN 'Maine'          WHEN 'MD' THEN 'Maryland'
    WHEN 'MA' THEN 'Massachusetts'  WHEN 'MI' THEN 'Michigan'
    WHEN 'MN' THEN 'Minnesota'      WHEN 'MS' THEN 'Mississippi'
    WHEN 'MO' THEN 'Missouri'       WHEN 'MT' THEN 'Montana'
    WHEN 'NE' THEN 'Nebraska'       WHEN 'NV' THEN 'Nevada'
    WHEN 'NH' THEN 'New Hampshire'  WHEN 'NJ' THEN 'New Jersey'
    WHEN 'NM' THEN 'New Mexico'     WHEN 'NY' THEN 'New York'
    WHEN 'NC' THEN 'North Carolina' WHEN 'ND' THEN 'North Dakota'
    WHEN 'OH' THEN 'Ohio'           WHEN 'OK' THEN 'Oklahoma'
    WHEN 'OR' THEN 'Oregon'         WHEN 'PA' THEN 'Pennsylvania'
    WHEN 'RI' THEN 'Rhode Island'   WHEN 'SC' THEN 'South Carolina'
    WHEN 'SD' THEN 'South Dakota'   WHEN 'TN' THEN 'Tennessee'
    WHEN 'TX' THEN 'Texas'          WHEN 'UT' THEN 'Utah'
    WHEN 'VT' THEN 'Vermont'        WHEN 'VA' THEN 'Virginia'
    WHEN 'WA' THEN 'Washington'     WHEN 'WV' THEN 'West Virginia'
    WHEN 'WI' THEN 'Wisconsin'      WHEN 'WY' THEN 'Wyoming'
    WHEN 'DC' THEN 'District of Columbia'
    WHEN 'PR' THEN 'Puerto Rico'    WHEN 'VI' THEN 'U.S. Virgin Islands'
    WHEN 'GU' THEN 'Guam'           WHEN 'AS' THEN 'American Samoa'
    WHEN 'MP' THEN 'Northern Mariana Islands'
    ELSE NULL
  END;
$$;

-- Public entry: return the expanded full name if the input is a known 2-letter
-- abbreviation, otherwise return the input unchanged. Used as the UPDATE
-- right-hand side so unknown / already-full values pass through untouched.
CREATE OR REPLACE FUNCTION app_state_normalize(val text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  expanded text;
BEGIN
  IF val IS NULL OR trim(val) = '' THEN RETURN val; END IF;
  IF trim(val) !~ '^[A-Za-z]{2}$' THEN RETURN val; END IF;   -- not a 2-letter code
  expanded := app_state_expand(val);
  RETURN COALESCE(expanded, val);
END;
$$;

-- Walk a flat JSONB object and normalize string values under keys whose name
-- is "state" or ends in "_state" / "_State" (covers customer_state,
-- billing_state, etc.). Non-string and non-state keys pass through.
CREATE OR REPLACE FUNCTION app_state_normalize_jsonb(data jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  k       text;
  v       jsonb;
  s       text;
  result  jsonb := '{}'::jsonb;
BEGIN
  IF data IS NULL OR jsonb_typeof(data) <> 'object' THEN
    RETURN data;
  END IF;
  FOR k, v IN SELECT key, value FROM jsonb_each(data) LOOP
    IF jsonb_typeof(v) = 'string' AND lower(k) ~ '(^|_)state$' THEN
      s := v #>> '{}';
      result := result || jsonb_build_object(k, app_state_normalize(s));
    ELSE
      result := result || jsonb_build_object(k, v);
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

-- ── apply to existing data ──────────────────────────────────────────────────

-- callbacks: direct customer_state column (set by zip lookup → typically full
-- name already, but older imports may carry 2-letter codes).
UPDATE callbacks
SET    customer_state = app_state_normalize(customer_state)
WHERE  customer_state IS NOT NULL
  AND  customer_state IS DISTINCT FROM app_state_normalize(customer_state);

-- transfers.form_data: walk JSONB and expand any state keys.
UPDATE transfers
SET    form_data = app_state_normalize_jsonb(form_data)
WHERE  form_data IS NOT NULL
  AND  form_data IS DISTINCT FROM app_state_normalize_jsonb(form_data);

-- sales.form_data: same walk.
UPDATE sales
SET    form_data = app_state_normalize_jsonb(form_data)
WHERE  form_data IS NOT NULL
  AND  form_data IS DISTINCT FROM app_state_normalize_jsonb(form_data);

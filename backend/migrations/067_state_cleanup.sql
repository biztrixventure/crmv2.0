-- ============================================================================
-- 067_state_cleanup.sql
--
-- Backfill cleanup for the Data Analyzer state filter gap. Production survey
-- showed 5175 transfers but "select all states" returned 4157 — 1018 rows
-- carried customer_state values the in.(canonical) filter couldn't match:
--   * 883 rows = "-"   (placeholder dash, never a real state)
--   * ~50 rows = pure digits ("33","16","75",…) — zip-prefix junk pasted into
--                the wrong field on a long-ago form
--   * 4 rows  = "District Of Columbia" (capitalization variant — canonical is
--               "District of Columbia" with lowercase "of")
--   * 1 row   = "Taxas" (typo for Texas)
--   * 5 rows  = customer_state key missing entirely (legit, no fix)
--
-- This migration:
--   1. Canonicalizes case-insensitively against the 50-states + DC list, so
--      "DISTRICT OF COLUMBIA", "florida", "NeW YoRk", "District Of Columbia"
--      all collapse to the canonical spelling.
--   2. Fixes the one known typo ("Taxas" → "Texas").
--   3. Blanks placeholder + numeric junk to NULL so the "Unspecified" chip
--      (frontend, this commit) can surface them as a distinct bucket instead
--      of silently dropping them from every state filter.
--
-- Touches transfers.form_data + sales.form_data. Reuses 061's
-- app_state_normalize (2-letter → full) before the case-canonical pass so
-- "fl" / "FL" also flow through correctly.
-- ============================================================================

-- Case-insensitive canonical lookup. Returns the canonical spelling when the
-- input matches a real state (any casing); returns the input unchanged when
-- it doesn't. NULL/blank pass through.
CREATE OR REPLACE FUNCTION app_state_canonicalize(val text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  t text;
BEGIN
  IF val IS NULL THEN RETURN NULL; END IF;
  t := trim(val);
  IF t = '' THEN RETURN NULL; END IF;

  -- First-pass: 2-letter expansion (reuses 061). "FL" → "Florida".
  t := app_state_normalize(t);

  -- Single-character typo fix that survived the wild: "Taxas" → "Texas".
  IF lower(t) = 'taxas' THEN RETURN 'Texas'; END IF;

  RETURN CASE lower(t)
    WHEN 'alabama' THEN 'Alabama'                     WHEN 'alaska' THEN 'Alaska'
    WHEN 'arizona' THEN 'Arizona'                     WHEN 'arkansas' THEN 'Arkansas'
    WHEN 'california' THEN 'California'               WHEN 'colorado' THEN 'Colorado'
    WHEN 'connecticut' THEN 'Connecticut'             WHEN 'delaware' THEN 'Delaware'
    WHEN 'florida' THEN 'Florida'                     WHEN 'georgia' THEN 'Georgia'
    WHEN 'hawaii' THEN 'Hawaii'                       WHEN 'idaho' THEN 'Idaho'
    WHEN 'illinois' THEN 'Illinois'                   WHEN 'indiana' THEN 'Indiana'
    WHEN 'iowa' THEN 'Iowa'                           WHEN 'kansas' THEN 'Kansas'
    WHEN 'kentucky' THEN 'Kentucky'                   WHEN 'louisiana' THEN 'Louisiana'
    WHEN 'maine' THEN 'Maine'                         WHEN 'maryland' THEN 'Maryland'
    WHEN 'massachusetts' THEN 'Massachusetts'         WHEN 'michigan' THEN 'Michigan'
    WHEN 'minnesota' THEN 'Minnesota'                 WHEN 'mississippi' THEN 'Mississippi'
    WHEN 'missouri' THEN 'Missouri'                   WHEN 'montana' THEN 'Montana'
    WHEN 'nebraska' THEN 'Nebraska'                   WHEN 'nevada' THEN 'Nevada'
    WHEN 'new hampshire' THEN 'New Hampshire'         WHEN 'new jersey' THEN 'New Jersey'
    WHEN 'new mexico' THEN 'New Mexico'               WHEN 'new york' THEN 'New York'
    WHEN 'north carolina' THEN 'North Carolina'       WHEN 'north dakota' THEN 'North Dakota'
    WHEN 'ohio' THEN 'Ohio'                           WHEN 'oklahoma' THEN 'Oklahoma'
    WHEN 'oregon' THEN 'Oregon'                       WHEN 'pennsylvania' THEN 'Pennsylvania'
    WHEN 'rhode island' THEN 'Rhode Island'           WHEN 'south carolina' THEN 'South Carolina'
    WHEN 'south dakota' THEN 'South Dakota'           WHEN 'tennessee' THEN 'Tennessee'
    WHEN 'texas' THEN 'Texas'                         WHEN 'utah' THEN 'Utah'
    WHEN 'vermont' THEN 'Vermont'                     WHEN 'virginia' THEN 'Virginia'
    WHEN 'washington' THEN 'Washington'               WHEN 'west virginia' THEN 'West Virginia'
    WHEN 'wisconsin' THEN 'Wisconsin'                 WHEN 'wyoming' THEN 'Wyoming'
    WHEN 'district of columbia' THEN 'District of Columbia'
    WHEN 'puerto rico' THEN 'Puerto Rico'
    WHEN 'u.s. virgin islands' THEN 'U.S. Virgin Islands'
    WHEN 'guam' THEN 'Guam'                           WHEN 'american samoa' THEN 'American Samoa'
    WHEN 'northern mariana islands' THEN 'Northern Mariana Islands'
    ELSE t   -- not a canonical state; let the junk-detector decide what to do with it
  END;
END;
$$;

-- "Junk" detector. Returns TRUE when a value can't possibly be a real state
-- and should be blanked to NULL so the Unspecified bucket can surface it.
CREATE OR REPLACE FUNCTION app_state_is_junk(val text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT val IS NOT NULL AND (
    trim(val) = ''               OR   -- empty after trim
    trim(val) ~ '^-+$'           OR   -- placeholder dashes
    trim(val) ~ '^[0-9]+$'       OR   -- pure-digit junk (zip prefix etc.)
    length(trim(val)) < 2             -- single char garbage
  );
$$;

-- Combined transformer. Returns NULL for junk, canonical for known states,
-- the value itself otherwise. Used as the right-hand side of the UPDATEs
-- below so unknown-but-not-junk values (e.g. "Ontario" if someone enters a
-- Canadian province) pass through untouched.
CREATE OR REPLACE FUNCTION app_state_clean(val text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN app_state_is_junk(val) THEN NULL
    ELSE app_state_canonicalize(val)
  END;
$$;

-- JSONB walker that applies app_state_clean to every key matching /(^|_)state$/i
-- on a flat form_data object. Skips non-string values. Sets the field to JSON
-- null when the cleaner returns NULL so the "is.null" filter catches them.
CREATE OR REPLACE FUNCTION app_clean_states_jsonb(data jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  k       text;
  v       jsonb;
  s       text;
  cleaned text;
  result  jsonb := '{}'::jsonb;
BEGIN
  IF data IS NULL OR jsonb_typeof(data) <> 'object' THEN RETURN data; END IF;
  FOR k, v IN SELECT key, value FROM jsonb_each(data) LOOP
    IF jsonb_typeof(v) = 'string' AND lower(k) ~ '(^|_)state$' THEN
      s := v #>> '{}';
      cleaned := app_state_clean(s);
      IF cleaned IS NULL THEN
        result := result || jsonb_build_object(k, 'null'::jsonb);
      ELSE
        result := result || jsonb_build_object(k, to_jsonb(cleaned));
      END IF;
    ELSE
      result := result || jsonb_build_object(k, v);
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

-- Apply
UPDATE transfers
SET    form_data = app_clean_states_jsonb(form_data)
WHERE  form_data IS NOT NULL
  AND  form_data IS DISTINCT FROM app_clean_states_jsonb(form_data);

UPDATE sales
SET    form_data = app_clean_states_jsonb(form_data)
WHERE  form_data IS NOT NULL
  AND  form_data IS DISTINCT FROM app_clean_states_jsonb(form_data);

-- callbacks has a typed customer_state column — same cleaner.
UPDATE callbacks
SET    customer_state = app_state_clean(customer_state)
WHERE  customer_state IS NOT NULL
  AND  customer_state IS DISTINCT FROM app_state_clean(customer_state);

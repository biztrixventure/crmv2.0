-- ============================================================================
-- 059_title_case_form_data.sql
--
-- Normalize existing user-entered text values to title case so reports group
-- cleanly: "john doe" → "John Doe", "NEW YORK" → "New York". Applies to JSONB
-- form_data on transfers + sales, plus the vehicle registry. Skips fields and
-- values that must keep their original case (VIN, email, phone, reference
-- codes, identifiers, URLs).
--
-- Safe to re-run: title-casing a value that is already title-cased is a no-op,
-- and the UPDATE filters with `IS DISTINCT FROM` so unchanged rows are skipped.
-- ============================================================================

-- ── helpers ─────────────────────────────────────────────────────────────────

-- "john doe" / "JOHN DOE" / " john   doe " → "John Doe". Splits on whitespace,
-- capitalizes first char of every token, collapses runs of whitespace to one
-- space. Leaves empty / null input untouched.
CREATE OR REPLACE FUNCTION app_title_case(input text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  word     text;
  result   text := '';
  is_first boolean := true;
BEGIN
  IF input IS NULL OR length(trim(input)) = 0 THEN
    RETURN input;
  END IF;
  FOREACH word IN ARRAY regexp_split_to_array(trim(input), '\s+') LOOP
    IF length(word) = 0 THEN CONTINUE; END IF;
    IF NOT is_first THEN result := result || ' '; END IF;
    result := result || upper(substr(word, 1, 1)) || lower(substr(word, 2));
    is_first := false;
  END LOOP;
  RETURN result;
END;
$$;

-- Decide whether a JSONB key name is safe to title-case. Returns FALSE for
-- identifier-like keys whose casing carries meaning (VIN, email, phone, etc.)
CREATE OR REPLACE FUNCTION app_key_titlecasable(key_name text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT NOT (
    lower(key_name) ~ '(^|_)(vin|email|mail|phone|mobile|tel|cli|zip|postal|url|link|website|password|reference|ref_no|refno|code|id|sku)($|_)'
  );
$$;

-- Decide whether a string value is safe to title-case. Guards against re-
-- casing data that LOOKS like an identifier even when the key name was generic
-- ("notes" containing a URL, "info" containing an email, etc.).
CREATE OR REPLACE FUNCTION app_value_titlecasable(val text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT
    val IS NOT NULL
    AND length(trim(val)) > 0
    AND position('@' in val) = 0                          -- emails
    AND val !~ '^https?://'                               -- URLs
    AND val !~ '^[0-9+()\-\s.]+$'                         -- phone/zip-shaped
    AND val !~ '^[A-HJ-NPR-Z0-9]{17}$'                    -- VIN
    AND val ~ '[a-zA-Z]';                                 -- has letters at all
$$;

-- Walk a JSONB object one level deep, title-casing string values whose keys
-- and values both pass the safety filters. Non-string values pass through
-- untouched; nested objects/arrays pass through untouched (form_data is flat
-- per the form_fields contract).
CREATE OR REPLACE FUNCTION app_titlecase_jsonb(data jsonb)
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
    IF jsonb_typeof(v) = 'string'
       AND app_key_titlecasable(k)
    THEN
      s := v #>> '{}';
      IF app_value_titlecasable(s) THEN
        result := result || jsonb_build_object(k, app_title_case(s));
      ELSE
        result := result || jsonb_build_object(k, v);
      END IF;
    ELSE
      result := result || jsonb_build_object(k, v);
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

-- ── apply to existing data ──────────────────────────────────────────────────

UPDATE transfers
SET    form_data = app_titlecase_jsonb(form_data)
WHERE  form_data IS NOT NULL
  AND  form_data IS DISTINCT FROM app_titlecase_jsonb(form_data);

UPDATE sales
SET    form_data = app_titlecase_jsonb(form_data)
WHERE  form_data IS NOT NULL
  AND  form_data IS DISTINCT FROM app_titlecase_jsonb(form_data);

-- Vehicle registry: clean any non-title-case entries so the typeahead matches
-- what new submissions land as.
UPDATE vehicle_makes
SET    name = app_title_case(name)
WHERE  name IS DISTINCT FROM app_title_case(name);

UPDATE vehicle_models
SET    name = app_title_case(name)
WHERE  name IS DISTINCT FROM app_title_case(name);

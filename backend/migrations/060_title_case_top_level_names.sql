-- ============================================================================
-- 060_title_case_top_level_names.sql
--
-- 059 covered JSONB form_data. This sweep covers the denormalized top-level
-- name columns that the sales / callbacks / number-lists schema mirrors out
-- of form_data for fast indexing and search. Reuses the helpers defined in
-- 059, so run 059 first.
--
-- Skips audit log snapshots (callback_audit_log.customer_name_snapshot,
-- callback_number_history payload) — those preserve identity of deleted /
-- mutated rows for compliance review and must not be rewritten.
-- ============================================================================

-- sales: customer_name + client_name (closer's customer + originating client)
UPDATE sales
SET    customer_name = app_title_case(customer_name)
WHERE  customer_name IS NOT NULL
  AND  customer_name IS DISTINCT FROM app_title_case(customer_name);

UPDATE sales
SET    client_name = app_title_case(client_name)
WHERE  client_name IS NOT NULL
  AND  client_name IS DISTINCT FROM app_title_case(client_name);

-- callbacks: live customer_name (snapshots in audit table intentionally skipped)
UPDATE callbacks
SET    customer_name = app_title_case(customer_name)
WHERE  customer_name IS NOT NULL
  AND  customer_name IS DISTINCT FROM app_title_case(customer_name);

-- callback_numbers: per-number contact name
UPDATE callback_numbers
SET    customer_name = app_title_case(customer_name)
WHERE  customer_name IS NOT NULL
  AND  customer_name IS DISTINCT FROM app_title_case(customer_name);

-- number_lists: assigned phone-list contacts
UPDATE number_lists
SET    customer_name = app_title_case(customer_name)
WHERE  customer_name IS NOT NULL
  AND  customer_name IS DISTINCT FROM app_title_case(customer_name);

-- user_profiles: staff display names
UPDATE user_profiles
SET    first_name = app_title_case(first_name)
WHERE  first_name IS NOT NULL
  AND  first_name IS DISTINCT FROM app_title_case(first_name);

UPDATE user_profiles
SET    last_name = app_title_case(last_name)
WHERE  last_name IS NOT NULL
  AND  last_name IS DISTINCT FROM app_title_case(last_name);

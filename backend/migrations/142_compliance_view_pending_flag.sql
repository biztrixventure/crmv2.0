-- ============================================================================
-- 142_compliance_view_pending_flag.sql
-- Expose vicidial_pending on the compliance transfer view so compliance can hide
-- UNCONFIRMED dialer transfers (the blank "lead_id + phone only" rows that the
-- fronter hasn't confirmed yet) — exactly like the normal transfer list already
-- does (transfers.js: "pending from dialer rows are not real transfers yet …
-- hide them from every normal list + count until the fronter confirms").
--
-- Real transfers carry their own flag; synthetic 'refresh' duplicate rows are
-- always false (a refresh is a duplicate of an already-real transfer). Column is
-- appended last so CREATE OR REPLACE VIEW is accepted.
-- ============================================================================
CREATE OR REPLACE VIEW v_compliance_transfer_records AS
  SELECT
    t.id,
    t.company_id,
    t.created_by,
    t.assigned_to,
    t.assigned_closer_id,
    t.form_data,
    t.status,
    t.normalized_phone,
    t.rejected_by,
    t.rejection_reason,
    t.rejected_at,
    t.rejection_count,
    t.edit_history,
    t.upload_batch_id,
    t.last_modified_by,
    t.customer_uuid,
    t.created_at,
    t.updated_at,
    'transfer'::text   AS record_type,
    NULL::uuid         AS dedup_event_id,
    NULL::uuid         AS refreshed_transfer_id,
    NULL::text         AS duplicate_event_type,
    COALESCE(t.vicidial_pending, false) AS vicidial_pending
  FROM transfers t

  UNION ALL

  SELECT
    de.id,
    de.company_id,
    de.fronter_id                       AS created_by,
    pt.assigned_to,
    pt.assigned_closer_id,
    pt.form_data,
    COALESCE(pt.status, 'assigned')     AS status,
    COALESCE(de.normalized_phone, pt.normalized_phone)  AS normalized_phone,
    NULL::uuid                          AS rejected_by,
    NULL::text                          AS rejection_reason,
    NULL::timestamptz                   AS rejected_at,
    NULL::integer                       AS rejection_count,
    NULL::jsonb                         AS edit_history,
    NULL::uuid                          AS upload_batch_id,
    NULL::uuid                          AS last_modified_by,
    pt.customer_uuid,
    de.created_at,
    de.created_at                       AS updated_at,
    'duplicate_refresh'::text           AS record_type,
    de.id                               AS dedup_event_id,
    de.transfer_id                      AS refreshed_transfer_id,
    de.event_type                       AS duplicate_event_type,
    false                               AS vicidial_pending
  FROM transfer_dedup_events de
  LEFT JOIN transfers pt ON pt.id = de.transfer_id
  WHERE de.event_type = 'refresh';

GRANT SELECT ON v_compliance_transfer_records TO service_role, authenticated, anon;
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- 321_compliance_view_dialer_columns.sql
-- Show WHICH DIALER a record came from in the compliance list.
--
-- v_compliance_transfer_records (migration 089) names its columns explicitly,
-- so the dialer_* columns migration 320 added to `transfers` do not appear in
-- it — compliance would be the one surface that could not tell a CallTools
-- transfer from a VICIdial one, which is exactly where someone reconciling
-- numbers needs to know.
--
-- The three columns are APPENDED (CREATE OR REPLACE VIEW can only add at the
-- end), so every existing consumer keeps its column positions.
--
-- The synthetic "duplicate_refresh" rows inherit the parent transfer's dialer:
-- a dedup event is a second attempt at the SAME call, so it came from wherever
-- that call did. With no parent it falls back to 'vicidial', which is what
-- every pre-320 row is.
--
-- Apply in the Supabase SQL editor. Idempotent.
-- ============================================================================

CREATE OR REPLACE VIEW v_compliance_transfer_records AS
 SELECT t.id,
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
    'transfer'::text AS record_type,
    NULL::uuid AS dedup_event_id,
    NULL::uuid AS refreshed_transfer_id,
    NULL::text AS duplicate_event_type,
    t.vicidial_pending,
    t.dialer_ghost,
    t.dialer_provider,
    t.dialer_account_id,
    t.dialer_call_id
   FROM transfers t
UNION ALL
 SELECT de.id,
    de.company_id,
    de.fronter_id AS created_by,
    pt.assigned_to,
    pt.assigned_closer_id,
    pt.form_data,
    COALESCE(pt.status, 'assigned'::transfer_status) AS status,
    COALESCE(de.normalized_phone, pt.normalized_phone) AS normalized_phone,
    NULL::uuid AS rejected_by,
    NULL::text AS rejection_reason,
    NULL::timestamp with time zone AS rejected_at,
    NULL::integer AS rejection_count,
    NULL::jsonb AS edit_history,
    NULL::uuid AS upload_batch_id,
    NULL::uuid AS last_modified_by,
    pt.customer_uuid,
    de.created_at,
    de.created_at AS updated_at,
    'duplicate_refresh'::text AS record_type,
    de.id AS dedup_event_id,
    de.transfer_id AS refreshed_transfer_id,
    de.event_type AS duplicate_event_type,
    pt.vicidial_pending,
    false AS dialer_ghost,
    COALESCE(pt.dialer_provider, 'vicidial'::text) AS dialer_provider,
    pt.dialer_account_id,
    pt.dialer_call_id
   FROM transfer_dedup_events de
     LEFT JOIN transfers pt ON pt.id = de.transfer_id
  WHERE de.event_type = 'refresh'::text;

INSERT INTO schema_migrations (filename, note)
VALUES ('321_compliance_view_dialer_columns.sql', 'Compliance transfer view carries dialer_provider/account/call id (mig 320)')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';

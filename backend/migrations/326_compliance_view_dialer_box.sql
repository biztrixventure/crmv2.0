-- ============================================================================
-- 326_compliance_view_dialer_box.sql
--
-- Mig 325 put `dialer_box` on transfers (WTI / TMC / ETC / INB / OAT, or a
-- connected account's own name). The compliance tab does NOT read `transfers`
-- — it reads v_compliance_transfer_records, and that view names every column
-- explicitly, so an ALTER TABLE never reaches it. Same trap as mig 321, which
-- had to do this for the other three dialer columns.
--
-- Without this the Dialer column on Compliance -> Transfers filters on a column
-- the view does not have (42703 -> 500 -> blank tab) and the badge can only say
-- "VICIdial" where every other surface says "WTI".
--
-- CREATE OR REPLACE, not DROP: it keeps the mig 176 REVOKE anon grants. Adding
-- columns at the END of the select list is the one shape Postgres allows to be
-- replaced in place, which is why dialer_box lands last on both legs.
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
    t.dialer_call_id,
    t.dialer_box
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
    -- A dedup row is a second attempt at a transfer that already exists, so it
    -- belongs to whatever dialer the PARENT belongs to. The pre-320 rows have
    -- no parent provider at all and those are all VICIdial by definition.
    COALESCE(pt.dialer_provider, 'vicidial'::text) AS dialer_provider,
    pt.dialer_account_id,
    pt.dialer_call_id,
    pt.dialer_box
   FROM transfer_dedup_events de
     LEFT JOIN transfers pt ON pt.id = de.transfer_id
  WHERE de.event_type = 'refresh'::text;

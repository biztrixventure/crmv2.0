-- ============================================================================
-- 089_compliance_transfer_records_view.sql
-- Makes EVERY VICIDIAL transfer attempt visible to compliance — including the
-- duplicate attempts that update a lead in place and never become their own row.
--
-- Background: when a fronter re-submits a phone they already transferred, the
-- dedup logic (transfers.js) does one of three things and logs it in
-- transfer_dedup_events:
--   • reengage / sale_overlap → a NEW transfer row is inserted (already visible
--     to compliance, already flagged is_duplicate).
--   • refresh (within the dedup window) → the EXISTING transfer is UPDATED in
--     place. No new row. Invisible to compliance, and not counted — this is the
--     source of the "CRM transfers < VICIDIAL transfers" discrepancy.
--
-- This view exposes both real transfers and the otherwise-invisible 'refresh'
-- events as one uniform record set, so the compliance transfers list, counts,
-- and CSV export reconcile 1:1 with VICIDIAL. A 'refresh' row borrows the
-- refreshed lead's customer fields (form_data / phone / company) so it reads
-- like the transfer it duplicated, dated to when the duplicate attempt happened.
--
-- reengage / sale_overlap are intentionally NOT synthesized here — they are
-- already real rows in `transfers`; duplicating them would double-count.
--
-- Read-only view. No data change. Safe to re-run.
-- ============================================================================

CREATE OR REPLACE VIEW v_compliance_transfer_records AS
  -- ── Real transfers (unchanged shape) ──────────────────────────────────────
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
    NULL::text         AS duplicate_event_type
  FROM transfers t

  UNION ALL

  -- ── 'refresh' duplicate attempts as synthetic records ─────────────────────
  SELECT
    de.id,                                              -- synthetic record id = event id
    de.company_id,
    de.fronter_id                       AS created_by,
    pt.assigned_to,
    pt.assigned_closer_id,
    pt.form_data,                                       -- borrow the refreshed lead's fields
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
    de.created_at,                                      -- when the duplicate attempt happened
    de.created_at                       AS updated_at,
    'duplicate_refresh'::text           AS record_type,
    de.id                               AS dedup_event_id,
    de.transfer_id                      AS refreshed_transfer_id,
    de.event_type                       AS duplicate_event_type
  FROM transfer_dedup_events de
  LEFT JOIN transfers pt ON pt.id = de.transfer_id
  WHERE de.event_type = 'refresh';

COMMENT ON VIEW v_compliance_transfer_records IS
  'Compliance reconciliation view: real transfers UNION refresh dedup events as synthetic rows, so every VICIDIAL transfer attempt (including in-place duplicate refreshes) is one visible, countable, exportable record. record_type = transfer | duplicate_refresh.';

-- Service role (used by the backend) + the PostgREST roles need read access.
GRANT SELECT ON v_compliance_transfer_records TO service_role, authenticated, anon;

-- Ask PostgREST to pick up the new view immediately (Supabase also auto-reloads
-- on DDL; this is belt-and-suspenders so the API exposes it without a restart).
NOTIFY pgrst, 'reload schema';

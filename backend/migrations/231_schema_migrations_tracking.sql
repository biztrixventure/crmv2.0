-- ============================================================================
-- 231_schema_migrations_tracking.sql
-- Migration apply tracking. 242 migration files existed with zero record of
-- what actually ran against this database — every apply has been manual,
-- copy-pasted into the Supabase SQL editor, with no ledger. This is Task 0 of
-- the QA v2 build brief: before adding ~15 new qa2_* tables, get a source of
-- truth for "has this file been applied" so QA v2's migrations — and every
-- migration after them — self-register on apply instead of relying on memory.
--
-- Backfill note: the 242 filenames that existed before this migration are
-- inserted with applied_at = now() (their TRUE original apply timestamps were
-- never recorded anywhere, so this is a presence marker, not real history)
-- and a 'note' flagging them as backfilled. This migration then registers
-- ITSELF live, not backfilled — that's the pattern every migration from here
-- on follows: end the file with a self-registering INSERT so tracking never
-- drifts from what's actually been run.
--
-- Internal ops table — no anon/authenticated access, service_role only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  note        text
);

REVOKE ALL ON public.schema_migrations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.schema_migrations TO service_role;

-- Backfill every migration file that existed before this one.
INSERT INTO schema_migrations (filename, note)
SELECT f, 'backfilled — applied before tracking existed (mig 231)'
FROM unnest(ARRAY[
  '000_complete_setup.sql','000_test_setup.sql','001_create_schema.sql',
  '002_enable_rls_policies.sql','003_seed_data.sql','003_update_role_levels.sql',
  '004_sale_fields_and_notifications.sql','005_sale_configs_and_search.sql',
  '006_callbacks_and_push.sql','007_roles_transfers_compliance.sql',
  '007a_schema_changes.sql','007b_seed_data.sql','008a_closer_pool_reviews.sql',
  '008b_seed_closer_pool.sql','009_compliance_workflow.sql','009_form_fronter_flag.sql',
  '010_company_types_links.sql','011_number_lists.sql','012_field_type_text.sql',
  '013_cleanup_superadmin_roles.sql','014_user_permission_overrides.sql',
  '015_callback_numbers.sql','016_missing_permissions_and_defaults.sql',
  '017_update_blp_role_permissions.sql','018_fix_role_permission_gaps.sql',
  '019_cleanup_and_fix_perms.sql','020_feature_flags.sql',
  '021_per_company_feature_flags.sql','022_add_timezone_to_callbacks.sql',
  '023_callback_number_history.sql','023b_backfill_callback_number_history.sql',
  '024_callback_audit_log.sql','025_disposition_activity_log.sql',
  '026_notification_dedup.sql','027_closer_disposition.sql','027_company_slug.sql',
  '027_remove_orphan_sales.sql','028_callback_history.sql','028_callback_priority.sql',
  '029_callbacks_answering_machine_status.sql','029_lead_events.sql',
  '030_disposition_configs.sql','031_timezone_support.sql',
  '032_disposition_setter_role.sql','033_number_lists_enhancements.sql',
  '034_form_templates.sql','035_form_fields_fixes.sql','036_multi_car_sales.sql',
  '037_callback_priority_rank.sql','038_faqs.sql','039_faq_scripts.sql',
  '040_standalone_scripts.sql','041_bulk_upload.sql','042_bulk_sale_upload.sql',
  '043_announcements_marquee_spiff.sql','044_announcement_reshow_richtext.sql',
  '045_chat.sql','046_chat_reactions.sql','047_chat_moderation_actions.sql',
  '048_transfer_normalized_phone.sql','049_events.sql',
  '050_chat_groups_richtext_attachments.sql','051_chat_group_management.sql',
  '052_performance_indexes.sql','053_raise_max_rows.sql',
  '054_assistant_feature_flag.sql','055_search_tools.sql','056_script_sections.sql',
  '057_spiff_metric_source.sql','058_vehicles.sql','059_title_case_form_data.sql',
  '060_title_case_top_level_names.sql','061_state_abbrev_to_full.sql',
  '062_title_case_city_backfill.sql','063_field_audit_log.sql',
  '064_audit_trigger_safe_actor.sql','065_user_preferences.sql',
  '066_company_theme_logos.sql','067_state_cleanup.sql','068_business_config.sql',
  '069_resell_columns.sql','070_drawer_layout.sql',
  '071_compliance_status_catalog.sql','072_transfer_dedup_events.sql',
  '073_transfer_status_catalog.sql','074_shell_layouts.sql',
  '075_sales_cancellation_date.sql','076_warranty_gaps.sql',
  '077_uniqueness_guards.sql','078_dedupe_reference_no.sql','079_customer_uuid.sql',
  '080_policy_number_unique.sql','081_vehicle_eligibility.sql',
  '082_compliance_batches_chat_styles.sql','083_sale_post_date_charge.sql',
  '084_user_presence_activity.sql','085_customer_uuid_on_transfers.sql',
  '086_transfer_assignments.sql','087_policy_events.sql','088_vin_active_policy.sql',
  '089_compliance_transfer_records_view.sql','090_revert_vin_active_enforcement.sql',
  '091_vin_active_reconcile.sql','092_perf_chat_and_indexes.sql',
  '093_data_cleanup_fn.sql','094_data_cleanup_history.sql',
  '095_script_faq_categories.sql','096_vicidial_integration.sql',
  '097_vicidial_dispo_map.sql','098_chat_message_reply.sql',
  '099_vicidial_closer_dispo_queue.sql','100_transfer_latest_disposition.sql',
  '101_vicidial_closer_assigned_status.sql','102_sales_miles_num.sql',
  '103_compliance_company_kpis_rpc.sql','104_trim_realtime_publication.sql',
  '105_realtime_keep_only_chat_notifs.sql','106_disposition_opens_sale_form.sql',
  '107_closer_dispo_queue_phone.sql','108_chat_guests.sql','109_call_checklist.sql',
  '110_vicidial_perf_indexes.sql','111_user_multi_agent_ids.sql',
  '112_vicidial_backfill_batches.sql','113_backfill_fill_code.sql',
  '114_backfill_apply_rpc.sql','115_scheduler_perf_index.sql',
  '116_client_portal.sql','117_closer_display_alias.sql',
  '118_portal_client_names.sql','119_dispo_actions_nullable_setter.sql',
  '120_vicidial_boxes.sql','121_uppercase_agent_ids.sql',
  '122_user_feature_flags.sql','123_exports_feature_flag.sql',
  '124_customer_segments.sql','125_customer_segments_score.sql',
  '126_admin_tool_flags.sql','127_custom_workspace_flag.sql',
  '128_workspace_surface_flags.sql','129_workspace_company_flag.sql',
  '130_transfer_crud_perms.sql','131_sale_crud_perms.sql',
  '132_callback_crud_perms.sql','133_review_perms.sql',
  '134_callback_number_perms.sql','135_role_crud_perms.sql','136_create_perms.sql',
  '137_customer_segments_matview.sql','138_payment_followups.sql',
  '139_customer_segments_phone_fallback.sql','140_customer_notes.sql',
  '141_record_search.sql','142_compliance_view_pending_flag.sql',
  '143_bulk_update_by_id.sql','144_bulk_apply_disposition.sql',
  '145_chat_message_controls.sql','146_blacklist_lookup.sql','147_sales_dnc.sql',
  '148_card_validator.sql','149_portal_recording_meta.sql',
  '150_sale_recording_confirmations.sql','151_recording_queue_v2.sql',
  '152_recording_queue_sort_search.sql','153_distribution_batches.sql',
  '154_recording_queue_typefix.sql','155_note_shortcodes.sql','156_batch_rules.sql',
  '157_recording_queue_count_page1.sql','158_batch_item_position.sql',
  '159_batch_roster.sql','160_recording_queue_any_code.sql',
  '161_recording_queue_exclude_postdate.sql','162_recording_queue_code_optional.sql',
  '163_recording_queue_recording_id_search.sql','164_internal_email.sql',
  '165_sale_group_id.sql','166_recording_queue_status_filter.sql',
  '167_data_egress_governance.sql','168_qa_role_levels.sql','169_qa_permissions.sql',
  '170_qa_schema.sql','171_qa_config.sql','172_qa_materialize_fns.sql',
  '173_qa_sheet_scorecards.sql','174_qa_assignment_recordings.sql',
  '175_payment_target_month.sql','176_security_revoke_anon_data.sql',
  '177_qa_retention.sql','178_fix_user_company_roles_recursion.sql',
  '179_close_authenticated_cross_tenant_leak.sql',
  '180_qa_agent_methods_and_enrichment.sql','181_qa_compliance_admin.sql',
  '182_revoke_anon_definer_funcs.sql',
  '183_drop_unused_transfers_phone_creator_idx.sql',
  '184_double_sold_customers_view.sql','185_qa_transcripts.sql',
  '186_qa_routing_rules.sql','187_pin_trigger_search_paths.sql',
  '188_trigger_functions_security_definer.sql','189_qa_crm_day_leadfill.sql',
  '190_resync_car_vin_from_formdata.sql','191_qa_scorecard_slots_closer_seed.sql',
  '192_qa_agent_methods_slots.sql','193_duplicate_sold_and_highlight.sql',
  '194_perf_fk_covering_indexes.sql','195_revoke_definer_rpc_exec.sql',
  '196_rls_initplan_wrap_auth.sql','197_vicidial_box_validation_url.sql',
  '198_qa_rcm_fronter_scorecard.sql','199_portal_recording_meta_unique.sql',
  '200_kanban_boards.sql','201_fronter_manager_edit_user.sql',
  '202_kanban_attachment_thumb.sql','203_qa_tra_fronter_scorecard.sql',
  '204_qa_generic_scorecard_names.sql','205_qa_rating_scale_1_to_5.sql',
  '206_qa_force_rating_1_to_5.sql','207_qa_tra_threshold_35.sql','208_qa_teams.sql',
  '209_readonly_governance.sql','210_egress_export_access.sql','211_teams.sql',
  '212_team_lead_edit.sql','213_hideable_form_options.sql',
  '214_sale_config_metadata.sql','215_staff_export_default_off.sql',
  '216_team_quotas.sql','217_team_lead_allocate.sql','218_quota_milestones.sql',
  '219_column_filter_indexes.sql','220_admin_profile_backfill.sql',
  '221_post_date_lifecycle.sql','222_postdate_pending_review_repair.sql',
  '223_compliance_manager_qa_scoring.sql','224_closer_dispo_scorecard_dedupe.sql',
  '225_tra_scorecard_dedupe.sql','226_qa_sheet_layouts_from_client_files.sql',
  '227_qa_manager_designation.sql','228_qa_perf_indexes.sql',
  '229_compliance_kpis_exclude_postdate.sql','230_duplicate_sold_vins.sql'
]) AS f
ON CONFLICT (filename) DO NOTHING;

-- This migration registers itself live, not backfilled — the first real
-- entry in the ledger, and the pattern every migration after it follows.
INSERT INTO schema_migrations (filename, note)
VALUES ('231_schema_migrations_tracking.sql', 'first live-recorded migration — tracking starts here')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';

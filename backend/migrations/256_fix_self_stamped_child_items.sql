-- ============================================================================
-- 256_fix_self_stamped_child_items.sql
-- Data repair for rows written before the assign fix.
--
-- `assigned_to` on a row means "handed to someone BELOW out of this batch";
-- ownership of the batch itself is distribution_batches.sent_to_user_id. The
-- first cut of POST /:id/assign stamped the recipient onto the CHILD rows too,
-- so every row in a manager's own batch looked already-dealt and they could pass
-- nothing to their fronters — the assign call 400'd with "every number in this
-- batch is already assigned".
--
-- Only untouched rows are reset; a real disposition stays exactly as it is.
-- The mirror trigger is disabled for the statement on purpose: mirroring 'new'
-- upward would clear the PARENT batch's legitimate assignment state.
-- Applied 2026-08-15 (100 rows across 2 child batches). Idempotent.
-- ============================================================================
ALTER TABLE distribution_batch_items DISABLE TRIGGER trg_mirror_item_status;

UPDATE distribution_batch_items i
   SET assigned_to = NULL, assigned_at = NULL, assigned_by = NULL,
       status = 'new', updated_at = now()
  FROM distribution_batches b
 WHERE b.id = i.batch_id
   AND b.parent_batch_id IS NOT NULL
   AND i.assigned_to = b.sent_to_user_id
   AND i.status = 'assigned';

ALTER TABLE distribution_batch_items ENABLE TRIGGER trg_mirror_item_status;

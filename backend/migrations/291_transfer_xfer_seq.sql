-- ============================================================================
-- 291_transfer_xfer_seq.sql
--
-- PROBLEM: when a fronter punches a SECOND XFER on a lead the dialer has
-- recycled, the CRM does not create a second transfer — it EDITS the first one.
--
-- uq_transfers_vicidial_code_creator (migration 250) allows exactly one row per
-- (vicidial_vendor_code, created_by). A VICIdial lead_id identifies a LEAD, not
-- a transfer EVENT, so the same fronter transferring the same customer again
-- next week carries the same code and collides with their own earlier row.
-- routes/vicidial.js therefore fell into its "already exists" branch and
-- updated the original transfer in place:
--
--   * the new transfer never appeared — the fronter saw no new card for a call
--     they really did make,
--   * resetIfStale() cleared the previous closer/status/dispo ON THE OLD ROW,
--     rewriting history that belonged to the earlier call, and
--   * on that reset the old row's form_data was merged with the incoming
--     payload, so a dialer XFER arriving without name tokens could blank fields
--     the earlier transfer already had.
--
-- FIX: keep the code, add an attempt counter. Uniqueness moves to
-- (vicidial_vendor_code, created_by, xfer_seq), so the same fronter can hold
-- as many transfers of a recycled lead as they actually made, each its own row,
-- and NO existing row is ever edited to make room for a new one.
--
-- vicidial_vendor_code itself is UNCHANGED — still the plain box-prefixed code
-- (WTI2340056). Nothing downstream has to learn a new format: every code-based
-- lookup in routes/vicidial.js already reads
--   .order('created_at', desc).limit(1)
-- (the property migration 250 documented and relied on), so a closer's
-- disposition resolves to the NEWEST transfer of that lead — today's call —
-- exactly as it should. Verified before writing this migration: all six
-- code-based lookups (lines 428, 507, 606, 624, 636, 830) order-and-limit; none
-- assumes a single row.
--
-- SAFE TO APPLY: xfer_seq defaults to 1, so every existing row becomes seq 1 and
-- already satisfies the new index (the old two-column key was unique, therefore
-- the three-column key is too). No row changes value. The index build cannot
-- fail on existing data.
-- ============================================================================

ALTER TABLE public.transfers
  ADD COLUMN IF NOT EXISTS xfer_seq INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.transfers.xfer_seq IS
  'Which transfer attempt this is for (vicidial_vendor_code, created_by). 1 = first time this fronter transferred this lead; 2+ = the dialer recycled the lead and they transferred it again. Lets a recycled lead produce a NEW transfer instead of overwriting the earlier one.';

-- Replace the two-column key with the three-column one. Both are partial on
-- "code IS NOT NULL" so hand-entered (code-less) transfers stay unconstrained.
DROP INDEX IF EXISTS uq_transfers_vicidial_code_creator;

CREATE UNIQUE INDEX IF NOT EXISTS uq_transfers_vicidial_code_creator_seq
  ON public.transfers (vicidial_vendor_code, created_by, xfer_seq)
  WHERE vicidial_vendor_code IS NOT NULL;

-- Hot path: /fronter-xfer computes the next seq with
-- MAX(xfer_seq) WHERE code = ? AND created_by = ?. The unique index above
-- already covers that prefix, so no additional index is needed.

INSERT INTO schema_migrations (filename, note)
VALUES ('291_transfer_xfer_seq.sql',
        'transfers.xfer_seq + unique (vicidial_vendor_code, created_by, xfer_seq) so a re-transferred recycled lead creates a NEW transfer instead of overwriting the fronter''s earlier one')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';

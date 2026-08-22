-- ============================================================================
-- 271_transfers_dialer_ghost.sql
-- Separate "do not prompt the fronter" from "do not count it as a transfer".
--
-- Both were riding on vicidial_pending, and that overload caused a regression I
-- introduced: migrations 267/270 cleared the flag on cards armed by a
-- non-transfer disposition, which correctly removed the bogus prompts — and
-- silently promoted those rows into every transfer count, because the counting
-- helpers exclude exactly `vicidial_pending = true` and nothing else.
--
-- Mubeen Jabbar's 21 August in compliance shows the shape precisely. Eight rows
-- listed, four real:
--   Lakisha  · closer Aqib Amir          · assigned   <- real
--   Bobby    · closer M. Abdullah Aftab  · assigned   <- real
--   Barbara  · closer Fahad Butt         · assigned   <- real
--   Carlos   · closer M. Ahad            · assigned   <- real
--   (no name)· no closer · GH   Greeting Hangup       <- ghost
--   (no name)· no closer · DAIR Dead Air              <- ghost
--   (no name)· no closer · CHU  Cx Hang up            <- ghost
--   (no name)· no closer · WI   Wrong Info By CRO     <- ghost
--
-- The discriminator is the CUSTOMER NAME. A genuine XFER carries the customer's
-- details; a row armed by the recycled-lead re-arm path has only a phone number.
-- Checked against 30 days: of 1,061 rows with no customer name, 338 have a
-- closer and 9 became sales — real transfers with a blank name — and requiring
-- "no closer, no sale" excludes every one of them.
--
-- Marked as ghosts: no customer name, no closer, no sale, still status
-- 'pending', and the dialer's own dispo present and NOT a transfer dispo. 260
-- rows. NOT marked: the 686 rows with no dialer dispo yet — a genuine XFER
-- awaiting confirmation looks exactly like that, and zero rows in the whole
-- table combine "no name" with an XFER dispo, so the guard costs nothing.
--
-- Nothing is deleted. The rows stay, with their history, flagged as what they
-- are.
-- ============================================================================
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS dialer_ghost boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN transfers.dialer_ghost IS
  'True when the row was armed by the dialer re-arm path and was never a real transfer: no customer details, no closer, no sale, and the dialer reported a non-transfer disposition. Excluded from transfer counts and lists; kept for audit.';

UPDATE transfers t
   SET dialer_ghost = true
 WHERE t.dialer_ghost = false
   AND t.status = 'pending'
   AND t.assigned_closer_id IS NULL
   AND t.vicidial_dispo IS NOT NULL
   AND upper(t.vicidial_dispo) <> 'XFER'
   AND nullif(trim(coalesce(t.form_data->>'customer_name',
                            t.form_data->>'FirstName',
                            t.form_data->>'Name', '')), '') IS NULL
   AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.transfer_id = t.id);

CREATE INDEX IF NOT EXISTS idx_transfers_dialer_ghost ON transfers (company_id, created_at DESC)
  WHERE dialer_ghost = false;

-- ── expose the flag on the compliance view ─────────────────────────────────
-- A view freezes its column list at creation, so adding the column to the table
-- was not enough: compliance reads v_compliance_transfer_records and was still
-- listing all eight of Mubeen Jabbar's 21 August rows. Recreated with
-- dialer_ghost carried through. Synthetic 'refresh' records report false — they
-- represent a real duplicate attempt against an existing lead, not a ghost.
-- (Applied as its own step; see the repo history for the full view body.)

-- ============================================================================
-- 259_qa2_boxless_merge.sql
-- Second duplicate family, found while pairing legs (258). The CRM transfer
-- path creates a qa2_call row with NO box_id — it knows the transfer and the
-- agent but not which dialer the call lives on. The sweep then ingests the SAME
-- call from the dialer with a real box_id and lead_id. Result: two rows per
-- call, and the recording can only ever attach to the boxed one (the poller
-- searches by box + lead_id). Measured over 30 days: 1,039 boxless closer rows,
-- ZERO with a recording, 764 sharing a transfer_id with a boxed twin.
--
-- The damage was not cosmetic: it blocked leg pairing. A boxless row would
-- claim the fronter leg first (pairing takes the first unclaimed counterpart),
-- leaving the boxed row — the one that actually holds the recording — unpaired.
-- 770 of the 1,086 unpaired closers had a fronter sitting right there, taken.
--
-- Merge rule: a boxless row folds into a boxed row of the SAME leg matched on
-- transfer_id, else on phone within ±2h. Evaluations, assignments and listen
-- logs are repointed before the delete (their FKs cascade). Rows with no boxed
-- twin are left alone — those are calls the dialer sweep genuinely never saw.
-- Idempotent.
-- ============================================================================
CREATE TEMP TABLE _qa2_boxless AS
SELECT n.id,
       COALESCE(
         (SELECT b.id FROM qa2_call b
           WHERE b.box_id IS NOT NULL AND b.leg = n.leg
             AND b.transfer_id IS NOT NULL AND b.transfer_id = n.transfer_id
           ORDER BY (b.recording_state = 'found') DESC, b.call_at LIMIT 1),
         (SELECT b.id FROM qa2_call b
           WHERE b.box_id IS NOT NULL AND b.leg = n.leg
             AND b.normalized_phone IS NOT NULL AND b.normalized_phone = n.normalized_phone
             AND b.call_at BETWEEN n.call_at - interval '2 hours' AND n.call_at + interval '2 hours'
           ORDER BY (b.recording_state = 'found') DESC,
                    abs(extract(epoch FROM (b.call_at - n.call_at))) LIMIT 1)
       ) AS keeper
  FROM qa2_call n
 WHERE n.box_id IS NULL AND n.leg IS NOT NULL AND n.call_at IS NOT NULL;

DELETE FROM _qa2_boxless WHERE keeper IS NULL;

-- Carry the CRM's own knowledge onto the survivor before dropping the row: the
-- boxless row is the one that knew the transfer / sale / company / agent.
UPDATE qa2_call k SET
  transfer_id   = COALESCE(k.transfer_id,   n.transfer_id),
  sale_id       = COALESCE(k.sale_id,       n.sale_id),
  company_id    = COALESCE(k.company_id,    n.company_id),
  agent_user_id = COALESCE(k.agent_user_id, n.agent_user_id),
  dispo_raw     = COALESCE(k.dispo_raw,     n.dispo_raw)
FROM _qa2_boxless d JOIN qa2_call n ON n.id = d.id
WHERE k.id = d.keeper;

UPDATE qa2_evaluation e SET call_id = d.keeper FROM _qa2_boxless d WHERE e.call_id = d.id;
UPDATE qa2_assignment a SET call_id = d.keeper FROM _qa2_boxless d WHERE a.call_id = d.id;
UPDATE qa2_listen_log l SET call_id = d.keeper FROM _qa2_boxless d WHERE l.call_id = d.id;

-- Free any leg link the doomed row was holding, so the survivor can claim it.
UPDATE qa2_call o SET linked_call_id = NULL
 WHERE o.linked_call_id IN (SELECT id FROM _qa2_boxless);

DELETE FROM qa2_call c USING _qa2_boxless d WHERE c.id = d.id;

-- Re-pair with the duplicates out of the way.
SELECT * FROM app_qa2_pair_legs(30);

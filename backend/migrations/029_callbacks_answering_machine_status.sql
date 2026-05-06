-- Migration 029: add 'answering_machine' to callbacks.status CHECK constraint
-- The original constraint in 006_callbacks_and_push.sql only included
-- ('pending','completed','cancelled','no_answer'), causing DB rejection
-- when status is set to 'answering_machine'.

ALTER TABLE callbacks DROP CONSTRAINT IF EXISTS callbacks_status_check;

ALTER TABLE callbacks
  ADD CONSTRAINT callbacks_status_check
  CHECK (status IN ('pending', 'completed', 'cancelled', 'no_answer', 'answering_machine'));

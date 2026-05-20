-- 037_callback_priority_rank.sql
-- Global sorting by priority needs a numeric rank: High > Medium > Low.
-- The text column sorts alphabetically (High, Low, Medium) which is wrong, so
-- add a generated rank column the API can ORDER BY across the whole dataset.

ALTER TABLE callbacks
  ADD COLUMN IF NOT EXISTS priority_rank smallint
  GENERATED ALWAYS AS (
    CASE priority
      WHEN 'High'   THEN 3
      WHEN 'Medium' THEN 2
      WHEN 'Low'    THEN 1
      ELSE 0
    END
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_callbacks_priority_rank ON callbacks(priority_rank);

-- 024: Callback status-change audit log
-- ON DELETE SET NULL so log rows survive callback deletion.
-- customer_name_snapshot / customer_phone_snapshot preserve identity after deletion.

CREATE TABLE IF NOT EXISTS callback_audit_log (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  callback_id             UUID        REFERENCES callbacks(id) ON DELETE SET NULL,
  company_id              UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  actor_id                UUID,                              -- NULL = system / unknown
  old_status              TEXT,                              -- NULL on first-ever log entry
  new_status              TEXT        NOT NULL,
  notes                   TEXT,                              -- outcome note entered by agent
  customer_name_snapshot  TEXT,                              -- preserved after deletion
  customer_phone_snapshot TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cal_callback ON callback_audit_log (callback_id);
CREATE INDEX IF NOT EXISTS idx_cal_company  ON callback_audit_log (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cal_actor    ON callback_audit_log (actor_id);

-- Verification
SELECT action, COUNT(*) FROM callback_audit_log GROUP BY action;

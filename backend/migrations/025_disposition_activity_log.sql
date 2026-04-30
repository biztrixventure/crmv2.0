-- 025: Disposition activity log
-- Tracks every disposition set/update by any actor (closer, manager override).
-- ON DELETE SET NULL on user_id so log rows survive user deletion.
-- metadata JSONB stores customer snapshot (preserved after transfer deletion).

CREATE TABLE IF NOT EXISTS activity_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID        REFERENCES companies(id) ON DELETE CASCADE,
  user_id     UUID,                              -- NULL = system
  action      TEXT        NOT NULL,              -- 'disposition_set' | 'disposition_updated' | 'transfer_reassigned'
  entity_type TEXT        NOT NULL DEFAULT 'transfer',
  entity_id   UUID,
  old_value   JSONB,                             -- NULL on first set
  new_value   JSONB       NOT NULL,
  metadata    JSONB,                             -- { customer_name, customer_phone, role }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_al_company  ON activity_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_al_user     ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_al_entity   ON activity_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_al_action   ON activity_logs(action);

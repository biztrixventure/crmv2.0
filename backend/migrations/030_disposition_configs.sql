-- 030_disposition_configs.sql
-- Configurable disposition options shown to closers in phone search alongside the Sale button.
-- Each option has custom notification routing (roles, fronter, fronter manager).
-- disposition_actions records every submission by a closer.

CREATE TABLE IF NOT EXISTS disposition_configs (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             UUID        REFERENCES companies(id) ON DELETE CASCADE,
  name                   TEXT        NOT NULL,
  color                  TEXT        NOT NULL DEFAULT '#6b7280',
  description            TEXT,
  notify_roles           TEXT[]      NOT NULL DEFAULT '{}',
  notify_fronter         BOOLEAN     NOT NULL DEFAULT false,
  notify_fronter_manager BOOLEAN     NOT NULL DEFAULT false,
  requires_note          BOOLEAN     NOT NULL DEFAULT false,
  is_active              BOOLEAN     NOT NULL DEFAULT true,
  sort_order             INTEGER     NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS disposition_actions (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id           UUID        NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  company_id            UUID        REFERENCES companies(id),
  user_id               UUID        NOT NULL,
  disposition_config_id UUID        REFERENCES disposition_configs(id) ON DELETE SET NULL,
  disposition_name      TEXT        NOT NULL,
  color                 TEXT        NOT NULL DEFAULT '#6b7280',
  note                  TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disp_configs_company  ON disposition_configs(company_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_disp_actions_transfer ON disposition_actions(transfer_id);
CREATE INDEX IF NOT EXISTS idx_disp_actions_user     ON disposition_actions(user_id);
CREATE INDEX IF NOT EXISTS idx_disp_actions_company  ON disposition_actions(company_id);
CREATE INDEX IF NOT EXISTS idx_disp_actions_created  ON disposition_actions(created_at DESC);

-- Seed global defaults (company_id = NULL → available to all companies)
INSERT INTO disposition_configs (company_id, name, color, notify_roles, notify_fronter, notify_fronter_manager, requires_note, sort_order)
VALUES
  (NULL, 'Not Interested', '#dc2626', ARRAY['closer_manager'],                       false, false, false, 0),
  (NULL, 'No Sale',        '#6b7280', ARRAY['closer_manager'],                       false, false, false, 1),
  (NULL, 'Callback',       '#d97706', ARRAY['closer_manager'],                       true,  true,  false, 2),
  (NULL, 'Voicemail',      '#8b5cf6', ARRAY['closer_manager'],                       false, false, false, 3),
  (NULL, 'Not Qualified',  '#ef4444', ARRAY['closer_manager','operations_manager'],  true,  false, true,  4)
ON CONFLICT DO NOTHING;

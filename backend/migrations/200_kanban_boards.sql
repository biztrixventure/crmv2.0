-- ============================================================================
-- 200 — Kanban task boards (temporary, no-login collaboration; kan.bn-style).
--
-- A superadmin creates a board and shares its link (share_token). Anyone with
-- the link can view + edit — no account. The visitor is asked their name once
-- (kept client-side, stamped onto what they create). Few users, temporary use.
--
-- All access goes through the service-role backend (routes/kanban.js), which
-- validates the share_token in app code — so RLS is ON with NO anon policy
-- (deny-all for anon/authenticated; service role bypasses). Same posture as
-- mig 176. Images are stored as base64 data URLs on kanban_attachments (small
-- team, temporary — no storage bucket needed); board fetches never ship the
-- bytes (only a per-card count), attachments load on card open.
-- ============================================================================

CREATE TABLE IF NOT EXISTS kanban_boards (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  share_token  text UNIQUE NOT NULL,
  created_by   uuid,
  archived     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kanban_columns (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id   uuid NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
  title      text NOT NULL,
  position   double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kanban_columns_board ON kanban_columns(board_id);

CREATE TABLE IF NOT EXISTS kanban_cards (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id        uuid NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
  column_id       uuid NOT NULL REFERENCES kanban_columns(id) ON DELETE CASCADE,
  title           text NOT NULL,
  description     text,
  tags            jsonb NOT NULL DEFAULT '[]'::jsonb,
  position        double precision NOT NULL DEFAULT 0,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kanban_cards_board  ON kanban_cards(board_id);
CREATE INDEX IF NOT EXISTS idx_kanban_cards_column ON kanban_cards(column_id);

CREATE TABLE IF NOT EXISTS kanban_attachments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id         uuid NOT NULL REFERENCES kanban_cards(id) ON DELETE CASCADE,
  board_id        uuid NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
  name            text,
  data_url        text NOT NULL,          -- base64 image (annotation flattened in)
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kanban_attach_card ON kanban_attachments(card_id);

ALTER TABLE kanban_boards      ENABLE ROW LEVEL SECURITY;
ALTER TABLE kanban_columns     ENABLE ROW LEVEL SECURITY;
ALTER TABLE kanban_cards       ENABLE ROW LEVEL SECURITY;
ALTER TABLE kanban_attachments ENABLE ROW LEVEL SECURITY;

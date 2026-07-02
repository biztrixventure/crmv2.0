-- ============================================================================
-- 164_internal_email.sql
-- Internal email between CRM users (no external addresses). Send / receive /
-- threads / drafts / trash, tiered templates, per-user signatures.
--
-- Design decisions (mirroring existing infra — see routes/emails.js):
--   * Realtime: NOT added to the supabase_realtime publication. Mig 105 trimmed
--     the publication to messages+notifications because WAL decode was ~72% of
--     DB time; new-email alerts ride the notifications channel via notifyUsers
--     (already published) and the client refetches on that event.
--   * Attachments: jsonb on the email row + 'email-attachments' storage bucket —
--     the exact chat pattern (mig 050). No separate attachments table.
--   * BCC: recipient rows are only readable through the route-side
--     visibleRecipients() helper (sender sees all; a recipient sees to/cc + own
--     row only). Drafts keep recipients in draft_recipients jsonb — recipient
--     rows are created ONLY at send, so drafts can never leak.
--   * email_recipients.sent_at is DENORMALIZED from the email so the inbox is
--     one index scan: (user_id, folder, sent_at DESC) — no join-then-sort.
--   * Bulk send (fan-out) groups its N emails by bulk_group_id for the sender's
--     collapsed Sent view. A plain multi-recipient email is NOT bulk.
--   * Templates mirror note_shortcodes (mig 155) exactly: personal / company /
--     global via owner_user_id / company_id, partial unique indexes on name.
--
-- RLS: enabled with NO policies — all access is server-side via the service
-- role (which bypasses RLS); anon/authenticated PostgREST access is denied.
-- Idempotent; apply once after 163.
-- ============================================================================

-- ── threads ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_threads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject       text NOT NULL DEFAULT '',            -- original subject (replies keep thread)
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_email_at timestamptz NOT NULL DEFAULT now()   -- bumped by the send route
);

-- ── emails ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS emails (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id        uuid REFERENCES email_threads(id) ON DELETE CASCADE,
  sender_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  company_id       uuid REFERENCES companies(id) ON DELETE SET NULL,  -- sender's company at send time
  reply_to_email_id uuid REFERENCES emails(id) ON DELETE SET NULL,    -- which email this replies to / forwards
  subject          text NOT NULL DEFAULT '',
  body_html        text,                              -- scrubbed server-side, DOMPurify on render
  body_text        text,                              -- plain preview / search / push text
  attachments      jsonb,                             -- [{ url, name, type, size, kind }] (chat pattern)
  status           text NOT NULL DEFAULT 'sent' CHECK (status IN ('draft','sent')),
  is_forward       boolean NOT NULL DEFAULT false,
  bulk_group_id    uuid,                              -- set on every email of one fan-out blast
  draft_recipients jsonb,                             -- draft-only: { to: [ids], cc: [ids], bcc: [ids] }
  sender_folder    text NOT NULL DEFAULT 'sent' CHECK (sender_folder IN ('sent','trash')),
  sent_at          timestamptz,                       -- null while draft
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Sent list: my sent mail, newest first (partial: drafts/trash excluded cheaply).
CREATE INDEX IF NOT EXISTS idx_emails_sender_sent
  ON emails (sender_id, sent_at DESC) WHERE status = 'sent';
-- Drafts list.
CREATE INDEX IF NOT EXISTS idx_emails_sender_drafts
  ON emails (sender_id, updated_at DESC) WHERE status = 'draft';
-- Thread view.
CREATE INDEX IF NOT EXISTS idx_emails_thread ON emails (thread_id, sent_at ASC);
-- Sent-view blast collapsing.
CREATE INDEX IF NOT EXISTS idx_emails_bulk_group ON emails (bulk_group_id) WHERE bulk_group_id IS NOT NULL;

-- ── per-recipient state (folder + read) ─────────────────────────────────────
-- One row per (email, recipient). kind='bcc' rows are NEVER returned to other
-- recipients (enforced in visibleRecipients()). folder is per-recipient —
-- trashing my copy doesn't touch anyone else's.
CREATE TABLE IF NOT EXISTS email_recipients (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id  uuid NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind      text NOT NULL DEFAULT 'to' CHECK (kind IN ('to','cc','bcc')),
  folder    text NOT NULL DEFAULT 'inbox' CHECK (folder IN ('inbox','trash')),
  read_at   timestamptz,
  sent_at   timestamptz NOT NULL DEFAULT now(),  -- denormalized from the email (inbox sort)
  UNIQUE (email_id, user_id)
);

-- THE inbox query: WHERE user_id=$1 AND folder=$2 ORDER BY sent_at DESC LIMIT n
-- → single index scan, no sort node.
CREATE INDEX IF NOT EXISTS idx_email_rcpt_user_folder
  ON email_recipients (user_id, folder, sent_at DESC);
-- Unread badge: head count on (user, inbox, unread) without scanning read rows.
CREATE INDEX IF NOT EXISTS idx_email_rcpt_unread
  ON email_recipients (user_id) WHERE folder = 'inbox' AND read_at IS NULL;
-- Reverse lookup (visibleRecipients / thread view).
CREATE INDEX IF NOT EXISTS idx_email_rcpt_email ON email_recipients (email_id);

-- ── templates (mirror of note_shortcodes' tier model, mig 155) ───────────────
CREATE TABLE IF NOT EXISTS email_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,  -- personal tier
  company_id    uuid REFERENCES companies(id) ON DELETE CASCADE,   -- company tier (owner NULL)
  name          text NOT NULL,                                     -- picker label
  subject       text NOT NULL DEFAULT '',
  body_html     text NOT NULL DEFAULT '',
  sort_order    int  NOT NULL DEFAULT 0,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- One name per scope (same partial-unique pattern as 155).
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_tpl_personal ON email_templates(owner_user_id, name) WHERE owner_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_tpl_company  ON email_templates(company_id, name)    WHERE company_id IS NOT NULL AND owner_user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_tpl_global   ON email_templates(name)                WHERE company_id IS NULL     AND owner_user_id IS NULL;
CREATE INDEX        IF NOT EXISTS idx_email_tpl_owner   ON email_templates(owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX        IF NOT EXISTS idx_email_tpl_company ON email_templates(company_id);

-- ── signatures (one active per user — PK enforces) ───────────────────────────
CREATE TABLE IF NOT EXISTS email_signatures (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  body_html  text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── RLS: deny client access; service role (backend) bypasses ─────────────────
ALTER TABLE email_threads    ENABLE ROW LEVEL SECURITY;
ALTER TABLE emails           ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_templates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_signatures ENABLE ROW LEVEL SECURITY;

-- ── storage bucket for attachments (exact chat pattern, mig 050) ─────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('email-attachments', 'email-attachments', true)
ON CONFLICT (id) DO NOTHING;

-- ── feature flag (chat pattern: catalog row, default ON) ─────────────────────
INSERT INTO feature_flags (key, name, description, default_enabled)
VALUES ('internal_email', 'Internal Email', 'CRM-internal email between users: inbox, threads, templates, signatures.', true)
ON CONFLICT (key) DO NOTHING;

-- ── post-apply verification (paste separately after applying) ────────────────
-- 1) Tables + indexes exist:
--    SELECT tablename FROM pg_tables WHERE tablename LIKE 'email%';
--    SELECT indexname FROM pg_indexes WHERE tablename IN
--      ('emails','email_recipients','email_threads','email_templates');
-- 2) Inbox plan (meaningful once rows exist — planner seq-scans tiny tables):
--    EXPLAIN ANALYZE
--    SELECT r.email_id, r.kind, r.read_at, r.sent_at
--    FROM email_recipients r
--    WHERE r.user_id = (SELECT id FROM auth.users LIMIT 1)
--      AND r.folder = 'inbox'
--    ORDER BY r.sent_at DESC LIMIT 25;
--    → expect: Index Scan (or Index Only) using idx_email_rcpt_user_folder, no Sort node.

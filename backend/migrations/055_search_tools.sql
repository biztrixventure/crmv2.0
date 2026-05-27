-- 055_search_tools.sql
-- Intelligent FAQ/Script search support:
--   search_synonyms — superadmin-managed groups of interchangeable terms that
--                      expand agent queries (e.g. "cancel" ⇄ "refund, terminate").
--   search_queries  — analytics log of what agents search for + how many results
--                      they got, so superadmins can spot gaps (zero-result terms).

CREATE TABLE IF NOT EXISTS search_synonyms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term        text NOT NULL,
  synonyms    text NOT NULL DEFAULT '',     -- comma-separated interchangeable terms
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_search_synonyms_term ON search_synonyms (lower(term));

CREATE TABLE IF NOT EXISTS search_queries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query         text NOT NULL,
  section       text NOT NULL CHECK (section IN ('faq', 'script')),
  result_count  integer NOT NULL DEFAULT 0,
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  role          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_search_queries_created ON search_queries (created_at);
CREATE INDEX IF NOT EXISTS idx_search_queries_q       ON search_queries (lower(query));

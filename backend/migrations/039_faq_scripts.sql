-- 039_faq_scripts.sql
-- Multiple role-tagged scripts per FAQ. A single FAQ can now carry several
-- scripts (e.g. "Script 1" for fronters, "Script 2" for closers); each script
-- has its own role so agents see only the scripts meant for them.
-- The FAQ-level `audience` still gates whether the FAQ itself is visible.

CREATE TABLE IF NOT EXISTS faq_scripts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  faq_id      uuid NOT NULL REFERENCES faqs(id) ON DELETE CASCADE,
  label       text,                                   -- e.g. "Script 1", "Rebuttal A"
  content     text NOT NULL,
  role        text NOT NULL DEFAULT 'both'
              CHECK (role IN ('closer', 'fronter', 'both')),
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_faq_scripts_faq ON faq_scripts(faq_id);

-- Backfill: move each existing single FAQ script into the new table as a
-- general (both) script so nothing is lost.
INSERT INTO faq_scripts (faq_id, label, content, role, sort_order)
SELECT id, 'Script 1', script, 'both', 0
FROM faqs
WHERE script IS NOT NULL AND btrim(script) <> '';

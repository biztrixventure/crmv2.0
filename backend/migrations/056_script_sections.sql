-- 056_script_sections.sql
-- Scripts can now be broken into tagged HEADINGS/sections. Each section is
-- { heading, content, tags } — superadmin tags a heading so that when an agent
-- searches a related word, that specific paragraph surfaces (not just the whole
-- script). Stored as jsonb so it's flexible and needs no extra table.

ALTER TABLE scripts ADD COLUMN IF NOT EXISTS sections jsonb;

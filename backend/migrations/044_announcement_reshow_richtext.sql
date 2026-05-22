-- 044_announcement_reshow_richtext.sql
-- Announcements get a re-show cadence and rich (HTML) bodies.
--   * reshow_hours: after a user dismisses an announcement it pops up again once
--     this many hours have passed. NULL = show once (never again after dismiss).
--   * body now stores rich HTML (bold/italic/underline/lists/links/images).
--     No column change needed — body is already text; this is a behavior note.

ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS reshow_hours integer;

-- ============================================================================
-- 202 — Kanban attachments: store a small thumbnail alongside the full image.
--
-- The card grid was loading every image at full base64 size (slow on the
-- viewer). Store a downscaled thumbnail (thumb_url) that the grid loads
-- instead; the full image is fetched only when a card's image is opened or
-- annotated. Uploads are also downscaled client-side, so even "full" is modest.
-- ============================================================================

ALTER TABLE kanban_attachments
  ADD COLUMN IF NOT EXISTS thumb_url text;

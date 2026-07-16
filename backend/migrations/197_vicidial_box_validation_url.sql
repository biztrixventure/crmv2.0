-- 197_vicidial_box_validation_url.sql
-- Per-box IP-validation portal URL.
--
-- Older dialers (wavetech, TMC, easytech) all expose their "IP Validation
-- Portal" at the fixed shape  http://<host>:81/index.php , which the
-- validate-ip route hardcoded. New dialers use different shapes, e.g.
--   https://tmcsolinb.i5.tel:81/KyZvls/index.php
-- (https scheme + non-default port + custom path). Store the full portal URL
-- per box so the validator hits it verbatim. NULL/empty => fall back to the
-- legacy http://<host>:81/index.php default (existing dialers keep working
-- with no config change).

ALTER TABLE vicidial_boxes
  ADD COLUMN IF NOT EXISTS validation_url text;

COMMENT ON COLUMN vicidial_boxes.validation_url IS
  'Full IP-validation portal URL (e.g. https://host:81/PATH/index.php). NULL = legacy http://<host>:81/index.php default.';

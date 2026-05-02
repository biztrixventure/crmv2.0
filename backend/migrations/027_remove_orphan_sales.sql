-- 027_remove_orphan_sales.sql
-- Remove sales that have no linked transfer (no fronter/company attribution).
-- These were created before the "create from search only" rule was enforced.
-- Closers can no longer create direct sales; all sales must originate from a transfer.
DELETE FROM sales WHERE transfer_id IS NULL;

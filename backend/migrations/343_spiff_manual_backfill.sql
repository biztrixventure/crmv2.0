-- ============================================================================
-- 343_spiff_manual_backfill.sql — six SPIFFs that never counted anything.
--
-- THE BUG, which was in the DEFAULT and not in the maths. SpiffManager's new
-- campaign form opened on `metric_source = 'manual'`, and a manual campaign
-- scores NOTHING until a superadmin types a number in per participant
-- (routes/spiff.js reads spiff_entries for those; only an auto source goes
-- through spiffMetrics.getProgress). So a spiff created without touching the
-- Source dropdown ran its whole window on an empty leaderboard while the
-- agents it targeted really were closing sales.
--
-- Measured 2026-10-13: of the NINE campaigns ever created, six were manual and
-- every one of them finished with ZERO spiff_entries. The only three that ever
-- scored are the three where someone happened to change that field. The form
-- now defaults to "Auto: Sales closed" and warns if Manual is chosen, so new
-- ones cannot land this way again; this file repairs the six already created.
--
-- What they SHOULD have shown, by the same rules spiffMetrics applies (status
-- closed_won/sold, windowed on sale_date in ET, post-dates excluded, credit to
-- the closer AND the fronter):
--
--     Weekly Deal for July       52 sales   17 agents
--     Month End Sprint           10          8
--     Deal of the Day             7          5
--     Month End Deal Sprint       5          4
--     Deal of the Day 11-7-26     5          3
--     Last two hours spiff        3          3
--                                ---
--                                82 sales that were never credited.
--
-- NOTHING IS LOST BY CONVERTING. All six hold zero spiff_entries, so there is
-- no hand-entered score to overwrite — the guard below re-checks that per row
-- rather than trusting this comment. Progress is computed LIVE from the sales
-- table, so the boards fill retroactively for their own windows the moment the
-- source changes; no backfill of entries is needed or wanted.
--
-- BY ID, NOT BY RULE. A blanket "convert every manual campaign with no
-- entries" would, on some later re-run, silently convert a campaign somebody
-- deliberately created as manual and had not scored yet. These six are named.
-- Reversing is `metric_source = 'manual', metric = 'deals_closed'` for the
-- same ids.
-- ============================================================================

UPDATE spiff_campaigns c
   SET metric_source = 'sales',
       metric        = 'sales_closed'
 WHERE c.id IN (
         'd3428f2f-5498-46e7-810f-2bfe0f0a8999',  -- Month End Sprint
         'ede98856-fac5-440c-ba84-f6e8e5b489cd',  -- Month End Deal Sprint
         '05f3dc2f-a981-4002-bdf7-f4d65f3933a9',  -- Last two hours spiff
         'f7bfd282-49d5-47dd-9a2d-c980dedaf301',  -- Weekly Deal for July
         '62cbe5e4-58b3-402b-8267-fae6bdd4ca59',  -- Deal of the Day
         '8aad43e3-8c3f-49fb-a517-25cafcc80e85'   -- Deal of the Day 11-7-26
       )
   AND c.metric_source = 'manual'                      -- idempotent re-run
   AND NOT EXISTS (                                     -- never clobber a typed score
         SELECT 1 FROM spiff_entries e WHERE e.campaign_id = c.id
       );

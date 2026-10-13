-- ============================================================================
-- 345_qa2_call_unclassified_index.sql — the second-biggest query on the box.
--
-- Companion to 344. With the hangup lookup indexed, this was the next one:
--
--   15.5% of ALL database CPU   329,852 s   1,571,973 calls   210 ms each
--     SELECT id FROM qa2_call
--      WHERE company_id = $1 AND method_id IS NULL AND qa_relevant = $2
--     + an exact COUNT(*) over the same predicate   <-- the expensive half
--
-- It was NOT a sequential scan — it used idx_qa2_call_company_date — but that
-- index is (company_id, call_at) and carries no idea of method_id, so the
-- count walked 180,031 index entries and then touched the HEAP for every one:
-- 179,126 buffers, about 1.4 GB of page reads, per call, 1.5 million times.
--
-- WHY THE PARTIAL PREDICATE IS THE WHOLE TRICK, AND WHY IT LOOKS WRONG.
-- `method_id IS NULL` is 1,456,032 of 1,493,473 rows — 97.5% of the table — so
-- as a *filter* it selects almost everything and a planner rightly ignores it.
-- As a partial index PREDICATE it does something different: it lets the index
-- hold ONLY (company_id), nothing else, which is what makes an INDEX ONLY SCAN
-- possible. The count then never reads the table at all.
--
-- A VACUUM is part of this change, not housekeeping around it. An index-only
-- scan still visits the heap for any page the visibility map does not mark
-- all-visible, and qa2_call is churned hard enough (6,829 autovacuums, last
-- one eight days before this) that 71,259 of the 180,031 rows still needed a
-- heap fetch. Vacuuming took that to 32.
--
-- Measured 2026-10-13, same query, same row count:
--     before 344/345   234 ms   179,126 buffers
--     index only       146 ms    17,978 buffers   (71,259 heap fetches)
--     + VACUUM          26 ms       173 buffers   (32 heap fetches)
-- Buffer reads fell by about 1,000x.
--
-- THE REAL FIX IS STILL UPSTREAM. 97.5% of qa2_call being unclassified is the
-- actual defect; this makes counting it cheap, it does not make it right.
-- Draining that backlog is what shrinks the table, the index and the work.
--
-- CONCURRENTLY, same reasoning as 344 — it works through the Supabase MCP and
-- never locks the table. Re-running is a no-op.
-- ============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_qa2_call_unclassified_company
  ON public.qa2_call (company_id)
  WHERE method_id IS NULL AND qa_relevant;

-- Sets the visibility map so the scan above is genuinely index-only. Safe and
-- non-blocking; this is a plain VACUUM, never VACUUM FULL (which would take an
-- ACCESS EXCLUSIVE lock and rewrite a 1 GB table).
VACUUM (ANALYZE) public.qa2_call;

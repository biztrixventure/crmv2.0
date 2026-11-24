-- 358: "Support manager" as a superadmin designation.
--
-- The person who runs the support desk already holds another role (company
-- admin, operations manager, a closer manager ...). Changing their role would
-- move their shell and their permissions, so -- like Training in mig 311 --
-- a superadmin switches it on for the PERSON instead: User Control Center ->
-- Modules -> Support manager. While it is on they get the admin view of the
-- support desk (Agent Report, Call Log, Agents & Clients, Colours) inside the
-- dashboard they already use. Off = it is gone again.
--
-- The designation tables carry a CHECK naming the modules; this only widens
-- it. No row is touched. The support desk is not company-scoped (it works on
-- CLIENT names), so module_designation_companies is widened only to keep the
-- two lists identical -- nothing writes 'support' rows there.
--
-- Verify:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname IN ('module_designations_module_check',
--                      'module_designation_companies_module_check');

ALTER TABLE module_designations
  DROP CONSTRAINT IF EXISTS module_designations_module_check;
ALTER TABLE module_designations
  ADD CONSTRAINT module_designations_module_check
  CHECK (module IN ('accounting','hr','training','support'));

ALTER TABLE module_designation_companies
  DROP CONSTRAINT IF EXISTS module_designation_companies_module_check;
ALTER TABLE module_designation_companies
  ADD CONSTRAINT module_designation_companies_module_check
  CHECK (module IN ('accounting','hr','training','support'));

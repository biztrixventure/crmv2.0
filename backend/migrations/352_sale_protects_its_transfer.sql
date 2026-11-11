-- 352: a transfer that carries a sale can no longer be deleted.
--
-- 2026-11-11 20:21 UTC: a closed_won sale (Doretha Prince, ref 000002GS) was
-- wiped out by pressing "Confirm" on a pending dialer card. The confirm path
-- (POST /vicidial/pending/:id/confirm) folds a pending card into a manual
-- transfer for the same phone and DELETES the card -- without checking for a
-- sale -- and sales.transfer_id was ON DELETE CASCADE, so the closer's sale
-- went with it. DELETE /transfers/:id refuses a transfer with a sale (409), but
-- that guard lived in ONE route; every other path that deletes a transfer had
-- to remember it, and one did not.
--
-- The rule now lives in the database, where no code path can forget it:
--   ON DELETE NO ACTION  -> deleting a transfer whose sale still exists fails
--                           (23503) -- whatever route, script or SQL asks.
-- NO ACTION, not RESTRICT, on purpose: NO ACTION is checked at the END of the
-- statement, so an admin cleanup that removes a transfer AND its sale together
-- (an upload batch -- sales.upload_batch_id cascades; a company -- both
-- company_id FKs cascade) still works. RESTRICT is checked per row and would
-- refuse those even though the sale is going too.
--
-- Deleting the SALE first is still possible for whoever holds delete_sale /
-- compliance / superadmin; the field_audit_log DELETE snapshot keeps it
-- restorable either way.

alter table public.sales drop constraint if exists sales_transfer_id_fkey;
alter table public.sales
  add constraint sales_transfer_id_fkey
  foreign key (transfer_id) references public.transfers(id)
  on delete no action
  not valid;
alter table public.sales validate constraint sales_transfer_id_fkey;

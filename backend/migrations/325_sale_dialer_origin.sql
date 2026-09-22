-- ============================================================================
-- 325_sale_dialer_origin.sql
-- WHICH DIALER DID THIS SALE COME FROM — and which box.
--
-- A sale has no dialer of its own: it is made from a transfer, and the transfer
-- knows. Reading that through a join is fine for one row and useless for the
-- thing people actually want, which is "how many of this month's sales came
-- from each dialer" — grouping and filtering across thousands of sales through
-- an embedded resource is slow and, in PostgREST, awkward enough that the
-- filter ends up being applied in the browser on one page of results.
--
-- So the origin is stamped ON the sale. Trigger-fed, never route-fed: the same
-- rule the invoice/payroll totals follow (mig 284/287) and the opposite of how
-- the sales denormalized columns drifted in mig 190. Nothing writes these from
-- a handler, so they cannot disagree with the transfer they came from.
--
-- dialer_box is the answer to "which box", one level finer than the product:
--   VICIdial  -> the vendor-code prefix: WTI / ETC / TMC / OAT / INB
--   CallTools -> the connected account's name
-- NOTE the prefix is a GROUP, not one server: wavetechpk and wti_flexo both
-- send WTI. Naming the group is honest; naming one of the two would be a
-- guess, and the CRM only learns the exact box when the recording poller finds
-- the clip.
--
-- Apply in the Supabase SQL editor. Idempotent.
-- ============================================================================

ALTER TABLE transfers ADD COLUMN IF NOT EXISTS dialer_box text;
ALTER TABLE sales     ADD COLUMN IF NOT EXISTS dialer_provider   text;
ALTER TABLE sales     ADD COLUMN IF NOT EXISTS dialer_account_id uuid REFERENCES dialer_accounts(id) ON DELETE SET NULL;
ALTER TABLE sales     ADD COLUMN IF NOT EXISTS dialer_box        text;

-- ── the one rule for naming a box ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_dialer_box(p_vendor_code text, p_provider text, p_account_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v_prefix text; v_name text;
BEGIN
  -- A connected dialer names itself.
  IF p_account_id IS NOT NULL THEN
    SELECT name INTO v_name FROM dialer_accounts WHERE id = p_account_id;
    IF v_name IS NOT NULL THEN RETURN v_name; END IF;
  END IF;

  IF COALESCE(p_provider, 'vicidial') <> 'vicidial' THEN
    RETURN initcap(COALESCE(p_provider, 'dialer'));
  END IF;

  -- VICIdial: the vendor code carries the prefix (WTI264204 -> WTI). A bare
  -- numeric code names no box at all, which is a real and common state — the
  -- honest answer there is nothing, not a guess.
  v_prefix := upper(COALESCE(substring(COALESCE(p_vendor_code, '') FROM '^([A-Za-z]+)'), ''));
  IF v_prefix = '' THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM vicidial_boxes b WHERE upper(b.prefix) = v_prefix) THEN
    RETURN NULL;   -- a prefix no box claims tells us nothing
  END IF;
  RETURN v_prefix;
END $$;

-- ── transfers keep their own box up to date ─────────────────────────────────
CREATE OR REPLACE FUNCTION fn_transfer_stamp_box()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.dialer_box := fn_dialer_box(NEW.vicidial_vendor_code, NEW.dialer_provider, NEW.dialer_account_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_transfer_stamp_box ON transfers;
CREATE TRIGGER trg_transfer_stamp_box
  BEFORE INSERT OR UPDATE OF vicidial_vendor_code, dialer_provider, dialer_account_id ON transfers
  FOR EACH ROW EXECUTE FUNCTION fn_transfer_stamp_box();

-- ── a sale inherits its origin from its transfer ────────────────────────────
CREATE OR REPLACE FUNCTION fn_sale_stamp_dialer()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE t RECORD;
BEGIN
  IF NEW.transfer_id IS NULL THEN
    -- Typed straight into the CRM with no transfer behind it. Not a dialer
    -- sale, and saying "vicidial" here would invent an origin.
    NEW.dialer_provider := NULL; NEW.dialer_account_id := NULL; NEW.dialer_box := NULL;
    RETURN NEW;
  END IF;

  SELECT dialer_provider, dialer_account_id, vicidial_vendor_code, vicidial_agent
    INTO t FROM transfers WHERE id = NEW.transfer_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- NO DIALER FINGERPRINT MEANS NO DIALER. transfers.dialer_provider defaults
  -- to 'vicidial' for every row ever written, so trusting it here would credit
  -- VICIdial with every hand-typed sale — measured on this data, 5,856 of
  -- 7,861. A transfer that carries neither a lead code, nor a dialer agent,
  -- nor a connected account was typed into the CRM by a person, and saying so
  -- is the useful answer.
  IF t.dialer_account_id IS NULL
     AND t.vicidial_vendor_code IS NULL
     AND t.vicidial_agent IS NULL THEN
    NEW.dialer_provider := NULL; NEW.dialer_account_id := NULL; NEW.dialer_box := NULL;
    RETURN NEW;
  END IF;

  NEW.dialer_provider   := COALESCE(t.dialer_provider, 'vicidial');
  NEW.dialer_account_id := t.dialer_account_id;
  NEW.dialer_box        := fn_dialer_box(t.vicidial_vendor_code, t.dialer_provider, t.dialer_account_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sale_stamp_dialer ON sales;
CREATE TRIGGER trg_sale_stamp_dialer
  BEFORE INSERT OR UPDATE OF transfer_id ON sales
  FOR EACH ROW EXECUTE FUNCTION fn_sale_stamp_dialer();

-- ── backfill what already exists ────────────────────────────────────────────
UPDATE transfers t
   SET dialer_box = fn_dialer_box(t.vicidial_vendor_code, t.dialer_provider, t.dialer_account_id)
 WHERE t.dialer_box IS DISTINCT FROM fn_dialer_box(t.vicidial_vendor_code, t.dialer_provider, t.dialer_account_id);

UPDATE sales s
   SET dialer_provider   = CASE WHEN t.dialer_account_id IS NULL
                                 AND t.vicidial_vendor_code IS NULL
                                 AND t.vicidial_agent IS NULL
                                THEN NULL ELSE COALESCE(t.dialer_provider, 'vicidial') END,
       dialer_account_id = t.dialer_account_id,
       dialer_box        = CASE WHEN t.dialer_account_id IS NULL
                                 AND t.vicidial_vendor_code IS NULL
                                 AND t.vicidial_agent IS NULL
                                THEN NULL
                                ELSE fn_dialer_box(t.vicidial_vendor_code, t.dialer_provider, t.dialer_account_id) END
  FROM transfers t
 WHERE t.id = s.transfer_id;

-- Grouping "sales by dialer this month" is the whole point, so index for it.
CREATE INDEX IF NOT EXISTS idx_sales_dialer         ON sales (dialer_provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_dialer_box     ON sales (dialer_box, created_at DESC) WHERE dialer_box IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transfers_dialer_box ON transfers (dialer_box, created_at DESC) WHERE dialer_box IS NOT NULL;

INSERT INTO schema_migrations (filename, note)
VALUES ('325_sale_dialer_origin.sql', 'Sales carry the dialer + box they came from (trigger-fed from the transfer)')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';

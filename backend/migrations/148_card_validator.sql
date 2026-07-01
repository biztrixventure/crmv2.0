-- ============================================================================
-- 148_card_validator.sql
-- Card validator (closer + compliance). Luhn / brand / format are checked in the
-- browser; the server only ever sees the BIN (first 6-8 digits, NOT the full PAN
-- — a card number is never sent to us, stored, or logged) to look up the issuer
-- via the free binlist.net API. BINs are bank identifiers, not card data, so we
-- cache them to avoid the API's rate limit.
-- ============================================================================
CREATE TABLE IF NOT EXISTS bin_lookups (
  bin              text PRIMARY KEY,          -- 6-8 leading digits
  scheme           text,                      -- visa | mastercard | amex | discover | …
  card_type        text,                      -- debit | credit
  brand            text,
  prepaid          boolean,
  bank_name        text,
  bank_url         text,
  bank_phone       text,
  country_name     text,
  country_alpha2   text,
  country_emoji    text,
  country_currency text,
  raw              jsonb,
  checked_at       timestamptz NOT NULL DEFAULT now()
);

INSERT INTO feature_flags (key, label, description, category, default_enabled, sort_order) VALUES
  ('tool_card_validator', 'Tool · Card Validator',
   'Validate card details — Luhn + brand + issuer (BIN) lookup. No card number is stored.',
   'admin_tools', false, 207)
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';

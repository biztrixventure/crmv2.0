-- 350: card vault -- card numbers / CVV / expiry pulled out of chat + email.
--
-- Agents pasted customers' card numbers, expiry dates and CVVs into chat
-- messages and internal emails (2026-11-08: 306 messages, 7 emails). The
-- operator wanted them gone from the CRM but recoverable on their say-so.
--
-- How it is kept:
--   * Each original row is stored as ONE OpenPGP message encrypted to a PUBLIC
--     key (pgp_pub_encrypt). The database holds only the public key, so it can
--     lock but never unlock. The private key lives off the database, with the
--     operator. A database dump, a service-role key or a superadmin login
--     reveals nothing.
--   * Own schema, not `public`: PostgREST does not expose it, and every grant
--     is revoked from anon / authenticated / public. Service role + postgres
--     only -- and even they see ciphertext.
--   * Restoring = decrypt OFF the database with the private key, then write
--     the original columns back. Nothing in the app can do it.
--
-- The source rows are hidden, not deleted: messages get deleted_at + blanked
-- body/body_html/attachments (the chat already renders a deleted message as
-- "deleted"); emails get their body replaced with a removal notice.

create schema if not exists card_vault;
revoke all on schema card_vault from public, anon, authenticated;

create table if not exists card_vault.items (
  id          bigint generated always as identity primary key,
  src_table   text        not null check (src_table in ('messages','emails')),
  src_id      uuid        not null,
  ciphertext  bytea       not null,          -- pgp_pub_encrypt(to_jsonb(original row)::text)
  key_fpr     text        not null,          -- which vault key can open it
  reason      text        not null default 'card data',
  vaulted_at  timestamptz not null default now(),
  restored_at timestamptz,
  unique (src_table, src_id)
);

create table if not exists card_vault.keys (
  fpr        text primary key,
  public_key text not null,                  -- ASCII-armored PUBLIC key only
  created_at timestamptz not null default now()
);

alter table card_vault.items enable row level security;
alter table card_vault.keys  enable row level security;
revoke all on all tables in schema card_vault from public, anon, authenticated;
alter default privileges in schema card_vault revoke all on tables from public, anon, authenticated;

-- 351: card vault -- messages removed outright, not just hidden.
--
-- 350 hid the vaulted chat messages (deleted_at + blank body), which still left
-- a "message deleted" placeholder in the conversation. On 2026-11-09 the
-- operator asked for them to disappear entirely, so the 335 rows were DELETED.
--
-- A DELETE also takes what points at the row: message_reactions cascade away
-- and replies' reply_to is set NULL. Both are saved first, encrypted to the
-- same public key, in `extra`:
--   {"reactions": [<message_reactions rows>], "replied_by": [<message ids>]}
--
-- Restore order for a row with removed_at set:
--   1. decrypt ciphertext + extra OFF the database (private key)
--   2. INSERT the original message row (jsonb_populate_record)
--   3. INSERT its reactions
--   4. UPDATE messages SET reply_to = <src_id> WHERE id IN replied_by
--   5. stamp restored_at

alter table card_vault.items add column if not exists extra bytea;
alter table card_vault.items add column if not exists removed_at timestamptz;
comment on column card_vault.items.extra is 'pgp_pub_encrypt(json {reactions:[...], replied_by:[message ids]}) -- rows that pointed at the source row, needed to rebuild it on restore';
comment on column card_vault.items.removed_at is 'when the source row was DELETED outright (not just hidden). Restore = re-INSERT from ciphertext, then re-insert reactions and re-point replied_by.reply_to';

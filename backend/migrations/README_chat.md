# Team Chat (migration 045)

Global real-time chat for BizTrix CRM. Any user can DM any other user across **all**
companies, plus group rooms and superadmin broadcasts. Built only on the existing
stack — Express + Supabase Realtime + Web Push — no external chat vendor, no new deps.

## 1. Apply the migration

Open the Supabase SQL editor and run `backend/migrations/045_chat.sql` once.

It creates: `conversations`, `conversation_members`, `messages`, `chat_user_settings`,
`chat_moderation_log`; indexes + the `bump_conversation_on_message` trigger; the
`is_conversation_member()` SECURITY DEFINER helper; RLS policies; adds `messages` and
`conversations` to the `supabase_realtime` publication; and seeds the `chat` feature flag
(+ per-company rows).

> Realtime won't deliver messages until the `ALTER PUBLICATION … ADD TABLE messages`
> lines have run. They're idempotent (guarded by `EXCEPTION WHEN duplicate_object`).

After applying, **redeploy / restart the backend** so the new routes mount.

## 2. Feature flag

Chat is gated by the `chat` flag (catalog row seeded with `default_enabled = true`).

- **Backend:** user routes are wrapped with `requireFeature('chat')` — superadmin bypasses.
- **Frontend:** the header `ChatLauncher` renders only when `isEnabled('chat')` is true,
  so chat lights up in every shell (Staff/Manager/Compliance) and the Admin panel at once.
- **Admin routes** (`/api/chat/admin/*`) are **not** feature-gated — they are
  `isSuperAdmin()`-gated so moderation always works regardless of company flags.

## 3. Per-company rollout (superadmin)

Admin Panel → **Chat Control → Rollout** tab. Toggle chat on/off per company; this writes
`company_feature_flags` via `PATCH /api/chat/admin/feature` (same shape as migration 021)
and is recorded in the moderation log.

## 4. Moderation tools (superadmin)

Admin Panel → **Chat Control**:

| Tab | What it does |
|-----|--------------|
| Overview | live counts: conversations, messages today, active users, banned users, locked rooms |
| Conversations | search **every** room (by participant / company / title), open any thread, delete a message, lock/unlock or delete a room |
| Users | search the global directory, ban / unban a user from chat |
| Broadcast | send an announcement message to everyone, or by company / role (also fires Web Push) |
| Moderation Log | full audit trail of every superadmin action |
| Rollout | per-company enable/disable |

Superadmin power is enforced **server-side** via `isSuperAdmin()` + `supabaseAdmin`
(service role bypasses RLS). RLS is never widened for superadmin.

## 5. How it scales (~350+ concurrent users)

- Only the **open** conversation holds a Realtime channel; it's torn down on switch/close.
- The header unread badge **polls** `/chat/conversations` on a jittered 25–37 s interval —
  no channel-per-conversation.
- `useChat` keeps the jittered 30–42 s poll fallback + backoff from `useNotifications`, so
  chat survives a dropped WebSocket.
- Typing (Broadcast) and online status (Presence) are ephemeral — never written to the DB.
- History is cursor-paginated (30 / page); full history is never loaded at once.

## 6. Offline delivery

`backend/utils/chatService.js → pushNewMessage` fires Web Push (via the existing
`pushService.js`) to a conversation's other members, fire-and-forget, tagged
`chat_<conversationId>`. (Pushing to all non-senders mirrors `notificationService.js`;
true presence-based suppression would need a shared presence store that survives multiple
server instances.)

## Files

```
backend/migrations/045_chat.sql        tables, indexes, trigger, RLS, realtime, flag seed
backend/utils/chatService.js           DM find-or-create, push, moderation log, directory
backend/routes/chat.js                 user endpoints (membership-checked)
backend/routes/chatAdmin.js            superadmin moderation (isSuperAdmin-gated)
frontend/src/hooks/useChat.js          open-conversation stream (realtime + poll fallback)
frontend/src/hooks/useChatUnread.js    header unread badge (poll only)
frontend/src/hooks/usePresence.js      online presence set
frontend/src/components/Chat/*         ChatLauncher, ChatPanel, ConversationList,
                                       MessageThread, Composer, NewChatPicker, PresenceDot, Avatar
frontend/src/components/Admin/Chat/ChatAdmin.jsx   superadmin control center
```

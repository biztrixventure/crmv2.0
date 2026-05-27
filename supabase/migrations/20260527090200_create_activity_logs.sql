-- Migration: create_activity_logs
-- Purpose : Audit trail for user actions (create/update/delete/search/etc).
-- Notes   : Forward-only & idempotent. Append-only by design — rows are never
--           updated or deleted by the app. `metadata` carries action-specific
--           detail (changed fields, search query, filters…).
--           IF NOT EXISTS guards make this safe even if an activity_logs table
--           already exists in the target database.

create table if not exists public.activity_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references auth.users (id) on delete set null,
  action      text not null
              check (action in ('create', 'update', 'delete', 'search', 'login', 'export', 'view')),
  entity_type text,                                  -- e.g. 'lead', 'user', 'sale'
  entity_id   text,                                  -- text so it fits uuid or external ids
  metadata    jsonb,
  ip_address  inet,
  created_at  timestamptz not null default now()
);

comment on table public.activity_logs is 'Append-only audit log of user actions across the CRM.';

create index if not exists idx_activity_logs_actor   on public.activity_logs (actor_id);
create index if not exists idx_activity_logs_entity  on public.activity_logs (entity_type, entity_id);
create index if not exists idx_activity_logs_created on public.activity_logs (created_at);

-- RLS: authenticated users may read the log and append their own entries.
-- (Deletion/updates are intentionally NOT granted — the trail is immutable.)
alter table public.activity_logs enable row level security;

do $$ begin
  create policy "activity_logs_select_authenticated" on public.activity_logs
    for select to authenticated using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "activity_logs_insert_self" on public.activity_logs
    for insert to authenticated with check (actor_id = auth.uid() or actor_id is null);
exception when duplicate_object then null; end $$;

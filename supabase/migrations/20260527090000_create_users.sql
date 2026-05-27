-- Migration: create_users
-- Purpose : Application user profile table (1:1 with Supabase auth.users).
-- Notes   : Forward-only & idempotent (IF NOT EXISTS). Never edit this file once
--           it has been applied to an environment — write a NEW migration instead.

-- gen_random_uuid() / crypto helpers (present on Supabase, guarded for local).
create extension if not exists pgcrypto;

-- Shared trigger to keep updated_at fresh. Created once here, reused by later
-- tables. CREATE OR REPLACE is safe to re-run.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── users ────────────────────────────────────────────────────────────────────
create table if not exists public.users (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null unique,
  full_name  text,
  role       text not null default 'member' check (role in ('member', 'manager', 'admin')),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.users is 'Application user profiles, one row per auth.users account.';

-- updated_at trigger (drop+create is safe — affects the trigger only, not data).
drop trigger if exists trg_users_set_updated_at on public.users;
create trigger trg_users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

create index if not exists idx_users_role on public.users (role);

-- Row Level Security: a user sees/edits only their own row.
alter table public.users enable row level security;

do $$ begin
  create policy "users_select_own" on public.users
    for select to authenticated using (id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "users_update_own" on public.users
    for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
exception when duplicate_object then null; end $$;

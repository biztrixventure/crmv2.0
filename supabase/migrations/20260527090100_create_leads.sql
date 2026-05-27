-- Migration: create_leads
-- Purpose : Core CRM leads table.
-- Notes   : Forward-only & idempotent. Status is a CHECK-constrained enum-like
--           text column so the pipeline stages are explicit and queryable.

create table if not exists public.leads (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text,
  phone      text,
  company    text,
  source     text,                                   -- e.g. website, referral, ad
  status     text not null default 'new'
             check (status in ('new', 'contacted', 'qualified', 'won', 'lost')),
  value      numeric(12, 2) not null default 0,      -- estimated deal value
  owner_id   uuid references auth.users (id) on delete set null,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.leads is 'CRM leads / opportunities moving through the sales pipeline.';

drop trigger if exists trg_leads_set_updated_at on public.leads;
create trigger trg_leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

-- Indexes for the common filters (pipeline board, my-leads, recency, dedupe).
create index if not exists idx_leads_status      on public.leads (status);
create index if not exists idx_leads_owner_id     on public.leads (owner_id);
create index if not exists idx_leads_created_at   on public.leads (created_at);
create index if not exists idx_leads_email_lower  on public.leads (lower(email));

-- RLS: team-wide read for authenticated users; only the owner may mutate their lead.
alter table public.leads enable row level security;

do $$ begin
  create policy "leads_select_authenticated" on public.leads
    for select to authenticated using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "leads_insert_owner" on public.leads
    for insert to authenticated with check (owner_id = auth.uid() or owner_id is null);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "leads_update_owner" on public.leads
    for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
exception when duplicate_object then null; end $$;

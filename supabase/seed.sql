-- seed.sql — sample data for LOCAL development.
-- Runs automatically on `supabase db reset` (never against production).
-- Idempotent: fixed UUIDs + ON CONFLICT DO NOTHING so re-seeding is safe.
--
-- NOTE on test users: auth.users is owned by GoTrue and should NOT be inserted
-- directly here. Create local test users with the Auth API / CLI, then their
-- profile row in public.users, e.g.:
--   curl -X POST "$SUPABASE_URL/auth/v1/admin/users" -H "apikey: $SERVICE_ROLE" ...
-- For pure local dev you can also sign up via Studio (http://localhost:54323).

-- ── Sample leads ───────────────────────────────────────────────────────────────
insert into public.leads (id, name, email, phone, company, source, status, value, notes)
values
  ('00000000-0000-0000-0000-0000000a0001', 'Jane Cooper',   'jane@acme.test',    '5550100001', 'Acme Inc',     'website',  'new',       1500.00, 'Inbound demo request'),
  ('00000000-0000-0000-0000-0000000a0002', 'Robert Fox',    'robert@globex.test','5550100002', 'Globex',       'referral', 'contacted', 3200.00, 'Referred by Jane'),
  ('00000000-0000-0000-0000-0000000a0003', 'Esther Howard', 'esther@initech.test','5550100003','Initech',      'ad',       'qualified', 9800.00, 'Budget confirmed'),
  ('00000000-0000-0000-0000-0000000a0004', 'Cody Fisher',   'cody@hooli.test',   '5550100004', 'Hooli',        'website',  'won',      12000.00, 'Closed annual plan'),
  ('00000000-0000-0000-0000-0000000a0005', 'Leslie Alexander','leslie@umbrella.test','5550100005','Umbrella',  'cold',     'lost',         0.00, 'Went with competitor')
on conflict (id) do nothing;

-- ── Sample activity log entries ─────────────────────────────────────────────────
insert into public.activity_logs (id, actor_id, action, entity_type, entity_id, metadata)
values
  ('00000000-0000-0000-0000-0000000b0001', null, 'create', 'lead', '00000000-0000-0000-0000-0000000a0001', '{"source":"seed"}'),
  ('00000000-0000-0000-0000-0000000b0002', null, 'search', 'lead', null,                                    '{"query":"acme"}')
on conflict (id) do nothing;

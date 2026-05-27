# Database Migrations (Supabase CLI)

Schema changes are **code-only**. Never edit tables/policies in the Supabase
dashboard — every change is a timestamped SQL file in `supabase/migrations/`,
reviewed in a PR, and applied by `supabase db push` (locally or in CI).

## One-time setup

```bash
npm i -g supabase            # or: npx supabase ...
supabase login               # opens browser; stores your access token
supabase link --project-ref <PROJECT_REF>   # from your project URL
```

## Daily workflow

```bash
# 1. Author a change — creates supabase/migrations/<timestamp>_name.sql
npm run db:new add_lead_tags

# 2. Test locally against a throwaway Postgres (rebuilds from ALL migrations + seed)
npm run db:reset             # LOCAL only — safe, destroys the local db

# 3. Apply pending migrations to the linked remote
npm run db:migrate           # = supabase db push
```

Migrations are **forward-only and applied in filename (timestamp) order**.
The CLI records applied versions in `supabase_migrations.schema_migrations`, so
each file runs exactly once per environment.

## Rules / best practices

- **Never edit an applied migration.** Write a new one that alters/fixes.
- Keep files **idempotent** where possible (`create table if not exists`,
  `do $$ … exception when duplicate_object …$$` for policies).
- **No destructive statements** in auto-deployed migrations (`drop table`,
  `truncate`, `drop column`). CI blocks them. If you truly must, run it manually
  after a backup + review.
- One logical change per migration; clear `-- Migration:` / `-- Purpose:` header.
- Enable RLS on every new table.

## Rollback strategy

Supabase migrations are forward-only — there is no automatic `down`. To revert:

1. **Write a new migration** that reverses the change (e.g. a prior
   `add_column` is undone by a new `drop_column` migration, reviewed manually).
2. For data safety, rely on **Supabase backups / PITR** (Dashboard → Database →
   Backups) before risky changes; restore from there for true rollback.
3. If migration *history* gets out of sync with the DB, fix it with
   `supabase migration repair --status applied <version>` (or `reverted`).

## ⚠️ Baselining an EXISTING database

This project's production schema was originally built by manually-applied SQL in
`backend/migrations/`. The CLI history table is therefore empty there. Before the
first `db push` to that database, baseline it so the CLI doesn't try to recreate
existing objects:

```bash
supabase db pull                       # captures current remote schema as a baseline migration
# …or mark the example migrations as already-applied:
supabase migration repair --status applied 20260527090000 20260527090100 20260527090200
```

The example migrations here use `IF NOT EXISTS` guards, so a push is non-destructive
regardless — but baselining keeps the history honest. New/empty projects need no baseline.

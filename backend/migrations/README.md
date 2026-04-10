# Database Setup Instructions

This directory contains SQL migration scripts for BizTrix CRM v2.0.

## Files

1. **001_create_schema.sql** - Creates all core tables and indexes
2. **002_enable_rls_policies.sql** - Enables Row Level Security for data isolation
3. **003_seed_data.sql** - Seeds initial permissions and form fields

## How to Run

### Step 1: Execute in Supabase SQL Editor

Go to your Supabase project:
1. Dashboard → SQL Editor
2. Click "New Query"
3. Copy contents of `001_create_schema.sql` and paste
4. Click "Run"
5. Wait for completion (should see "Success" message)

### Step 2: Enable RLS Policies

Repeat the process with `002_enable_rls_policies.sql`

### Step 3: Seed Initial Data

Repeat the process with `003_seed_data.sql`

## Verification

After running all scripts, verify in Supabase:

**Tables should exist:**
- companies
- custom_roles
- permissions
- role_permissions
- user_company_roles
- user_profiles
- form_fields
- transfers
- sales
- audit_logs

**Permissions should be inserted:**
```sql
SELECT * FROM permissions;
-- Should show ~15 permissions
```

**Form fields should be inserted:**
```sql
SELECT * FROM form_fields ORDER BY "order";
-- Should show 9 default transfer form fields
```

## Setup Your First Company & Admin

### Method 1: Supabase Dashboard (Easiest for Testing)

1. Go to **Authentication** → **Users**
2. Create a new user (note the user ID)
3. Go to **SQL Editor** and run:

```sql
-- Create first company
INSERT INTO companies (name, is_active)
VALUES ('Test Company', true)
RETURNING id;

-- Copy the returned ID and use it below as <COMPANY_ID>

-- Get the super admin role ID
SELECT id FROM custom_roles WHERE name = 'Super Admin' LIMIT 1;

-- Copy the ID and use it below as <ADMIN_ROLE_ID>

-- Assign super admin role to your user
INSERT INTO user_company_roles (user_id, company_id, role_id, is_active)
VALUES ('<YOUR_USER_ID_FROM_STEP_2>', '<COMPANY_ID>', '<ADMIN_ROLE_ID>', true);

-- Create user profile
INSERT INTO user_profiles (user_id, first_name, last_name, theme_preference)
VALUES ('<YOUR_USER_ID_FROM_STEP_2>', 'Admin', 'User', 'light');
```

### Method 2: Backend API (After Phase 3)

Use the backend API endpoints:
- `POST /auth/invite` - Send invite to new user
- `POST /companies` - Create company (SuperAdmin only)
- `POST /users` - Create user in company

## RLS Policies Explanation

Row Level Security ensures users can only see data they should access:

- **Fronters** see only their own transfers
- **Closers** see transfers assigned to them
- **Managers** see all transfers in their company
- **SuperAdmin** sees everything (via service role)

Data is automatically filtered based on the authenticated user's ID.

## Important Notes

⚠️ **Do NOT run these scripts repeatedly** - they will fail with "already exists" errors on second run

✅ Service role key can bypass RLS (used for admin operations from backend)

✅ All user queries are automatically filtered by RLS policies

🔒 Credentials in `.env.local` are git-ignored for security

## Troubleshooting

**Error: "role_level does not exist"**
- Make sure you ran 001_create_schema.sql first

**Error: "Duplicate index"**
- You've already run the migration scripts
- Check existing tables with `\dt` (or via Supabase dashboard)

**RLS policies not working**
- Ensure 002_enable_rls_policies.sql was fully completed
- Check policy status: Table → Policies in Supabase Dashboard

## Next Steps

After database setup:
1. Run Phase 3: Backend API Routes (auth, users, companies)
2. Run Phase 4: Frontend integration tests
3. Deploy to Coolify when ready

## Coolify Production Environment Variables Setup

For **api.tokocrypto.live** and **tokocrypto.live** to work correctly, set these in **Coolify Dashboard → Project → Services → Environment Variables**:

### Critical Environment Variables (COPY EXACTLY)

```
# Supabase Configuration (copy from Supabase dashboard)
VITE_SUPABASE_URL=https://tdqljwenzuptupjihsvg.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkcWxqd2VuenVwdHVwamloc3ZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NjI2NTUsImV4cCI6MjA5MTQzODY1NX0.a9HjMeLTD3musGmzND0sq715JMadU_6hk6W0g9CL4O4
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkcWxqd2VuenVwdHVwamloc3ZnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTg2MjY1NSwiZXhwIjoyMDkxNDM4NjU1fQ.98i0APW9m8nJyEGezStXKeOaOTepotbgrvE3jbiTYso

# Deployment URLs
FRONTEND_URL=https://tokocrypto.live
VITE_API_URL=https://api.tokocrypto.live
CORS_ORIGIN=https://tokocrypto.live

# Port Configuration
PORT=3001
NODE_ENV=production
```

### Step-by-Step in Coolify:

1. **Go to Coolify Dashboard**
2. **Select Your Project**
3. **For Backend Service (api.tokocrypto.live):**
   - Infrastructure → Services → Backend
   - General → Environment Variables
   - Add each variable above
   - **Buildtime:** OFF (unchecked) for `SUPABASE_SERVICE_ROLE_KEY` and `PORT`
   - **Buildtime:** ON (checked) for `VITE_*` variables
   - Save & Redeploy

4. **For Frontend Service (tokocrypto.live):**
   - Infrastructure → Services → Frontend
   - General → Environment Variables
   - Add each `VITE_*` and `FRONTEND_URL` variable
   - **Buildtime:** ON (checked) for all variables
   - Save & Redeploy

### Verify It's Working:

```bash
# Check backend is responding
curl https://api.tokocrypto.live/health
# Should return: {"status":"ok","timestamp":"..."}

# Check frontend is loading
curl https://tokocrypto.live/
# Should return: HTML with React app (contains "BizTrix")

# Check frontend health
curl https://tokocrypto.live/health
# Should return: healthy
```

### If Still Getting Errors:

**Error: `no available server` for api.tokocrypto.live**
- Backend container not running
- Check Coolify logs: Infrastructure → Services → Backend → Logs
- Common causes: Missing env vars, port not exposed

**Error: `Route not found` for tokocrypto.live**
- Frontend domain pointing to backend by mistake
- Check Coolify domain assignments for each service
- Verify nginx config is including `/usr/share/nginx/html`

### Domain Assignment in Coolify:

1. Infrastructure → Services
2. For Backend Service: Assign `api.tokocrypto.live`
3. For Frontend Service: Assign `tokocrypto.live`
4. Both should have `Https` enabled
5. Both should be on same network: `biztrix-network`

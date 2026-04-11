# BizTrix CRM v2.0 - Deployment Configuration

## Environment Variables Required

All of these must be set in Coolify or your deployment environment:

### Supabase Credentials ⭐ CRITICAL
```env
VITE_SUPABASE_URL=https://tdqljwenzuptupjihsvg.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### API Configuration
```env
VITE_API_URL=http://backend:3001  # For Docker/Coolify
# or
VITE_API_URL=https://your-domain.com  # For production
```

### Server Configuration
```env
PORT=3001
NODE_ENV=production
CORS_ORIGIN=*  # or your specific domain
```

## Docker Build Fixes Applied

### Frontend
- ✅ Changed from `npm ci` to `npm install --legacy-peer-deps`
- ✅ Reason: npm ci requires package-lock.json which might not be available during Coolify builds
- ✅ Legacy peer deps flag handles any peer dependency mismatches

### Backend
- ✅ Changed from `npm ci` to `npm install`
- ✅ Changed production deps from `npm ci --only=production` to `npm install --production`
- ✅ Same reason: better compatibility with CI/CD systems

### Docker Compose
- ✅ Removed `depends_on` to allow parallel builds
- ✅ Updated health checks (wget for nginx frontend)
- ✅ Changed VITE_API_URL to use Docker service name internally

## How to Deploy via Coolify

1. **Add Environment Variables in Coolify**:
   - Go to Application Settings → Environment Variables
   - Add all required variables from above
   - Make sure SUPABASE_SERVICE_ROLE_KEY is marked as "Private"

2. **Connect GitHub Repository**:
   - Connect biztrixventure/crmv2.0
   - Set branch to `main`
   - Configure webhook for auto-deploy

3. **Configure Ports**:
   - Backend: 3001
   - Frontend: 80 (or 5173 for dev)

4. **Deploy**:
   - Coolify will:
     - Clone the repository
     - Build both services from Dockerfiles
     - Start containers with your environment variables
     - Expose services on configured ports

## Local Development Testing

Before deploying to Coolify, test locally:

```bash
# Option 1: Direct npm
cd backend && npm start  # Terminal 1
cd frontend && npm run dev  # Terminal 2

# Option 2: Docker Compose
docker-compose up --build

# Option 3: Docker Compose with env file
docker-compose --env-file .env.local up --build
```

## Troubleshooting

**Build fails with "npm ci"**: ✅ FIXED - Using npm install now

**Peer dependency errors**: ✅ FIXED - Frontend uses --legacy-peer-deps flag

**CORS errors**: Check CORS_ORIGIN environment variable is set correctly

**API can't reach backend**: In Docker, backend is at `http://backend:3001` from frontend

**Health check fails**: Wait 40+ seconds for startup, containers may take time to initialize

## Security Notes

⚠️  **NEVER commit .env file to git** - It's in .gitignore

⚠️  **Service Role Key** is private and can bypass RLS - use only server-side

⚠️  **Anon Key** is public and respects RLS - safe for frontend

⚠️  **In production**, use HTTPS and restrict CORS_ORIGIN to your domain

## Deployment Checklist

- [ ] All environment variables set in Coolify
- [ ] Database migrations run (001, 002, 003 SQL scripts)
- [ ] Seed data loaded (permissions, form fields)
- [ ] First company created manually
- [ ] First superadmin user created
- [ ] GitHub webhook configured
- [ ] Health checks passing (wait 40+ seconds)
- [ ] Login page loads: `https://your-domain/login`
- [ ] Backend health check: `https://your-domain/api/health`

## Next Deployment

Push to main branch:
```bash
git push origin main
```

Coolify will automatically detect the push and start deployment!

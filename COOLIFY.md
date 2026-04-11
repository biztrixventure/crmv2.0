# 🚀 Coolify Deployment Guide

This guide explains how to deploy BizTrix CRM v2.0 on Coolify using Docker Compose.

## Prerequisites

- Coolify instance running
- GitHub repository connected to Coolify
- Environment variables configured in Coolify

## Architecture

```
┌─────────────────────────────────────────┐
│           Coolify Server                 │
├─────────────────────────────────────────┤
│  ┌────────────────────────────────────┐  │
│  │   Frontend (React + Nginx)         │  │
│  │   Port: 5173 (or 80 inside)        │  │
│  └────────────────────────────────────┘  │
│                   ↓                       │
│  ┌────────────────────────────────────┐  │
│  │   Backend (Express)                │  │
│  │   Port: 3001 (internal network)    │  │
│  └────────────────────────────────────┘  │
│                   ↓                       │
│  ┌────────────────────────────────────┐  │
│  │   Supabase (Database)              │  │
│  │   Cloud-hosted                     │  │
│  └────────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## Setup Steps

### 1. Create Coolify Application

1. Go to your Coolify dashboard
2. Create a new **Docker Compose** application
3. Connect your GitHub repository (biztrixventure/crmv2.0)

### 2. Configure Docker Compose

Coolify will automatically detect `docker-compose.yaml` in your repository.

The file includes:
- **Frontend Service**: React app built with Vite, served via Nginx
- **Backend Service**: Express.js API server
- **Network**: Internal `biztrix-network` for service communication
- **Health Checks**: Automatic service health monitoring

### 3. Set Environment Variables

In Coolify application settings, add these variables:

```env
# Database
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=xxxxx
SUPABASE_SERVICE_ROLE_KEY=xxxxx

# API Configuration
VITE_API_URL=https://api.your-domain.com
CORS_ORIGIN=https://your-domain.com
FRONTEND_URL=https://your-domain.com

# App Mode
NODE_ENV=production
```

### 4. Configure Webhook

1. In your repository settings, get the Coolify webhook URL
2. Go to GitHub Settings → Webhooks → Add webhook
3. Payload URL: `https://your-coolify.com/webhook/...`
4. Content type: `application/json`
5. Events: `push` (branch: main)

### 5. Deploy

#### Automatic Deployment (Recommended)
```bash
# Push to main branch triggers automatic deployment
git push origin main
```

Coolify will automatically:
1. Pull latest code from GitHub
2. Build Docker images for backend and frontend
3. Start containers using docker-compose
4. Run health checks
5. Switch traffic to new version

#### Manual Deployment
1. Go to Coolify dashboard
2. Click "Deploy" button on your application
3. Wait for logs to show both services as "healthy"

## Ports & URLs

| Service | Port | URL |
|---------|------|-----|
| Frontend | 80/443 | https://your-domain.com |
| Backend API | 3001 | https://api.your-domain.com |
| Health Check | - | https://api.your-domain.com/health |

## Docker Compose Details

### Services

**Frontend Service**:
- Builds from `./frontend/Dockerfile`
- Node.js 18 build → Nginx Alpine serve
- Runs Vite build in container
- Serves React SPA with proper routing
- Proxies API requests to backend
- Health check via HTTP GET /

**Backend Service**:
- Builds from `./backend/Dockerfile`
- Node.js 18 Alpine image
- Multi-stage build for optimized size
- Runs Express server on port 3001
- Connected to internal network only (not exposed)
- Health check via HTTP GET /health

### Network

Both services communicate via internal `biztrix-network`:
- Frontend proxies `/api` and `/auth` requests to backend
- Backend unreachable from outside (only through frontend)
- Improved security

### Environment Variables

Services inherit from `.env.example`:

**Frontend receives:**
- `VITE_API_URL` - Backend URL (used at build time)
- `VITE_SUPABASE_URL` - Supabase URL
- `VITE_SUPABASE_ANON_KEY` - Supabase key

**Backend receives:**
- `NODE_ENV` - Production mode
- `PORT` - Server port (3001)
- `VITE_SUPABASE_URL` - Supabase URL
- `VITE_SUPABASE_ANON_KEY` - Supabase key
- `SUPABASE_SERVICE_ROLE_KEY` - Admin access
- `CORS_ORIGIN` - Allowed domains

## Monitoring

### Health Checks

Both services have health checks that Coolify monitors:

```bash
# Frontend health
curl https://your-domain.com/health

# Backend health
curl https://api.your-domain.com/health
```

### Logs

View logs in Coolify:
1. Go to Application → Logs
2. Filter by service (frontend/backend)
3. Search for errors

Common issues:
- `connection refused` - Backend not ready
- `upstream timeout` - Backend overloaded
- `404 Not Found` - Wrong route

## Volumes

Currently no persistent volumes (stateless app):
- Database: Supabase (cloud)
- Sessions: Stored on client (JWT)
- Uploads: Future implementation

To add volumes:
1. Update `docker-compose.yaml`
2. Commit and push
3. Coolify auto-deploys

Example:
```yaml
volumes:
  uploads:
    driver: local

services:
  backend:
    volumes:
      - uploads:/app/uploads
```

## Performance Optimization

### Frontend Optimization
- Vite production build (tree-shaking, minification)
- Nginx gzip compression
- Asset caching (1 year for .js, .css, images)
- CDN-ready (serve static assets from CDN)

### Backend Optimization
- Production mode (no debug logging)
- Connection pooling (via Supabase)
- Rate limiting (10 req/s general, 30 req/s API)
- Request timeout: 60s

### Security Hardening
- No root user in containers
- Read-only filesystem (where possible)
- Security headers (X-Frame-Options, CSP, etc.)
- Rate limiting
- CORS enforcement

## Troubleshooting

### Services Not Starting

1. Check logs:
```bash
docker logs biztrix-frontend
docker logs biztrix-backend
```

2. Verify environment variables:
   - All required variables set in Coolify
   - No typos in variable names
   - Supabase credentials valid

3. Check port availability:
   - Port 5173 (frontend)
   - Port 3001 (backend - internal only)

### API Requests Returning 502

1. Backend service unhealthy
   - Check logs for errors
   - Verify Supabase connection
   - Check environment variables

2. CORS issue
   - Verify `CORS_ORIGIN` matches domain
   - Check browser console for CORS errors

3. Rate limit exceeded
   - Default: 10 req/s general, 30 req/s API
   - Modify in `frontend/nginx.conf` if needed

### Frontend Not Loading

1. Check Nginx logs:
```bash
docker logs biztrix-frontend
```

2. Verify React route handling
   - Nginx configured to serve index.html for all routes
   - Check `frontend/nginx.conf` location rules

3. Assets not loading
   - Check build output in logs
   - Verify `VITE_API_URL` environment variable

## Scaling

### Horizontal Scaling

To run multiple backend instances:

```yaml
backend:
  deploy:
    replicas: 2  # Run 2 instances
  ports:
    - "3001-3002:3001"  # Port mapping
```

Frontend (Nginx) automatically load balances.

### Vertical Scaling

Update in Coolify:
1. Increase memory allocation
2. Increase CPU allocation
3. Increase build resources

## Backup & Recovery

### Database Backup

Supabase handles automatic backups:
1. Daily backups (configurable)
2. Point-in-time recovery
3. Export to CSV/JSON

### Application Backup

Coolify provides:
1. Automatic image builds
2. Version tagging
3. Rollback to previous version

To rollback:
1. Coolify Dashboard → Application
2. Select previous deployment
3. Click "Rollback"

## SSL/TLS Certificate

Coolify integrates with Let's Encrypt:

1. Configure domain in Coolify
2. Automatic certificate generation
3. Auto-renewal 30 days before expiry
4. HTTPS enforced for your domain

## Git Integration

### Auto-Deploy on Push

1. Webhook configured (see Setup Steps)
2. Push to `main` branch
3. Coolify detects push event
4. Builds and deploys automatically

### Manual Deploy

If webhook fails:
1. Coolify Dashboard → Your Application
2. Click "Deploy" button
3. Wait for build to complete

## CI/CD Pipeline

```
GitHub Commit
    ↓
Webhook triggers Coolify
    ↓
Pull latest code
    ↓
Build Backend Docker image
    ↓
Build Frontend Docker image
    ↓
Health checks pass?
    ↓ YES
Update running containers
    ↓
LIVE 🚀
```

## Maintenance

### Database Migrations

For schema changes:

1. Update `backend/migrations/` files
2. Commit and push to GitHub
3. Coolify deploys
4. Run migrations manually via Supabase Dashboard

Example:
```bash
# In Supabase SQL Editor
-- Paste migration SQL here
```

### Dependency Updates

```bash
# Backend
cd backend
npm update
npm audit fix

# Frontend
cd frontend
npm update
npm audit fix

# Commit and push
git add -A
git commit -m "Update dependencies"
git push origin main
```

## Disaster Recovery

### If Frontend Container Crashes

Coolify automatically:
1. Detects failed health check
2. Restarts container
3. Keeps backend running

### If Backend Container Crashes

1. Frontend still serves (cached responses)
2. API calls fail with 502
3. Coolify restarts backend
4. Service recovers automatically

### If Supabase is Down

1. Frontend loads (static content)
2. API calls fail
3. Show error to user
4. Automatically retry

## Cost Optimization

- Single instance runs both services
- Shared network reduces overhead
- No database server (cloud Supabase)
- Container auto-cleanup

## Support

For Coolify issues:
- https://coolify.io/docs
- https://github.com/coollabsio/coolify

For app issues:
- Check logs: `docker logs biztrix-*`
- Review environment variables
- Verify Supabase connection

## Next Steps

After deployment:

1. ✅ Configure custom domain
2. ✅ Setup SSL certificate
3. ✅ Configure monitoring/alerts
4. ✅ Setup database backups
5. ✅ Implement CI/CD pipeline
6. ✅ Performance testing
7. ✅ Load testing

---

**Last Updated:** 2024-04-12
**Maintained By:** @abdulmanan69
**Project:** BizTrix CRM v2.0

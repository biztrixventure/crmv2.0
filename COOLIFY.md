# 🚀 Coolify Deployment Guide (Nixpacks)

This guide explains how to deploy BizTrix CRM v2.0 on Coolify using **Nixpacks** (not Docker Compose).

## Deployment Model

Create **two separate services** in Coolify from the same repository:

- **Frontend service**
  - Root Directory: `frontend`
  - Build Pack: `Nixpacks`
  - Domain: `your-frontend-domain.com`
  - Start command comes from `frontend/nixpacks.toml`

- **Backend service**
  - Root Directory: `backend`
  - Build Pack: `Nixpacks`
  - Domain: `api.your-domain.com`
  - Start command comes from `backend/nixpacks.toml`

## Environment Variables

Set these in Coolify:

### Frontend service
```env
NODE_ENV=production
VITE_API_URL=https://api.your-domain.com
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Backend service
```env
NODE_ENV=production
PORT=3001
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
CORS_ORIGIN=https://your-frontend-domain.com
FRONTEND_URL=https://your-frontend-domain.com
```

## Domain and Health Checks

- Frontend URL: `https://your-frontend-domain.com`
- Backend URL: `https://api.your-domain.com`
- Backend health: `https://api.your-domain.com/health`

## Notes

- This deployment is Nixpacks-only; Dockerfiles and docker-compose are not required.
- Keep URL configuration in Coolify domains + environment variables only.
- Commit/push to `main` to trigger deployment.

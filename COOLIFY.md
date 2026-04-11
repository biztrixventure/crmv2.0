# 🚀 Coolify Deployment Guide (Nixpacks)

This guide explains how to deploy BizTrix CRM v2.0 on Coolify using **Nixpacks** (not Docker Compose).

## Deployment Model

Create **two separate services** in Coolify from the same repository:

- **Frontend service**
  - Root Directory: `frontend`
  - Build Pack: `Nixpacks`
  - Domain: `tokocrypto.live`
  - Start command comes from `frontend/nixpacks.toml`

- **Backend service**
  - Root Directory: `backend`
  - Build Pack: `Nixpacks`
  - Domain: `api.tokocrypto.live`
  - Start command comes from `backend/nixpacks.toml`

## Environment Variables

Set these in Coolify:

### Frontend service
```env
NODE_ENV=production
VITE_API_URL=https://api.tokocrypto.live
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
CORS_ORIGIN=https://tokocrypto.live
FRONTEND_URL=https://tokocrypto.live
```

## Domain and Health Checks

- Frontend URL: `https://tokocrypto.live`
- Backend URL: `https://api.tokocrypto.live`
- Backend health: `https://api.tokocrypto.live/health`

## Notes

- Do **not** put frontend/backend public URLs in Dockerfiles.
- Keep URL configuration in Coolify domains + environment variables only.
- Commit/push to `main` to trigger deployment.

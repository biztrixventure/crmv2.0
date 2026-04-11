# BizTrix CRM v2.0 - Deployment Configuration (Nixpacks)

## Coolify Setup

Deploy as two Nixpacks services from one repo:

1. Frontend service
   - Root directory: `frontend`
   - Domain: `tokocrypto.live`
2. Backend service
   - Root directory: `backend`
   - Domain: `api.tokocrypto.live`

## Required Environment Variables

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

## Verification Checklist

- `https://tokocrypto.live/login` loads frontend login page
- `https://api.tokocrypto.live/health` returns backend health JSON
- Browser API calls target `https://api.tokocrypto.live`

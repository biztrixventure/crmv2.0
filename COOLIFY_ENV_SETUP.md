## Coolify Production Environment Variables Setup (Nixpacks, two services)

Set values in **Coolify Dashboard → Project → Services → Environment Variables**.
Do not commit real keys to the repository.

### Frontend service variables

```env
NODE_ENV=production
VITE_API_URL=https://api.your-domain.com
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Backend service variables

```env
NODE_ENV=production
PORT=3001
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
CORS_ORIGIN=https://your-frontend-domain.com
FRONTEND_URL=https://your-frontend-domain.com
```

### Buildtime flags

- Frontend: mark `VITE_*` as **Buildtime + Runtime**
- Backend: mark `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as **Buildtime + Runtime**
- Backend: mark `SUPABASE_SERVICE_ROLE_KEY`, `CORS_ORIGIN`, `FRONTEND_URL`, `PORT`, `NODE_ENV` as **Runtime only**

### Verify deployment

```bash
curl https://api.your-domain.com/health
curl https://your-frontend-domain.com/
```

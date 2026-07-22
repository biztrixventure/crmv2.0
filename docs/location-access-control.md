# Location access control — internal CRM only from allowed locations

Goal: the **internal CRM** (staff / managers / compliance / admin) is reachable
only from your allowed location(s); the **client recording portal** (external
clients, often overseas) stays reachable from anywhere. Identity stays with the
app's own login — no second login, no email domain required.

Two layers:

## Layer 1 (primary) — Cloudflare edge rule
1. Add the CRM domain to a free Cloudflare account and switch its DNS to
   Cloudflare (orange-cloud / proxied). Optionally run **Cloudflare Tunnel**
   (`cloudflared`) on the Coolify host so the origin has no open ports.
2. Cloudflare dashboard → **Security → WAF → Custom rules → Create**. Expression
   (replace `PK` with your country ISO-2 code; add more with `in {"PK" "US"}`):

   ```
   (ip.geoip.country ne "PK")
     and not starts_with(http.request.uri.path, "/portal")
     and not starts_with(http.request.uri.path, "/api/portal")
     and not starts_with(http.request.uri.path, "/api/auth")
   ```
   Action: **Block**.

   → Everyone outside your country is blocked from the CRM UI + API, but
   `/portal`, the portal API, and the login endpoint stay open, so overseas
   clients and the login flow keep working.
3. (Optional, tighter) To lock the **admin area** to the office only, add a
   second rule: `starts_with(uri.path,"/admin") and ip.src ne <office_ip>` → Block,
   or use Cloudflare Access with an IP-range Require policy for `/admin`.

Find your office public IP: on an office machine open `https://ifconfig.me`.
Check on two different days — same value ⇒ effectively static.

## Layer 2 (defense-in-depth) — in-app gate
`backend/middleware/geoGate.js` (mounted in `server.js` before the routes) is the
second layer + audit log. It reads Cloudflare's `Cf-IPCountry` / `Cf-Connecting-IP`.

**Opt-in, safe by default** (env — set on the backend / Coolify):
```
GEO_GATE_ENABLED=true              # default OFF (no-op) until you set this
GEO_ALLOWED_COUNTRIES=PK           # ISO-2 list allowed into the internal CRM
GEO_ALLOWED_IPS=203.0.113.4        # office/allowlist IPs that always pass (CIDR ok)
# GEO_EXEMPT_PREFIXES=/api/whatever # extra always-allowed path prefixes
```
Always exempt (never blocked): `/api/portal`, `/portal`, `/api/auth`,
`/api/branding`, `/health`. It **fails open** when the `Cf-IPCountry` header is
absent (i.e. requests not coming through Cloudflare) — Cloudflare's edge rule is
the real gate; this layer only bites for CF-proxied traffic and logs blocks
(`GEO_GATE` in the logger).

## Rollout order (no downtime, no lockout)
1. Deploy the code (gate is OFF by default — nothing changes).
2. Set up Cloudflare DNS + the WAF rule; verify the portal + login still work
   from a foreign VPN and the CRM is blocked from a foreign VPN.
3. Then set `GEO_GATE_ENABLED=true` + `GEO_ALLOWED_COUNTRIES` on the backend for
   the in-app second layer. Test again. Keep your office IP in `GEO_ALLOWED_IPS`
   as a safety valve.

## Why not Cloudflare Access login / SSO here
The team's accounts use an email domain you don't own, so Cloudflare's own
email-OTP / Google / Microsoft identity can't be used. Identity therefore stays
with the CRM's existing Supabase login; Cloudflare only enforces **location**.

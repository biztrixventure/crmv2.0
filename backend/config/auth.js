const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const https = require('https');

/**
 * Supabase JWT verification.
 *
 * HISTORY / WHY THIS FILE MATTERS:
 * This used to call `jwt.decode()` — which only base64-decodes the payload and
 * checks `exp`. It NEVER checked the signature. The comment claimed we could
 * "rely on Supabase's RLS policies for security", but that assumption was false:
 * essentially every query in this codebase uses `supabaseAdmin` (the service-role
 * client), which BYPASSES RLS entirely. The result was a full authentication
 * bypass — anyone could hand-craft a token with `app_metadata.role: "superadmin"`
 * (or any real user's `sub`) and receive complete cross-tenant access, with no
 * password and no secret. Every permission/company-scoping check downstream was
 * decorative. Do NOT reintroduce `jwt.decode()` on the request path.
 *
 * HOW VERIFICATION WORKS NOW:
 * Supabase signs access tokens asymmetrically (ES256/RS256) and publishes the
 * public keys at {SUPABASE_URL}/auth/v1/.well-known/jwks.json. We fetch that
 * once, cache it by `kid`, and verify the signature properly. Legacy projects
 * that still sign symmetrically (HS256) are supported via SUPABASE_JWT_SECRET.
 *
 * FAIL-CLOSED: any token we cannot cryptographically verify is rejected. A JWKS
 * fetch failure serves the last-known-good key set (so a network blip doesn't
 * log the whole company out) but never degrades into "accept without checking".
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const JWKS_URL = SUPABASE_URL ? `${SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/.well-known/jwks.json` : null;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';

// kid → crypto.KeyObject. Kept indefinitely once fetched; a key only disappears
// when Supabase rotates, which surfaces as an unknown kid and triggers a refetch.
let keyCache = new Map();
let lastFetchAt = 0;
let inFlight = null;
const REFRESH_MS = 10 * 60 * 1000;   // proactive refresh window
const MIN_REFETCH_MS = 30 * 1000;    // floor between refetches on unknown kid (anti-DoS)

function fetchJwks() {
  return new Promise((resolve, reject) => {
    if (!JWKS_URL) return reject(new Error('No Supabase URL configured for JWKS'));
    const req = https.get(JWKS_URL, { timeout: 8000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`JWKS fetch returned HTTP ${res.statusCode}`));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (!parsed || !Array.isArray(parsed.keys)) throw new Error('JWKS missing keys[]');
          resolve(parsed.keys);
        } catch (e) { reject(new Error(`JWKS parse failed: ${e.message}`)); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('JWKS fetch timed out')); });
    req.on('error', reject);
  });
}

// Refresh the cache. On failure we KEEP the existing keys (stale-but-valid beats
// locking every user out over a transient network error) and just report it.
async function refreshKeys() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const jwks = await fetchJwks();
      const next = new Map();
      for (const jwk of jwks) {
        if (!jwk || !jwk.kid) continue;
        // Only signing keys are usable here; ignore anything else Supabase lists.
        if (jwk.use && jwk.use !== 'sig') continue;
        try {
          next.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }));
        } catch { /* skip a key we can't import rather than failing the whole set */ }
      }
      if (next.size) { keyCache = next; lastFetchAt = Date.now(); }
      return keyCache;
    } finally { inFlight = null; }
  })();
  return inFlight;
}

// Resolve the public key for a token's `kid`, refetching once if it's unknown
// (covers Supabase key rotation without a restart).
async function keyForKid(kid) {
  if (!kid) return null;
  if (keyCache.has(kid)) {
    // Opportunistic background refresh; never blocks this request.
    if (Date.now() - lastFetchAt > REFRESH_MS) refreshKeys().catch(() => {});
    return keyCache.get(kid);
  }
  if (Date.now() - lastFetchAt > MIN_REFETCH_MS) await refreshKeys().catch(() => {});
  return keyCache.get(kid) || null;
}

// ── Remote verification fallback ────────────────────────────────────────────
// Safety net for the cases local verification cannot settle: a legacy HS256
// project with no SUPABASE_JWT_SECRET configured, or an asymmetric token whose
// `kid` is not in our JWKS view. Supabase's Auth API is asked to validate the
// token; it answers authoritatively for whichever scheme the project actually
// uses, so a signing-scheme mismatch can never lock users out.
//
// This is a network call, so successful answers are cached briefly (keyed by a
// SHA-256 of the token — the raw token is never stored or logged) and never
// past the token's own expiry. Failures are NOT cached and always deny.
const remoteCache = new Map();
const REMOTE_TTL_MS = 60 * 1000;
const tokenKey = (t) => crypto.createHash('sha256').update(t).digest('hex');

function sweepRemoteCache() {
  const now = Date.now();
  for (const [k, v] of remoteCache) if (v.until <= now) remoteCache.delete(k);
}

async function verifyRemotely(cleanToken, unverifiedPayload) {
  const key = tokenKey(cleanToken);
  const hit = remoteCache.get(key);
  if (hit && hit.until > Date.now()) return hit.payload;

  // Required lazily: config/database pulls in the Supabase client, and importing
  // it at module scope would create a require cycle with anything auth touches.
  const { supabaseAdmin } = require('./database');
  const { data, error } = await supabaseAdmin.auth.getUser(cleanToken);
  if (error || !data?.user) {
    throw new Error(`Token verification failed: rejected by Supabase (${error?.message || 'no user'})`);
  }
  const u = data.user;
  // Rebuild the payload from what Supabase itself vouched for. Claims are taken
  // from the verified user record, never from the unverified token body — the
  // only fields borrowed are the non-authoritative timestamps.
  const payload = {
    sub: u.id,
    email: u.email,
    role: u.role,
    app_metadata: u.app_metadata || {},
    user_metadata: u.user_metadata || {},
    iat: unverifiedPayload?.iat,
    exp: unverifiedPayload?.exp,
  };
  // Never cache past the token's own expiry.
  const expMs = payload.exp ? payload.exp * 1000 : 0;
  const until = Math.min(Date.now() + REMOTE_TTL_MS, expMs || (Date.now() + REMOTE_TTL_MS));
  if (until > Date.now()) remoteCache.set(key, { payload, until });
  if (remoteCache.size > 5000) sweepRemoteCache();
  return payload;
}

/**
 * Verify a Supabase JWT and return its payload.
 * @param {string} token - JWT with or without the "Bearer " prefix
 * @returns {Promise<object>} verified payload
 * @throws if the signature, algorithm, or expiry is not valid
 */
const verifyToken = async (token) => {
  const cleanToken = String(token || '').startsWith('Bearer ') ? String(token).slice(7) : String(token || '');
  if (!cleanToken) throw new Error('Token verification failed: no token supplied');

  // Read the header ONLY to pick the right key — never to trust its contents.
  const decoded = jwt.decode(cleanToken, { complete: true });
  if (!decoded || !decoded.header || !decoded.payload) {
    throw new Error('Token verification failed: malformed token');
  }
  const alg = decoded.header.alg;

  // `jwt.verify` enforces exp/nbf itself, so expiry is covered on every path.
  if (alg === 'HS256') {
    // Legacy symmetric signing. Verify locally when the secret is configured;
    // otherwise fall back to asking Supabase (below) rather than either
    // trusting the token blind (the old bug) or locking every user out.
    if (JWT_SECRET) return jwt.verify(cleanToken, JWT_SECRET, { algorithms: ['HS256'] });
    return await verifyRemotely(cleanToken, decoded.payload);
  }

  if (alg === 'ES256' || alg === 'RS256') {
    const key = await keyForKid(decoded.header.kid);
    // An unknown kid means our JWKS view is stale or the project signs with a
    // key we can't see — ask Supabase instead of rejecting a possibly-valid user.
    if (!key) return await verifyRemotely(cleanToken, decoded.payload);
    return jwt.verify(cleanToken, key, { algorithms: ['ES256', 'RS256'] });
  }

  // Anything else — notably alg:"none" — is refused outright. `none` is the
  // forged-token case and must never reach the remote fallback.
  throw new Error(`Token verification failed: unsupported algorithm ${alg}`);
};

// Warm the cache at boot so the first request doesn't pay the JWKS round-trip.
// Failure here is non-fatal: the first verify will retry.
if (JWKS_URL) refreshKeys().catch(() => {});

module.exports = { verifyToken, _refreshKeys: refreshKeys };

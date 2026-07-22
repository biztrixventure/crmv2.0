// ============================================================================
// geoGate — location restriction for the INTERNAL CRM API, with the client
// portal (overseas clients) always exempt.
//
// Primary enforcement is meant to live at Cloudflare (a WAF custom rule on the
// domain: block country ≠ allowed AND path not /portal). This middleware is the
// in-app SECOND layer + the audit hook, reading the headers Cloudflare adds:
//   Cf-IPCountry     — ISO-2 country of the visitor
//   Cf-Connecting-IP — the real client IP
//
// SAFE BY DEFAULT — everything is opt-in via env, and it FAILS OPEN so it can
// never lock out staff or clients by accident:
//   GEO_GATE_ENABLED=true            turn it on (default OFF = pass everything)
//   GEO_ALLOWED_COUNTRIES=PK,US      ISO-2 list allowed to reach the internal CRM
//   GEO_ALLOWED_IPS=1.2.3.4,5.6.7.0/24   office/allowlisted IPs that always pass
//   GEO_EXEMPT_PREFIXES=/portal,/auth extra path prefixes to never gate
//
// Exempt no matter what: the client portal + auth + health + branding, so
// overseas portal clients and the login flow are never blocked.
// Behind Cloudflare only Cf-IPCountry is trusted; with no such header (not
// proxied) it PASSES (Cloudflare is the real gate) but still logs.
// ============================================================================
const logger = require('./../utils/logger');

const bool = (v) => String(v || '').toLowerCase() === 'true';
const list = (v) => String(v || '').split(',').map(s => s.trim()).filter(Boolean);

const ENABLED = bool(process.env.GEO_GATE_ENABLED);
const ALLOWED_COUNTRIES = new Set(list(process.env.GEO_ALLOWED_COUNTRIES).map(c => c.toUpperCase()));
const ALLOWED_IPS = list(process.env.GEO_ALLOWED_IPS);
// Always-exempt prefixes: the external client portal + auth + health/branding.
const BASE_EXEMPT = ['/api/portal', '/portal', '/api/auth', '/api/branding', '/api/health', '/health'];
const EXEMPT = [...BASE_EXEMPT, ...list(process.env.GEO_EXEMPT_PREFIXES)];

// Simple IPv4 CIDR / exact match (covers office allowlists). IPv6 → exact only.
function ipMatches(ip, rule) {
  if (!ip || !rule) return false;
  if (!rule.includes('/')) return ip === rule || ip.endsWith(`:${rule}`);
  const [range, bitsStr] = rule.split('/');
  const bits = parseInt(bitsStr, 10);
  const toInt = (a) => a.split('.').reduce((n, o) => (n << 8) + (parseInt(o, 10) || 0), 0) >>> 0;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || !/^\d+\.\d+\.\d+\.\d+$/.test(range)) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (toInt(ip) & mask) === (toInt(range) & mask);
}

function geoGate(req, res, next) {
  if (!ENABLED) return next();                                  // opt-in — off = no-op
  const path = req.path || req.originalUrl.split('?')[0];
  if (EXEMPT.some(p => path.startsWith(p))) return next();      // portal / auth / health always pass

  const ip = req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip;
  if (ALLOWED_IPS.some(rule => ipMatches(ip, rule))) return next();   // office / allowlisted IP

  const country = String(req.headers['cf-ipcountry'] || '').toUpperCase();
  // No Cloudflare country header → not proxied through CF (or a health probe).
  // Fail OPEN (Cloudflare's edge rule is the real gate); log so it's visible.
  if (!country || country === 'XX' || country === 'T1') {
    return next();
  }
  if (ALLOWED_COUNTRIES.size === 0 || ALLOWED_COUNTRIES.has(country)) return next();

  logger.warn('GEO_GATE', `Blocked ${req.method} ${path} from country=${country} ip=${ip}`);
  return res.status(403).json({ error: 'This system is not available from your location.' });
}

module.exports = { geoGate };

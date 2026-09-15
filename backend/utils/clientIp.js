// ============================================================================
// utils/clientIp.js -- the ONE answer to "what address is this request from?"
// for IP access control (mig 319).
//
// Behind nginx / Traefik (Coolify) / Cloudflare the socket peer is the proxy,
// not the person. A forwarded header carries the real address -- but any client
// can send that header too, so it is only believed when the request actually
// arrived FROM a proxy we trust. Otherwise the raw socket address wins.
//
// Configuration is deploy-time (env), never an admin screen: a setting an admin
// could flip to "trust everyone" would let any user spoof their way past a rule.
//
//   IP_TRUSTED_PROXIES  comma list of IPs / CIDRs / Express keywords
//                       (loopback, linklocal, uniquelocal). Empty = trust no
//                       proxy, which is exactly how the app has always behaved.
//   IP_CLIENT_HEADER    x-forwarded-for (default) | cf-connecting-ip
//
// X-Forwarded-For uses Express's own trusted-proxy support (`trust proxy`,
// backed by proxy-addr): it walks the chain right-to-left, skipping trusted
// hops, and req.ip becomes the first untrusted address. CF-Connecting-IP is a
// single value Cloudflare sets; it is read only when the immediate peer is a
// trusted proxy.
//
// configureTrustProxy(app) is a no-op when IP_TRUSTED_PROXIES is unset, so
// req.ip -- and the rate limiters keyed on it -- stay exactly as they are today.
// ============================================================================
const logger = require('./logger');
const { normalizeIp, normalizeRule, isPrivateIp } = require('./ipAddress');

const EXPRESS_KEYWORDS = new Set(['loopback', 'linklocal', 'uniquelocal']);
const HEADERS = new Set(['x-forwarded-for', 'cf-connecting-ip']);

function readTrustedProxies(env = process.env) {
  const out = [];
  const invalid = [];
  for (const raw of String(env.IP_TRUSTED_PROXIES || '').split(',')) {
    const s = raw.trim();
    if (!s) continue;
    if (EXPRESS_KEYWORDS.has(s.toLowerCase())) { out.push(s.toLowerCase()); continue; }
    const r = normalizeRule(s);
    if (r.ok) out.push(r.value); else invalid.push(s);
  }
  return { list: out, invalid };
}

function clientHeader(env = process.env) {
  const h = String(env.IP_CLIENT_HEADER || 'x-forwarded-for').trim().toLowerCase();
  return HEADERS.has(h) ? h : 'x-forwarded-for';
}

// Wire the trusted-proxy list into Express. Returns what it did, for the boot log.
function configureTrustProxy(app, env = process.env) {
  const { list, invalid } = readTrustedProxies(env);
  if (invalid.length) {
    logger.warn('CLIENT_IP', `IP_TRUSTED_PROXIES: ignoring invalid entr${invalid.length === 1 ? 'y' : 'ies'} ${invalid.join(', ')}`);
  }
  if (!list.length) return { configured: false, list: [] };
  try {
    app.set('trust proxy', list);
    logger.info('CLIENT_IP', `trusting proxies ${list.join(', ')}; client header ${clientHeader(env)}`);
    return { configured: true, list };
  } catch (e) {
    // proxy-addr rejected the list -- keep the safe default (trust nobody).
    logger.error('CLIENT_IP', `IP_TRUSTED_PROXIES rejected (${e.message}); trusting no proxy`);
    return { configured: false, list: [], error: e.message };
  }
}

function peerAddress(req) {
  return req?.socket?.remoteAddress || req?.connection?.remoteAddress || null;
}

// Did this request arrive straight from a trusted proxy?
function peerIsTrusted(req) {
  const raw = peerAddress(req);
  if (!raw) return false;
  const trust = req.app && typeof req.app.get === 'function' ? req.app.get('trust proxy fn') : null;
  try { return typeof trust === 'function' ? !!trust(raw, 0) : false; } catch { return false; }
}

// The client address for this request, canonical form, or null if unknown.
function resolveClientIp(req, env = process.env) {
  const peer = normalizeIp(peerAddress(req));
  if (!peerIsTrusted(req)) return peer;

  if (clientHeader(env) === 'cf-connecting-ip') {
    const cf = normalizeIp(req.headers?.['cf-connecting-ip']);
    if (cf) return cf;
  }
  // Express has already resolved X-Forwarded-For against the trusted list.
  return normalizeIp(req.ip) || peer;
}

// Everything an admin needs to check the proxy setup before switching IP
// restriction on -- shown on the IP Access screen as "your detected IP".
function describeClientIp(req, env = process.env) {
  const { list, invalid } = readTrustedProxies(env);
  const resolved = resolveClientIp(req, env);
  const trusted = peerIsTrusted(req);
  const xff = req.headers?.['x-forwarded-for'] || null;
  const cf = req.headers?.['cf-connecting-ip'] || null;
  const header = clientHeader(env);

  const warnings = [];
  const peer = normalizeIp(peerAddress(req));
  if (!list.length && (xff || cf)) {
    warnings.push(`A forwarded-address header is arriving but IP_TRUSTED_PROXIES is not set, so it is ignored and every user appears to come from the proxy (${peer || 'unknown'}). `
      + `Set IP_TRUSTED_PROXIES=${peer || '<proxy address>'} (or "uniquelocal" to trust any private-network proxy) in the backend environment and restart before relying on IP rules.`);
  }
  if (list.length && !trusted && (xff || cf)) {
    warnings.push(`This request came from ${peer || 'an address'}, which is not in IP_TRUSTED_PROXIES, so its forwarded header was ignored. If that is your proxy, add it to IP_TRUSTED_PROXIES.`);
  }
  if (header === 'cf-connecting-ip' && trusted && !cf) {
    warnings.push('IP_CLIENT_HEADER is cf-connecting-ip but this request carried no CF-Connecting-IP header; fell back to X-Forwarded-For.');
  }
  if (resolved && isPrivateIp(resolved)) {
    warnings.push(`The detected address ${resolved} is a private/loopback address. That is expected on an office LAN, but if you connect over the internet it means the proxy is not configured and everyone would share this address.`);
  }
  if (invalid.length) warnings.push(`IP_TRUSTED_PROXIES has invalid entries that are ignored: ${invalid.join(', ')}`);

  return {
    ip: resolved,
    peer_ip: normalizeIp(peerAddress(req)),
    peer_trusted: trusted,
    header,
    forwarded_for: xff,
    cf_connecting_ip: cf,
    trusted_proxies: list,
    trusted_proxies_configured: list.length > 0,
    is_private: resolved ? isPrivateIp(resolved) : false,
    warnings,
  };
}

module.exports = { resolveClientIp, describeClientIp, configureTrustProxy, readTrustedProxies, clientHeader };

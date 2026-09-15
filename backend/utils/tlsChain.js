// ============================================================================
// utils/tlsChain.js -- complete a server's certificate chain the way a browser
// does, instead of failing with UNABLE_TO_VERIFY_LEAF_SIGNATURE.
//
// THE PROBLEM. A TLS server is supposed to send its own certificate AND the
// intermediate that signed it. Plenty of dialers send only their own. The new
// flexodialer box does exactly this (measured 2026-09-15): it serves
// "*.flexodialer.com" and omits "SSL.com TLS Issuing RSA CA R1". Chrome and
// Windows quietly download the missing intermediate, so the site looks fine in
// a browser. Node does not, so every CRM call to that dialer -- recordings,
// dispositions, the IP validator's API check -- died with
// UNABLE_TO_VERIFY_LEAF_SIGNATURE.
//
// WHAT THIS DOES. On exactly that failure, it reads the server's certificate,
// follows the "CA Issuers" address the certificate itself carries (the AIA
// extension), downloads the missing intermediate, and retries with it added to
// the chain. Then Node verifies the WHOLE chain, as normal.
//
// WHAT IT DOES NOT DO: switch verification off. `rejectUnauthorized:false` would
// let anyone in the middle read the dialer credentials in every request. Here:
//   - the downloaded intermediate must actually have signed the certificate
//     (issuer name matches AND the signature verifies), or it is thrown away;
//   - it is only a LINK, never a trust anchor. The chain must still end at a
//     root Node already ships with (tls.rootCertificates), and Node's default
//     allowPartialTrustChain=false means an intermediate alone trusts nothing;
//   - a self-signed certificate fetched from the network is never added, so a
//     forged chain cannot smuggle in its own root;
//   - the hostname is still checked by Node, untouched.
// A server whose chain cannot be completed that way fails exactly as before.
//
// The real fix belongs on the dialer (serve the full chain: fullchain.pem /
// SSLCertificateChainFile). status() reports which hosts needed repairing so
// the admin screen can say so instead of hiding it.
// ============================================================================
const tls = require('tls');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const logger = require('./logger');

// Errors that mean "I could not find the certificate that signed this one" --
// the only case this module touches. Everything else (expired, wrong host,
// self-signed, revoked) is a real problem and is left to fail.
const CHAIN_ERRORS = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
]);

const MAX_HOPS = 3;                 // leaf -> intermediate -> intermediate -> root
const MAX_CERT_BYTES = 64 * 1024;   // an intermediate is ~2 KB; refuse anything silly
const NET_TIMEOUT_MS = 8000;
const RETRY_FAILED_AFTER_MS = 10 * 60 * 1000;

const agents = new Map();      // "host:port" -> https.Agent with the completed chain
const repaired = new Map();    // "host:port" -> { at, chain: [subject CN...] }
const failed = new Map();      // "host:port" -> { at, reason }
const inflight = new Map();    // "host:port" -> Promise, so a burst repairs once

let bundledRoots = null;       // parsed lazily, once
const roots = () => {
  if (!bundledRoots) {
    bundledRoots = [];
    for (const pem of tls.rootCertificates) {
      try { bundledRoots.push(new crypto.X509Certificate(pem)); } catch { /* skip unparsable */ }
    }
  }
  return bundledRoots;
};

const cn = (cert) => (String(cert.subject || '').split('\n').find(l => l.startsWith('CN=')) || cert.subject || '').replace(/^CN=/, '');
const isSelfSigned = (cert) => cert.subject === cert.issuer && cert.verify(cert.publicKey);
const signedBy = (cert, issuer) => cert.checkIssued(issuer) && cert.verify(issuer.publicKey);

// The server's own certificate, read without verifying it -- we only need to
// see what it claims so we know which intermediate to fetch. Nothing is sent.
function peerCertificate(host, port) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: NET_TIMEOUT_MS }, () => {
      try {
        const c = socket.getPeerCertificate(true);
        socket.end();
        if (!c || !c.raw) return reject(new Error('no certificate presented'));
        resolve(new crypto.X509Certificate(c.raw));
      } catch (e) { socket.destroy(); reject(e); }
    });
    socket.on('timeout', () => { socket.destroy(); reject(new Error('timed out reading the certificate')); });
    socket.on('error', reject);
  });
}

// "CA Issuers - URI:http://cert.ssl.com/SSLcom-TLS-I-RSA-R1.cer" -> the URL.
function issuerUrl(cert) {
  const m = String(cert.infoAccess || '').match(/CA Issuers - URI:(\S+)/i);
  return m ? m[1] : null;
}

function download(url, redirects = 2) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { timeout: NET_TIMEOUT_MS }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).toString(), redirects - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`issuer download HTTP ${res.statusCode}`)); }
      const chunks = []; let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_CERT_BYTES) { req.destroy(); reject(new Error('issuer certificate too large')); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => req.destroy(new Error('issuer download timed out')));
    req.on('error', reject);
  });
}

async function buildAgent(host, port) {
  let cert = await peerCertificate(host, port);
  const intermediates = [];
  const names = [cn(cert)];

  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    if (roots().some(r => signedBy(cert, r))) break;          // reached a bundled root
    const url = issuerUrl(cert);
    if (!url) throw new Error(`"${cn(cert)}" names no issuer to fetch`);
    let issuer;
    try { issuer = new crypto.X509Certificate(await download(url)); }
    catch (e) { throw new Error(`could not load issuer from ${url}: ${e.message}`); }
    if (!signedBy(cert, issuer)) throw new Error(`certificate at ${url} did not sign "${cn(cert)}"`);
    // Never let the network hand us a root. Trust must come from Node's bundle.
    if (isSelfSigned(issuer)) throw new Error(`issuer "${cn(issuer)}" is a root Node does not trust`);
    intermediates.push(issuer.toString());
    names.push(cn(issuer));
    cert = issuer;
  }
  if (!intermediates.length) return null;                     // chain was never the problem

  // Node still verifies everything: signatures, validity dates, hostname, and a
  // path to a bundled root. The intermediates only fill the missing link.
  const agent = new https.Agent({ keepAlive: true, ca: [...tls.rootCertificates, ...intermediates] });
  return { agent, names };
}

/**
 * Complete the chain for host:port, once. Resolves to an https.Agent, or null
 * when it cannot be completed safely (the caller then fails exactly as before).
 */
async function repair(host, port = 443) {
  const key = `${host}:${port}`;
  if (agents.has(key)) return agents.get(key);
  const f = failed.get(key);
  if (f && Date.now() - f.at < RETRY_FAILED_AFTER_MS) return null;
  if (inflight.has(key)) return inflight.get(key);

  const p = buildAgent(host, Number(port))
    .then((res) => {
      if (!res) { failed.set(key, { at: Date.now(), reason: 'chain already complete; the failure was something else' }); return null; }
      agents.set(key, res.agent);
      repaired.set(key, { at: new Date().toISOString(), chain: res.names });
      failed.delete(key);
      logger.warn('TLS', `${key} sends an incomplete certificate chain; completed it via AIA (${res.names.join(' <- ')}). Fix on the server: serve the full chain.`);
      return res.agent;
    })
    .catch((e) => {
      failed.set(key, { at: Date.now(), reason: e.message });
      logger.warn('TLS', `${key} chain could not be completed: ${e.message}`);
      return null;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

const isChainError = (err) => CHAIN_ERRORS.has(err?.code) || CHAIN_ERRORS.has(err?.cause?.code);

function targetOf(config) {
  try {
    const u = new URL(config.url, config.baseURL || undefined);
    return u.protocol === 'https:' ? { host: u.hostname, port: u.port || 443 } : null;
  } catch { return null; }
}

/**
 * Hook an axios instance: on a missing-intermediate failure, complete the
 * chain and retry the request ONCE. Hosts already repaired get their agent up
 * front, so only the very first call to a broken host pays the retry.
 */
function install(axios) {
  if (axios.__tlsChainInstalled) return;
  axios.__tlsChainInstalled = true;

  axios.interceptors.request.use((config) => {
    if (!config.httpsAgent) {
      const t = targetOf(config);
      const agent = t && agents.get(`${t.host}:${t.port}`);
      if (agent) config.httpsAgent = agent;
    }
    return config;
  });

  axios.interceptors.response.use(undefined, async (error) => {
    const config = error?.config;
    if (!config || config.__tlsChainRetried || !isChainError(error)) throw error;
    const t = targetOf(config);
    if (!t) throw error;
    const agent = await repair(t.host, t.port);
    if (!agent) throw error;
    return axios.request({ ...config, httpsAgent: agent, __tlsChainRetried: true });
  });
}

/** Which hosts needed their chain completed, and which could not be. */
function status() {
  return {
    repaired: Object.fromEntries(repaired),
    failed: Object.fromEntries([...failed].map(([k, v]) => [k, { at: new Date(v.at).toISOString(), reason: v.reason }])),
  };
}

module.exports = { install, repair, status, isChainError };

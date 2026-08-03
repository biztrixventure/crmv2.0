// ============================================================================
// mediaTicket — a short-lived signed permission to stream ONE recording.
//
// Why this exists: an <audio> element cannot send an Authorization header, so
// the player used to download the whole mp3 through an authenticated XHR
// (responseType:'blob') and only then hand it to the browser. The reviewer waits
// for the ENTIRE file before hearing the first second, and cannot seek until it
// lands. Pointing <audio src> straight at the proxy fixes both — the browser
// streams it with Range requests — but only if the URL carries its own proof of
// access.
//
// So: the authenticated endpoint checks the user may hear this clip (the same
// scope + assignment-ownership rules as before, and the egress audit still
// happens there, where the user is known), then signs a ticket naming exactly
// that one recording, for a few minutes. The media route trusts nothing else.
//
//   payload { u: user_id, b: box_id, l: lead_id, r: recording_id, e: exp_epoch }
//   ticket  base64url(payload) + '.' + base64url(HMAC-SHA256(payload, secret))
//
// A leaked ticket is worth one recording for a few minutes — not a session, not
// another tenant's audio, and never something that can call the rest of the API.
// ============================================================================
const crypto = require('crypto');

const TTL_SECONDS = 10 * 60;   // long enough to play a long call, short enough to be worthless later

// The service-role key is always configured (the app cannot boot without it),
// but a dedicated secret can be set so rotating one never rotates the other.
const secret = () => process.env.RECORDING_TICKET_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'insecure-dev-secret';

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sign = (body) => b64(crypto.createHmac('sha256', secret()).update(body).digest());

function issueTicket({ userId, box_id, lead_id, recording_id }, ttl = TTL_SECONDS) {
  const payload = JSON.stringify({
    u: userId, b: box_id || '', l: lead_id || '', r: recording_id || '',
    e: Math.floor(Date.now() / 1000) + ttl,
  });
  const body = b64(payload);
  return `${body}.${sign(body)}`;
}

/** → { u, b, l, r, e } when the signature holds and it has not expired, else null. */
function readTicket(ticket) {
  const [body, mac] = String(ticket || '').split('.');
  if (!body || !mac) return null;
  const expected = sign(body);
  // constant-time compare; timingSafeEqual throws on a length mismatch
  if (mac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  let claims;
  try { claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!claims || typeof claims.e !== 'number' || claims.e < Math.floor(Date.now() / 1000)) return null;
  return claims;
}

module.exports = { issueTicket, readTicket, TTL_SECONDS };

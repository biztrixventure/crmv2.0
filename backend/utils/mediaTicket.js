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

// A REVIEW SESSION, not a single play. Ten minutes was the cause of "once the
// call finishes I cannot move it forward again": the <audio> element keeps the
// same src for the life of the panel, and every seek issues a FRESH Range
// request against it. On a call of any length the ticket had already expired by
// the end of the first listen, so the seek got a 403, the browser could not
// fetch the bytes for the new position, and the playhead snapped straight back.
//
// The exposure is unchanged in kind — a ticket still names ONE recording, is
// HMAC-signed, and the media route always re-resolves the location from the
// dialer, so it can never be pointed anywhere else. It is now worth that single
// clip for a working day instead of for ten minutes.
const TTL_SECONDS = 8 * 60 * 60;

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

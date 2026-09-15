// ============================================================================
// ipAccessGate -- IP access control on every authenticated request (mig 319).
//
// Chained INSIDE authMiddleware (after req.user is resolved), so every route
// that requires a login is covered without touching ~90 mount lines, and every
// route that does not -- login, logout, password reset, health, static files,
// the client portal's public endpoints -- is never gated and cannot loop.
//
// OFF: the first line returns. No query, no log, no last-seen stamp.
// ON:  a blocked request gets 403 {code:'IP_BLOCKED'} and its Supabase session
//      is revoked; api/client.js logs the browser out and shows the message on
//      the login page. So a session opened at the office does not survive a
//      move to another network, or an admin removing the rule it relied on.
// ============================================================================
const { isEnabled, guardRequest } = require('../utils/ipAccess');

// Deliberately NOT async: switched off, this is one property read and a direct
// call to next() -- no promise, no await, nothing else on the request path.
function ipAccessGate(req, res, next) {
  if (!isEnabled()) return next();
  // Some routers mount authMiddleware again per route; decide once per request.
  if (req._ipAccessChecked) return next();
  req._ipAccessChecked = true;
  return enforce(req, res, next);
}

async function enforce(req, res, next) {
  let blocked = null;
  try {
    blocked = await guardRequest(req);
  } catch {
    blocked = null;   // guardRequest already fails open; belt and braces
  }
  if (blocked) return res.status(blocked.status).json(blocked.body);
  return next();
}

module.exports = { ipAccessGate };

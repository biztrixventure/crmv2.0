// ============================================================================
// qaMedia — ticket-authenticated audio streaming for the QA player.
//
// Mounted BEFORE authMiddleware (server.js) because an <audio> element cannot
// send an Authorization header. That is the whole point: given a plain URL the
// browser streams the file with Range requests and starts playing in about a
// second, instead of the player downloading the entire mp3 as a blob and only
// then handing it over — which is why playback "took really very long".
//
// Nothing here is trusted from the query string except the TICKET. It is an
// HMAC signed by /api/qa/recordings/ticket, which is authenticated, applies the
// same scope + assignment-ownership checks as before, and is where the egress
// audit is recorded. The ticket names one recording and expires in minutes; the
// location is ALWAYS re-resolved from the dialer here, so a caller cannot point
// this at a URL of their own (no SSRF) even holding a valid ticket.
// ============================================================================
const express = require('express');
const axios = require('axios');
const { readTicket } = require('../utils/mediaTicket');
const { locationForRecording } = require('../utils/dialerBoxes');
const logger = require('../utils/logger');

const router = express.Router();

router.get('/stream', async (req, res) => {
  const claims = readTicket(req.query.ticket);
  if (!claims) return res.status(403).json({ error: 'Invalid or expired media ticket' });

  const ref = { box_id: claims.b, lead_id: claims.l, recording_id: claims.r };
  let url = null;
  try { url = await locationForRecording(ref); } catch { /* fall through to 404 */ }
  if (!url) return res.status(404).json({ error: 'Recording not found' });

  try {
    const upstream = await axios.get(url, {
      responseType: 'stream',
      timeout: 30000,
      // Forwarding Range is what makes seeking work, and what lets the browser
      // start on the first chunk instead of waiting for the last.
      headers: req.headers.range ? { Range: req.headers.range } : {},
      validateStatus: s => s >= 200 && s < 400,
    });
    res.status(upstream.status === 206 ? 206 : 200);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Accept-Ranges', 'bytes');
    // private: one user's ticket, so no shared cache may keep it — but the
    // reviewer's OWN browser should. The player streams the clip and then copies
    // it into IndexedDB; with a long window that copy is served from the
    // browser's HTTP cache instead of crossing the network a second time. It
    // also covers the re-requests a seek can trigger before the copy is stored.
    res.setHeader('Cache-Control', 'private, max-age=3600');
    if (upstream.headers['content-length']) res.setHeader('Content-Length', upstream.headers['content-length']);
    if (upstream.headers['content-range']) res.setHeader('Content-Range', upstream.headers['content-range']);
    upstream.data.pipe(res);
    upstream.data.on('error', () => { try { res.end(); } catch { /* client already gone */ } });
  } catch (e) {
    logger.warn('QA_MEDIA', `stream ${claims.b}/${claims.r}: ${e.message}`);
    if (!res.headersSent) res.status(502).json({ error: 'Could not load audio' });
  }
});

module.exports = router;

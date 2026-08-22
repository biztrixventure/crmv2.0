// ============================================================================
// qaMedia — ticket-authenticated audio streaming for the QA player.
//
// Mounted BEFORE authMiddleware (server.js) because an <audio> element cannot
// send an Authorization header. Nothing here is trusted from the query string
// except the TICKET: an HMAC signed by /api/qa/recordings/ticket, which is
// authenticated, applies the scope + assignment-ownership checks, and records
// the egress audit. The ticket names one recording and expires; the location is
// ALWAYS re-resolved from the dialer here, so a caller holding a valid ticket
// still cannot point this at a URL of their own (no SSRF).
//
// ── WHY THIS PROXY BUFFERS, AND WHY IT MUST ─────────────────────────────────
// Measured against a real recording (23 minutes, lead 147923):
//
//   • The dialer's recording host DOES NOT SUPPORT RANGE. Asked for
//     `bytes=0-65535` it answers `HTTP 200` with the whole file, no
//     Content-Range — and no Content-Length either, because it chunks.
//   • The MP3 carries NO Xing / Info / VBRI header. It is MPEG2 Layer3,
//     16 kbps, 16 kHz.
//
// So a browser streaming it straight through has no duration in the file, no
// byte count to derive one from, and no way to jump. It guesses the length from
// whatever it has buffered — which is why a five-minute call showed a ten-second
// progress bar, raced to the end, reported itself finished, and then refused
// every seek: you cannot seek in a resource whose length the browser does not
// know and whose server will not serve a byte range.
//
// The good news, also measured: the audio is CONSTANT bitrate. 2,798,640 bytes
// for 1399 seconds is 16.00 kbps exactly, matching the frame header. For CBR,
// a correct Content-Length IS the duration — the browser divides and gets it
// right. So this proxy fetches the file once, holds it briefly, and then serves
// it like a proper static file: real Content-Length, real 206 range responses.
// The player gets an accurate scrub bar and can seek anywhere, repeatedly,
// including after it has played to the end.
//
// The files are small — 16 kbps is ~7 MB per hour of call — so holding a few in
// memory is cheap next to re-fetching them from a dialer that is also running a
// call centre.
// ============================================================================
const express = require('express');
const axios = require('axios');
const { readTicket } = require('../utils/mediaTicket');
const { locationForRecording } = require('../utils/dialerBoxes');
const { supabaseAdmin } = require('../config/database');
const logger = require('../utils/logger');

const router = express.Router();

// ── in-process clip cache ───────────────────────────────────────────────────
// Bounded by BYTES, not entries, because that is the resource that actually
// runs out. Least-recently-used is evicted first. A short TTL keeps a deleted
// or re-recorded call from being served stale.
const CACHE_MAX_BYTES = 192 * 1024 * 1024;   // ~27 hours of 16 kbps audio
const CACHE_TTL_MS = 30 * 60 * 1000;
const clips = new Map();      // key → { buf, at }
const inflight = new Map();   // key → Promise<Buffer> — concurrent listeners share one fetch
let cacheBytes = 0;

function evictIfNeeded() {
  const now = Date.now();
  for (const [k, v] of clips) {
    if (now - v.at > CACHE_TTL_MS) { cacheBytes -= v.buf.length; clips.delete(k); }
  }
  if (cacheBytes <= CACHE_MAX_BYTES) return;
  // oldest USE first — Map preserves insertion order, and a hit re-inserts
  for (const [k, v] of clips) {
    if (cacheBytes <= CACHE_MAX_BYTES) break;
    cacheBytes -= v.buf.length;
    clips.delete(k);
  }
}

async function getClip(key, url) {
  const hit = clips.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    clips.delete(key); clips.set(key, hit);      // mark as most-recently-used
    return hit.buf;
  }
  const pending = inflight.get(key);
  if (pending) return pending;                   // a second listener joins the first fetch

  const p = (async () => {
    const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 });
    const buf = Buffer.from(r.data);
    clips.set(key, { buf, at: Date.now() });
    cacheBytes += buf.length;
    evictIfNeeded();
    return buf;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// "bytes=START-END" → {start,end} clamped to the file, or null when unparseable.
// A malformed or unsatisfiable range must answer 416 rather than silently
// serving the whole file, or the browser's seek bookkeeping goes wrong.
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m) return null;
  const hasStart = m[1] !== '', hasEnd = m[2] !== '';
  if (!hasStart && !hasEnd) return null;
  let start, end;
  if (hasStart) {
    start = parseInt(m[1], 10);
    end = hasEnd ? parseInt(m[2], 10) : size - 1;
  } else {
    const suffix = parseInt(m[2], 10);            // "bytes=-500" = the last 500
    if (!suffix) return { unsatisfiable: true };
    start = Math.max(0, size - suffix);
    end = size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  end = Math.min(end, size - 1);
  if (start > end || start >= size) return { unsatisfiable: true };
  return { start, end };
}

router.get('/stream', async (req, res) => {
  const claims = readTicket(req.query.ticket);
  if (!claims) return res.status(403).json({ error: 'Invalid or expired media ticket' });

  const ref = { box_id: claims.b, lead_id: claims.l, recording_id: claims.r };
  let url = null;
  try { url = await locationForRecording(ref); } catch { /* fall through */ }

  // Fall back to the location we already recorded. locationForRecording asks
  // the box named on the ticket to re-resolve the clip by lead id, and a box
  // can write its clips to a SECOND recording host: 5026480949's closer leg is
  // filed under box wavetechpk but served from 95.216.29.176, while the box's
  // own API answers on 95.216.23.22. The re-resolve found nothing and the
  // route returned "Recording not found" for a clip that exists and plays.
  //
  // This is not client input — it is the URL the poller stored on the row when
  // it found the clip, read back server-side by the ticket's own box and
  // recording id. Re-resolution stays FIRST so a moved or re-encoded clip still
  // wins; this only catches the case where the box cannot account for its own
  // recording.
  if (!url) {
    try {
      let q = supabaseAdmin.from('qa2_call')
        .select('recording_location')
        .eq('recording_id', String(claims.r))
        .not('recording_location', 'is', null);
      if (claims.b) q = q.eq('box_id', claims.b);
      const { data } = await q.limit(1).maybeSingle();
      if (data?.recording_location && /^https?:\/\//i.test(data.recording_location)) {
        url = data.recording_location;
        logger.info('QA_MEDIA', `re-resolve missed ${claims.b}/${claims.r} — serving the stored location`);
      }
    } catch (e) { logger.warn('QA_MEDIA', `stored-location fallback: ${e.message}`); }
  }
  if (!url) return res.status(404).json({ error: 'Recording not found' });

  const key = `${claims.b}|${claims.r}`;
  let buf;
  try {
    buf = await getClip(key, url);
  } catch (e) {
    logger.warn('QA_MEDIA', `stream ${claims.b}/${claims.r}: ${e.message}`);
    if (!res.headersSent) res.status(502).json({ error: 'Could not load audio' });
    return;
  }

  const size = buf.length;
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Accept-Ranges', 'bytes');       // the dialer cannot say this; we can
  // private: one user's ticket, so no shared cache may hold it — but the
  // reviewer's own browser should, so a replay costs nothing.
  res.setHeader('Cache-Control', 'private, max-age=3600');

  const range = req.headers.range ? parseRange(req.headers.range, size) : null;
  if (range?.unsatisfiable) {
    res.setHeader('Content-Range', `bytes */${size}`);
    return res.status(416).end();
  }
  if (range) {
    const { start, end } = range;
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', end - start + 1);
    return res.end(buf.subarray(start, end + 1));
  }
  res.status(200);
  res.setHeader('Content-Length', size);         // THE fix for the wrong duration
  return res.end(buf);
});

module.exports = router;

/**
 * Auto catch-up disposition fetch — a safety net for MANUAL-DIAL transfers.
 *
 * Most closer dispositions arrive in real time via the dialer's Dispo Call URL
 * (closer-dispo ingest). But manual dials (fronter/closer hand-dialing) often
 * don't get matched in real time — the manual CRM transfer has no dialer code,
 * so the dispo can only be matched by phone, same-day, before the dialer's call
 * log archives. This job periodically pulls each undisposed recent transfer's
 * disposition from the dialer (queue → lead status → call log) so the info
 * shows up automatically instead of needing a manual "Fetch dispo".
 *
 * Gentle by design: only the last 12h of UNDISPOSED transfers, low concurrency,
 * every 30 min, and gated by config `auto_fetch_dispo.enabled` (default on).
 */
const { supabaseAdmin } = require('../config/database');
const { getConfig } = require('./businessConfig');
const logger = require('./logger');

let interval = null;
let running  = false;
const EVERY_MS  = 30 * 60 * 1000;   // run every 30 minutes
const WINDOW_H  = 12;               // only transfers from the last 12h (pre-archive)
const CONC      = 4;                // gentle on the dialers
const MAX_ROWS  = 1500;
const BACKOFF_MS = 2 * 60 * 60 * 1000;   // don't re-poll a no-dispo transfer for 2h

// In-memory back-off: a transfer with no disposition yet (closer hasn't worked
// it) would otherwise be re-checked every 30 min for its whole 12h window. Skip
// ones we checked recently → ~4× fewer futile dialer calls under a surge.
const checkedAt = new Map();   // transfer_id → last-checked ts
function pruneChecked() {
  const cut = Date.now() - BACKOFF_MS;
  for (const [id, ts] of checkedAt) if (ts < cut) checkedAt.delete(id);
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const enabled = (await getConfig(null, 'auto_fetch_dispo.enabled', true)) !== false;
    if (!enabled) return;

    // Lazy require to avoid any module load-order coupling with the route file.
    const { fetchAndApplyDispo } = require('../routes/vicidial');
    const from = new Date(Date.now() - WINDOW_H * 3600000).toISOString();

    const { data: trs } = await supabaseAdmin
      .from('transfers')
      .select('id, company_id, normalized_phone, assigned_closer_id, status, vicidial_vendor_code, created_at')
      .gte('created_at', from)
      .not('normalized_phone', 'is', null)
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS);
    const all = trs || [];
    if (!all.length) return;

    const have = new Set();
    for (let i = 0; i < all.length; i += 200) {
      const { data } = await supabaseAdmin.from('disposition_actions')
        .select('transfer_id').in('transfer_id', all.slice(i, i + 200).map(t => t.id));
      (data || []).forEach(a => have.add(a.transfer_id));
    }
    pruneChecked();
    const now = Date.now();
    // undisposed AND not checked in the last 2h (back-off on persistent no-dispo)
    const todo = all.filter(t => !have.has(t.id) && !(checkedAt.get(t.id) > now - BACKOFF_MS));
    if (!todo.length) return;

    let fetched = 0, idx = 0;
    await Promise.all(Array.from({ length: Math.min(CONC, todo.length) }, async () => {
      while (idx < todo.length) {
        const t = todo[idx++];
        try {
          const r = await fetchAndApplyDispo(t);
          if (r.ok) fetched++;
          else checkedAt.set(t.id, Date.now());   // no dispo yet → back off for 2h
        } catch { /* skip one, keep going */ }
      }
    }));

    if (fetched) logger.success('AUTO_FETCH_DISPO', `auto-fetched ${fetched}/${todo.length} undisposed (last ${WINDOW_H}h)`);
  } catch (e) {
    logger.warn('AUTO_FETCH_DISPO', e.message);
  } finally {
    running = false;
  }
}

function startAutoFetchDispo() {
  if (interval) return;
  setTimeout(tick, 2 * 60 * 1000);            // first pass 2 min after boot
  interval = setInterval(tick, EVERY_MS);
  logger.info('AUTO_FETCH_DISPO', `started — every ${EVERY_MS / 60000} min, last ${WINDOW_H}h undisposed (disable via config auto_fetch_dispo.enabled=false)`);
}

module.exports = { startAutoFetchDispo };

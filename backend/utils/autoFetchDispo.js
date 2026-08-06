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

    await sweepCodedBacklog();
  } catch (e) {
    logger.warn('AUTO_FETCH_DISPO', e.message);
  } finally {
    running = false;
  }
}

// ── the backlog sweep: what the 12-hour window can never reach ───────────────
//
// The pass above only looks at the last 12 hours, because a MANUAL transfer can
// only be matched by phone before the dialer's call log archives. A CODED
// transfer is different: it carries a lead id, and a lead's status lives in
// vicidial_list, which is archive-proof — it can be read weeks later.
//
// Nothing was reading it. So whenever a dialer stopped answering for longer
// than 12 hours, every transfer created during that outage stayed blank
// forever, even after the box came back. Measured while diagnosing exactly that
// on one box: 148 undisposed coded transfers inside the window, and 947 outside
// it that no job would ever look at again.
//
// Deliberately slow. This is a repair trickle, not a backfill: a small batch per
// tick, newest first, sharing the same back-off map so a lead that genuinely has
// no disposition is not asked about again for hours. A one-off bulk recovery is
// what the superadmin /backfill/coded endpoint is for.
const BACKLOG_DAYS = 30;
const BACKLOG_BATCH = 40;
async function sweepCodedBacklog() {
  const enabled = (await getConfig(null, 'auto_fetch_dispo.backlog_enabled', true)) !== false;
  if (!enabled) return;
  const { fetchAndApplyDispo } = require('../routes/vicidial');
  const until = new Date(Date.now() - WINDOW_H * 3600000).toISOString();          // older than the live pass
  const since = new Date(Date.now() - BACKLOG_DAYS * 86400000).toISOString();

  const { data: rows } = await supabaseAdmin
    .from('transfers')
    .select('id, company_id, normalized_phone, assigned_closer_id, status, vicidial_vendor_code, created_at')
    .is('vicidial_dispo', null)
    .not('vicidial_vendor_code', 'is', null)      // CODED only — the archive-proof path
    .gte('created_at', since).lt('created_at', until)
    .order('created_at', { ascending: false })
    .limit(BACKLOG_BATCH * 4);
  const now = Date.now();
  const todo = (rows || []).filter(t => !(checkedAt.get(t.id) > now - BACKOFF_MS)).slice(0, BACKLOG_BATCH);
  if (!todo.length) return;

  let fixed = 0, idx = 0;
  await Promise.all(Array.from({ length: Math.min(CONC, todo.length) }, async () => {
    while (idx < todo.length) {
      const t = todo[idx++];
      try {
        const r = await fetchAndApplyDispo(t);
        if (r.ok) fixed++; else checkedAt.set(t.id, Date.now());
      } catch { checkedAt.set(t.id, Date.now()); }
    }
  }));
  if (fixed) logger.success('AUTO_FETCH_DISPO', `backlog: recovered ${fixed}/${todo.length} coded transfers older than ${WINDOW_H}h`);
}

function startAutoFetchDispo() {
  if (interval) return;
  setTimeout(tick, 2 * 60 * 1000);            // first pass 2 min after boot
  interval = setInterval(tick, EVERY_MS);
  logger.info('AUTO_FETCH_DISPO', `started — every ${EVERY_MS / 60000} min, last ${WINDOW_H}h undisposed (disable via config auto_fetch_dispo.enabled=false)`);
}

module.exports = { startAutoFetchDispo };

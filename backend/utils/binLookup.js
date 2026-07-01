// ============================================================================
// utils/binLookup.js — issuer lookup for a card BIN (first 6-8 digits).
// The BIN is a bank identifier, NOT card data — we never receive/store the full
// PAN. Results are cached indefinitely (a BIN's issuer doesn't change) so the
// free binlist.net rate limit is a non-issue after the first hit.
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const logger = require('./logger');

const normBin = (v) => String(v || '').replace(/\D/g, '').slice(0, 8);

function shape(row) {
  return {
    bin: row.bin, scheme: row.scheme || null, type: row.card_type || null, brand: row.brand || null,
    prepaid: row.prepaid, bank: row.bank_name ? { name: row.bank_name, url: row.bank_url || null, phone: row.bank_phone || null } : null,
    country: row.country_name ? { name: row.country_name, alpha2: row.country_alpha2 || null, emoji: row.country_emoji || null, currency: row.country_currency || null } : null,
  };
}

async function lookupBin(bin) {
  const b = normBin(bin);
  if (b.length < 6) return { ok: false, error: 'BIN needs at least 6 digits' };

  const { data: cached } = await supabaseAdmin.from('bin_lookups').select('*').eq('bin', b).maybeSingle();
  if (cached) return { ok: true, cached: true, ...shape(cached) };

  let data;
  try {
    const r = await fetch(`https://lookup.binlist.net/${b}`, {
      headers: { 'Accept-Version': '3', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(7000),
    });
    if (r.status === 404) { // unknown BIN — cache a sparse row so we don't re-hit
      await supabaseAdmin.from('bin_lookups').upsert({ bin: b, raw: { notFound: true } }, { onConflict: 'bin' }).then(() => {}, () => {});
      return { ok: true, cached: false, bin: b, scheme: null, type: null, brand: null, prepaid: null, bank: null, country: null, unknown: true };
    }
    if (r.status === 429) return { ok: false, error: 'Issuer lookup is rate-limited — try again shortly' };
    if (!r.ok) return { ok: false, error: `Issuer lookup failed (${r.status})` };
    data = await r.json();
  } catch (e) {
    logger.warn('BIN', `lookup ${b} failed: ${e.message}`);
    return { ok: false, error: 'Issuer lookup unavailable' };
  }

  const row = {
    bin: b,
    scheme: data.scheme || null,
    card_type: data.type || null,
    brand: data.brand || null,
    prepaid: typeof data.prepaid === 'boolean' ? data.prepaid : null,
    bank_name: data.bank?.name || null,
    bank_url: data.bank?.url || null,
    bank_phone: data.bank?.phone || null,
    country_name: data.country?.name || null,
    country_alpha2: data.country?.alpha2 || null,
    country_emoji: data.country?.emoji || null,
    country_currency: data.country?.currency || null,
    raw: data,
    checked_at: new Date().toISOString(),
  };
  await supabaseAdmin.from('bin_lookups').upsert(row, { onConflict: 'bin' }).then(() => {}, () => {});
  return { ok: true, cached: false, ...shape(row) };
}

module.exports = { lookupBin, normBin };

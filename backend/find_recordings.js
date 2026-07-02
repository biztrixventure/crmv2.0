// ============================================================================
// find_recordings.js — diagnostic: check EVERY dialer box for a phone number's
// call log + recordings, and print all of it (flagging which recording
// filenames contain the phone). RUN ON THE SERVER (it's IP-whitelisted on the
// dialers; a dev machine is not).
//
//   node find_recordings.js <phone> [agent] [date YYYY-MM-DD] [lead_id]
//   e.g.  node find_recordings.js 5174891039 TMC100313 2026-06-18
//
// It tries, per box, all three resolution paths so we can see exactly where a
// recording is (or why it isn't found):
//   1) phone_number_log(phone)            — the dialer call log (short retention)
//   2) recording_lookup(agent, day)       — for each agent/day the log returned
//   3) recording_lookup(agent, date±1)    — the closer's agent+date (longer
//                                            retention; works when the log aged out)
//   4) recording_lookup(lead_id)          — if a lead_id/code is given
// ============================================================================
require('dotenv').config({ path: '.env.local' });
const axios = require('axios');
const { getBoxes, refreshBoxes } = require('./utils/dialerBoxes');

const digits = (s) => String(s || '').replace(/\D/g, '');
const tail10 = (p) => { const d = digits(p); return d.length >= 10 ? d.slice(-10) : d; };
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

async function api(box, params) {
  try {
    const r = await axios.get(`${box.base}/vicidial/non_agent_api.php`, {
      params: { source: 'crm', user: box.user, pass: box.pass, stage: 'pipe', ...params },
      timeout: 20000, responseType: 'text',
    });
    return String(r.data || '').trim();
  } catch (e) { return `__ERR__ ${e.code || e.message}`; }
}

async function recLookup(box, params) {
  const text = await api(box, { function: 'recording_lookup', duration: 'Y', ...params });
  if (!text || text.startsWith('__ERR__') || /NO RECORDINGS|^ERROR|^NOTICE|PERMISSION/i.test(text)) return { note: text.slice(0, 90) || 'empty', rows: [] };
  const rows = text.split(/\r?\n/).filter(Boolean).map((l) => {
    const p = l.split('|');   // start|user|recording_id|lead_id|duration|location
    return { start: p[0], user: p[1], recording_id: p[2], lead_id: p[3], duration: parseInt(p[4], 10) || 0, location: p[5] };
  });
  return { note: `${rows.length} rows`, rows };
}

async function phoneLog(box, phone) {
  const text = await api(box, { function: 'phone_number_log', phone_number: phone, type: 'ALL', detail: 'ALL' });
  if (!text || text.startsWith('__ERR__') || /^ERROR|^NOTICE/im.test(text)) return { note: text.slice(0, 90) || 'empty', rows: [] };
  const rows = text.split(/\r?\n/).filter(Boolean).map((l) => {
    const [, call_date, , len, lead_status, , call_status, , user] = l.split('|');
    return { call_date, user, lead_status, call_status, len: parseInt(len, 10) || 0 };
  }).filter((r) => r.call_date);
  return { note: `${rows.length} rows`, rows };
}

(async () => {
  const [phone, agent, date, leadId] = process.argv.slice(2);
  if (!phone) { console.log('usage: node find_recordings.js <phone> [agent] [date YYYY-MM-DD] [lead_id]'); process.exit(1); }
  await refreshBoxes().catch(() => {});
  const boxes = getBoxes();
  const ph = tail10(phone);
  const printRecs = (rows) => rows.forEach((r) =>
    console.log(`   ${(ph && digits(r.location).includes(ph)) ? '✓PHONE' : '      '} ${r.start} agent=${r.user} rec=${r.recording_id} lead=${r.lead_id} ${r.duration}s ${r.location}`));

  console.log(`\n=== boxes: ${boxes.map((b) => b.id).join(', ')} | phone=${phone} (tail ${ph}) agent=${agent || '-'} date=${date || '-'} lead=${leadId || '-'} ===`);

  for (const box of boxes) {
    console.log(`\n──[ ${box.id} · ${box.base} ]──`);

    // 1) phone_number_log — what the call log has for this number
    const pl = await phoneLog(box, phone);
    console.log(` phone_number_log: ${pl.note}`);
    pl.rows.forEach((r) => console.log(`   call ${r.call_date} agent=${r.user} status=${r.lead_status}/${r.call_status} ${r.len}s`));

    // 2) recording_lookup for each (agent, day) the call log returned
    const keys = new Map();
    pl.rows.forEach((r) => { const day = String(r.call_date).slice(0, 10); if (r.user && day) keys.set(r.user + '|' + day, { a: r.user, day }); });
    for (const { a, day } of keys.values()) {
      const rl = await recLookup(box, { agent_user: a, date: day });
      console.log(` recording_lookup(agent=${a}, date=${day}): ${rl.note}`);
      printRecs(rl.rows);
    }

    // 3) explicit closer agent+date (longer retention than the call log)
    if (agent && date) {
      for (const d of [date, addDays(date, -1), addDays(date, 1)]) {
        const rl = await recLookup(box, { agent_user: agent, date: d });
        console.log(` recording_lookup[closer](agent=${agent}, date=${d}): ${rl.note}`);
        printRecs(rl.rows);
      }
    }

    // 4) lead_id path (if a code/lead_id is supplied)
    if (leadId) {
      const rl = await recLookup(box, { lead_id: leadId });
      console.log(` recording_lookup(lead_id=${leadId}): ${rl.note}`);
      printRecs(rl.rows);
    }
  }
  console.log('\n=== done ===');
  process.exit(0);
})();

// ============================================================================
// dncStatus.js — how a Blacklist Alliance answer is named and coloured.
//
// ONE definition, because the badge and the lookup page must never disagree
// about what a number is. Both used to keep their own half-list of codes, and
// neither knew `suppression` or `screamer`, so those arrived as raw slugs.
//
// The Alliance answers with a MESSAGE (Good / Suppressed / Blacklisted) plus
// the CODES it matched. The message is the rule you would break; the codes are
// why. A suppressed number is not a litigator -- it is someone who asked this
// client never to call again -- so it gets its own name and its own colour
// instead of one red "bad" for everything that is not Good.
// ============================================================================

// verdict → how it reads on screen. `verdict` comes from the server
// (utils/blacklist.js classify); anything unknown falls back to caution.
export const VERDICTS = {
  clean:       { label: 'Good',        color: '#16a34a', tone: 'safe',    note: 'Not on any list' },
  suppressed:  { label: 'Suppressed',  color: '#d97706', tone: 'caution', note: 'Asked not to be contacted' },
  blacklisted: { label: 'Blacklisted', color: '#dc2626', tone: 'danger',  note: 'On a DNC / litigation list' },
  flagged:     { label: 'Flagged',     color: '#7c3aed', tone: 'caution', note: 'The Alliance returned a status we do not recognise' },
  unknown:     { label: 'Unknown',     color: '#64748b', tone: 'caution', note: 'No answer for this number' },
};

// Back-compat: a result from before `verdict` existed still has to render, and
// an unrecognised verdict must never silently read as Good.
export function verdictOf(res) {
  if (!res) return VERDICTS.unknown;
  if (res.verdict && VERDICTS[res.verdict]) return VERDICTS[res.verdict];
  return res.blacklisted ? VERDICTS.blacklisted : VERDICTS.clean;
}

// The status line an agent reads: the Alliance's own wording wins, since that
// is what the compliance rule is called.
export const statusText = (res) => (res?.message || verdictOf(res).label);

const GROUPS = {
  dnc:         'Do-not-call list',
  litigation:  'Litigation risk',
  suppression: 'Suppressed',
  complaint:   'Complainer',
  other:       'Other list',
};
export const groupLabel = (g) => GROUPS[g] || GROUPS.other;

// code → { label, short, group }. Slugs not listed here still render: the slug
// is title-cased and grouped by its own shape (…-dnc → DNC, etc.), so a list
// the Alliance adds tomorrow shows up named rather than swallowed.
const CODES = {
  'federal-dnc':        { label: 'Federal DNC',            short: 'Federal DNC', group: 'dnc' },
  'suppression':        { label: 'Suppression list',       short: 'Suppressed',  group: 'suppression' },
  'screamer':           { label: 'Screamer (complainer)',  short: 'Screamer',    group: 'complaint' },
  'dnc-complainers':    { label: 'DNC complainer',         short: 'Complainer',  group: 'complaint' },
  'attorney-primary':   { label: 'Attorney (primary)',     short: 'Attorney',    group: 'litigation' },
  'attorney-secondary': { label: 'Attorney (secondary)',   short: 'Attorney (2nd)', group: 'litigation' },
  'plaintiff-primary':  { label: 'Plaintiff (primary)',    short: 'Plaintiff',   group: 'litigation' },
  'plaintiff-secondary':{ label: 'Plaintiff (secondary)',  short: 'Plaintiff (2nd)', group: 'litigation' },
  'prelitigation1':     { label: 'Pre-litigation',         short: 'Pre-litigation', group: 'litigation' },
  'prelitigation2':     { label: 'Pre-litigation (2)',     short: 'Pre-litigation (2)', group: 'litigation' },
  'anti-telemarketing': { label: 'Anti-telemarketing',     short: 'Anti-telemarketing', group: 'litigation' },
  'tcpa':               { label: 'TCPA litigator',         short: 'TCPA',        group: 'litigation' },
  'gov':                { label: 'Government',             short: 'Government',  group: 'other' },
};

const STATE_DNC = {
  colorado: 'Colorado', florida: 'Florida', indiana: 'Indiana', louisiana: 'Louisiana',
  missouri: 'Missouri', oklahoma: 'Oklahoma', pennsylvania: 'Pennsylvania', tennessee: 'Tennessee',
  texas: 'Texas', wisconsin: 'Wisconsin', wyoming: 'Wyoming',
};
const titleCase = (s) => String(s).replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export function codeMeta(code) {
  const c = String(code || '').trim().toLowerCase();
  if (!c) return { label: 'Unknown list', short: 'Unknown', group: 'other' };
  if (CODES[c]) return CODES[c];
  const st = c.match(/^([a-z]+)-dnc$/);
  if (st) {
    const name = STATE_DNC[st[1]] || titleCase(st[1]);
    return { label: `${name} DNC`, short: `${name} DNC`, group: 'dnc' };
  }
  if (c.includes('dnc')) return { label: titleCase(c), short: titleCase(c), group: 'dnc' };
  if (/litig|attorney|plaintiff|tcpa/.test(c)) return { label: titleCase(c), short: titleCase(c), group: 'litigation' };
  if (c.includes('suppress')) return { label: titleCase(c), short: titleCase(c), group: 'suppression' };
  return { label: titleCase(c), short: titleCase(c), group: 'other' };
}

export const codeLabel = (c) => codeMeta(c).label;
export const codeShort = (c) => codeMeta(c).short;

// Codes bucketed by group, in a fixed order, for the detail panel.
const ORDER = ['suppression', 'litigation', 'dnc', 'complaint', 'other'];
export function groupCodes(codes = []) {
  const by = {};
  codes.forEach(c => { const m = codeMeta(c); (by[m.group] = by[m.group] || []).push({ code: c, ...m }); });
  return ORDER.filter(g => by[g]?.length).map(g => ({ group: g, label: groupLabel(g), items: by[g] }));
}

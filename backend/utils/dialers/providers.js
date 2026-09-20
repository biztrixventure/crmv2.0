// ============================================================================
// dialers/providers.js — the canonical call, and one preset per dialer.
//
// CANONICAL_FIELDS is the contract between every dialer and the CRM. It is
// deliberately the SAME vocabulary the VICIdial ingest URLs already speak
// (agent / code / phone / dispo / talk_time / first / last / …), because the
// whole point of this layer is that a CallTools call can be handed to the
// transfer + disposition logic that VICIdial calls already go through — the
// dedup window, the XFER gate, the queued-dispo reconcile, the closer-side
// guard. None of that gets a second implementation.
//
// A PRESET is only a starting point. Every dialer install names its fields
// slightly differently (custom campaigns, custom dispositions), so the real
// mapping is finished in the UI against a payload the dialer actually sent —
// Admin -> Dialers -> Mapping reads the last events and lets you point each
// canonical field at a real key. The preset just means you are not staring at
// an empty form.
// ============================================================================

// key, label, and what it does. `required` is what an account needs before it
// can do anything useful; the UI shows those first and warns when unmapped.
const CANONICAL_FIELDS = [
  { key: 'event_type',   label: 'Event type',        required: false, hint: "xfer | dispo | call — leave unmapped to use the account's rules" },
  { key: 'leg',          label: 'Leg',               required: false, hint: 'fronter | closer — which side of the call this is' },
  { key: 'agent',        label: 'Agent id',          required: true,  hint: "the dialer's agent login; mapped to a CRM user under Agents" },
  { key: 'phone',        label: 'Customer phone',    required: true,  hint: 'the number the customer was reached on' },
  { key: 'dispo',        label: 'Disposition',       required: true,  hint: 'the outcome code or name the agent selected' },
  { key: 'code',         label: 'Lead / vendor code', required: false, hint: 'the dialer lead id — the correlation key between the two legs' },
  { key: 'external_call_id', label: 'Call id',       required: false, hint: "the dialer's own unique id for this call" },
  { key: 'talk_time',    label: 'Talk time (s)',     required: false, hint: 'seconds; use the seconds transform if the dialer sends ms' },
  { key: 'call_at',      label: 'Call time',         required: false, hint: 'when the call happened (UTC); defaults to now' },
  { key: 'term',         label: 'Hangup / term',     required: false, hint: 'who hung up — AGENT / CALLER / QUEUETIMEOUT' },
  { key: 'recording_url', label: 'Recording URL',    required: false, hint: 'direct link to the audio, if the webhook carries one' },
  { key: 'recording_id', label: 'Recording id',      required: false, hint: 'the recording id, for fetching the clip later by API' },
  { key: 'first',        label: 'First name',        required: false },
  { key: 'last',         label: 'Last name',         required: false },
  { key: 'address',      label: 'Address',           required: false },
  { key: 'city',         label: 'City',              required: false },
  { key: 'state',        label: 'State',             required: false },
  { key: 'zip',          label: 'Zip',               required: false },
  { key: 'email',        label: 'Email',             required: false },
  { key: 'alt_phone',    label: 'Alt phone',         required: false },
  { key: 'comments',     label: 'Comments',          required: false },
  { key: 'list_id',      label: 'List id',           required: false },
  { key: 'campaign',     label: 'Campaign',          required: false },
  { key: 'car_make',     label: 'Car make',          required: false },
  { key: 'car_model',    label: 'Car model',         required: false },
  { key: 'car_year',     label: 'Car year',          required: false },
];

const REQUIRED_FIELDS = CANONICAL_FIELDS.filter(f => f.required).map(f => f.key);

// ── CallTools ───────────────────────────────────────────────────────────────
// CallTools fires an automation/webhook on events such as a new call (after
// hangup) and a new call disposition, and posts JSON. Its REST API is keyed by
// a token created in the manager dashboard, and its datetimes are UTC
// "YYYY-MM-DD HH:MM:SS".
//
// The paths below are written as FALLBACK LISTS on purpose: a CallTools account
// can post a flat call object or an {event, data:{...}} envelope depending on
// how the automation is built, and both spellings resolve here without the
// operator having to know which one their tenant sends. Whatever is left
// unmapped is finished from a real payload in the Mapping tab.
const CALLTOOLS_PRESET = {
  field_map: {
    agent: ['data.user.username', 'user.username', 'data.agent.username', 'agent.username', 'agent_id', 'user_id'],
    phone: { paths: ['data.contact.phone_number', 'contact.phone_number', 'data.phone_number', 'phone_number', 'to_number', 'called_number'], transform: 'phone10' },
    dispo: { paths: ['data.call_disposition.name', 'call_disposition.name', 'data.disposition.name', 'disposition.name', 'disposition', 'call_disposition'], transform: 'upper' },
    code:  ['data.contact.id', 'contact.id', 'data.contact_id', 'contact_id', 'lead_id'],
    external_call_id: ['data.call.id', 'call.id', 'data.id', 'id', 'call_id', 'uuid'],
    talk_time: { paths: ['data.call.talk_time', 'call.talk_time', 'data.duration', 'duration', 'talk_time', 'call_length'], transform: 'seconds' },
    call_at:   { paths: ['data.call.created', 'call.created', 'data.created', 'created', 'start_time', 'call_date'], transform: 'iso' },
    recording_url: ['data.call.recording_url', 'call.recording_url', 'data.recording_url', 'recording_url', 'recording'],
    recording_id:  ['data.call.recording_id', 'call.recording_id', 'data.recording_id', 'recording_id'],
    first: ['data.contact.first_name', 'contact.first_name', 'first_name'],
    last:  ['data.contact.last_name', 'contact.last_name', 'last_name'],
    address: ['data.contact.address', 'contact.address', 'address'],
    city:  ['data.contact.city', 'contact.city', 'city'],
    state: ['data.contact.state', 'contact.state', 'state'],
    zip:   ['data.contact.zip_code', 'contact.zip_code', 'zip_code', 'zip'],
    email: ['data.contact.email', 'contact.email', 'email'],
    campaign: ['data.campaign.name', 'campaign.name', 'campaign'],
    comments: ['data.note', 'note', 'notes'],
  },
  settings: {
    // Which dispositions mean "this call was transferred to a closer". Set these
    // to YOUR CallTools disposition names — nothing is assumed beyond the three
    // obvious spellings, and a call whose dispo is not listed is still recorded
    // for QA, it just does not create a transfer.
    xfer_dispos: ['XFER', 'TRANSFER', 'TRANSFERRED'],
    default_leg: 'fronter',
    // A closer campaign posting to the same URL is named here (or with a
    // leg_rule) so its calls are treated as the closer's leg.
    leg_rules: [],
    dedup_ms: 120000,
    ignore_dispos: [],
  },
  // VERIFIED against a live tenant (east-3.calltools.io, 2026-09-21): the API
  // is Django REST Framework at /api/, keyed by `Authorization: Token <key>`,
  // and each tenant is its own host (east-3, east-1, …) — so base_url is left
  // blank rather than guessing app.calltools.com, which is the marketing site.
  auth: { type: 'token', header_name: 'Authorization' },
  base_url: '',
  api: {
    // Calls are contactcalls, addressable by the call's uuid; the endpoint
    // refuses an unfiltered GET ("contact_id or uuid filter is required"), so
    // the poller always asks for one specific call. The recording field is a
    // list of candidates because it is read out of the paged {results:[…]}
    // envelope and tenants differ on the exact name.
    call_path: '/api/contactcalls/?uuid={call_id}',
    recording_url_field: ['results[0].recording_url', 'results[0].recording', 'results[0].call_recording_url'],
    // A cheap authenticated GET for the Test button: small, always present.
    test_path: '/api/calldispositions/',
  },
};

// ── generic ─────────────────────────────────────────────────────────────────
// Anything that can POST JSON (or hit a GET URL with query parameters): an
// in-house dialer, Zapier/Make, a PBX, a CPaaS. Flat keys with the canonical
// names work out of the box; anything else is one mapping edit away.
const GENERIC_PRESET = {
  field_map: {
    agent: ['agent', 'agent_id', 'user', 'user_id'],
    phone: { paths: ['phone', 'phone_number', 'customer_phone', 'to'], transform: 'phone10' },
    dispo: { paths: ['dispo', 'disposition', 'status', 'outcome'], transform: 'upper' },
    code: ['code', 'lead_id', 'vendor_lead_code'],
    external_call_id: ['call_id', 'uniqueid', 'id'],
    talk_time: { paths: ['talk_time', 'duration', 'length_in_sec'], transform: 'seconds' },
    call_at: { paths: ['call_at', 'start_time', 'timestamp'], transform: 'iso' },
    recording_url: ['recording_url', 'recording', 'audio_url'],
    first: ['first', 'first_name'],
    last: ['last', 'last_name'],
    address: ['address'], city: ['city'], state: ['state'], zip: ['zip', 'postal_code'],
    email: ['email'], comments: ['comments', 'note'], campaign: ['campaign'],
    leg: ['leg'], event_type: ['event_type', 'event'],
  },
  settings: { xfer_dispos: ['XFER'], default_leg: 'fronter', leg_rules: [], dedup_ms: 120000, ignore_dispos: [] },
  auth: { type: 'none' },
  base_url: '',
  api: {},
};

// ── vicidial (webhook-shaped) ───────────────────────────────────────────────
// The existing VICIdial boxes keep using /api/vicidial/* and the env token —
// this preset exists for a NEW VICIdial cluster someone would rather wire up as
// an account (its own token, its own agent map) than add to the env. The token
// names in the map are exactly the ones the Dispo Call URL substitutes.
const VICIDIAL_PRESET = {
  field_map: {
    agent: ['agent', 'agent_user', 'user'],
    phone: { paths: ['phone', 'phone_number'], transform: 'phone10' },
    dispo: { paths: ['dispo', 'dispo_code'], transform: 'upper' },
    code: ['code', 'vendor_lead_code', 'alt_code', 'lead_id'],
    talk_time: { paths: ['talk_time'], transform: 'seconds' },
    term: { paths: ['term', 'term_reason'], transform: 'upper' },
    first: ['first', 'first_name'], last: ['last', 'last_name'],
    address: ['address'], city: ['city'], state: ['state'], zip: ['zip'],
    email: ['email'], alt_phone: ['alt_phone'], comments: ['comments'],
    list_id: ['list_id'], campaign: ['campaign'], external_call_id: ['uniqueid'],
    car_make: ['car_make'], car_model: ['car_model'], car_year: ['car_year'],
  },
  settings: { xfer_dispos: ['XFER'], default_leg: 'fronter', leg_rules: [], dedup_ms: 120000, ignore_dispos: [] },
  auth: { type: 'query', query_param: 'key' },
  base_url: '',
  api: {},
};

const PROVIDERS = {
  calltools: {
    key: 'calltools',
    label: 'CallTools',
    docs: 'Manager dashboard -> API / Automations. Create an API token, then an automation that POSTs to the webhook URL below.',
    preset: CALLTOOLS_PRESET,
    supports: { webhook: true, api: true, recording_api: true },
  },
  vicidial: {
    key: 'vicidial',
    label: 'VICIdial (as an account)',
    docs: 'Campaign -> Dispo Call URL. The existing boxes stay on /api/vicidial/* — use this only for a new cluster you want isolated.',
    preset: VICIDIAL_PRESET,
    supports: { webhook: true, api: true, recording_api: true },
  },
  generic: {
    key: 'generic',
    label: 'Generic / other (any webhook)',
    docs: 'Point anything that can POST JSON or call a URL at the webhook below, then finish the mapping from a real payload.',
    preset: GENERIC_PRESET,
    supports: { webhook: true, api: false, recording_api: false },
  },
};

const providerKeys = () => Object.keys(PROVIDERS);
const getProvider = (key) => PROVIDERS[String(key || '').toLowerCase()] || PROVIDERS.generic;

module.exports = { CANONICAL_FIELDS, REQUIRED_FIELDS, PROVIDERS, providerKeys, getProvider };

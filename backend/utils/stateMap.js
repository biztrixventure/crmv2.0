// ============================================================================
// stateMap — USPS 2-letter abbreviation → full name. Mirrors the SQL helpers
// in migration 061 so the write path agrees with the back-fill.
// ============================================================================

const ABBR_TO_FULL = {
  AL: 'Alabama',        AK: 'Alaska',         AZ: 'Arizona',        AR: 'Arkansas',
  CA: 'California',     CO: 'Colorado',       CT: 'Connecticut',    DE: 'Delaware',
  FL: 'Florida',        GA: 'Georgia',        HI: 'Hawaii',         ID: 'Idaho',
  IL: 'Illinois',       IN: 'Indiana',        IA: 'Iowa',           KS: 'Kansas',
  KY: 'Kentucky',       LA: 'Louisiana',      ME: 'Maine',          MD: 'Maryland',
  MA: 'Massachusetts',  MI: 'Michigan',       MN: 'Minnesota',      MS: 'Mississippi',
  MO: 'Missouri',       MT: 'Montana',        NE: 'Nebraska',       NV: 'Nevada',
  NH: 'New Hampshire',  NJ: 'New Jersey',     NM: 'New Mexico',     NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota',   OH: 'Ohio',           OK: 'Oklahoma',
  OR: 'Oregon',         PA: 'Pennsylvania',   RI: 'Rhode Island',   SC: 'South Carolina',
  SD: 'South Dakota',   TN: 'Tennessee',      TX: 'Texas',          UT: 'Utah',
  VT: 'Vermont',        VA: 'Virginia',       WA: 'Washington',     WV: 'West Virginia',
  WI: 'Wisconsin',      WY: 'Wyoming',        DC: 'District of Columbia',
  PR: 'Puerto Rico',    VI: 'U.S. Virgin Islands',
  GU: 'Guam',           AS: 'American Samoa', MP: 'Northern Mariana Islands',
};

// Expand a single 2-letter code to its full name. Pass-through if the input
// isn't a clean 2-letter alpha string or doesn't map to a known state.
function expandState(val) {
  if (val == null) return val;
  const s = String(val).trim();
  if (!/^[A-Za-z]{2}$/.test(s)) return val;
  return ABBR_TO_FULL[s.toUpperCase()] || val;
}

// Walk a flat object and expand string values under keys whose name is
// `state` or ends in `_state` (case-insensitive).
function expandStateInFormData(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && /(^|_)state$/i.test(k)) {
      out[k] = expandState(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

module.exports = { expandState, expandStateInFormData };

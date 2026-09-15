// ============================================================================
// testing/supabaseFake.js -- an in-memory stand-in for the slice of supabase-js
// the IP access control code uses, so its tests run without a database.
//
//   jest.mock('../config/database', () => {
//     const fake = require('../testing/supabaseFake');
//     return { supabaseAdmin: fake.admin, supabaseClient: fake.client };
//   });
//   const fake = require('../testing/supabaseFake');   // same instance
//   fake.reset({ user_ip_rules: [...] }, { users: [...] });
//
// Tables are plain arrays of row objects (nested selects are stored nested).
// Every executed query is appended to fake.calls, which is how the tests prove
// "switch off = zero database queries".
// ============================================================================
const state = {
  tables: {},
  users: [],           // auth.users: { id, email, password, app_metadata }
  calls: [],           // { table, op }
  signOuts: [],        // { jwt, scope }
  seq: 1,
};

const now = () => new Date().toISOString();

const DEFAULTS = {
  user_ip_access: () => ({ ip_access_mode: 'anywhere', created_at: now(), updated_at: now() }),
  user_ip_rules: () => ({ is_active: true, label: null, created_at: now(), updated_at: now() }),
  ip_access_logs: () => ({ created_at: now() }),
};

const UNIQUE = {
  user_ip_rules: (a, b) => (a.user_id || null) === (b.user_id || null) && a.type === b.type && a.ip_value === b.ip_value,
};

// SQL LIKE -> RegExp. Backslash-escaped % and _ stay literal.
function likeToRegex(pattern, flags) {
  let out = '';
  const s = String(pattern);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length) { out += s[i + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); i++; continue; }
    if (ch === '%') { out += '.*'; continue; }
    if (ch === '_') { out += '.'; continue; }
    out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, flags);
}

class Query {
  constructor(table) {
    this.table = table;
    this.op = 'select';
    this.filters = [];
    this.payload = null;
    this.opts = {};
    this.returning = false;
    this.mode = null;
    this.sort = null;
    this.max = null;
    this.window = null;
  }

  select(_cols, opts = {}) {
    if (this.op === 'select') this.opts = opts; else this.returning = true;
    return this;
  }
  insert(rows) { this.op = 'insert'; this.payload = rows; return this; }
  upsert(row, opts = {}) { this.op = 'upsert'; this.payload = row; this.conflict = String(opts.onConflict || 'id').split(','); return this; }
  update(patch) { this.op = 'update'; this.payload = patch; return this; }
  delete(opts = {}) { this.op = 'delete'; this.opts = opts; return this; }

  eq(c, v)   { this.filters.push(r => r[c] === v); return this; }
  neq(c, v)  { this.filters.push(r => r[c] !== v); return this; }
  in(c, arr) { this.filters.push(r => arr.includes(r[c])); return this; }
  is(c, v)   { this.filters.push(r => (v === null ? r[c] == null : r[c] === v)); return this; }
  lt(c, v)   { this.filters.push(r => r[c] < v); return this; }
  lte(c, v)  { this.filters.push(r => r[c] <= v); return this; }
  gt(c, v)   { this.filters.push(r => r[c] > v); return this; }
  gte(c, v)  { this.filters.push(r => r[c] >= v); return this; }
  like(c, p)  { const re = likeToRegex(p, '');  this.filters.push(r => re.test(String(r[c] ?? ''))); return this; }
  ilike(c, p) { const re = likeToRegex(p, 'i'); this.filters.push(r => re.test(String(r[c] ?? ''))); return this; }
  or() { return this; }
  order(c, { ascending = true } = {}) { this.sort = { c, ascending }; return this; }
  limit(n) { this.max = n; return this; }
  range(a, b) { this.window = [a, b]; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }
  single() { this.mode = 'single'; return this; }

  then(resolve, reject) {
    let out;
    try { out = this.exec(); } catch (e) { out = { data: null, error: { message: e.message } }; }
    return Promise.resolve(out).then(resolve, reject);
  }

  rows() {
    if (!state.tables[this.table]) state.tables[this.table] = [];
    return state.tables[this.table];
  }

  shape(list) {
    if (this.mode === 'single') {
      if (list.length !== 1) return { data: null, error: { message: `expected 1 row, got ${list.length}`, code: 'PGRST116' } };
      return { data: list[0], error: null };
    }
    if (this.mode === 'maybe') {
      if (list.length > 1) return { data: null, error: { message: 'multiple rows' } };
      return { data: list[0] || null, error: null };
    }
    return { data: list, error: null };
  }

  exec() {
    state.calls.push({ table: this.table, op: this.op });
    const all = this.rows();
    const hit = (r) => this.filters.every(f => f(r));

    if (this.op === 'select') {
      let list = all.filter(hit).map(r => ({ ...r }));
      const count = list.length;
      if (this.sort) {
        const { c, ascending } = this.sort;
        list.sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (ascending ? 1 : -1));
      }
      if (this.window) list = list.slice(this.window[0], this.window[1] + 1);
      if (this.max != null) list = list.slice(0, this.max);
      if (this.opts.head) return { data: null, error: null, count };
      return { ...this.shape(list), count };
    }

    if (this.op === 'insert') {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload];
      const made = [];
      for (const p of incoming) {
        const row = { ...(DEFAULTS[this.table] ? DEFAULTS[this.table]() : {}), ...p };
        if (row.id === undefined) row.id = this.table === 'ip_access_logs' ? state.seq++ : `id-${state.seq++}`;
        const uniq = UNIQUE[this.table];
        if (uniq && all.some(r => uniq(r, row))) {
          return { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } };
        }
        all.push(row);
        made.push({ ...row });
      }
      return this.returning ? this.shape(made) : { data: null, error: null };
    }

    if (this.op === 'upsert') {
      const p = this.payload;
      const existing = all.find(r => this.conflict.every(c => r[c] === p[c]));
      let row;
      if (existing) { Object.assign(existing, p); row = existing; }
      else { row = { ...(DEFAULTS[this.table] ? DEFAULTS[this.table]() : {}), ...p }; all.push(row); }
      return this.returning ? this.shape([{ ...row }]) : { data: null, error: null };
    }

    if (this.op === 'update') {
      const list = all.filter(hit);
      list.forEach(r => Object.assign(r, this.payload));
      return this.returning ? this.shape(list.map(r => ({ ...r }))) : { data: null, error: null };
    }

    if (this.op === 'delete') {
      const keep = all.filter(r => !hit(r));
      const removed = all.length - keep.length;
      state.tables[this.table] = keep;
      return { data: null, error: null, count: removed };
    }
    throw new Error(`unsupported op ${this.op}`);
  }
}

const findUser = (id) => state.users.find(u => u.id === id) || null;
const publicUser = (u) => (u ? { id: u.id, email: u.email, app_metadata: u.app_metadata || {}, user_metadata: {}, created_at: now(), last_sign_in_at: null } : null);
const sessionFor = (u) => ({ access_token: `at-${u.id}`, refresh_token: `rt-${u.id}` });

const admin = {
  from: (table) => new Query(table),
  rpc: async () => ({ data: null, error: null }),
  auth: {
    admin: {
      signOut: async (jwt, scope) => { state.signOuts.push({ jwt, scope }); return { data: null, error: null }; },
      getUserById: async (id) => ({ data: { user: publicUser(findUser(id)) }, error: null }),
      listUsers: async () => ({ data: { users: state.users.map(publicUser) }, error: null }),
    },
    getUser: async (token) => {
      const u = state.users.find(x => `at-${x.id}` === token);
      return u ? { data: { user: publicUser(u) }, error: null } : { data: { user: null }, error: { message: 'bad token' } };
    },
  },
};

const client = {
  from: (table) => new Query(table),
  auth: {
    signInWithPassword: async ({ email, password }) => {
      const u = state.users.find(x => x.email === email && x.password === password);
      if (!u) return { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } };
      return { data: { user: publicUser(u), session: sessionFor(u) }, error: null };
    },
    refreshSession: async ({ refresh_token }) => {
      const u = state.users.find(x => `rt-${x.id}` === refresh_token);
      if (!u) return { data: { user: null, session: null }, error: { message: 'bad refresh token' } };
      return { data: { user: publicUser(u), session: sessionFor(u) }, error: null };
    },
  },
};

function reset(tables = {}, { users = [] } = {}) {
  state.tables = {};
  for (const [name, rows] of Object.entries(tables)) state.tables[name] = rows.map(r => ({ ...r }));
  state.users = users.map(u => ({ ...u }));
  state.calls = [];
  state.signOuts = [];
  state.seq = 1;
}

const table = (name) => state.tables[name] || [];

module.exports = {
  admin,
  client,
  reset,
  table,
  get calls() { return state.calls; },
  get signOuts() { return state.signOuts; },
};

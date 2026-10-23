// In-memory stand-in for supabase-js used by the UI tests. It mirrors the
// database rules in supabase/schema.sql: per-household row isolation,
// ensure_title/swipe (one title per key per household, one swipe per person),
// and "you can only change your own swipes".
// Tests seed it through window.__SEED before the page loads.

const seed = structuredClone(window.__SEED ?? {});
const db = {
  users: seed.users ?? [],
  households: seed.households ?? [],
  members: seed.members ?? [],
  titles: seed.titles ?? [],
  swipes: seed.swipes ?? [],
};
let sessionUserId = seed.sessionUserId ?? null;
let seq = 1;
const uid = (p = "id") => `${p}${seq++}`;
const now = () => new Date(Date.now() + seq).toISOString();
const err = (code, message) => ({ code, message });
const clean = (s) => String(s ?? "").trim().replace(/\s+/g, " ");
const me = () => db.users.find((u) => u.id === sessionUserId) ?? null;
const myHousehold = () => db.members.find((m) => m.user_id === sessionUserId)?.household_id ?? null;
const visible = (table, r) => {
  if (table === "households") return r.id === myHousehold();
  if ("household_id" in r) return r.household_id === myHousehold() && myHousehold() !== null;
  return true;
};
const CHOICES = ["no", "yes", "liked", "disliked"];

function ensureTitle(p) {
  if (!myHousehold()) throw err("42501", "not in a household");
  const title = clean(p.title);
  if (!title) throw err("23514", "title required");
  let t = db.titles.find((x) => x.household_id === myHousehold() && x.key === p.key);
  if (t) { t.poster ??= p.poster ?? null; t.overview ??= p.overview ?? null; t.rating ??= p.rating ?? null; return t; }
  t = { id: uid("title"), household_id: myHousehold(), key: p.key, media_type: p.media_type ?? "movie", tmdb_id: p.tmdb_id ?? null,
    title, year: p.year ?? null, poster: p.poster ?? null, overview: p.overview ?? null, rating: p.rating ?? null,
    added_by: sessionUserId, created_at: now() };
  db.titles.push(t);
  return t;
}

function setSwipe(titleId, choice) {
  if (!CHOICES.includes(choice)) throw err("23514", "bad choice");
  const t = db.titles.find((x) => x.id === titleId && visible("titles", x));
  if (!t) throw err("42501", "new row violates row-level security policy");
  db.swipes = db.swipes.filter((s) => !(s.title_id === titleId && s.user_id === sessionUserId));
  const row = { title_id: titleId, user_id: sessionUserId, household_id: myHousehold(), choice, updated_at: now() };
  db.swipes.push(row);
  return row;
}

function query(table) {
  const filters = [];
  let op = "select", payload = null, single = false, maybe = false, returning = false, orders = [], limit = Infinity;
  const matches = (r) => visible(table, r) && filters.every(([k, v, neg]) => (neg ? r[k] !== v : r[k] === v));

  function run() {
    if (!sessionUserId && table !== "members") return { data: single ? null : [], error: null };
    let out = [];
    try {
      if (op === "insert" || op === "upsert") {
        if (!myHousehold()) throw err("42501", "not in a household");
        for (const p of Array.isArray(payload) ? payload : [payload]) {
          if (table === "swipes") out.push(setSwipe(p.title_id, p.choice));
          else if (table === "titles") out.push(ensureTitle(p));
          else throw err("42501", "permission denied");
        }
      } else if (op === "update") {
        if (table !== "titles") throw err("42501", "permission denied");
        out = db[table].filter(matches);
        for (const r of out) Object.assign(r, payload);
      } else if (op === "delete") {
        if (table !== "swipes") throw err("42501", "permission denied");
        out = db.swipes.filter((r) => matches(r) && r.user_id === sessionUserId);
        db.swipes = db.swipes.filter((r) => !out.includes(r));
      } else {
        out = db[table].filter(matches).map((r) => ({ ...r }));
        for (const [col, asc] of orders.slice().reverse()) {
          out.sort((a, b) => String(a[col] ?? "").localeCompare(String(b[col] ?? "")) * (asc ? 1 : -1));
        }
        out = out.slice(0, limit);
      }
    } catch (e) {
      return { data: null, error: e };
    }
    if (op !== "select" && !returning) return { data: null, error: null };
    if (single) {
      if (!out.length && !maybe) return { data: null, error: err("PGRST116", "no rows") };
      return { data: out[0] ?? null, error: null };
    }
    return { data: out, error: null };
  }

  const c = {
    select() { if (op !== "select") returning = true; return c; },
    insert(p) { op = "insert"; payload = p; return c; },
    upsert(p) { op = "upsert"; payload = p; return c; },
    update(p) { op = "update"; payload = p; return c; },
    delete() { op = "delete"; return c; },
    eq(k, v) { filters.push([k, v, false]); return c; },
    neq(k, v) { filters.push([k, v, true]); return c; },
    order(col, opts = {}) { orders.push([col, opts.ascending !== false]); return c; },
    limit(n) { limit = n; return c; },
    single() { single = true; return c; },
    maybeSingle() { single = true; maybe = true; return c; },
    then(ok, bad) { return Promise.resolve(run()).then(ok, bad); },
  };
  return c;
}

const listeners = [];
const changeListeners = [];
const session = () => (me() ? { user: { id: me().id, email: me().email, user_metadata: { username: me().username } } } : null);
const emit = (event) => listeners.forEach((cb) => cb(event, session()));

async function rpc(fn, args) {
  try {
    if (!sessionUserId) throw err("42501", "not signed in");
    if (fn === "ensure_title") return { data: ensureTitle(args.p).id, error: null };
    if (fn === "swipe") {
      const t = ensureTitle(args.p_title);
      setSwipe(t.id, args.p_choice);
      return { data: t.id, error: null };
    }
    if (fn === "create_household" || fn === "join_household") {
      if (myHousehold()) throw err("P0001", "already in a household");
      let h;
      if (fn === "create_household") {
        h = { id: uid("hh"), name: clean(args.p_name) || "Home", join_code: "JOIN" + seq++ };
        db.households.push(h);
      } else {
        h = db.households.find((x) => x.join_code === clean(args.p_code).toUpperCase());
        if (!h) throw err("P0001", "invalid join code");
      }
      db.members.push({ user_id: sessionUserId, household_id: h.id, username: args.p_username, created_at: now() });
      return { data: h.id, error: null };
    }
    throw err("PGRST202", `unknown function ${fn}`);
  } catch (e) {
    return { data: null, error: e };
  }
}

export function createClient() {
  return {
    auth: {
      onAuthStateChange(cb) { listeners.push(cb); setTimeout(() => cb("INITIAL_SESSION", session())); return { data: { subscription: { unsubscribe() {} } } }; },
      async getSession() { return { data: { session: session() } }; },
      async signInWithPassword({ email, password }) {
        const u = db.users.find((x) => x.email === email && x.password === password);
        if (!u) return { data: {}, error: { message: "Invalid login credentials" } };
        sessionUserId = u.id; emit("SIGNED_IN");
        return { data: session(), error: null };
      },
      async signUp({ email, password, options }) {
        if (db.users.some((x) => x.email === email)) return { data: {}, error: { message: "User already registered" } };
        if (password.length < 6) return { data: {}, error: { message: "Password should be at least 6 characters." } };
        const u = { id: uid("user"), email, password, username: options?.data?.username };
        db.users.push(u);
        sessionUserId = u.id; emit("SIGNED_IN");
        return { data: session(), error: null };
      },
      async signOut() { sessionUserId = null; emit("SIGNED_OUT"); return { error: null }; },
      async updateUser({ password }) {
        if (!me()) return { data: {}, error: { message: "Auth session missing!" } };
        if (password.length < 6) return { data: {}, error: { message: "Password should be at least 6 characters." } };
        me().password = password;
        return { data: { user: session().user }, error: null };
      },
    },
    from: query,
    rpc,
    channel() {
      const ch = { on(_e, _f, cb) { changeListeners.push(cb); return ch; }, subscribe() { return ch; } };
      return ch;
    },
    removeChannel() { changeListeners.length = 0; },
  };
}

// Tests call __fake.as(userId, fn) to act as the partner on another phone,
// then __fake.changed() to fire the realtime callbacks.
window.__fake = {
  db,
  get sessionUserId() { return sessionUserId; },
  async as(userId, fn) {
    const prev = sessionUserId;
    sessionUserId = userId;
    try { return await fn({ rpc, from: query }); } finally { sessionUserId = prev; }
  },
  changed() { changeListeners.forEach((cb) => cb({})); },
};

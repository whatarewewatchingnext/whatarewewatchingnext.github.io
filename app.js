import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY, USERNAME_EMAIL_DOMAIN, TMDB_KEY, TMDB_REGION, OMDB_KEY, LANGUAGES } from "./config.js";
import {
  CHOICES, esc, cleanName, mediaLabel, choiceFromDrag, dragProgress, titleKey, fromTmdb, posterUrl, faceUrl,
  detailsFromTmdb, imdbRating, latestWork, recSeeds, recommend, becauseText, inLanguages,
  favouriteActors, seededRandom, daySeed, keyedNoise,
  feedRequest, feedMediaType, buildDeck, choicesFor, matches, onlyWants, watchedList, myList,
  partnerNote, STARTER, hue,
} from "./lib.js";

const app = document.getElementById("app");
const $ = (sel, root = document) => root.querySelector(sel);
const mount = (id) => { app.replaceChildren($(`#${id}`).content.cloneNode(true)); };
const showError = (el, err) => { el.textContent = err?.message ?? String(err); el.hidden = false; };

if (!SUPABASE_URL || !SUPABASE_KEY) {
  mount("tpl-setup");
  throw new Error("config.js is not filled in");
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const toEmail = (u) => `${u.trim().toLowerCase()}@${USERNAME_EMAIL_DOMAIN}`;

// How many cards to keep queued up before fetching more from TMDB.
const DECK_MIN = 6;

let state = freshState();
function freshState() {
  return {
    user: null, member: null, household: null, members: [], titles: [], swipes: [],
    filter: "all", feeds: {}, pending: new Map(), undo: [], front: null, mineTab: "yes",
    matchIds: null, picked: null,
  };
}
let channel = null;

sb.auth.onAuthStateChange((_event, session) => {
  const uid = session?.user?.id ?? null;
  if (uid === state.user?.id) return;
  state = { ...freshState(), user: session?.user ?? null };
  route();
});

$("#logout").addEventListener("click", () => sb.auth.signOut());
app.addEventListener("click", onClick);
document.addEventListener("keydown", onKey);

async function route() {
  if (channel) { sb.removeChannel(channel); channel = null; }
  $("#who").hidden = !state.user;
  if (!state.user) return showAuth();

  const { data: member, error } = await sb.from("members").select("*").eq("user_id", state.user.id).maybeSingle();
  if (error) { app.textContent = error.message; return; }
  state.member = member;
  $("#who-name").textContent = member?.username ?? state.user.user_metadata?.username ?? "";
  if (!member) return showHousehold();
  showMain();
}

// ---------------------------------------------------------------- auth ----

function showAuth() {
  document.body.classList.remove("in-app", "swiping");
  mount("tpl-auth");
  const form = $("#auth-form");
  const submit = $("button[type=submit]", form);
  const err = $(".error", form);
  let mode = "login";

  app.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => {
    mode = b.dataset.mode;
    app.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
    submit.textContent = mode === "login" ? "Log in" : "Create account";
    form.password.autocomplete = mode === "login" ? "current-password" : "new-password";
    err.hidden = true;
  }));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.hidden = true;
    submit.disabled = true;
    const username = form.username.value.trim();
    const email = toEmail(username);
    const password = form.password.value;
    const { error } = mode === "login"
      ? await sb.auth.signInWithPassword({ email, password })
      : await sb.auth.signUp({ email, password, options: { data: { username } } });
    submit.disabled = false;
    if (error) {
      showError(err, error.message === "Invalid login credentials" ? new Error("Wrong username or password") : error);
    } else if (mode === "signup") {
      const { data } = await sb.auth.getSession();
      if (!data.session) showError(err, new Error("Account created, but email confirmation is on in Supabase. Turn it off (see README) and log in."));
    }
  });
}

// ----------------------------------------------------------- household ----

function showHousehold() {
  mount("tpl-household");
  const err = app.querySelector(":scope > .card > .error");
  const username = state.user.user_metadata?.username ?? state.user.email.split("@")[0];

  $("#create-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error } = await sb.rpc("create_household", { p_name: e.target.name.value, p_username: username });
    error ? showError(err, error) : route();
  });
  $("#join-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error } = await sb.rpc("join_household", { p_code: e.target.code.value, p_username: username });
    error ? showError(err, error) : route();
  });
}

// ---------------------------------------------------------------- main ----

function showMain() {
  mount("tpl-main");
  document.body.classList.add("in-app");

  app.querySelectorAll(".bottom-nav button").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));

  $("#filter").addEventListener("click", (e) => {
    const b = e.target.closest("[data-filter]");
    if (!b) return;
    state.filter = b.dataset.filter;
    $("#filter").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
    renderDeck();
  });
  $("#mine-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-choice]");
    if (!b) return;
    state.mineTab = b.dataset.choice;
    $("#mine-tabs").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
    renderMine();
  });

  app.querySelectorAll("[data-swipe]").forEach((b) => b.addEventListener("click", () => swipeTop(b.dataset.swipe)));
  $("#undo").addEventListener("click", undo);
  $("#pick").addEventListener("click", pickOne);
  setupDrag($("#deck"));
  setupSearch();
  setupPerson();
  setupPassword();
  $("#tmdb-credit").hidden = !TMDB_KEY;
  showView("swipe");

  loadHousehold();
  loadData();

  let t = null;
  const soon = () => { clearTimeout(t); t = setTimeout(loadData, 150); };
  channel = sb.channel("household")
    .on("postgres_changes", { event: "*", schema: "public", table: "titles" }, soon)
    .on("postgres_changes", { event: "*", schema: "public", table: "swipes" }, soon)
    .subscribe();
}

function showView(view) {
  app.querySelectorAll(".bottom-nav button").forEach((x) => x.classList.toggle("active", x.dataset.view === view));
  app.querySelectorAll("[data-view]:not(button)").forEach((s) => (s.hidden = s.dataset.view !== view));
  document.body.classList.toggle("swiping", view === "swipe");
  window.scrollTo(0, 0);
}

function onKey(e) {
  if (!$("#deck") || $(".swipe-view").hidden || $("#search")?.open || $("#person")?.open) return;
  if (e.target.closest?.("input, select, textarea")) return;
  const choice = { ArrowLeft: "no", ArrowRight: "yes", ArrowUp: "liked", ArrowDown: "disliked" }[e.key];
  if (choice) { e.preventDefault(); swipeTop(choice); }
  else if (e.key === "Backspace" || (e.key === "z" && (e.metaKey || e.ctrlKey))) { e.preventDefault(); undo(); }
}

async function loadHousehold() {
  const [{ data: hh }, { data: members }] = await Promise.all([
    sb.from("households").select("*").single(),
    sb.from("members").select("user_id, username").order("created_at"),
  ]);
  state.household = hh;
  state.members = members ?? [];
  $("#hh-name").textContent = hh?.name ?? "";
  $("#hh-code").textContent = hh?.join_code ?? "";
  $("#members").innerHTML = state.members.map((m) => `<li>${esc(m.username)}${m.user_id === state.user.id ? ` <span class="meta">(you)</span>` : ""}</li>`).join("");
  renderAll();
}

const memberIds = () => state.members.map((m) => m.user_id);
const nameOf = (uid) => state.members.find((m) => m.user_id === uid)?.username ?? "someone";
const others = () => state.members.filter((m) => m.user_id !== state.user.id);

async function loadData() {
  const [{ data: titles }, { data: swipes }] = await Promise.all([
    sb.from("titles").select("*").order("created_at"),
    sb.from("swipes").select("*"),
  ]);
  state.titles = titles ?? [];
  state.swipes = swipes ?? [];
  noticeMatches();
  renderAll();
  refreshRecs();
}

// ------------------------------------------------- "For you two" recs ----

// Per liked title: its TMDB recommendations and top cast, fetched once per session (one request each).
const seedInfo = new Map();
// Per favourite actor: their well-rated work.
const actorWork = new Map();
let recs = [];                 // [{ t, score, because }], best first
let recReason = new Map();     // title key → "✨ Because …"
let recSalt = 0;               // 🎲 Shuffle bumps this for a different mix today

async function refreshRecs() {
  if (!TMDB_KEY || !state.user) return;
  const day = daySeed(new Date(), recSalt);
  const rand = seededRandom(day);
  const seeds = recSeeds(state.titles, state.swipes, memberIds(), { rand });
  const keep = (x) => x && inLanguages(x, LANGUAGES);
  await Promise.all([...seeds.pos, ...seeds.neg].filter((s) => !seedInfo.has(s.t.key)).map(async ({ t }) => {
    seedInfo.set(t.key, { recs: [], cast: [] });
    try {
      const d = await tmdbGet(`${t.media_type}/${t.tmdb_id}`, { append_to_response: "credits,recommendations" });
      seedInfo.set(t.key, {
        recs: (d.recommendations?.results ?? []).map((r) => fromTmdb(r, r.media_type ?? t.media_type)).filter(keep),
        cast: (d.credits?.cast ?? []).slice(0, 6).map((c) => ({ id: c.id, name: c.name })),
      });
    } catch (e) {
      console.warn("TMDB recommendations:", e.message);
      seedInfo.delete(t.key);
    }
  }));
  const actors = favouriteActors(seeds.pos, (k) => seedInfo.get(k)?.cast);
  await Promise.all(actors.filter((a) => !actorWork.has(a.id)).map(async (a) => {
    actorWork.set(a.id, []);
    try {
      actorWork.set(a.id, latestWork(await tmdbGet(`person/${a.id}/combined_credits`), 30).map((w) => w.t).filter(keep));
    } catch (e) {
      console.warn("TMDB person:", e.message);
      actorWork.delete(a.id);
    }
  }));
  const mine = new Set(state.swipes.filter((x) => x.user_id === state.user.id).map((x) => x.title_id));
  const exclude = new Set(state.titles.filter((t) => mine.has(t.id)).map((t) => t.key));
  recs = recommend(seeds, (k) => seedInfo.get(k)?.recs, { exclude, actors, workFor: (id) => actorWork.get(id), noise: keyedNoise(day) });
  recReason = new Map(recs.map((r) => [r.t.key, becauseText(r.because, state.user.id, nameOf, state.members.length)]));
  renderDeck();
  renderForYou();
}

function renderForYou() {
  const el = $("#for-you");
  if (!el) return;
  $("#for-you-card").hidden = !TMDB_KEY;
  const top = recs.slice(0, 10);
  if (!top.length) {
    el.innerHTML = `<li class="muted">Swipe → or ↑ on a few things you like and suggestions show up here.</li>`;
    return;
  }
  renderPickList(el, top.map((r) => r.t), top.map((r) => esc(recReason.get(r.t.key))));
}

// Toast when a new match appears, whether from my swipe or my partner's.
function noticeMatches() {
  if (state.members.length < 2) return;
  const now = matches(state.titles, state.swipes, memberIds());
  const before = state.matchIds;
  state.matchIds = new Set(now.map((t) => t.id));
  if (!before) return;
  const fresh = now.filter((t) => !before.has(t.id));
  if (fresh.length) toast(`🎉 It's a match! You both want to watch ${fresh.map((t) => t.title).join(", ")}`);
}

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 3500);
}

function renderAll() {
  if (!$("#deck")) return;
  renderDeck();
  renderMatches();
  renderWatched();
  renderMine();
}

// ---------------------------------------------------------------- deck ----

// TMDB feed per filter: items fetched so far, and how many requests have been made (see feedRequest).
function feedFor(filter) {
  return (state.feeds[filter] ??= TMDB_KEY ? { items: [], n: 0, loading: false, done: false } : { items: STARTER, done: true });
}

async function loadMore(filter) {
  const f = feedFor(filter);
  if (f.loading || f.done) return;
  f.loading = true;
  try {
    for (let tries = 0; tries < 3; tries++) {
      const req = feedRequest(filter, f.n++, new Date(), LANGUAGES);
      if (!req) { f.done = true; break; }
      const results = await tmdb(req.path, req.params);
      const items = results.map((r) => fromTmdb(r, feedMediaType(req.path) ?? r.media_type)).filter((t) => t && inLanguages(t, LANGUAGES));
      f.items.push(...items);
      if (currentDeck(filter).length >= DECK_MIN) break;
    }
  } catch (e) {
    console.warn("TMDB:", e.message);
    f.done = true;
    toast("Couldn't reach TMDB. Check TMDB_KEY in config.js.");
  } finally {
    f.loading = false;
  }
}

async function tmdbGet(path, params = {}) {
  const q = new URLSearchParams({ api_key: TMDB_KEY, language: "en-US", ...(TMDB_REGION ? { region: TMDB_REGION } : {}), ...params });
  const res = await fetch(`https://api.themoviedb.org/3/${path}?${q}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
const tmdb = async (path, params) => (await tmdbGet(path, params)).results ?? [];

// Runtime, genres, cast and IMDb rating per title key, fetched when its card comes near the top.
const details = new Map();

function ensureDetails(t) {
  if (!TMDB_KEY || !t.tmdb_id || details.has(t.key)) return;
  details.set(t.key, null);
  (async () => {
    const d = detailsFromTmdb(await tmdbGet(`${t.media_type}/${t.tmdb_id}`, { append_to_response: "credits,external_ids" }), t.media_type);
    if (OMDB_KEY && d.imdbId) {
      try {
        const r = await fetch(`https://www.omdbapi.com/?${new URLSearchParams({ i: d.imdbId, apikey: OMDB_KEY })}`);
        d.imdb = imdbRating(await r.json());
      } catch (e) {
        console.warn("OMDb:", e.message);
      }
    }
    details.set(t.key, d);
    renderDeck();
  })().catch((e) => { console.warn("TMDB details:", e.message); details.delete(t.key); });
}

function currentDeck(filter = state.filter) {
  // Recommendations go after anything from the household, before the general feed.
  const feed = [...recs.map((r) => r.t), ...feedFor(filter).items];
  const deck = buildDeck({ titles: state.titles, swipes: state.swipes, feed, userId: state.user.id, filter })
    .filter((t) => !state.pending.has(t.key));
  // Once you're swiping, cards already on screen keep their places, so new data (a save,
  // a partner's swipe, updated recommendations) never swaps out the card you're about to see.
  // Before the first swipe the deck is still loading, so recommendations may take the top.
  const onScreen = swiping && shown.filter === filter ? shown.keys : [];
  const at = (t) => { const i = onScreen.indexOf(t.key); return i < 0 ? Infinity : i; };
  deck.sort((a, b) => at(a) - at(b));
  if (state.front) {
    const i = deck.findIndex((t) => t.key === state.front);
    if (i > 0) deck.unshift(...deck.splice(i, 1));
  }
  return deck;
}

let drag = null;      // the drag in progress, if any
let flying = false;   // a card is animating off-screen
let shown = { filter: null, keys: [] };   // cards on screen, top first
let swiping = false;                       // set by the first swipe this session

async function renderDeck() {
  const el = $("#deck");
  if (!el || drag || flying) return;
  const filter = state.filter;
  let deck = currentDeck(filter);
  const f = feedFor(filter);
  if (deck.length < DECK_MIN && !f.done) {
    if (!deck.length) { el.innerHTML = `<div class="empty muted">Loading…</div>`; shown = { filter, keys: [] }; }
    if (!f.loading) loadMore(filter).then(() => state.filter === filter && renderDeck());
    if (!deck.length) return;
  }

  const show = deck.slice(0, 3);
  show.forEach(ensureDetails);
  $("#undo").disabled = !state.undo.length;
  shown = { filter, keys: show.map((t) => t.key) };
  if (!show.length) {
    el.innerHTML = `<div class="empty"><div class="big">🍿</div><p>You've swiped through everything${filter === "all" ? "" : ` in ${filter === "tv" ? "shows" : "movies"}`}.</p>
       <p class="muted small">Try another filter, or tap 🔍 Find to add something.</p></div>`;
    return;
  }
  // Reuse a card's element while what it shows is unchanged, so its poster never reloads;
  // only its place in the stack is updated.
  const old = new Map([...el.querySelectorAll(".mcard")].map((c) => [c.dataset.key, c]));
  const cards = show.map((t, i) => {
    const sig = cardSig(t);
    let c = old.get(t.key);
    if (!c || c.dataset.sig !== sig) {
      const tpl = document.createElement("template");
      tpl.innerHTML = cardHtml(t, i).trim();
      c = tpl.content.firstElementChild;
      c.dataset.sig = sig;
    }
    patchNote(c, partnerNoteFor(t) || recReason.get(t.key) || "");
    c.style.setProperty("--i", i);
    c.classList.toggle("top", i === 0);
    if (i === 0) { c.tabIndex = 0; c.removeAttribute("aria-hidden"); c.setAttribute("aria-label", t.title); }
    else { c.removeAttribute("tabindex"); c.setAttribute("aria-hidden", "true"); c.classList.remove("expanded"); }
    return c;
  });
  const order = cards.slice().reverse();
  if (order.length !== el.children.length || order.some((c, i) => el.children[i] !== c)) el.replaceChildren(...order);
}

// Changes only when the card's layout changes (details loading → loaded); notes are patched in place.
const cardSig = (t) => (details.has(t.key) ? (details.get(t.key) ? "d" : "loading") : "none");

function patchNote(card, text) {
  let note = card.querySelector(".facts .note");
  if (!text) return note?.remove();
  if (!note) {
    note = document.createElement("div");
    note.className = "note";
    card.querySelector(".facts").prepend(note);
  }
  if (note.textContent !== text) note.textContent = text;
}

const partnerNoteFor = (t) => (t.id ? partnerNote(state.swipes, t.id, state.user.id, nameOf) : "");

function cardHtml(t, i) {
  const d = details.get(t.key);
  const poster = posterUrl(d?.poster ?? t.poster);
  const note = partnerNoteFor(t) || recReason.get(t.key) || "";
  const overview = d?.overview ?? t.overview;
  const rating = d?.imdb ? `<span class="badge-imdb"><b>IMDb</b> ★ ${esc(d.imdb)}</span>`
    : t.rating ? `<span class="badge-tmdb"><b>TMDB</b> ★ ${esc(t.rating)}</span>` : "";
  const meta = [t.year, mediaLabel(t.media_type), d?.length].filter(Boolean).join(" · ");
  const cast = d?.cast ?? [];
  return `<article class="mcard dcard${i === 0 ? " top" : ""}" data-key="${esc(t.key)}" style="--i:${i}; --h:${hue(t.title)}" ${i === 0 ? `tabindex="0" aria-label="${esc(t.title)}"` : `aria-hidden="true"`}>
    ${poster ? `<div class="backdrop" style="background-image:url('${esc(posterUrl(d?.poster ?? t.poster, "w342"))}')"></div>` : ""}
    <div class="stamp s-yes">WANT ♥</div><div class="stamp s-no">NOPE</div>
    <div class="stamp s-liked">LOVED IT 👍</div><div class="stamp s-disliked">MEH 👎</div>
    <div class="body">
      <div class="head">
        <div class="poster">${poster ? `<img src="${esc(poster)}" alt="" draggable="false" onerror="this.remove()" ${i ? `loading="lazy"` : ""}>` : ""}<span class="ph">${t.media_type === "tv" ? "📺" : "🎬"}</span></div>
        <div class="facts">
          ${note ? `<div class="note">${esc(note)}</div>` : ""}
          <h2>${esc(t.title)}</h2>
          ${rating ? `<div>${rating}</div>` : ""}
          <div class="meta">${esc(meta)}</div>
          ${d?.genres.length ? `<div class="genres">${d.genres.map((g) => `<span>${esc(g)}</span>`).join("")}</div>` : ""}
        </div>
      </div>
      ${overview ? `<div class="lbl lbl-story">Story</div><p class="overview">${esc(overview)}</p>` : ""}
      ${cast.length ? `<div class="lbl lbl-cast">Cast <span>tap a face for their latest</span></div>
      <div class="cast">${cast.map((c) => `<button type="button" class="face" data-person="${c.id}" data-name="${esc(c.name)}" data-face="${esc(c.face ?? "")}" aria-label="${esc(c.name)}: latest movies and shows">
        ${c.face ? `<img src="${esc(faceUrl(c.face))}" alt="" draggable="false" loading="lazy">` : `<span class="noface">${esc(c.name[0] ?? "?")}</span>`}
        <span class="n">${esc(c.name)}</span>${c.character ? `<span class="r">${esc(c.character)}</span>` : ""}</button>`).join("")}</div>`
        : d === null ? `<div class="lbl lbl-cast">Cast</div><div class="cast loading">${"<span class=\"face\"><span class=\"noface\"></span></span>".repeat(3)}</div>` : ""}
    </div>
  </article>`;
}

const topCard = () => $("#deck .mcard.top");
const topItem = () => {
  const key = topCard()?.dataset.key;
  return key ? currentDeck().find((t) => t.key === key) : null;
};

function setupDrag(deck) {
  deck.addEventListener("pointerdown", (e) => {
    const card = e.target.closest(".mcard.top");
    if (!card || flying || (e.pointerType === "mouse" && e.button !== 0)) return;
    card.setPointerCapture(e.pointerId);
    card.style.transition = "none";
    drag = { card, id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0, face: e.target.closest("[data-person]") };
  });
  deck.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.dx = e.clientX - drag.x;
    drag.dy = e.clientY - drag.y;
    place(drag.card, drag.dx, drag.dy);
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { card, dx, dy, face } = drag;
    drag = null;
    const choice = e.type === "pointerup" ? choiceFromDrag(dx, dy) : null;
    if (choice) return fly(card, choice, dx, dy);
    card.style.transition = "";
    place(card, 0, 0);
    // A tap (not a drag): on a face opens that person, anywhere else shows the full story.
    if (e.type === "pointerup" && Math.hypot(dx, dy) < 8) {
      if (face) openPerson(face.dataset);
      else card.classList.toggle("expanded");
    }
    renderDeck();
  };
  deck.addEventListener("pointerup", end);
  deck.addEventListener("pointercancel", end);
}

// Moves the card with the finger and fades in the stamp for where it would land.
function place(card, dx, dy) {
  card.style.transform = dx || dy ? `translate(${dx}px, ${dy}px) rotate(${dx / 14}deg)` : "";
  const lean = dx || dy ? choiceFromDrag(dx, dy, 1) : null;
  const p = dragProgress(dx, dy);
  card.querySelectorAll(".stamp").forEach((s) => (s.style.opacity = s.classList.contains(`s-${lean}`) ? p : 0));
}

function swipeTop(choice) {
  const card = topCard();
  if (!card || flying || drag) return;
  const nudge = { yes: [40, 0], no: [-40, 0], liked: [0, -40], disliked: [0, 40] }[choice];
  card.querySelector(`.s-${choice}`).style.opacity = 1;
  fly(card, choice, ...nudge);
}

function fly(card, choice, dx, dy) {
  const item = currentDeck().find((t) => t.key === card.dataset.key);
  flying = true;
  const w = window.innerWidth * 1.5, h = window.innerHeight * 1.2;
  const to = { yes: [w, dy], no: [-w, dy], liked: [dx, -h], disliked: [dx, h] }[choice];
  card.style.transition = "transform .28s ease-out, opacity .28s ease-out";
  card.style.transform = `translate(${to[0]}px, ${to[1]}px) rotate(${to[0] / 30}deg)`;
  card.style.opacity = "0";
  setTimeout(() => {
    flying = false;
    if (item) commit(item, choice);
    else renderDeck();
  }, 260);
}

// Hides the card right away, then saves. The database adds the title to the
// household the first time anyone swipes on it.
async function commit(item, choice) {
  swiping = true;
  if (state.front === item.key) state.front = null;
  const job = { key: item.key, choice, titleId: item.id ?? null };
  job.saved = sb.rpc("swipe", { p_title: titlePayload(item), p_choice: choice });
  state.pending.set(item.key, job);
  state.undo.push(job);
  if (state.undo.length > 20) state.undo.shift();
  renderDeck();

  const { data, error } = await job.saved;
  if (error) {
    state.pending.delete(item.key);
    state.undo = state.undo.filter((j) => j !== job);
    toast(`Couldn't save: ${error.message}`);
    renderDeck();
    return;
  }
  job.titleId = data;
  await loadData();
  state.pending.delete(item.key);
  renderDeck();
}

const titlePayload = (t) => ({
  key: t.key, media_type: t.media_type, tmdb_id: t.tmdb_id ?? null, title: t.title,
  year: t.year ?? null, poster: t.poster ?? null, overview: t.overview ?? null, rating: t.rating ?? null,
});

async function undo() {
  const job = state.undo.pop();
  if (!job) return;
  const { data: id } = await job.saved;
  if (id) await sb.from("swipes").delete().eq("title_id", id).eq("user_id", state.user.id);
  state.pending.delete(job.key);
  state.front = job.key;
  await loadData();
}

// ------------------------------------------------------------- lists ----

function rowHtml(t, right = "", sub = "") {
  const poster = posterUrl(t.poster, "w154");
  const meta = [t.year, mediaLabel(t.media_type), t.rating ? `⭐ ${t.rating}` : null].filter(Boolean).join(" · ");
  return `<li>
    ${poster ? `<img class="thumb" src="${esc(poster)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'), { className: 'thumb ph', textContent: '🎬' }))">` : `<div class="thumb ph" style="--h:${hue(t.title)}">${t.media_type === "tv" ? "📺" : "🎬"}</div>`}
    <div class="grow"><div class="t">${esc(t.title)}</div><div class="meta">${esc(meta)}</div>${sub ? `<div class="meta">${sub}</div>` : ""}</div>
    ${right}
  </li>`;
}

// Buttons that set my choice on a title; the current one is highlighted.
function choiceButtons(t, which = ["yes", "liked", "disliked", "no"]) {
  const mine = choicesFor(state.swipes, t.id)[state.user.id];
  return `<div class="choices">${which.map((c) =>
    `<button data-act="set" data-id="${t.id}" data-choice="${c}" class="c-${c} ${mine === c ? "on" : ""}" aria-label="${CHOICES[c].label}" title="${CHOICES[c].label}">${CHOICES[c].icon}</button>`).join("")}</div>`;
}

const verdictText = (c) => (c === "yes" ? "♥ wants it" : c === "no" ? "✕ nope" : c === "liked" ? "👍 liked it" : c === "disliked" ? "👎 didn't like it" : "hasn't swiped");

function renderMatches() {
  if (!$("#matches")) return;
  const both = matches(state.titles, state.swipes, memberIds());
  const count = $("#match-count");
  count.textContent = both.length;
  count.hidden = !both.length;
  $("#pick").hidden = both.length < 2;
  if (state.picked && !both.some((t) => t.id === state.picked)) state.picked = null;
  const picked = both.find((t) => t.id === state.picked);
  $("#picked").hidden = !picked;
  $("#picked").innerHTML = picked ? `<div class="muted small">Tonight's pick</div><strong>${esc(picked.title)}</strong>` : "";

  const solo = state.members.length < 2;
  $("#matches").innerHTML = both.length
    ? both.map((t) => rowHtml(t, choiceButtons(t, ["liked", "disliked"]), "Watched it? Rate it →")).join("")
    : `<li class="muted">${solo ? "Matches show up once your partner joins. Send them the join code from 🏠 Home." : "No matches yet. Keep swiping right on things you'd watch."}</li>`;

  const partners = others();
  $("#partner-card").hidden = !partners.length;
  $("#partner-title").textContent = partners.length ? `💭 ${partners.map((m) => m.username).join(" & ")} wants to watch` : "";
  const theirs = partners.flatMap((m) => onlyWants(state.titles, state.swipes, m.user_id))
    .filter((t, i, a) => a.findIndex((x) => x.id === t.id) === i);
  $("#partner-wants").innerHTML = theirs.length
    ? theirs.map((t) => rowHtml(t, choiceButtons(t, ["yes", "no"]), `You: ${verdictText(choicesFor(state.swipes, t.id)[state.user.id])}`)).join("")
    : `<li class="muted">Nothing waiting on you.</li>`;

  const mine = onlyWants(state.titles, state.swipes, state.user.id);
  $("#only-me").innerHTML = mine.length
    ? mine.map((t) => rowHtml(t, choiceButtons(t, ["no"]), partners.map((m) => `${esc(m.username)}: ${verdictText(choicesFor(state.swipes, t.id)[m.user_id])}`).join(" · "))).join("")
    : `<li class="muted">Nothing here.</li>`;
}

function pickOne() {
  const both = matches(state.titles, state.swipes, memberIds());
  if (!both.length) return;
  const rest = both.filter((t) => t.id !== state.picked);
  state.picked = (rest.length ? rest : both)[Math.floor(Math.random() * (rest.length || both.length))].id;
  renderMatches();
}

function renderWatched() {
  if (!$("#watched")) return;
  const rows = watchedList(state.titles, state.swipes);
  $("#watched").innerHTML = rows.length ? rows.map(({ t, verdicts }) => rowHtml(t, choiceButtons(t, ["liked", "disliked"]),
    state.members.filter((m) => verdicts[m.user_id]).map((m) => `${esc(m.username)} ${verdicts[m.user_id] === "liked" ? "👍" : "👎"}`).join(" · "))).join("")
    : `<li class="muted">Nothing yet. Swipe ↑ or ↓ on things you've already seen.</li>`;
}

function renderMine() {
  if (!$("#mine")) return;
  const rows = myList(state.titles, state.swipes, state.user.id, state.mineTab);
  $("#mine").innerHTML = rows.length
    ? rows.map((t) => rowHtml(t, `${choiceButtons(t)}<button class="x" data-act="unswipe" data-id="${t.id}" aria-label="Put back in my deck" title="Put back in my deck">↺</button>`)).join("")
    : `<li class="muted">Nothing here yet.</li>`;
}

async function onClick(e) {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const { act, id } = btn.dataset;
  if (act === "set") {
    const mine = choicesFor(state.swipes, id)[state.user.id];
    if (mine === btn.dataset.choice) return;
    const { error } = await sb.from("swipes").upsert({ title_id: id, choice: btn.dataset.choice, updated_at: new Date().toISOString() });
    if (error) return toast(error.message);
    loadData();
  } else if (act === "unswipe") {
    await sb.from("swipes").delete().eq("title_id", id).eq("user_id", state.user.id);
    state.front = state.titles.find((t) => t.id === id)?.key ?? null;
      loadData();
  }
}

// -------------------------------------------------------------- search ----

function setupSearch() {
  const dlg = $("#search");
  const form = $("#search-form");
  form.media.hidden = !!TMDB_KEY;
  form.q.placeholder = TMDB_KEY ? "Search movies & shows…" : "Movie or show name";
  $("#open-search").addEventListener("click", () => {
    $("#results").innerHTML = "";
    form.reset();
    dlg.showModal();
    form.q.focus();
  });
  $("#close-search").addEventListener("click", () => dlg.close());
  dlg.addEventListener("close", () => renderDeck());

  let found = [];
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = cleanName(form.q.value);
    if (!q) return;
    if (!TMDB_KEY) {
      found = [{ key: titleKey(form.media.value, null, q), media_type: form.media.value, tmdb_id: null, title: q, year: null, poster: null, overview: null, rating: null }];
    } else {
      $("#results").innerHTML = `<li class="muted">Searching…</li>`;
      try {
        found = (await tmdb("search/multi", { query: q, include_adult: "false" })).map((r) => fromTmdb(r)).filter(Boolean).slice(0, 12);
      } catch (err) {
        $("#results").innerHTML = `<li class="error">Search failed: ${esc(err.message)}</li>`;
        return;
      }
    }
    renderResults(found);
  });

  bindPickList($("#results"));
}

const renderResults = (found) => renderPickList($("#results"), found);

// A list of titles (search results, someone's latest work) with buttons to swipe each one.
function renderPickList(el, found, subs = []) {
  el.found = found;
  el.subs = subs;
  el.innerHTML = found.length ? found.map((t, i) => {
    const existing = state.titles.find((x) => x.key === t.key);
    const mine = existing ? choicesFor(state.swipes, existing.id)[state.user.id] : null;
    return rowHtml(t, `<div class="choices">${["yes", "liked", "disliked", "no"].map((c) =>
      `<button data-pick="${c}" data-i="${i}" class="c-${c} ${mine === c ? "on" : ""}" aria-label="${CHOICES[c].label}" title="${CHOICES[c].label}">${CHOICES[c].icon}</button>`).join("")}</div>`, subs[i] ?? "");
  }).join("") : `<li class="muted">No results.</li>`;
}

function bindPickList(el) {
  el.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-pick]");
    if (!b) return;
    const t = el.found[Number(b.dataset.i)];
    b.closest(".choices").querySelectorAll("button").forEach((x) => (x.disabled = true));
    const { error } = await sb.rpc("swipe", { p_title: titlePayload(t), p_choice: b.dataset.pick });
    if (error) return toast(error.message);
    await loadData();
    renderPickList(el, el.found, el.subs);
  });
}

// ------------------------------------------------------------ password ----

// Checks the current password first (so an unlocked phone isn't enough), then sets the new one.
function setupPassword() {
  const form = $("#password-form");
  const err = $(".error", form), ok = $(".ok", form), submit = $("button", form);
  form.username.value = state.member?.username ?? "";
  form.addEventListener("input", () => { err.hidden = true; ok.hidden = true; });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.hidden = true;
    ok.hidden = true;
    const { current, password, confirm } = form;
    if (password.value !== confirm.value) return showError(err, new Error("The new passwords don't match."));
    if (password.value === current.value) return showError(err, new Error("The new password is the same as the current one."));
    submit.disabled = true;
    try {
      const check = await sb.auth.signInWithPassword({ email: state.user.email, password: current.value });
      if (check.error) return showError(err, new Error("Current password is wrong."));
      const { error } = await sb.auth.updateUser({ password: password.value });
      if (error) return showError(err, error);
      form.reset();
      form.username.value = state.member?.username ?? "";
      ok.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
}

// -------------------------------------------------------------- person ----

function setupPerson() {
  const dlg = $("#person");
  $("#close-person").addEventListener("click", () => dlg.close());
  dlg.addEventListener("close", () => renderDeck());
  bindPickList($("#credits"));
  bindPickList($("#for-you"));
  $("#shuffle").addEventListener("click", () => { recSalt++; refreshRecs(); });
}

async function openPerson({ person, name, face }) {
  const dlg = $("#person");
  $("#person-name").textContent = name;
  const img = $("#person-face");
  img.hidden = !face;
  if (face) img.src = faceUrl(face);
  $("#credits").innerHTML = `<li class="muted">Loading…</li>`;
  dlg.showModal();
  try {
    const work = latestWork(await tmdbGet(`person/${person}/combined_credits`));
    const today = new Date().toISOString().slice(0, 10);
    renderPickList($("#credits"), work.map((w) => w.t), work.map((w) =>
      [w.character ? `as ${esc(w.character)}` : null, w.date > today ? "Upcoming" : null].filter(Boolean).join(" · ")));
  } catch (e) {
    $("#credits").innerHTML = `<li class="error">Couldn't load: ${esc(e.message)}</li>`;
  }
}

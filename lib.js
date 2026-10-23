// Pure helpers shared by app.js and the tests. No DOM, no network.

// One swipe per person per title. The direction is the choice:
//   ← no (not interested)   → yes (want to watch)
//   ↑ liked (watched it, liked it)   ↓ disliked (watched it, didn't like it)
export const CHOICES = {
  no:       { dir: "left",  icon: "✕",  label: "Not interested" },
  yes:      { dir: "right", icon: "♥",  label: "Interested" },
  liked:    { dir: "up",    icon: "👍", label: "Watched & liked" },
  disliked: { dir: "down",  icon: "👎", label: "Watched, didn't like" },
};
export const WATCHED = ["liked", "disliked"];

// How far (px) a card has to be dragged before letting go counts as a swipe.
export const SWIPE_THRESHOLD = 90;

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const cleanName = (s) => String(s ?? "").trim().replace(/\s+/g, " ");
export const mediaLabel = (t) => (t === "tv" ? "Show" : "Movie");

// The dominant axis wins, so a slightly diagonal drag still means one thing.
export function choiceFromDrag(dx, dy, threshold = SWIPE_THRESHOLD) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < threshold) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "yes" : "no";
  return dy < 0 ? "liked" : "disliked";
}

// 0..1, how close a drag is to counting, for fading in the stamp.
export const dragProgress = (dx, dy, threshold = SWIPE_THRESHOLD) =>
  Math.min(1, Math.max(Math.abs(dx), Math.abs(dy)) / threshold);

// Same title in the same household is one row: TMDB titles by id, hand-added ones by name.
export const titleKey = (mediaType, tmdbId, name) =>
  tmdbId ? `${mediaType}:${tmdbId}` : `custom:${cleanName(name).toLowerCase()}`;

// TMDB search/discover result → the shape stored in the titles table.
export function fromTmdb(r, mediaType = r.media_type) {
  if (mediaType !== "movie" && mediaType !== "tv") return null;
  const name = r.title ?? r.name;
  if (!name) return null;
  const date = r.release_date ?? r.first_air_date ?? "";
  return {
    key: titleKey(mediaType, r.id),
    media_type: mediaType,
    tmdb_id: r.id,
    title: name,
    year: /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null,
    poster: r.poster_path ?? null,
    overview: r.overview || null,
    rating: typeof r.vote_average === "number" && r.vote_count > 20 ? Math.round(r.vote_average * 10) / 10 : null,
    lang: r.original_language ?? null,
  };
}

export const posterUrl = (path, size = "w500") => (path ? `https://image.tmdb.org/t/p/${size}${path}` : null);
export const faceUrl = (path) => (path ? `https://image.tmdb.org/t/p/w185${path}` : null);

// How many cast members a card shows (one row of big faces).
export const CAST_LIMIT = 4;

// TMDB movie/tv details (with append_to_response=credits,external_ids) → what the card shows.
export function detailsFromTmdb(d, mediaType) {
  const seasons = d.number_of_seasons;
  const length = mediaType === "tv"
    ? (seasons ? `${seasons} season${seasons === 1 ? "" : "s"}` : null)
    : runtimeText(d.runtime);
  return {
    length,
    genres: (d.genres ?? []).map((g) => g.name).slice(0, 3),
    imdbId: d.imdb_id ?? d.external_ids?.imdb_id ?? null,
    cast: (d.credits?.cast ?? []).slice(0, CAST_LIMIT).map((c) => ({ id: c.id, name: c.name, character: c.character || null, face: c.profile_path ?? null })),
    overview: d.overview || null,
    poster: d.poster_path ?? null,
  };
}

export function runtimeText(mins) {
  if (!mins) return null;
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}

// OMDb's rating is a string like "8.8", or "N/A".
export const imdbRating = (omdb) => (omdb && /^\d+(\.\d)?$/.test(omdb.imdbRating ?? "") ? omdb.imdbRating : null);

// Talk shows, news and award shows where the person just appears as themselves.
const SELF_GENRES = new Set([10763, 10767]);
const isSelf = (c) => /^(self|himself|herself|themselves)\b/i.test(c.character ?? "") || (c.genre_ids ?? []).some((g) => SELF_GENRES.has(g));

// A person's combined_credits → their acting work, newest first (upcoming ones included),
// one row per title.
export function latestWork(credits, limit = 15) {
  const seen = new Set();
  return (credits.cast ?? [])
    .filter((c) => !isSelf(c))
    .map((c) => ({ t: fromTmdb(c, c.media_type), character: c.character || null, date: c.release_date || c.first_air_date || "" }))
    .filter(({ t }) => t && !seen.has(t.key) && seen.add(t.key))
    .sort((a, b) => (b.date || "0").localeCompare(a.date || "0"))
    .slice(0, limit);
}

// Recent means released in the last RECENT_YEARS; those fill the first RECENT_PAGES
// pages of the deck, then the all-time lists take over.
export const RECENT_YEARS = 2;
export const RECENT_PAGES = 8;
export const CLASSIC_PAGES = 15;

// TMDB lists for each filter. Recent ones are taken in turn one page at a time, then the classics.
export const FEEDS = {
  all:   { recent: ["trending/all/week", "discover/movie", "discover/tv"], classic: ["movie/top_rated", "tv/top_rated", "movie/popular", "tv/popular"] },
  movie: { recent: ["trending/movie/week", "discover/movie", "movie/now_playing"], classic: ["movie/top_rated", "movie/popular"] },
  tv:    { recent: ["trending/tv/week", "discover/tv", "tv/on_the_air"], classic: ["tv/top_rated", "tv/popular"] },
};
export const feedMediaType = (path) => (/(^|\/)movie(\/|$)/.test(path) ? "movie" : /(^|\/)tv(\/|$)/.test(path) ? "tv" : undefined);

// Popular titles released since `since` ("YYYY-MM-DD"), with enough votes to mean something,
// in the given original languages (TMDB treats "en|hi" as either).
function recentParams(path, since, langs) {
  const lang = langs.length ? { with_original_language: langs.join("|") } : {};
  if (path === "discover/movie") return { sort_by: "popularity.desc", "primary_release_date.gte": since, "vote_count.gte": "100", ...lang };
  if (path === "discover/tv") return { sort_by: "popularity.desc", "first_air_date.gte": since, "vote_count.gte": "30", ...lang };
  return {};
}

// Lists that can't be filtered on TMDB's side are filtered here. Unknown language passes.
export const inLanguages = (t, langs) => !langs?.length || !t.lang || langs.includes(t.lang);

export function yearsAgo(today, n) {
  const d = new Date(today.getFullYear() - n, today.getMonth(), today.getDate());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The n-th request to make for a filter: { path, params } with the page number, or null when done.
export function feedRequest(filter, n, today = new Date(), langs = []) {
  const { recent, classic } = FEEDS[filter];
  const since = yearsAgo(today, RECENT_YEARS);
  if (n < recent.length * RECENT_PAGES) {
    const path = recent[n % recent.length];
    return { path, params: { ...recentParams(path, since, langs), page: Math.floor(n / recent.length) + 1 } };
  }
  const m = n - recent.length * RECENT_PAGES;
  if (m >= classic.length * CLASSIC_PAGES) return null;
  return { path: classic[m % classic.length], params: { page: Math.floor(m / classic.length) + 1 } };
}

export const matchesFilter = (t, filter) => filter === "all" || t.media_type === filter;

// What I see next, in order:
//   1. titles my partner wants to watch that I haven't swiped yet
//   2. anything else added to the household that I haven't swiped
//   3. the TMDB feed, minus anything I've already swiped
export function buildDeck({ titles, swipes, feed = [], userId, filter = "all" }) {
  const mine = new Set(swipes.filter((s) => s.user_id === userId).map((s) => s.title_id));
  const swipedKeys = new Set(titles.filter((t) => mine.has(t.id)).map((t) => t.key));
  const partnerYes = new Set(swipes.filter((s) => s.user_id !== userId && s.choice === "yes").map((s) => s.title_id));
  const seen = new Set(swipedKeys);
  const out = [];
  const take = (t) => { if (!seen.has(t.key) && matchesFilter(t, filter)) { seen.add(t.key); out.push(t); } };

  const fresh = titles.filter((t) => !mine.has(t.id));
  fresh.filter((t) => partnerYes.has(t.id)).sort(byNewest).forEach(take);
  fresh.slice().sort(byNewest).forEach(take);
  feed.forEach(take);
  return out;
}
const byNewest = (a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));

// Everyone's swipe on one title: { [userId]: choice }.
export function choicesFor(swipes, titleId) {
  const out = {};
  for (const s of swipes) if (s.title_id === titleId) out[s.user_id] = s.choice;
  return out;
}

const withSwipes = (titles, swipes) => {
  const byTitle = {};
  for (const s of swipes) (byTitle[s.title_id] ??= []).push(s);
  return titles.map((t) => ({ t, ss: byTitle[t.id] ?? [] }));
};
const lastSwiped = (ss) => ss.reduce((m, s) => (String(s.updated_at ?? "") > m ? String(s.updated_at) : m), "");
const newestFirst = (a, b) => lastSwiped(b.ss).localeCompare(lastSwiped(a.ss)) || a.t.title.localeCompare(b.t.title);

// Everyone in the household wants to watch it. Needs at least two people.
export function matches(titles, swipes, memberIds) {
  if (memberIds.length < 2) return [];
  return withSwipes(titles, swipes)
    .filter(({ ss }) => memberIds.every((id) => ss.some((s) => s.user_id === id && s.choice === "yes")))
    .sort(newestFirst)
    .map(({ t }) => t);
}

// Titles `userId` wants that nobody else has said yes to (yet).
export function onlyWants(titles, swipes, userId) {
  return withSwipes(titles, swipes)
    .filter(({ ss }) => ss.some((s) => s.user_id === userId && s.choice === "yes") && !ss.some((s) => s.user_id !== userId && s.choice === "yes"))
    .sort(newestFirst)
    .map(({ t }) => t);
}

// Anything anyone has watched, with each person's verdict.
export function watchedList(titles, swipes) {
  return withSwipes(titles, swipes)
    .filter(({ ss }) => ss.some((s) => WATCHED.includes(s.choice)))
    .sort(newestFirst)
    .map(({ t, ss }) => ({ t, verdicts: Object.fromEntries(ss.filter((s) => WATCHED.includes(s.choice)).map((s) => [s.user_id, s.choice])) }));
}

// My titles with one choice, most recently swiped first.
export function myList(titles, swipes, userId, choice) {
  return withSwipes(titles, swipes.filter((s) => s.user_id === userId))
    .filter(({ ss }) => ss.some((s) => s.choice === choice))
    .sort(newestFirst)
    .map(({ t }) => t);
}

// True when my "yes" on this title completes a match with everyone else.
export function isMatch(swipes, titleId, memberIds) {
  const c = choicesFor(swipes, titleId);
  return memberIds.length >= 2 && memberIds.every((id) => c[id] === "yes");
}

// Short note on a card about what the others thought, e.g. "💕 Priya wants to watch".
export function partnerNote(swipes, titleId, userId, nameOf) {
  const notes = [];
  for (const s of swipes) {
    if (s.title_id !== titleId || s.user_id === userId) continue;
    const who = nameOf(s.user_id);
    if (s.choice === "yes") notes.push(`💕 ${who} wants to watch`);
    else if (s.choice === "liked") notes.push(`👍 ${who} watched & liked it`);
    else if (s.choice === "disliked") notes.push(`👎 ${who} watched, didn't like it`);
  }
  return notes.join(" · ");
}

// ------------------------------------------------- "For you two" recs ----
//
// Every title one of you liked is a seed. Candidates come from two places:
//   1. TMDB's "recommendations" for each seed (higher in the list counts more), and
//   2. other work by favourite actors: people billed high in several things you liked.
// A candidate's score adds up how much you liked what led to it. Liked-after-watching counts
// more than "want to watch", and a seed you BOTH like counts extra. Things recommended by
// titles you rejected lose points. Ratings matter a lot: weakly rated titles barely surface.
// To keep it fresh, the seeds mix your newest likes with a random handful of older ones, and
// scores get a little random jitter. The randomness is seeded per day, so the deck is stable
// while you swipe but different tomorrow (or after 🎲 Shuffle).

export const RECENT_SEEDS = 8;
export const SAMPLE_SEEDS = 7;
export const NEG_SEED_LIMIT = 8;
export const ACTOR_LIMIT = 3;
const POSITIVE = { liked: 2, yes: 1.2 };
const NEGATIVE = { disliked: 1.5, no: 1 };
const BOTH_BONUS = 1.5;
const NEG_FACTOR = 0.6;
const ACTOR_WEIGHT = 0.7;
const JITTER = 0.4;
const MIN_RATING = 5.5;
const rankWeight = (i) => 1 / (1 + i / 5);

// Small deterministic random generator (mulberry32), so a day's suggestions don't jump around.
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const daySeed = (date, salt = 0) => Math.floor(date.getTime() / 864e5) * 31 + salt;

// A random-looking number in [0, 1) per (seed, key): the same title gets the same nudge all
// day, however the rest of the list changes.
export function keyedNoise(seed) {
  return (key) => {
    let h = seed >>> 0;
    for (const ch of String(key)) h = Math.imul(h ^ ch.codePointAt(0), 2654435761) >>> 0;
    return seededRandom(h)();
  };
}

// Seeds from household swipes: { pos, neg }, each [{ t, weight, who }].
// pos = newest RECENT_SEEDS likes + a random SAMPLE_SEEDS of the older ones.
// Only TMDB titles can be seeds (hand-added ones have no recommendations).
export function recSeeds(titles, swipes, memberIds, { rand = Math.random } = {}) {
  const pos = [], neg = [];
  for (const { t, ss } of withSwipes(titles, swipes)) {
    if (!t.tmdb_id || !ss.length) continue;
    const mine = ss.filter((s) => memberIds.includes(s.user_id));
    const likers = mine.filter((s) => POSITIVE[s.choice]);
    const last = lastSwiped(ss);
    if (likers.length) {
      let weight = likers.reduce((n, s) => n + POSITIVE[s.choice], 0);
      if (memberIds.length >= 2 && likers.length === memberIds.length) weight *= BOTH_BONUS;
      pos.push({ t, weight, who: likers.map((s) => s.user_id), last });
    } else {
      const weight = mine.reduce((n, s) => n + (NEGATIVE[s.choice] ?? 0), 0);
      if (weight) neg.push({ t, weight, who: mine.map((s) => s.user_id), last });
    }
  }
  const newest = (a, b) => b.last.localeCompare(a.last) || a.t.key.localeCompare(b.t.key);
  pos.sort(newest);
  const older = pos.slice(RECENT_SEEDS).map((p) => [rand(), p]).sort((a, b) => a[0] - b[0]).map(([, p]) => p);
  return { pos: [...pos.slice(0, RECENT_SEEDS), ...older.slice(0, SAMPLE_SEEDS)], neg: neg.sort(newest).slice(0, NEG_SEED_LIMIT) };
}

// castFor(seedKey) → [{ id, name }] in billing order. Favourite actors are the ones billed
// high across your liked seeds: [{ id, name, weight, who, from }] best first.
export function favouriteActors(pos, castFor, limit = ACTOR_LIMIT) {
  const byId = new Map();
  for (const seed of pos) {
    (castFor(seed.t.key) ?? []).slice(0, 6).forEach((c, i) => {
      const a = byId.get(c.id) ?? { id: c.id, name: c.name, weight: 0, who: new Set(), from: [] };
      a.weight += seed.weight / (1 + i);
      seed.who.forEach((u) => a.who.add(u));
      a.from.push(seed.t.title);
      byId.set(c.id, a);
    });
  }
  return [...byId.values()]
    .sort((a, b) => b.from.length - a.from.length || b.weight - a.weight)
    .slice(0, limit)
    .map((a) => ({ ...a, who: [...a.who] }));
}

// recsFor(seedKey) → that seed's TMDB recommendations; workFor(actorId) → that person's work
// (both already mapped with fromTmdb). exclude: keys not to suggest (already swiped).
export function recommend({ pos, neg }, recsFor, {
  exclude = new Set(), actors = [], workFor = () => [], rand = Math.random, noise = () => rand(), limit = 40, thisYear = new Date().getFullYear(),
} = {}) {
  const scored = new Map();
  const bump = (t, amount, why) => {
    if (exclude.has(t.key)) return;
    const c = scored.get(t.key) ?? { t, score: 0, because: [] };
    c.score += amount;
    if (why && amount > 0) c.because.push({ ...why, amount });
    scored.set(t.key, c);
  };
  for (const seed of pos) (recsFor(seed.t.key) ?? []).forEach((t, i) => bump(t, seed.weight * rankWeight(i), { kind: "title", title: seed.t.title, who: seed.who }));
  for (const a of actors) (workFor(a.id) ?? []).forEach((t, i) => bump(t, ACTOR_WEIGHT * a.weight * rankWeight(i), { kind: "cast", title: a.name, from: a.from[0], who: a.who }));
  for (const seed of neg) (recsFor(seed.t.key) ?? []).forEach((t, i) => bump(t, -NEG_FACTOR * seed.weight * rankWeight(i)));
  return [...scored.values()]
    .filter((c) => !(c.t.rating && c.t.rating < MIN_RATING))
    .map((c) => ({ ...c, score: c.score * quality(c.t, thisYear) * (1 - JITTER / 2 + JITTER * noise(c.t.key)), because: c.because.sort((a, b) => b.amount - a.amount).slice(0, 2) }))
    .filter((c) => c.score > 0 && c.because.length)
    .sort((a, b) => b.score - a.score || a.t.title.localeCompare(b.t.title))
    .slice(0, limit);
}

// Rating matters a lot (8.5+ ≈ full marks, 6 ≈ a third); unrated titles sit in the middle-low.
// Recent titles get a small bonus.
export function quality(t, thisYear) {
  const rated = t.rating ? Math.min(1.15, Math.max(0.15, (t.rating - 5) / 3.5)) : 0.45;
  const recent = t.year && t.year >= thisYear - 2 ? 1.1 : 1;
  return rated * recent;
}

// "✨ Because you both liked Panchayat & Kota Factory" or "✨ With Jitendra Kumar, from Panchayat"
export function becauseText(because, userId, nameOf, memberCount) {
  if (!because?.length) return "";
  const [first] = because;
  if (first.kind === "cast") return `✨ With ${first.title}${first.from ? `, from ${first.from}` : ""}`;
  const same = because.filter((b) => b.kind !== "cast" && b.who.length === first.who.length && b.who.every((u) => first.who.includes(u)));
  const who = memberCount >= 2 && first.who.length >= memberCount ? "you both"
    : first.who.includes(userId) ? "you" : nameOf(first.who[0]);
  return `✨ Because ${who} liked ${same.map((b) => b.title).join(" & ")}`;
}

// Used when no TMDB key is set: a few well-known titles so the deck isn't empty, newest first.
export const STARTER = [
  ["movie", "The Shawshank Redemption", 1994], ["movie", "Inception", 2010], ["movie", "Interstellar", 2014],
  ["movie", "Parasite", 2019], ["movie", "Spirited Away", 2001], ["movie", "The Dark Knight", 2008],
  ["movie", "3 Idiots", 2009], ["movie", "Dangal", 2016], ["movie", "Zindagi Na Milegi Dobara", 2011],
  ["movie", "La La Land", 2016], ["movie", "Everything Everywhere All at Once", 2022], ["movie", "Knives Out", 2019],
  ["movie", "Oppenheimer", 2023], ["movie", "Dune: Part Two", 2024], ["movie", "The Grand Budapest Hotel", 2014],
  ["movie", "Before Sunrise", 1995], ["movie", "Lagaan", 2001], ["movie", "RRR", 2022],
  ["tv", "Breaking Bad", 2008], ["tv", "The Office", 2005], ["tv", "Friends", 1994],
  ["tv", "Panchayat", 2020], ["tv", "Succession", 2018], ["tv", "The Bear", 2022],
  ["tv", "Ted Lasso", 2020], ["tv", "Fleabag", 2016], ["tv", "Severance", 2022],
  ["tv", "Schitt's Creek", 2015], ["tv", "Kota Factory", 2019], ["tv", "Stranger Things", 2016],
].map(([media_type, title, year]) => ({ key: titleKey(media_type, null, title), media_type, tmdb_id: null, title, year, poster: null, overview: null, rating: null }))
  .sort((a, b) => b.year - a.year);

// A stable gradient per title for cards without a poster.
export function hue(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) % 360;
  return h;
}

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
  };
}

export const posterUrl = (path, size = "w500") => (path ? `https://image.tmdb.org/t/p/${size}${path}` : null);

// Feeds pulled from TMDB for each filter, taken in turn one page at a time.
export const FEEDS = {
  all:   ["trending/all/week", "movie/top_rated", "tv/top_rated", "movie/popular", "tv/popular"],
  movie: ["trending/movie/week", "movie/top_rated", "movie/popular", "movie/now_playing"],
  tv:    ["trending/tv/week", "tv/top_rated", "tv/popular", "tv/on_the_air"],
};
export const feedMediaType = (path) => (path.startsWith("movie/") || path.endsWith("/movie/week") ? "movie"
  : path.startsWith("tv/") || path.endsWith("/tv/week") ? "tv" : undefined);

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

// Used when no TMDB key is set: a few well-known titles so the deck isn't empty.
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
].map(([media_type, title, year]) => ({ key: titleKey(media_type, null, title), media_type, tmdb_id: null, title, year, poster: null, overview: null, rating: null }));

// A stable gradient per title for cards without a poster.
export function hue(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) % 360;
  return h;
}

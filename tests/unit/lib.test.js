import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CHOICES, SWIPE_THRESHOLD, esc, cleanName, mediaLabel, choiceFromDrag, dragProgress, titleKey, fromTmdb, posterUrl,
  recSeeds, recommend, becauseText, favouriteActors, quality, seededRandom, daySeed, RECENT_SEEDS, SAMPLE_SEEDS,
  detailsFromTmdb, runtimeText, imdbRating, latestWork, faceUrl, CAST_LIMIT,
  inLanguages, FEEDS, RECENT_PAGES, CLASSIC_PAGES, feedRequest, yearsAgo, feedMediaType, buildDeck, choicesFor, matches, onlyWants, watchedList, myList, isMatch, partnerNote, STARTER, hue,
} from "../../lib.js";

const title = (id, name, extra = {}) => ({ id, key: `movie:${id}`, media_type: "movie", title: name, created_at: "2026-10-01", ...extra });
const sw = (title_id, user_id, choice, updated_at = "2026-10-10") => ({ title_id, user_id, choice, updated_at });
const names = (ts) => ts.map((t) => t.title);

describe("esc / cleanName / mediaLabel", () => {
  test("escapes all HTML-significant characters", () => {
    assert.equal(esc(`<img src=x onerror="alert('1')">&`), "&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;&amp;");
    assert.equal(esc(null), "");
  });
  test("cleanName trims and collapses whitespace", () => {
    assert.equal(cleanName("  The \t Bear \n"), "The Bear");
  });
  test("tv is a Show, anything else a Movie", () => {
    assert.equal(mediaLabel("tv"), "Show");
    assert.equal(mediaLabel("movie"), "Movie");
  });
});

describe("choiceFromDrag", () => {
  test("each direction maps to its choice", () => {
    assert.equal(choiceFromDrag(120, 0), "yes");
    assert.equal(choiceFromDrag(-120, 0), "no");
    assert.equal(choiceFromDrag(0, -120), "liked");
    assert.equal(choiceFromDrag(0, 120), "disliked");
  });
  test("below the threshold is no swipe", () => {
    assert.equal(choiceFromDrag(SWIPE_THRESHOLD - 1, 0), null);
    assert.equal(choiceFromDrag(0, -(SWIPE_THRESHOLD - 1)), null);
    assert.equal(choiceFromDrag(SWIPE_THRESHOLD, 0), "yes");
  });
  test("the dominant axis wins on a diagonal", () => {
    assert.equal(choiceFromDrag(150, -100), "yes");
    assert.equal(choiceFromDrag(-60, -140), "liked");
    assert.equal(choiceFromDrag(-130, 129), "no");
  });
  test("progress is capped at 1", () => {
    assert.equal(dragProgress(45, 0, 90), 0.5);
    assert.equal(dragProgress(0, -500, 90), 1);
  });
  test("every choice has a direction, icon and label", () => {
    assert.deepEqual(Object.values(CHOICES).map((c) => c.dir).sort(), ["down", "left", "right", "up"]);
  });
});

describe("titleKey / fromTmdb / posterUrl", () => {
  test("TMDB titles key on id, hand-added ones on cleaned name", () => {
    assert.equal(titleKey("tv", 1396), "tv:1396");
    assert.equal(titleKey("movie", null, "  The  Matrix "), "custom:the matrix");
  });
  test("maps a movie result", () => {
    assert.deepEqual(fromTmdb({ id: 1, title: "Up", release_date: "2009-05-29", poster_path: "/up.jpg", overview: "Balloons", vote_average: 8.03, vote_count: 100 }, "movie"), {
      key: "movie:1", media_type: "movie", tmdb_id: 1, title: "Up", year: 2009, poster: "/up.jpg", overview: "Balloons", rating: 8, lang: null,
    });
  });
  test("maps a tv result using media_type from the result", () => {
    const t = fromTmdb({ id: 2, media_type: "tv", name: "Dark", first_air_date: "2017-12-01" });
    assert.equal(t.key, "tv:2");
    assert.equal(t.title, "Dark");
    assert.equal(t.year, 2017);
    assert.equal(t.rating, null);
  });
  test("people and nameless results are dropped; missing dates give no year", () => {
    assert.equal(fromTmdb({ id: 3, media_type: "person", name: "X" }), null);
    assert.equal(fromTmdb({ id: 4, media_type: "movie" }), null);
    assert.equal(fromTmdb({ id: 5, media_type: "movie", title: "Soon", release_date: "" }).year, null);
  });
  test("ratings with few votes are hidden", () => {
    assert.equal(fromTmdb({ id: 6, title: "Tiny", vote_average: 10, vote_count: 3 }, "movie").rating, null);
  });
  test("poster urls", () => {
    assert.equal(posterUrl("/a.jpg"), "https://image.tmdb.org/t/p/w500/a.jpg");
    assert.equal(posterUrl("/a.jpg", "w154"), "https://image.tmdb.org/t/p/w154/a.jpg");
    assert.equal(posterUrl(null), null);
  });
  test("feed media types", () => {
    assert.equal(feedMediaType("movie/top_rated"), "movie");
    assert.equal(feedMediaType("trending/tv/week"), "tv");
    assert.equal(feedMediaType("trending/all/week"), undefined);
    assert.equal(feedMediaType("discover/movie"), "movie");
    assert.equal(feedMediaType("discover/tv"), "tv");
    for (const f of [...FEEDS.movie.recent, ...FEEDS.movie.classic]) assert.equal(feedMediaType(f), "movie", f);
    for (const f of [...FEEDS.tv.recent, ...FEEDS.tv.classic]) assert.equal(feedMediaType(f), "tv", f);
  });
});

describe("feedRequest", () => {
  const today = new Date(2026, 9, 21);
  test("yearsAgo", () => {
    assert.equal(yearsAgo(today, 2), "2024-10-21");
    assert.equal(yearsAgo(new Date(2028, 1, 29), 1), "2027-03-01");
  });
  test("recent lists first, cycling page by page", () => {
    const first = [0, 1, 2, 3].map((n) => feedRequest("all", n, today));
    assert.deepEqual(first.map((r) => `${r.path}@${r.params.page}`), ["trending/all/week@1", "discover/movie@1", "discover/tv@1", "trending/all/week@2"]);
    assert.equal(first[1].params["primary_release_date.gte"], "2024-10-21");
    assert.equal(first[2].params["first_air_date.gte"], "2024-10-21");
    assert.equal(first[1].params.sort_by, "popularity.desc");
  });
  test("languages: discover asks TMDB, other lists are filtered here", () => {
    assert.equal(feedRequest("all", 1, today, ["en", "hi"]).params.with_original_language, "en|hi");
    assert.equal(feedRequest("all", 1, today).params.with_original_language, undefined);
    assert.equal(inLanguages({ lang: "ja" }, ["en", "hi"]), false);
    assert.equal(inLanguages({ lang: "hi" }, ["en", "hi"]), true);
    assert.equal(inLanguages({ lang: null }, ["en", "hi"]), true);
    assert.equal(inLanguages({ lang: "ja" }, []), true);
  });
  test("then the all-time lists, then done", () => {
    const n = FEEDS.all.recent.length * RECENT_PAGES;
    assert.equal(feedRequest("all", n - 1, today).params.page, RECENT_PAGES);
    assert.deepEqual(feedRequest("all", n, today), { path: "movie/top_rated", params: { page: 1 } });
    const end = n + FEEDS.all.classic.length * CLASSIC_PAGES;
    assert.ok(feedRequest("all", end - 1, today));
    assert.equal(feedRequest("all", end, today), null);
  });
  test("filters only ask for their media type", () => {
    for (let n = 0; feedRequest("movie", n, today); n++) {
      assert.equal(feedMediaType(feedRequest("movie", n, today).path), "movie");
    }
    for (let n = 0; feedRequest("tv", n, today); n++) assert.equal(feedMediaType(feedRequest("tv", n, today).path), "tv");
  });
});

describe("buildDeck", () => {
  const titles = [
    title("a", "Old household", { created_at: "2026-10-01" }),
    title("b", "Partner wants", { created_at: "2026-09-01" }),
    title("c", "I swiped", { created_at: "2026-10-05" }),
    title("d", "New household", { created_at: "2026-10-09" }),
    title("e", "Show", { media_type: "tv", key: "tv:e", created_at: "2026-10-08" }),
  ];
  const swipes = [sw("b", "u2", "yes"), sw("c", "u1", "no"), sw("a", "u2", "no")];
  const feed = [{ key: "movie:f1", media_type: "movie", title: "Feed 1" }, { key: "movie:c", media_type: "movie", title: "I swiped (feed copy)" }, { key: "movie:d", media_type: "movie", title: "dup" }];

  test("partner's yes first, then household newest first, then feed; skips what I swiped and duplicates", () => {
    assert.deepEqual(names(buildDeck({ titles, swipes, feed, userId: "u1" })), ["Partner wants", "New household", "Show", "Old household", "Feed 1"]);
  });
  test("filter keeps one media type", () => {
    assert.deepEqual(names(buildDeck({ titles, swipes, feed, userId: "u1", filter: "tv" })), ["Show"]);
    assert.ok(!names(buildDeck({ titles, swipes, feed, userId: "u1", filter: "movie" })).includes("Show"));
  });
  test("the partner's own deck doesn't promote their own yes", () => {
    const d = names(buildDeck({ titles, swipes, feed: [], userId: "u2" }));
    assert.ok(!d.includes("Partner wants"));
    assert.ok(!d.includes("Old household"));
    assert.ok(d.includes("I swiped"));
  });
});

describe("matches / onlyWants / watched / myList", () => {
  const titles = [title("a", "Both yes"), title("b", "Only u1"), title("c", "Only u2"), title("d", "Watched"), title("e", "Mixed")];
  const swipes = [
    sw("a", "u1", "yes", "2026-10-02"), sw("a", "u2", "yes", "2026-10-03"),
    sw("b", "u1", "yes"), sw("b", "u2", "no"),
    sw("c", "u2", "yes"),
    sw("d", "u1", "liked", "2026-10-12"), sw("d", "u2", "disliked", "2026-10-13"),
    sw("e", "u1", "yes", "2026-10-20"), sw("e", "u2", "liked", "2026-10-20"),
  ];
  const ids = ["u1", "u2"];

  test("a match needs everyone's yes", () => {
    assert.deepEqual(names(matches(titles, swipes, ids)), ["Both yes"]);
    assert.equal(isMatch(swipes, "a", ids), true);
    assert.equal(isMatch(swipes, "e", ids), false);
  });
  test("nobody matches with only one member", () => {
    assert.deepEqual(matches(titles, swipes, ["u1"]), []);
    assert.equal(isMatch(swipes, "a", ["u1"]), false);
  });
  test("onlyWants: my yes without anyone else's yes, newest first", () => {
    assert.deepEqual(names(onlyWants(titles, swipes, "u1")), ["Mixed", "Only u1"]);
    assert.deepEqual(names(onlyWants(titles, swipes, "u2")), ["Only u2"]);
  });
  test("watched lists each person's verdict", () => {
    const w = watchedList(titles, swipes);
    assert.deepEqual(w.map((x) => x.t.title), ["Mixed", "Watched"]);
    assert.deepEqual(w[1].verdicts, { u1: "liked", u2: "disliked" });
    assert.deepEqual(w[0].verdicts, { u2: "liked" });
  });
  test("myList by choice", () => {
    assert.deepEqual(names(myList(titles, swipes, "u1", "yes")), ["Mixed", "Only u1", "Both yes"]);
    assert.deepEqual(names(myList(titles, swipes, "u2", "no")), ["Only u1"]);
    assert.deepEqual(choicesFor(swipes, "d"), { u1: "liked", u2: "disliked" });
  });
  test("partnerNote describes the others, not me", () => {
    const nameOf = (u) => ({ u1: "amey", u2: "wife" }[u]);
    assert.equal(partnerNote(swipes, "c", "u1", nameOf), "💕 wife wants to watch");
    assert.equal(partnerNote(swipes, "d", "u1", nameOf), "👎 wife watched, didn't like it");
    assert.equal(partnerNote(swipes, "e", "u2", nameOf), "💕 amey wants to watch");
    assert.equal(partnerNote(swipes, "b", "u1", nameOf), "");
  });
});

describe("details", () => {
  test("movie details: runtime, genres, imdb id, top cast", () => {
    const cast = Array.from({ length: 10 }, (_, k) => ({ id: k, name: `A${k}`, character: k ? `R${k}` : "", profile_path: `/f${k}.jpg` }));
    const d = detailsFromTmdb({ runtime: 148, imdb_id: "tt1", genres: [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }], credits: { cast }, overview: "", poster_path: "/p.jpg" }, "movie");
    assert.equal(d.length, "2h 28m");
    assert.deepEqual(d.genres, ["A", "B", "C"]);
    assert.equal(d.imdbId, "tt1");
    assert.equal(d.cast.length, CAST_LIMIT);
    assert.deepEqual(d.cast[0], { id: 0, name: "A0", character: null, face: "/f0.jpg" });
    assert.equal(d.overview, null);
  });
  test("tv details: seasons and imdb id from external_ids", () => {
    const d = detailsFromTmdb({ number_of_seasons: 1, external_ids: { imdb_id: "tt2" } }, "tv");
    assert.equal(d.length, "1 season");
    assert.equal(d.imdbId, "tt2");
    assert.deepEqual(d.cast, []);
    assert.equal(detailsFromTmdb({ number_of_seasons: 4 }, "tv").length, "4 seasons");
  });
  test("runtime text", () => {
    assert.equal(runtimeText(120), "2h");
    assert.equal(runtimeText(45), "45m");
    assert.equal(runtimeText(null), null);
  });
  test("imdb rating ignores N/A and junk", () => {
    assert.equal(imdbRating({ imdbRating: "8.8" }), "8.8");
    assert.equal(imdbRating({ imdbRating: "N/A" }), null);
    assert.equal(imdbRating(null), null);
  });
  test("face url", () => {
    assert.equal(faceUrl("/x.jpg"), "https://image.tmdb.org/t/p/w185/x.jpg");
    assert.equal(faceUrl(null), null);
  });
  test("latest work: newest first, undated last, no self appearances or duplicates", () => {
    const w = latestWork({ cast: [
      { id: 1, media_type: "movie", title: "Old", release_date: "2010-01-01", character: "A" },
      { id: 2, media_type: "tv", name: "Chat", first_air_date: "2025-01-01", character: "Himself" },
      { id: 3, media_type: "tv", name: "News", first_air_date: "2025-01-01", character: "Guest", genre_ids: [10763] },
      { id: 4, media_type: "movie", title: "New", release_date: "2026-01-01", character: "" },
      { id: 4, media_type: "movie", title: "New", release_date: "2026-01-01", character: "B" },
      { id: 5, media_type: "movie", title: "Undated" },
    ] });
    assert.deepEqual(w.map((x) => x.t.title), ["New", "Old", "Undated"]);
    assert.equal(w[0].character, null);
    assert.equal(latestWork({ cast: [] }).length, 0);
    assert.equal(latestWork({}).length, 0);
  });
});

describe("For you two", () => {
  const tm = (id, name, extra = {}) => title(id, name, { tmdb_id: Number(id.replace(/\D/g, "")) || 1, ...extra });
  const rec = (n, extra = {}) => ({ key: `movie:${n}`, media_type: "movie", title: `Rec ${n}`, rating: 8.5, ...extra });
  const still = () => 0.5;  // no jitter: 1 - 0.2 + 0.4 * 0.5 = 1

  test("seeds: likes are positive, both liking counts extra, no/disliked are negative", () => {
    const titles = [tm("s1", "Both liked"), tm("s2", "One wants"), tm("s3", "Nope"), tm("s4", "Mixed"), title("c", "Custom")];
    const swipes = [
      sw("s1", "u1", "liked", "2026-10-05"), sw("s1", "u2", "yes", "2026-10-06"),
      sw("s2", "u2", "yes", "2026-10-07"),
      sw("s3", "u1", "no"), sw("s3", "u2", "disliked"),
      sw("s4", "u1", "yes", "2026-10-01"), sw("s4", "u2", "no", "2026-10-01"),
      sw("c", "u1", "liked"),
    ];
    const { pos, neg } = recSeeds(titles, swipes, ["u1", "u2"]);
    assert.deepEqual(pos.map((p) => p.t.title), ["One wants", "Both liked", "Mixed"], "newest first, hand-added titles skipped");
    assert.equal(pos[1].weight, (2 + 1.2) * 1.5);
    assert.equal(pos[0].weight, 1.2);
    assert.deepEqual(pos[2].who, ["u1"], "a yes beats the other's no");
    assert.deepEqual(neg.map((n) => n.t.title), ["Nope"]);
    assert.equal(neg[0].weight, 2.5);
  });

  test("seeds: newest likes plus a random sample of older ones, different per random seed", () => {
    const titles = Array.from({ length: 40 }, (_, i) => tm(`s${i + 1}`, `T${i}`));
    const swipes = titles.map((t, i) => sw(t.id, "u1", "yes", `2026-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`));
    const a = recSeeds(titles, swipes, ["u1", "u2"], { rand: seededRandom(1) }).pos.map((p) => p.t.title);
    const b = recSeeds(titles, swipes, ["u1", "u2"], { rand: seededRandom(2) }).pos.map((p) => p.t.title);
    assert.equal(a.length, RECENT_SEEDS + SAMPLE_SEEDS);
    assert.deepEqual(a.slice(0, RECENT_SEEDS), b.slice(0, RECENT_SEEDS), "the newest likes always count");
    assert.deepEqual(a.slice(0, 3), ["T39", "T38", "T37"]);
    assert.notDeepEqual(a.slice(RECENT_SEEDS), b.slice(RECENT_SEEDS), "older ones rotate");
    assert.deepEqual(a, recSeeds(titles, swipes, ["u1", "u2"], { rand: seededRandom(1) }).pos.map((p) => p.t.title), "same seed, same pick");
  });

  test("seededRandom is deterministic and in [0, 1); daySeed changes daily", () => {
    const r1 = seededRandom(42), r2 = seededRandom(42);
    const xs = Array.from({ length: 50 }, () => r1());
    assert.deepEqual(xs, Array.from({ length: 50 }, () => r2()));
    assert.ok(xs.every((x) => x >= 0 && x < 1));
    assert.equal(daySeed(new Date("2026-10-21T08:00:00Z")), daySeed(new Date("2026-10-21T20:00:00Z")));
    assert.notEqual(daySeed(new Date("2026-10-21T08:00:00Z")), daySeed(new Date("2026-10-22T08:00:00Z")));
    assert.notEqual(daySeed(new Date("2026-10-21T08:00:00Z"), 1), daySeed(new Date("2026-10-21T08:00:00Z"), 0));
  });

  test("favourite actors: billed high in several likes wins", () => {
    const pos = [
      { t: { key: "a", title: "A" }, weight: 3, who: ["u1", "u2"] },
      { t: { key: "b", title: "B" }, weight: 1.2, who: ["u2"] },
    ];
    const cast = { a: [{ id: 1, name: "Star" }, { id: 2, name: "Only A" }], b: [{ id: 3, name: "Lead B" }, { id: 1, name: "Star" }] };
    const fav = favouriteActors(pos, (k) => cast[k]);
    assert.deepEqual(fav.map((f) => f.name), ["Star", "Only A", "Lead B"]);
    assert.deepEqual(fav[0].from, ["A", "B"]);
    assert.deepEqual(fav[0].who.sort(), ["u1", "u2"]);
    assert.equal(favouriteActors(pos, () => undefined).length, 0);
  });

  test("recommend: shared recs rise, negatives sink, excluded and unseeded drop out", () => {
    const seeds = {
      pos: [{ t: { key: "movie:1", title: "A" }, weight: 3, who: ["u1", "u2"] }, { t: { key: "movie:2", title: "B" }, weight: 1.2, who: ["u2"] }],
      neg: [{ t: { key: "movie:3", title: "N" }, weight: 2.5, who: ["u1"] }],
    };
    const lists = {
      "movie:1": [rec(10), rec(11), rec(12), rec(99)],
      "movie:2": [rec(11), rec(13)],
      "movie:3": [rec(12), rec(14)],
    };
    const out = recommend(seeds, (k) => lists[k], { exclude: new Set(["movie:99"]), thisYear: 2026, rand: still });
    assert.deepEqual(out.map((r) => r.t.title), ["Rec 11", "Rec 10", "Rec 13", "Rec 12"], "two seeds beat one; a negative seed sinks Rec 12");
    assert.deepEqual(out[0].because.map((b) => b.title), ["A", "B"], "strongest reason first");
    assert.ok(!out.some((r) => r.t.title === "Rec 14"), "only negative seeds → not suggested");
  });

  test("recommend: a favourite actor's well-rated work comes in with its reason", () => {
    const seeds = { pos: [{ t: { key: "s", title: "Panchayat" }, weight: 2, who: ["u1"] }], neg: [] };
    const actors = [{ id: 7, name: "Jitendra Kumar", weight: 2, who: ["u1"], from: ["Panchayat"] }];
    const out = recommend(seeds, () => [], { actors, workFor: (id) => (id === 7 ? [rec(1, { title: "Kota Factory" })] : []), rand: still });
    assert.deepEqual(out.map((r) => r.t.title), ["Kota Factory"]);
    assert.equal(becauseText(out[0].because, "u1", () => "", 2), "✨ With Jitendra Kumar, from Panchayat");
  });

  test("recommend: ratings matter a lot, and poorly rated titles are dropped", () => {
    const seeds = { pos: [{ t: { key: "s", title: "S" }, weight: 1, who: ["u1"] }], neg: [] };
    const list = [rec(1, { rating: 6.2 }), rec(2, { rating: 8.6 }), rec(3, { rating: 4.9 }), rec(4, { rating: null })];
    const out = recommend(seeds, () => list, { rand: still, thisYear: 2026 }).map((r) => r.t.title);
    assert.deepEqual(out, ["Rec 2", "Rec 1", "Rec 4"], "8.6 beats a higher-ranked 6.2; under 5.5 is gone");
    assert.ok(quality({ rating: 8.5 }, 2026) > 2.5 * quality({ rating: 6 }, 2026));
    assert.ok(quality({ rating: 7, year: 2026 }, 2026) > quality({ rating: 7, year: 2010 }, 2026), "recent bonus");
  });

  test("recommend: jitter reshuffles close calls but the random seed makes it repeatable", () => {
    const seeds = { pos: [{ t: { key: "s", title: "S" }, weight: 1, who: ["u1"] }], neg: [] };
    const list = Array.from({ length: 12 }, (_, i) => rec(i + 1, { rating: 8 }));
    const order = (n) => recommend(seeds, () => list, { rand: seededRandom(n) }).map((r) => r.t.title).join();
    assert.equal(order(5), order(5));
    assert.ok(new Set([1, 2, 3, 4, 5, 6].map(order)).size > 1, "different days, different order");
  });

  test("recommend copes with missing lists", () => {
    assert.deepEqual(recommend({ pos: [{ t: { key: "x", title: "X" }, weight: 1, who: [] }], neg: [] }, () => undefined), []);
  });

  test("becauseText", () => {
    const nameOf = (u) => ({ u1: "amey", u2: "wife" }[u]);
    const both = { kind: "title", title: "Panchayat", who: ["u1", "u2"] }, wife = { kind: "title", title: "Kota Factory", who: ["u2"] }, wife2 = { kind: "title", title: "Dark", who: ["u2"] };
    assert.equal(becauseText([both, wife], "u1", nameOf, 2), "✨ Because you both liked Panchayat");
    assert.equal(becauseText([wife, wife2], "u1", nameOf, 2), "✨ Because wife liked Kota Factory & Dark");
    assert.equal(becauseText([wife], "u2", nameOf, 2), "✨ Because you liked Kota Factory");
    assert.equal(becauseText([{ kind: "cast", title: "Neena Gupta", who: ["u1"] }], "u1", nameOf, 2), "✨ With Neena Gupta");
    assert.equal(becauseText([], "u1", nameOf, 2), "");
  });
});

describe("STARTER / hue", () => {
  test("starter titles have unique custom keys and both media types", () => {
    assert.equal(new Set(STARTER.map((t) => t.key)).size, STARTER.length);
    assert.ok(STARTER.every((t) => t.key.startsWith("custom:")));
    assert.ok(STARTER.some((t) => t.media_type === "tv") && STARTER.some((t) => t.media_type === "movie"));
  });
  test("starter list is newest first", () => {
    assert.deepEqual(STARTER.map((t) => t.year), STARTER.map((t) => t.year).sort((a, b) => b - a));
  });
  test("hue is stable and in range", () => {
    assert.equal(hue("Inception"), hue("Inception"));
    assert.ok(hue("x") >= 0 && hue("x") < 360);
  });
});

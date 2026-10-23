import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CHOICES, SWIPE_THRESHOLD, esc, cleanName, mediaLabel, choiceFromDrag, dragProgress, titleKey, fromTmdb, posterUrl,
  FEEDS, feedMediaType, buildDeck, choicesFor, matches, onlyWants, watchedList, myList, isMatch, partnerNote, STARTER, hue,
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
      key: "movie:1", media_type: "movie", tmdb_id: 1, title: "Up", year: 2009, poster: "/up.jpg", overview: "Balloons", rating: 8,
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
    for (const f of FEEDS.movie) assert.equal(feedMediaType(f), "movie", f);
    for (const f of FEEDS.tv) assert.equal(feedMediaType(f), "tv", f);
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

describe("STARTER / hue", () => {
  test("starter titles have unique custom keys and both media types", () => {
    assert.equal(new Set(STARTER.map((t) => t.key)).size, STARTER.length);
    assert.ok(STARTER.every((t) => t.key.startsWith("custom:")));
    assert.ok(STARTER.some((t) => t.media_type === "tv") && STARTER.some((t) => t.media_type === "movie"));
  });
  test("hue is stable and in range", () => {
    assert.equal(hue("Inception"), hue("Inception"));
    assert.ok(hue("x") >= 0 && hue("x") < 360);
  });
});

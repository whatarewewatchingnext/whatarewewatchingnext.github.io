// Layout checks at many screen sizes with worst-case content (very long titles, names and
// stories): nothing may be cut off, overlap, or make the page scroll sideways.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startAll, stopAll, openApp, baseSeed, tab, settle } from "./helpers.js";

before(startAll);
after(stopAll);

export const SIZES = [
  ["iPhone SE (1st gen)", 320, 568], ["small Android", 360, 640], ["iPhone SE", 375, 667], ["iPhone 15", 393, 852],
  ["Pixel 8", 412, 915], ["iPhone 15 Pro Max", 430, 932], ["phone landscape", 844, 390], ["small phone landscape", 667, 375],
  ["iPad portrait", 768, 1024], ["laptop", 1280, 800], ["desktop", 1440, 900],
];

const LONG = "The Incredibly Long and Winding Title of a Show That Never Seems to End: Part Two";

function worstCaseSeed() {
  const seed = baseSeed();
  seed.titles = [
    { id: "t1", household_id: "h1", key: "movie:4242", media_type: "movie", tmdb_id: 4242, title: LONG, year: 2025, poster: "/p.jpg", overview: "Short.", rating: 8.4, created_at: "2026-10-09" },
    ...Array.from({ length: 6 }, (_, i) => ({ id: `l${i}`, household_id: "h1", key: `tv:${50 + i}`, media_type: "tv", tmdb_id: 50 + i,
      title: i % 2 ? `${LONG} (${i})` : `Supercalifragilisticexpialidocious${i}`, year: 2020 + i, poster: i === 3 ? null : `/l${i}.jpg`, rating: 7.5, created_at: `2026-10-0${i + 1}` })),
  ];
  const sw = (title_id, user_id, choice) => ({ title_id, user_id, household_id: "h1", choice, updated_at: `2026-10-1${title_id.slice(-1)}` });
  seed.swipes = [
    sw("t1", "u2", "yes"),                              // partner note on the top card
    sw("l0", "u1", "yes"), sw("l0", "u2", "yes"),         // a match
    sw("l1", "u1", "liked"), sw("l1", "u2", "disliked"),  // watched
    sw("l2", "u1", "yes"),                              // only me
    sw("l3", "u2", "yes"),                              // only partner
    sw("l4", "u1", "no"), sw("l5", "u1", "disliked"),
  ];
  seed.members[0].username = "a_very_long_username_123";
  return seed;
}

// Runs in the page: every visible element matching `sels` inside `root` must be inside root's box.
function outside([rootSel, sels]) {
  const root = document.querySelector(rootSel);
  if (!root) return [`missing ${rootSel}`];
  const r = root.getBoundingClientRect();
  const bad = [];
  for (const sel of sels) {
    for (const el of root.querySelectorAll(sel)) {
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height || getComputedStyle(el).visibility === "hidden") continue;
      if (b.left < r.left - 1 || b.right > r.right + 1 || b.top < r.top - 1 || b.bottom > r.bottom + 1) {
        bad.push(`${sel} "${el.textContent.trim().slice(0, 24)}" (${Math.round(b.left)},${Math.round(b.top)})-(${Math.round(b.right)},${Math.round(b.bottom)}) outside ${rootSel} (${Math.round(r.left)},${Math.round(r.top)})-(${Math.round(r.right)},${Math.round(r.bottom)})`);
      }
    }
  }
  return bad;
}

// Runs in the page: inside a clipping box, a line of text is either fully shown or fully hidden,
// never sliced in half (e.g. the bottom line of the title block).
function sliced(boxSel) {
  const bad = [];
  for (const box of document.querySelectorAll(boxSel)) {
    const r = box.getBoundingClientRect();
    if (!r.height) continue;
    for (const el of box.querySelectorAll(":scope > *")) {
      const b = el.getBoundingClientRect();
      if (b.height && b.top < r.bottom - 1 && b.bottom > r.bottom + 1) bad.push(`"${el.textContent.trim().slice(0, 24)}" sliced at the bottom of ${boxSel} (${Math.round(b.top)}–${Math.round(b.bottom)} vs ${Math.round(r.bottom)})`);
    }
  }
  return bad;
}

// Runs in the page: no visible element sticks out sideways past the viewport.
function sideways() {
  const w = document.documentElement.clientWidth;
  const bad = [];
  if (document.documentElement.scrollWidth > w) bad.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${w}`);
  for (const el of document.querySelectorAll("main *, dialog[open] *")) {
    const b = el.getBoundingClientRect();
    if (b.width && b.height && (b.right > w + 1 || b.left < -1) && !el.closest(".mcard")) bad.push(`${el.tagName.toLowerCase()}.${el.className} "${el.textContent.trim().slice(0, 20)}" right=${Math.round(b.right)} > ${w}`);
  }
  return bad.slice(0, 5);
}

// Runs in the page: list rows keep enough room for the title, and their buttons stay in the row.
function rows(sel) {
  const bad = [];
  for (const li of document.querySelectorAll(`${sel} li`)) {
    const grow = li.querySelector(".grow");
    if (!grow || !li.getBoundingClientRect().height) continue;
    if (grow.getBoundingClientRect().width < 120) bad.push(`title column only ${Math.round(grow.getBoundingClientRect().width)}px: "${grow.textContent.trim().slice(0, 20)}"`);
    const r = li.getBoundingClientRect();
    for (const b of li.querySelectorAll("button")) {
      const x = b.getBoundingClientRect();
      if (x.right > r.right + 1 || x.left < r.left - 1) bad.push(`button sticks out of row: "${grow.textContent.trim().slice(0, 20)}"`);
      if (x.width < 34 || x.height < 34) bad.push(`button too small to tap: ${Math.round(x.width)}×${Math.round(x.height)}`);
    }
  }
  return bad.slice(0, 5);
}

const CARD_PARTS = [".poster", "h2", ".badge-imdb", ".badge-tmdb", ".meta", ".genres span", ".note", ".lbl", ".overview", ".face", ".face img", ".face .noface", ".face .n", ".face .r"];

for (const [name, width, height] of SIZES) {
  describe(`${name} ${width}×${height}`, () => {
    test("swipe card: everything inside the card, nothing overlapping, controls reachable", async () => {
      const app = await openApp(worstCaseSeed(), { width, height });
      const { page } = app;
      try {
        await page.waitForSelector("#deck .mcard.top .badge-imdb");
        await settle(page);
        assert.deepEqual(await page.evaluate(outside, ["#deck .mcard.top", CARD_PARTS]), [], "card contents");
        assert.deepEqual(await page.evaluate(sliced, "#deck .mcard.top .facts"), [], "title block");
        assert.deepEqual(await page.evaluate(sliced, "#deck .mcard.top .body"), [], "card body");
        assert.deepEqual(await page.evaluate(sideways), [], "sideways");
        const bar = await page.evaluate(() => {
          const r = (s) => document.querySelector(s).getBoundingClientRect();
          const seg = r("#filter"), genre = r("#genre"), go = r("#apply-genre"), deck = r(".deck-bar");
          const h1 = document.querySelector("header h1"), search = r("#open-search"), acct = r("#who .acct");
          const acts = [...document.querySelectorAll(".actions .act")].map((b) => b.getBoundingClientRect());
          return { heights: [seg.height, genre.height, go.height].map(Math.round), genreLabel: document.querySelector("#genre").selectedOptions[0].textContent, genreW: genre.width,
            overlap: seg.right > genre.left + 1 || genre.right > go.left + 1 || go.right > deck.right + 1,
            header: { titleClipped: h1.scrollWidth > h1.clientWidth + 1, titleRight: h1.getBoundingClientRect().right, search, acct, vw: innerWidth },
            acts: { n: acts.length, overlap: acts.some((a, i) => i && a.left < acts[i - 1].right - 1), left: acts[0].left, right: acts.at(-1).right }, tabsFit: [...document.querySelectorAll("#filter button")].every((b) => b.scrollWidth <= b.clientWidth + 1) };
        });
        assert.ok(bar.genreW >= 72, `genre dropdown squeezed to ${bar.genreW}px`);
        assert.equal(bar.overlap, false, "deck bar items overlap");
        assert.equal(bar.tabsFit, true, "All/Movies/Shows labels cut off");
        assert.ok(Math.max(...bar.heights) - Math.min(...bar.heights) <= 1, `deck bar controls differ in height: ${bar.heights}`);
        assert.equal(bar.genreLabel, "All genres");
        const hd = bar.header;
        assert.equal(hd.titleClipped, false, "app title cut off");
        assert.ok(hd.titleRight <= hd.search.left + 1 && hd.search.right <= hd.acct.left + 1 && hd.acct.right <= hd.vw + 1, "header: title, Search and account overlap or run off screen");
        assert.ok(hd.search.width >= 40 && hd.search.height >= 36, `Search button too small (${Math.round(hd.search.width)}×${Math.round(hd.search.height)})`);
        assert.equal(bar.acts.n, 6, "six action buttons");
        assert.equal(bar.acts.overlap, false, "action buttons overlap");
        assert.ok(bar.acts.left >= 0 && bar.acts.right <= hd.vw, "action buttons run off screen");
        const m = await page.evaluate(() => {
          const q = (s) => document.querySelector(s)?.getBoundingClientRect();
          const faces = [...document.querySelectorAll("#deck .mcard.top .face")].map((f) => f.getBoundingClientRect()).filter((b) => b.height);
          const poster = q("#deck .mcard.top .poster"), facts = q("#deck .mcard.top .facts"), card = q("#deck .mcard.top");
          const h2 = document.querySelector("#deck .mcard.top h2");
          return {
            facesOverlap: faces.some((a, i) => faces.some((b, j) => i < j && a.right > b.left + 1 && b.right > a.left + 1 && a.bottom > b.top + 1 && b.bottom > a.top + 1)),
            faces: faces.length, posterRight: poster.right, factsLeft: facts.left, posterH: poster.height, cardH: card.height,
            h2Clipped: h2.scrollWidth > h2.clientWidth + 1,
            actions: [...document.querySelectorAll(".actions .act")].map((b) => b.getBoundingClientRect()).map((b) => ({ top: b.top, bottom: b.bottom, w: b.width })),
            nav: q(".bottom-nav").top, vh: innerHeight, docH: document.documentElement.scrollHeight,
            bar: q(".deck-bar"), header: q("header"),
          };
        });
        assert.equal(m.facesOverlap, false, "cast faces overlap");
        assert.ok(m.factsLeft >= m.posterRight, "title/facts overlap the poster");
        assert.equal(m.h2Clipped, false, "title is cut off sideways");
        assert.ok(m.posterH <= m.cardH * 0.6 + 1, `poster takes over the card (${m.posterH} of ${m.cardH})`);
        assert.ok(m.posterH >= 100, `poster too small (${m.posterH}px)`);
        if (height >= 560) assert.ok(m.faces >= 4, `cast hidden on a ${height}px-tall screen`);
        for (const a of m.actions) assert.ok(a.w >= 40, "swipe buttons big enough to tap");
        if (height >= 560) {
          assert.ok(m.docH <= m.vh + 1, `page scrolls on a portrait phone (${m.docH} > ${m.vh})`);
          for (const a of m.actions) assert.ok(a.bottom <= m.nav + 1, "swipe buttons hidden behind the tab bar");
        } else {
          // Landscape phones: the page may scroll, but it must be able to reach the buttons.
          await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
          const bottom = await page.evaluate(() => Math.max(...[...document.querySelectorAll(".actions .act")].map((b) => b.getBoundingClientRect().bottom)));
          const nav = await page.evaluate(() => document.querySelector(".bottom-nav").getBoundingClientRect().top);
          assert.ok(bottom <= nav + 1, `landscape: swipe buttons unreachable (${bottom} > ${nav})`);
        }

        // Tapping for the full story must still keep everything inside the card.
        await page.click("#deck .mcard.top .head");
        assert.deepEqual(await page.evaluate(outside, ["#deck .mcard.top", CARD_PARTS]), [], "expanded card contents");
        assert.deepEqual(app.errors, [], "page errors");
      } finally {
        await app.close();
      }
    });

    test("every tab, the search and the cast sheet: no cut-off rows or sideways scrolling", async () => {
      const app = await openApp(worstCaseSeed(), { width, height });
      const { page } = app;
      try {
        await page.waitForSelector("#deck .mcard.top .badge-imdb");
        for (const [view, lists] of [["matches", ["#matches", "#partner-wants", "#only-me", "#for-you"]], ["watched", ["#watched"]], ["mine", ["#mine"]], ["home", []]]) {
          await tab(page, view);
          if (view === "mine") for (const c of ["yes", "liked", "disliked", "no"]) {
            await page.click(`#mine-tabs [data-choice=${c}]`);
            assert.deepEqual(await page.evaluate(rows, "#mine"), [], `my lists: ${c}`);
          }
          await settle(page);
          assert.deepEqual(await page.evaluate(sideways), [], `${view}: sideways`);
          for (const l of lists) assert.deepEqual(await page.evaluate(rows, l), [], `${view} ${l}`);
          const nav = await page.evaluate(() => {
            const b = [...document.querySelectorAll(".bottom-nav button")].map((x) => x.getBoundingClientRect());
            return { fits: b.every((x) => x.right <= innerWidth + 1 && x.left >= -1), labels: [...document.querySelectorAll(".bottom-nav button")].every((x) => x.scrollWidth <= x.clientWidth + 1) };
          });
          assert.ok(nav.fits && nav.labels, `${view}: tab bar cut off`);
        }
        await tab(page, "swipe");
        await page.click("#open-search");
        await page.fill("#search-form [name=q]", "Supercalifragilisticexpialidocious and other very long words");
        await page.press("#search-form [name=q]", "Enter");
        await page.waitForSelector("#results li .t");
        assert.deepEqual(await page.evaluate(sideways), [], "search: sideways");
        assert.deepEqual(await page.evaluate(rows, "#results"), [], "search rows");
        assert.deepEqual(await page.evaluate(outside, ["#search", ["#search-form", "#close-search"]]), [], "search sheet");
        await page.click("#close-search");
        if (!(await page.isVisible("#deck .mcard.top .face >> nth=0"))) {
          assert.ok(height < 500, "faces only hide on landscape phones");
          return;
        }
        await page.click("#deck .mcard.top .face >> nth=0");
        await page.waitForSelector("#credits li .t");
        assert.deepEqual(await page.evaluate(sideways), [], "cast sheet: sideways");
        assert.deepEqual(await page.evaluate(rows, "#credits"), [], "cast sheet rows");
        assert.deepEqual(await page.evaluate(outside, ["#person", [".person-head", "#close-person"]]), [], "cast sheet");
        assert.deepEqual(app.errors, [], "page errors");
      } finally {
        await app.close();
      }
    });
  });
}

describe("login and household screens", () => {
  for (const [name, width, height] of [SIZES[0], SIZES[6], SIZES[9]]) {
    test(`${name}: auth and household forms fit`, async () => {
      const seed = { ...baseSeed(), sessionUserId: null };
      const app = await openApp(seed, { width, height });
      const { page } = app;
      try {
        await page.waitForSelector("#auth-form");
        assert.deepEqual(await page.evaluate(sideways), [], "login");
        await page.click(".tabs [data-mode=signup]");
        await page.fill("#auth-form [name=username]", "newperson");
        await page.fill("#auth-form [name=password]", "hunter22");
        await page.click("#auth-form button[type=submit]");
        await page.waitForSelector("#create-form");
        assert.deepEqual(await page.evaluate(sideways), [], "household");
        assert.deepEqual(app.errors, [], "page errors");
      } finally {
        await app.close();
      }
    });
  }
});

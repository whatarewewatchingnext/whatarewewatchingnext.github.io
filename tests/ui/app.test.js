import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startAll, stopAll, openApp, baseSeed, texts, tab, settle, topTitle } from "./helpers.js";

const flat = (s) => s.replace(/\s+/g, " ").trim();

before(startAll);
after(stopAll);

// Runs fn with a fresh app; fails if the page logged any errors.
async function withApp(seed, fn, opts) {
  const app = await openApp(seed, opts);
  try {
    await app.page.waitForSelector(seed.sessionUserId ? ".bottom-nav, #create-form" : "#auth-form");
    if (seed.sessionUserId && seed.members.some((m) => m.user_id === seed.sessionUserId)) await app.page.waitForSelector("#deck .mcard.top, #deck .empty:not(:has-text('Loading'))");
    await fn(app);
    assert.deepEqual(app.errors, [], "page errors");
  } finally {
    await app.close();
  }
}
const loggedOut = () => ({ ...baseSeed(), sessionUserId: null });
const mySwipe = async (db, titleName, user = "u1") => {
  const d = await db();
  const t = d.titles.find((x) => x.title === titleName && x.household_id === "h1");
  return t && d.swipes.find((s) => s.title_id === t.id && s.user_id === user)?.choice;
};

// Drags the top card by (dx, dy) with the mouse, in small steps like a finger.
async function dragTop(page, dx, dy) {
  const box = await page.locator("#deck .mcard.top").boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
  await settle(page);
}

describe("auth", () => {
  test("wrong password shows a friendly error", () => withApp(loggedOut(), async ({ page }) => {
    await page.fill("#auth-form [name=username]", "amey");
    await page.fill("#auth-form [name=password]", "nope123");
    await page.click("#auth-form button[type=submit]");
    await page.waitForSelector("#auth-form .error:not([hidden])");
    assert.equal(await page.textContent("#auth-form .error"), "Wrong username or password");
  }));

  test("log in is case-insensitive and lands on the deck", () => withApp(loggedOut(), async ({ page }) => {
    await page.fill("#auth-form [name=username]", "AMEY");
    await page.fill("#auth-form [name=password]", "secret1");
    await page.click("#auth-form button[type=submit]");
    await page.waitForSelector("#deck .mcard.top");
    assert.equal(await page.textContent("#who-name"), "amey");
  }));

  test("sign up → create household → join code; partner joins; log out", () => withApp(loggedOut(), async ({ page, db }) => {
    await page.click(".tabs [data-mode=signup]");
    await page.fill("#auth-form [name=username]", "newbie");
    await page.fill("#auth-form [name=password]", "hunter22");
    await page.click("#auth-form button[type=submit]");
    await page.waitForSelector("#create-form");
    await page.fill("#create-form [name=name]", "Movie nights");
    await page.click("#create-form button");
    await page.waitForSelector(".bottom-nav");
    await tab(page, "home");
    assert.equal(await page.textContent("#hh-name"), "Movie nights");
    const code = await page.textContent("#hh-code");
    assert.match(code, /^JOIN/);
    await tab(page, "matches");
    assert.match(await page.textContent("#matches"), /once your partner joins/);

    await page.click("#logout");
    await page.click(".tabs [data-mode=signup]");
    await page.fill("#auth-form [name=username]", "partner");
    await page.fill("#auth-form [name=password]", "hunter33");
    await page.click("#auth-form button[type=submit]");
    await page.fill("#join-form [name=code]", code.toLowerCase());
    await page.click("#join-form button");
    await page.waitForSelector(".bottom-nav");
    await tab(page, "home");
    assert.deepEqual(await texts(page, "#members li"), ["newbie", "partner (you)"]);
  }));
});

describe("deck", () => {
  test("household titles first, then the TMDB feed; never another household's titles", () => withApp(baseSeed(), async ({ page, tmdbCalls }) => {
    assert.equal(await topTitle(page), "Inception");
    assert.match(await page.getAttribute("#deck .mcard.top .poster img", "src"), /image\.tmdb\.org\/t\/p\/w500\/inception\.jpg/);
    assert.equal(await page.locator("#deck .mcard").count(), 3);
    assert.ok(tmdbCalls[0].startsWith("trending/all/week") && tmdbCalls[0].includes("api_key=fake-tmdb-key"), tmdbCalls[0]);
    assert.ok(tmdbCalls.some((c) => c.startsWith("discover/movie") && c.includes("primary_release_date.gte=2024-10-21")), "recent movies asked for");
    assert.ok(!tmdbCalls.some((c) => c.includes("top_rated")), "all-time lists wait until recent ones run out");
    assert.ok(tmdbCalls.some((c) => c.startsWith("discover/movie") && c.includes("with_original_language=en%7Chi")), "only English and Hindi");
    for (let i = 0; i < 8; i++) {
      assert.notEqual(await topTitle(page), "Stranger secret film");
      assert.doesNotMatch(await topTitle(page), /^Anime/, "Japanese titles are filtered out");
      await page.click("[data-swipe=no]");
      await settle(page);
    }
  }));

  test("buttons save each choice", () => withApp(baseSeed(), async ({ page, db }) => {
    const seen = [];
    for (const choice of ["yes", "no", "liked", "disliked"]) {
      const name = await topTitle(page);
      seen.push(name);
      await page.click(`[data-swipe=${choice}]`);
      await settle(page);
      assert.equal(await mySwipe(db, name), choice, name);
    }
    assert.equal(new Set(seen).size, 4);
  }));

  test("dragging right/left/up/down swipes; a short drag snaps back", () => withApp(baseSeed(), async ({ page, db }) => {
    let name = await topTitle(page);
    await dragTop(page, 40, 10);
    assert.equal(await topTitle(page), name, "short drag keeps the card");
    assert.equal(await mySwipe(db, name), undefined);
    for (const [dx, dy, choice] of [[160, 20, "yes"], [-160, -30, "no"], [10, -170, "liked"], [-20, 170, "disliked"]]) {
      name = await topTitle(page);
      await dragTop(page, dx, dy);
      assert.equal(await mySwipe(db, name), choice, `${name} → ${choice}`);
      assert.notEqual(await topTitle(page), name);
    }
  }));

  test("the stamp fades in while dragging", () => withApp(baseSeed(), async ({ page }) => {
    const box = await page.locator("#deck .mcard.top").boundingBox();
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 100, box.y - 20, { steps: 5 });
    assert.equal(await page.$eval("#deck .mcard.top .s-liked", (e) => Number(e.style.opacity) > 0.9), true);
    assert.equal(await page.$eval("#deck .mcard.top .s-yes", (e) => Number(e.style.opacity)), 0);
    await page.mouse.move(box.x + 100, box.y + 100, { steps: 3 });
    await page.mouse.up();
  }));

  test("a poster that fails to load falls back to the gradient", () => {
    const seed = baseSeed();
    seed.titles[0].poster = "/broken.jpg";
    return withApp(seed, async ({ page }) => {
      assert.equal(await topTitle(page), "Inception");
      await page.waitForFunction(() => !document.querySelector("#deck .mcard.top .poster img"));
    });
  });

  test("tapping a card shows the full description", () => withApp(baseSeed(), async ({ page }) => {
    await page.click("#deck .mcard.top .head");
    assert.equal(await page.$eval("#deck .mcard.top", (e) => e.classList.contains("expanded")), true);
  }));

  test("arrow keys swipe too", () => withApp(baseSeed(), async ({ page, db }) => {
    const name = await topTitle(page);
    await page.keyboard.press("ArrowRight");
    await settle(page);
    assert.equal(await mySwipe(db, name), "yes");
  }));

  test("undo puts the card back on top and removes the swipe", () => withApp(baseSeed(), async ({ page, db }) => {
    const first = await topTitle(page);
    assert.equal(await page.isDisabled("#undo"), true);
    await page.click("[data-swipe=no]");
    await settle(page);
    const second = await topTitle(page);
    await page.click("[data-swipe=yes]");
    await settle(page);
    await page.click("#undo");
    await settle(page);
    assert.equal(await topTitle(page), second);
    assert.equal(await mySwipe(db, second), undefined);
    await page.click("#undo");
    await settle(page);
    assert.equal(await topTitle(page), first);
    assert.equal(await mySwipe(db, first), undefined);
    assert.equal(await page.isDisabled("#undo"), true);
  }));

  test("filters show only movies or only shows", () => withApp(baseSeed(), async ({ page }) => {
    await page.click("[data-filter=tv]");
    await page.waitForFunction(() => document.querySelector("#deck .mcard.top h2")?.textContent.startsWith("Show"));
    for (let i = 0; i < 4; i++) {
      assert.match(await page.textContent("#deck .mcard.top .meta"), /Show/);
      await page.click("[data-swipe=no]");
      await settle(page);
    }
    await page.click("[data-filter=movie]");
    await settle(page);
    assert.equal(await topTitle(page), "Inception");
    assert.match(await page.textContent("#deck .mcard.top .meta"), /^2010 · Movie/);
  }));

  test("a title my partner wants jumps to the front, with a note", () => {
    const seed = baseSeed();
    seed.titles.push({ id: "t2", household_id: "h1", key: "tv:1", media_type: "tv", tmdb_id: 1, title: "Panchayat", year: 2020, created_at: "2026-09-01T00:00:00Z" });
    seed.swipes.push({ title_id: "t2", user_id: "u2", household_id: "h1", choice: "yes", updated_at: "2026-10-01" });
    return withApp(seed, async ({ page }) => {
      assert.equal(await topTitle(page), "Panchayat");
      assert.equal(await page.textContent("#deck .mcard.top .note"), "💕 wife wants to watch");
      assert.equal(await page.locator("#deck .mcard.top .poster img").count(), 0, "no poster → placeholder");
    });
  });
});

describe("card details + cast", () => {
  test("shows IMDb rating, runtime, genres, story and cast faces", () => withApp(baseSeed(), async ({ page, tmdbCalls }) => {
    await page.waitForSelector("#deck .mcard.top .face");
    const card = "#deck .mcard.top";
    assert.equal(await page.textContent(`${card} h2`), "Inception");
    assert.equal(flat(await page.textContent(`${card} .badge-imdb`)), "IMDb ★ 8.8");
    assert.equal(await page.textContent(`${card} .meta`), "2010 · Movie · 2h 28m");
    assert.deepEqual(await texts(page, `${card} .genres span`), ["Drama", "Comedy", "Crime"]);
    assert.equal(await page.textContent(`${card} .overview`), "Full story of 27205.");
    assert.equal(await page.locator(`${card} .face`).count(), 4);
    assert.equal(await page.locator(`${card} .face img`).count(), 3, "missing photo shows an initial");
    assert.match(await page.getAttribute(`${card} .face img`, "src"), /image\.tmdb\.org\/t\/p\/w185\/face0\.jpg/);
    assert.ok(tmdbCalls.some((c) => c.startsWith("movie/27205?") && c.includes("append_to_response=credits%2Cexternal_ids")));
    assert.ok(tmdbCalls.includes("omdb:tt27205"));
  }));

  test("without an OMDb key the TMDB rating shows instead", () => withApp(baseSeed(), async ({ page, tmdbCalls }) => {
    await page.waitForSelector("#deck .mcard.top .face");
    assert.equal(flat(await page.textContent("#deck .mcard.top .badge-tmdb")), "TMDB ★ 8.4");
    assert.equal(await page.locator("#deck .mcard.top .badge-imdb").count(), 0);
    assert.ok(!tmdbCalls.some((c) => c.startsWith("omdb:")));
  }, { omdb: false }));

  test("tapping a face shows their latest work, newest first, and you can swipe it", () => withApp(baseSeed(), async ({ page, db }) => {
    await page.waitForSelector("#deck .mcard.top .face");
    await page.click("#deck .mcard.top .face >> nth=1");
    await page.waitForSelector("#person[open] #credits li .t");
    assert.equal(await page.textContent("#person-name"), "Actor 205-1");
    assert.deepEqual(await texts(page, "#credits .t"), ["Next Year Film", "Recent Show", "Old Film", "Undated Film"], "no talk shows, no duplicates");
    assert.match((await texts(page, "#credits li"))[0], /as Hero · Upcoming/);
    await page.click("#credits li:has-text('Recent Show') [data-pick=yes]");
    await settle(page);
    assert.equal(await mySwipe(db, "Recent Show"), "yes");
    await page.click("#close-person");
    assert.equal(await page.isVisible("#person"), false);
    assert.equal(await topTitle(page), "Inception", "card is still there");
  }));

  test("a drag that starts on a face still swipes", () => withApp(baseSeed(), async ({ page, db }) => {
    await page.waitForSelector("#deck .mcard.top .face");
    const box = await page.locator("#deck .mcard.top .face >> nth=0").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 30, { steps: 8 });
    await page.mouse.up();
    await settle(page);
    assert.equal(await mySwipe(db, "Inception"), "yes");
    assert.equal(await page.isVisible("#person"), false);
  }));
});

describe("for you two", () => {
  test("titles similar to what you both liked show in the deck and on Matches, with the reason", () => {
    const seed = baseSeed();
    seed.swipes.push({ title_id: "t1", user_id: "u1", household_id: "h1", choice: "liked", updated_at: "2026-10-01" },
      { title_id: "t1", user_id: "u2", household_id: "h1", choice: "liked", updated_at: "2026-10-02" });
    return withApp(seed, async ({ page, db, tmdbCalls }) => {
      await page.waitForFunction(() => document.querySelector("#deck .mcard.top h2")?.textContent === "Interstellar");
      assert.equal(await page.textContent("#deck .mcard.top .note"), "✨ Because you both liked Inception");
      assert.ok(tmdbCalls.some((c) => c.startsWith("movie/27205?") && c.includes("recommendations")), "one request gets recs + cast");
      assert.ok(tmdbCalls.some((c) => c.startsWith("person/900/combined_credits")), "top-billed actor's work is looked up");
      await tab(page, "matches");
      const list = await texts(page, "#for-you .t");
      assert.equal(list[0], "Interstellar", "strongest rec from a title you both liked");
      assert.ok(list.includes("Tenet"));
      assert.ok(!list.includes("Badly Rated"), "under 5.5 is dropped");
      assert.ok(!list.includes("Some Anime"), "only English and Hindi");
      assert.ok(list.includes("Recent Show"), "an actor's other work comes in");
      assert.match((await texts(page, "#for-you li:has-text('Recent Show')"))[0], /✨ With Actor 205-0, from Inception/);
      await page.click("#for-you li:has-text('Tenet') [data-pick=yes]");
      await settle(page);
      assert.equal(await mySwipe(db, "Tenet"), "yes");
      assert.ok(!(await texts(page, "#for-you .t")).includes("Tenet"), "swiped ones leave the list");
      await page.click("#shuffle");
      await settle(page);
      assert.ok((await texts(page, "#for-you .t")).length > 0, "shuffle keeps a list");
    });
  });

  test("no TMDB key: no suggestions section", () => withApp(baseSeed(), async ({ page }) => {
    await tab(page, "matches");
    assert.equal(await page.isVisible("#for-you-card"), false);
  }, { tmdb: false }));
});

describe("matches", () => {
  test("my yes on something my partner wants is a match", () => {
    const seed = baseSeed();
    seed.swipes.push({ title_id: "t1", user_id: "u2", household_id: "h1", choice: "yes", updated_at: "2026-10-01" });
    return withApp(seed, async ({ page }) => {
      await tab(page, "matches");
      assert.deepEqual((await texts(page, "#partner-wants .t")), ["Inception"]);
      await tab(page, "swipe");
      await page.click("[data-swipe=yes]");
      await page.waitForSelector("#toast:not([hidden])");
      assert.match(await page.textContent("#toast"), /It's a match! You both want to watch Inception/);
      assert.equal(await page.textContent("#match-count"), "1");
      await tab(page, "matches");
      assert.deepEqual(await texts(page, "#matches .t"), ["Inception"]);
      assert.match(await page.textContent("#partner-wants"), /Nothing waiting on you/);
    });
  });

  test("partner's live swipe makes a match on my phone", () => withApp(baseSeed(), async ({ page, as }) => {
    await page.click("[data-swipe=yes]");
    await settle(page);
    await tab(page, "matches");
    assert.deepEqual(await texts(page, "#only-me .t"), ["Inception"]);
    await as("u2", async ({ rpc }) => rpc("swipe", { p_title: { key: "movie:27205", media_type: "movie", title: "Inception" }, p_choice: "yes" }));
    await page.waitForSelector("#toast:not([hidden])");
    assert.match(await page.textContent("#toast"), /Inception/);
    assert.deepEqual(await texts(page, "#matches .t"), ["Inception"]);
    assert.match(await page.textContent("#only-me"), /Nothing here/);
  }));

  test("rating a match moves it to Watched; pick one chooses among matches", () => {
    const seed = baseSeed();
    seed.titles.push({ id: "t2", household_id: "h1", key: "tv:1", media_type: "tv", title: "Panchayat", created_at: "2026-09-01" });
    for (const [t, u] of [["t1", "u1"], ["t1", "u2"], ["t2", "u1"], ["t2", "u2"]]) seed.swipes.push({ title_id: t, user_id: u, household_id: "h1", choice: "yes", updated_at: "2026-10-01" });
    return withApp(seed, async ({ page, db }) => {
      await tab(page, "matches");
      assert.equal((await texts(page, "#matches .t")).length, 2);
      await page.click("#pick");
      assert.match(await page.textContent("#picked"), /Tonight's pick(Inception|Panchayat)/);
      await page.click("#matches li:has-text('Inception') [data-choice=liked]");
      await settle(page);
      assert.equal(await mySwipe(db, "Inception"), "liked");
      assert.deepEqual(await texts(page, "#matches .t"), ["Panchayat"]);
      await tab(page, "watched");
      assert.match((await texts(page, "#watched li"))[0], /Inception.*amey 👍/);
    });
  });
});

describe("watched + my lists", () => {
  test("watched shows each person's verdict", () => withApp(baseSeed(), async ({ page, as }) => {
    await page.click("[data-swipe=liked]");
    await settle(page);
    await as("u2", async ({ rpc }) => rpc("swipe", { p_title: { key: "movie:27205", media_type: "movie", title: "Inception" }, p_choice: "disliked" }));
    await settle(page);
    await tab(page, "watched");
    assert.match((await texts(page, "#watched li"))[0], /Inception.*amey 👍 · wife 👎/);
  }));

  test("my lists: change my mind, or put a title back in the deck", () => withApp(baseSeed(), async ({ page, db }) => {
    await page.click("[data-swipe=no]");
    await settle(page);
    await tab(page, "mine");
    assert.match(await page.textContent("#mine"), /Nothing here yet/);
    await page.click("#mine-tabs [data-choice=no]");
    assert.deepEqual(await texts(page, "#mine .t"), ["Inception"]);
    await page.click("#mine [data-choice=yes]");
    await settle(page);
    assert.equal(await mySwipe(db, "Inception"), "yes");
    assert.match(await page.textContent("#mine"), /Nothing here yet/);
    await page.click("#mine-tabs [data-choice=yes]");
    await page.click("#mine [data-act=unswipe]");
    await settle(page);
    assert.equal(await mySwipe(db, "Inception"), undefined);
    await tab(page, "swipe");
    assert.equal(await topTitle(page), "Inception");
  }));
});

describe("search", () => {
  test("finds titles on TMDB and swipes from the results", () => withApp(baseSeed(), async ({ page, db }) => {
    await page.click("#open-search");
    await page.fill("#search-form [name=q]", "Bad");
    await page.press("#search-form [name=q]", "Enter");
    await page.waitForSelector("#results li .t");
    assert.deepEqual(await texts(page, "#results .t"), ["Inception", "Breaking Bad"], "people are left out");
    await page.click("#results li:has-text('Breaking Bad') [data-pick=yes]");
    await settle(page);
    assert.equal(await mySwipe(db, "Breaking Bad"), "yes");
    assert.equal(await page.$eval("#results li:has-text('Breaking Bad') [data-pick=yes]", (b) => b.classList.contains("on")), true);
    const t = (await db()).titles.find((x) => x.title === "Breaking Bad");
    assert.equal(t.key, "tv:1396");
    await page.click("#close-search");
    await tab(page, "mine");
    assert.ok((await texts(page, "#mine .t")).includes("Breaking Bad"));
  }));
});

describe("without a TMDB key", () => {
  test("uses the starter list, and Find adds a custom title", () => withApp(baseSeed(), async ({ page, db, tmdbCalls }) => {
    assert.equal(await topTitle(page), "Inception");
    await page.click("[data-swipe=no]");
    await settle(page);
    assert.equal(await topTitle(page), "Dune: Part Two", "newest starter title first");
    await page.click("#open-search");
    assert.equal(await page.isVisible("#search-form [name=media]"), true);
    await page.fill("#search-form [name=q]", "  Kota   Factory ");
    await page.selectOption("#search-form [name=media]", "tv");
    await page.click("#search-form button");
    await page.click("#results [data-pick=yes]");
    await settle(page);
    const t = (await db()).titles.find((x) => x.key === "custom:kota factory");
    assert.equal(t.title, "Kota Factory");
    assert.equal(t.media_type, "tv");
    assert.equal(tmdbCalls.length, 0);
    assert.equal(await page.isHidden("#tmdb-credit"), true);
  }, { tmdb: false }));
});

describe("layout", () => {
  for (const [w, h] of [[320, 568], [375, 667], [430, 932]]) {
    test(`fits a ${w}×${h} phone without page scrolling`, () => withApp(baseSeed(), async ({ page }) => {
      const m = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
        sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight,
        actions: document.querySelector(".actions").getBoundingClientRect().bottom,
        nav: document.querySelector(".bottom-nav").getBoundingClientRect().top,
      }));
      assert.ok(m.sw <= m.cw, `no horizontal scroll (${m.sw} > ${m.cw})`);
      assert.ok(m.actions <= m.nav, `swipe buttons sit above the tab bar (${m.actions} > ${m.nav})`);
      if (h >= 600) assert.ok(m.sh <= m.ch + 1, `no vertical scroll (${m.sh} > ${m.ch})`);
      for (const v of ["matches", "watched", "mine", "home"]) {
        await tab(page, v);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), v);
      }
    }, { width: w, height: h }));
  }
});

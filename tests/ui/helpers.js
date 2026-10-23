// Shared setup for the UI tests: a static server for the repo, headless Chrome
// at phone size, the supabase-js CDN import swapped for tests/ui/fake-supabase.js,
// TMDB answered from tests/ui/fake-tmdb.js, and a fixed clock.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { tmdbResponse } from "./fake-tmdb.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FAKE = fileURLToPath(new URL("./fake-supabase.js", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

export const email = (u) => `${u}@users.whatarewewatchingnext.app`;

export function baseSeed() {
  return {
    sessionUserId: "u1",
    users: [
      { id: "u1", email: email("amey"), password: "secret1", username: "amey" },
      { id: "u2", email: email("wife"), password: "secret2", username: "wife" },
      { id: "u9", email: email("stranger"), password: "secret9", username: "stranger" },
    ],
    households: [{ id: "h1", name: "Our couch", join_code: "ABCD1234" }, { id: "h2", name: "Other", join_code: "ZZZZ9999" }],
    members: [
      { user_id: "u1", household_id: "h1", username: "amey", created_at: "1" },
      { user_id: "u2", household_id: "h1", username: "wife", created_at: "2" },
      { user_id: "u9", household_id: "h2", username: "stranger", created_at: "3" },
    ],
    titles: [
      { id: "t1", household_id: "h1", key: "movie:27205", media_type: "movie", tmdb_id: 27205, title: "Inception", year: 2010, poster: "/inception.jpg", overview: "Dreams within dreams.", rating: 8.4, created_at: "2026-10-01T00:00:00Z" },
      { id: "tx", household_id: "h2", key: "movie:999", media_type: "movie", tmdb_id: 999, title: "Stranger secret film", year: 2001, created_at: "2026-10-01T00:00:00Z" },
    ],
    swipes: [
      { title_id: "tx", user_id: "u9", household_id: "h2", choice: "yes", updated_at: "2026-10-01T00:00:00Z" },
    ],
  };
}

let server, browser, baseUrl;

export async function startAll() {
  server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
    try {
      const body = await readFile(join(ROOT, path === "/" ? "index.html" : path));
      res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "text/html" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ channel: "chrome", headless: true });
}

export async function stopAll() {
  await browser?.close();
  await new Promise((r) => server?.close(r));
}

// Opens the app with the given seed. `tmdb: false` runs without a TMDB key.
export async function openApp(seed = baseSeed(), { width = 375, height = 812, tmdb = true } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, timezoneId: "America/Los_Angeles", locale: "en-US", hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const tmdbCalls = [];
  await page.clock.install({ time: new Date("2026-10-21T12:00:00-07:00") });
  // Later routes win in Playwright: block everything external, then allow the swaps.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  await page.route(/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js/, async (route) =>
    route.fulfill({ contentType: "text/javascript", body: await readFile(FAKE, "utf8") }));
  await page.route(/api\.themoviedb\.org\/3\//, (route) => {
    const url = new URL(route.request().url());
    tmdbCalls.push(url.pathname.replace("/3/", "") + url.search);
    route.fulfill({ contentType: "application/json", body: JSON.stringify(tmdbResponse(url)) });
  });
  // Posters load as a plain rectangle, except paths containing "broken", which 404.
  await page.route(/image\.tmdb\.org\/t\/p\//, (route) => /broken/.test(route.request().url()) ? route.fulfill({ status: 404 }) : route.fulfill({ contentType: "image/svg+xml",
    body: `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="750"><rect width="500" height="750" fill="#345"/></svg>` }));
  await page.route(/\/config\.js$/, async (route) => {
    const body = (await readFile(join(ROOT, "config.js"), "utf8"))
      .replace(/SUPABASE_URL = ".*"/, `SUPABASE_URL = "https://fake.supabase.co"`)
      .replace(/SUPABASE_KEY = ".*"/, `SUPABASE_KEY = "sb_publishable_fake"`)
      .replace(/TMDB_KEY = ".*"/, `TMDB_KEY = "${tmdb ? "fake-tmdb-key" : ""}"`);
    route.fulfill({ contentType: "text/javascript", body });
  });
  await page.addInitScript((s) => { window.__SEED = s; }, seed);
  await page.goto(baseUrl);
  return {
    page, errors, tmdbCalls,
    db: () => page.evaluate(() => structuredClone(window.__fake.db)),
    // Act as another user (e.g. the partner on their phone), then push a realtime update.
    as: (userId, fn) => page.evaluate(async ([u, src]) => {
      const r = await window.__fake.as(u, new Function("return " + src)());
      window.__fake.changed();
      return r;
    }, [userId, fn.toString()]),
    close: () => context.close(),
  };
}

// Small helpers for reading the UI.
export const texts = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
export const tab = (page, view) => page.click(`.bottom-nav [data-view=${view}]`);
export const settle = (page) => page.waitForTimeout(400);
export const topTitle = (page) => page.$eval("#deck .mcard.top h2", (e) => e.textContent).catch(() => null);

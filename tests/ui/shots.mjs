// Not a test: saves screenshots of the swipe screen at phone sizes, for eyeballing.  node tests/ui/shots.mjs <dir>
import { startAll, stopAll, openApp, baseSeed } from "./helpers.js";
const dir = process.argv[2];
const sizes = [[320, 568], [360, 640], [375, 667], [393, 852], [430, 932], [667, 375], [1280, 800]];
await startAll();
for (const [w, h] of sizes) {
  const seed = baseSeed(); if (process.env.LONG) seed.members[0].username = "a_very_long_username_123";
  const app = await openApp(seed, { width: w, height: h });
  await app.page.waitForSelector("#deck .mcard.top .badge-imdb").catch(() => {});
  await app.page.waitForTimeout(500);
  const m = await app.page.evaluate(() => { const h = document.querySelector("header h1"); return [h.scrollWidth, h.clientWidth]; });
  console.log(w, h, "h1", m);
  await app.page.screenshot({ path: `${dir}/${w}x${h}.png` });
  await app.close();
}
await stopAll();

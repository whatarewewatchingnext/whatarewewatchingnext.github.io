# What Are We Watching Next 🍿

A swipe app for two people sharing a couch. Each of you swipes through movies and shows on your own phone:

| Swipe | Means |
|---|---|
| → right | ♥ Interested, I'd watch this |
| ← left | ✕ Not interested |
| ↑ up | 👍 Already watched it, liked it |
| ↓ down | 👎 Already watched it, didn't like it |

- **🃏 Swipe**: each card shows the poster, IMDb rating, year, length, genres, story and the main cast with photos.
  Tap a face to see that person's latest movies and shows (newest first) and swipe on those too. Tap anywhere else for
  the full story. The deck starts with titles from the last 2 years, then all-time favourites; filter to All / Movies / Shows.
  Titles your partner said yes to jump to the front with a "💕 wants to watch" note. There are buttons and arrow keys too,
  plus ↶ undo. **🔍 Find** searches for a specific title.
- **💕 Matches**: everything you *both* swiped right on, shown live on both phones with an "It's a match!" toast.
  🎲 **Pick one** chooses for tonight. Below that: what your partner wants that you haven't said yes to, and what only you want.
- **✨ For you two**: titles similar to what either of you liked (TMDB recommendations for each ♥/👍), plus other work by
  actors who keep showing up in your likes. Things you *both* liked, and things you liked after watching, count most;
  ratings count a lot (under 5.5 is dropped); anything similar to what you rejected sinks. It mixes your newest likes
  with a rotating sample of older ones and reshuffles daily (or tap 🎲 Shuffle), so it doesn't get stuck. Suggestions
  appear in the deck with a "✨ Because you both liked …" or "✨ With <actor>, from …" note, and as a list on the
  Matches tab. Only English and Hindi titles are suggested (`LANGUAGES` in `config.js`). No AI, no server.
- **🎬 Watched**: everything either of you has seen, with each person's 👍/👎.
- **📋 My lists**: your own Want / Liked / Didn't / Nope lists. Change your mind, or ↺ put a title back in your deck.

Username and password login, each person has their own account. It's a static site for GitHub Pages, with data in
[Supabase](https://supabase.com) (free tier). Movie data and posters come from [TMDB](https://www.themoviedb.org) (free API key).

## Privacy

The code is public, but your data isn't. Every table uses Postgres row-level security
([`supabase/schema.sql`](supabase/schema.sql)): a signed-in user can only read rows in their own household and only change
their own swipes. The Supabase *publishable key* in `config.js` is designed to be public.
**Never** commit a secret or `service_role` key.

The TMDB key in `config.js` is also visible to anyone who opens the site. It's read-only, but if it's ever abused
you can regenerate it on TMDB.

## One-time setup (about 10 minutes)

1. Create a free project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query**, paste all of `supabase/schema.sql`, then click **Run**.
   (A database set up before genres were stored only needs `supabase/migrations/002_title_genres.sql`.)
3. **Authentication → Sign In / Providers → Email**: turn **off** “Confirm email”. Usernames are mapped
   to pseudo-emails, so no mail can be delivered.
4. **Project Settings**: copy the **Project URL** (Data API) and the **publishable** key (API Keys) into `config.js`.
5. Get a free TMDB key: sign up at [themoviedb.org](https://www.themoviedb.org/signup), then
   **Settings → API → Create → Developer**, and copy the **API Key** (the short one, not the Read Access Token) into
   `TMDB_KEY` in `config.js`. Optionally set `TMDB_REGION` (e.g. `"IN"` or `"US"`).
   Without a key the app still works, with a built-in list of ~30 well-known titles and no posters or cast.
   Optional: for real **IMDb** ratings, get a free key at [omdbapi.com](https://www.omdbapi.com/apikey.aspx) and put it in
   `OMDB_KEY` (1,000 lookups a day; one per card). Without it, cards show TMDB's own rating.
6. Commit and push. In the GitHub repo: **Settings → Pages → Deploy from branch → `main` / root**.
7. Open the site on your phone, **Sign up** with a username and password, then **Create** a household.
   Go to the 🏠 tab and send the join code to your partner. They sign up and **Join** with that code.
   Tip: **Share → Add to Home Screen** (iOS) or **⋮ → Add to Home screen** (Android) makes it feel like an app.
8. Optional but recommended: once you've both signed up, go to **Authentication → Sign In / Providers**
   and turn off **Allow new users to sign up**.

## Tests

```sh
npm install        # once; only installs playwright-core (uses your installed Chrome)
npm test           # unit + UI tests
npm run test:unit  # just the logic in lib.js (swipe directions, deck order, matches)
npm run test:ui    # swipes through the real page in headless Chrome at phone sizes
```

- `tests/unit/` tests the pure helpers in `lib.js` with Node's built-in test runner.
- `tests/ui/layout.test.js` loads worst-case content (very long titles, names and stories) at 11 screen sizes, from a
  320px iPhone SE through landscape phones to a 1440px desktop, and fails if anything is cut off, half-clipped,
  overlapping, too small to tap, hidden behind the tab bar, or makes the page scroll sideways.
- `tests/ui/` drives `index.html` with Playwright against `tests/ui/fake-supabase.js` (an in-memory stand-in that
  mirrors the database rules) and `tests/ui/fake-tmdb.js`, so nothing real is touched.
- `tests/db/db_test.sql` checks row-level security on the real database. Paste it into the Supabase SQL Editor and
  run it: it rolls itself back and reports PASS/FAIL per check in the error message.

GitHub Actions runs the unit and UI tests on every push.

## Local dev

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000. To try it on your phone, open `http://<your-computer's-LAN-IP>:8000` on the same Wi-Fi.

---

This product uses the TMDB API but is not endorsed or certified by TMDB.

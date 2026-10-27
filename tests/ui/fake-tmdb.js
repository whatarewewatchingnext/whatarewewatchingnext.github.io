// Canned TMDB answers for the UI tests. Every list returns three items per page,
// with ids derived from the list and page so pages never repeat.

const LISTS = ["trending/all/week", "movie/top_rated", "tv/top_rated", "movie/popular", "tv/popular",
  "trending/movie/week", "movie/now_playing", "trending/tv/week", "tv/on_the_air", "discover/movie", "discover/tv"];

export function tmdbResponse(url) {
  const path = url.pathname.replace(/^\/3\//, "");
  const page = Number(url.searchParams.get("page") ?? 1);
  if (path === "search/multi") {
    const q = url.searchParams.get("query") ?? "";
    return { results: [
      { id: 27205, media_type: "movie", title: "Inception", release_date: "2010-07-15", poster_path: "/inception.jpg", overview: "Dreams.", vote_average: 8.4, vote_count: 30000 },
      { id: 1396, media_type: "tv", name: `Breaking ${q}`, first_air_date: "2008-01-20", poster_path: "/bb.jpg", vote_average: 8.9, vote_count: 12000 },
      { id: 5, media_type: "person", name: "Some Actor" },
    ] };
  }
  if (path === "search/tv" || path === "search/movie") {
    const q = (url.searchParams.get("query") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const catalog = [
      { id: 101352, media_type: "tv", name: "Panchayat", first_air_date: "2020-04-03", vote_average: 8.9, vote_count: 300 },
      { id: 89113, media_type: "tv", name: "Kota Factory", first_air_date: "2019-04-16", vote_average: 8.7, vote_count: 200 },
      { id: 157336, media_type: "movie", title: "Interstellar", release_date: "2014-11-05", vote_average: 8.4, vote_count: 30000 },
      { id: 777, media_type: "movie", title: "Panch Ratan", release_date: "1965-01-01", vote_average: 6, vote_count: 30 },
    ].filter((x) => x.media_type === path.slice(7));
    return { results: catalog.filter((x) => q.every((w) => (x.title ?? x.name).toLowerCase().split(/\s+/).some((tw) => tw.startsWith(w)))).map(({ media_type, ...r }) => r) };
  }
  const det = path.match(/^(movie|tv)\/(\d+)$/);
  if (det) return { ...details(det[1], Number(det[2])), recommendations: { results: recommendationsFor(Number(det[2])) } };
  const person = path.match(/^person\/(\d+)\/combined_credits$/);
  if (person) return personCredits(Number(person[1]));
  const li = LISTS.indexOf(path);
  if (li < 0) return { results: [] };
  const tv = path.startsWith("tv/") || path.includes("/tv");
  const results = [0, 1, 2].map((k) => {
    const id = 100000 + li * 1000 + page * 10 + k;
    const mt = path === "trending/all/week" ? (k === 2 ? "tv" : "movie") : tv ? "tv" : "movie";
    const name = `${mt === "tv" ? "Show" : "Film"} ${li}-${page}-${k}`;
    // k=0 is a comedy, the rest dramas; asking for a genre gets only that genre (like TMDB).
    const genre_ids = k === 0 ? [35] : [18];
    return mt === "tv"
      ? { id, media_type: mt, name, first_air_date: "2020-01-01", poster_path: null, overview: `About ${name}`, vote_average: 7.5, vote_count: 500, genre_ids }
      : { id, media_type: mt, title: name, release_date: "2021-05-05", poster_path: `/p${id}.jpg`, overview: `About ${name}`, vote_average: 7.1, vote_count: 900, genre_ids };
  }).map((r) => {
    const want = url.searchParams.get("with_genres");
    return want ? { ...r, id: r.id + 50000, genre_ids: want.split("|").map(Number), ...(r.title ? { title: `${r.title} [g${want}]` } : { name: `${r.name} [g${want}]` }) } : r;
  });
  // One Japanese title per trending page, which the language filter should drop.
  if (path === "trending/all/week") results.push({ id: 100000 + page * 10 + 9, media_type: "tv", name: `Anime ${page}`, original_language: "ja", first_air_date: "2023-10-22", vote_average: 8.7, vote_count: 900 });
  return { page, results };
}

// Details with credits + external_ids, as asked for with append_to_response.
// Id 4242 is the worst case for layout tests: long everything.
function details(mediaType, id) {
  if (id === 4242) return {
    id, overview: "A very long story. ".repeat(40), runtime: 201, imdb_id: "tt4242",
    genres: [{ name: "Science Fiction" }, { name: "Documentary" }, { name: "Romance" }],
    credits: { cast: ["Venkata Subramaniam Krishnamurthy-Ramachandran", "Bartholomew Montgomery-Fitzwilliam III", "Xi", "Anastasia Konstantinopoulou"]
      .map((name, k) => ({ id: 4300 + k, name, character: k === 2 ? null : "The Extraordinarily Long-Named Supporting Character", profile_path: k === 1 ? null : `/face${k}.jpg` })) },
  };
  const cast = Array.from({ length: 8 }, (_, k) => ({ id: 900 + k, name: `Actor ${id % 1000}-${k}`, character: `Role ${k}`, profile_path: k === 3 ? null : `/face${k}.jpg` }));
  return {
    id, overview: `Full story of ${id}.`,
    genres: [{ id: 18, name: "Drama" }, { id: 35, name: "Comedy" }, { id: 80, name: "Crime" }, { id: 9, name: "Extra" }],
    credits: { cast },
    ...(mediaType === "movie" ? { runtime: 148, imdb_id: `tt${id}` } : { number_of_seasons: 4, external_ids: { imdb_id: `tt${id}` } }),
  };
}

// Mixed up on purpose: out of date order, a talk-show appearance, a duplicate and an upcoming title.
function personCredits(personId) {
  return { cast: [
    { id: 1, media_type: "movie", title: "Old Film", release_date: "2012-03-01", character: "Lead" },
    { id: 2, media_type: "tv", name: "Late Night Chat", first_air_date: "2024-01-01", character: "Self", genre_ids: [10767] },
    { id: 3, media_type: "movie", title: "Next Year Film", release_date: "2027-02-01", character: "Hero" },
    { id: 4, media_type: "tv", name: "Recent Show", first_air_date: "2025-06-01", character: `Person ${personId}` },
    { id: 4, media_type: "tv", name: "Recent Show", first_air_date: "2025-06-01", character: "Narrator" },
    { id: 5, media_type: "movie", title: "Undated Film", release_date: "", character: "Cameo" },
  ] };
}

function recommendationsFor(id) {
  return id === 27205
    ? [{ id: 7001, media_type: "movie", title: "Interstellar", release_date: "2014-11-05", vote_average: 8.4, vote_count: 30000 },
       { id: 7002, media_type: "movie", title: "Tenet", release_date: "2020-08-22", vote_average: 7.2, vote_count: 9000 },
       { id: 7003, media_type: "movie", title: "Badly Rated", release_date: "2021-01-01", vote_average: 4.1, vote_count: 900 },
       { id: 7004, media_type: "tv", name: "Some Anime", first_air_date: "2022-01-01", original_language: "ja", vote_average: 8.9, vote_count: 900 }]
    : [];
}

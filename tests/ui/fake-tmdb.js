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
  const det = path.match(/^(movie|tv)\/(\d+)$/);
  if (det) return details(det[1], Number(det[2]));
  const person = path.match(/^person\/(\d+)\/combined_credits$/);
  if (person) return personCredits(Number(person[1]));
  const li = LISTS.indexOf(path);
  if (li < 0) return { results: [] };
  const tv = path.startsWith("tv/") || path.includes("/tv");
  const results = [0, 1, 2].map((k) => {
    const id = 100000 + li * 1000 + page * 10 + k;
    const mt = path === "trending/all/week" ? (k === 2 ? "tv" : "movie") : tv ? "tv" : "movie";
    const name = `${mt === "tv" ? "Show" : "Film"} ${li}-${page}-${k}`;
    return mt === "tv"
      ? { id, media_type: mt, name, first_air_date: "2020-01-01", poster_path: null, overview: `About ${name}`, vote_average: 7.5, vote_count: 500 }
      : { id, media_type: mt, title: name, release_date: "2021-05-05", poster_path: `/p${id}.jpg`, overview: `About ${name}`, vote_average: 7.1, vote_count: 900 };
  });
  return { page, results };
}

// Details with credits + external_ids, as asked for with append_to_response.
function details(mediaType, id) {
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

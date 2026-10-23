// Canned TMDB answers for the UI tests. Every list returns three items per page,
// with ids derived from the list and page so pages never repeat.

const LISTS = ["trending/all/week", "movie/top_rated", "tv/top_rated", "movie/popular", "tv/popular",
  "trending/movie/week", "movie/now_playing", "trending/tv/week", "tv/on_the_air"];

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
  const li = LISTS.indexOf(path);
  if (li < 0) return { results: [] };
  const tv = path.startsWith("tv/") || path.includes("/tv/");
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

-- Store each title's TMDB genre ids, so the genre filter works on titles already in the
-- household (a partner's ♥ picks, search adds). Safe to run more than once.
alter table public.titles add column if not exists genre_ids integer[];

create or replace function public.ensure_title(p jsonb)
returns uuid language plpgsql set search_path = public as $$
declare tid uuid; gids integer[];
begin
  if jsonb_typeof(p -> 'genre_ids') = 'array' then
    select array_agg(x::int) into gids from jsonb_array_elements_text(p -> 'genre_ids') x;
  end if;
  insert into titles(key, media_type, tmdb_id, title, year, poster, overview, rating, genre_ids)
  values (p ->> 'key', coalesce(p ->> 'media_type', 'movie'), (p ->> 'tmdb_id')::int,
          regexp_replace(trim(p ->> 'title'), '\s+', ' ', 'g'), (p ->> 'year')::int,
          p ->> 'poster', p ->> 'overview', (p ->> 'rating')::numeric, gids)
  on conflict (household_id, key) do update
    set poster = coalesce(excluded.poster, titles.poster),
        overview = coalesce(excluded.overview, titles.overview),
        rating = coalesce(excluded.rating, titles.rating),
        genre_ids = coalesce(excluded.genre_ids, titles.genre_ids)
  returning id into tid;
  return tid;
end $$;

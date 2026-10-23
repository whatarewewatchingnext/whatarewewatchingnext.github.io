-- what-are-we-watching: database schema
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
-- Every table is protected by row-level security: a signed-in user can only
-- see rows belonging to their own household, and only change their own swipes.

create extension if not exists pgcrypto;

-- Households ---------------------------------------------------------------

create table if not exists public.households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  join_code  text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8)),
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  username     text not null,
  created_at   timestamptz not null default now()
);

-- Returns the caller's household (security definer so RLS on members
-- doesn't recurse when policies call it).
create or replace function public.my_household()
returns uuid language sql stable security definer set search_path = public as $$
  select household_id from public.members where user_id = auth.uid()
$$;

create or replace function public.create_household(p_name text, p_username text)
returns uuid language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then
    raise exception 'already in a household';
  end if;
  insert into households(name) values (coalesce(nullif(trim(p_name), ''), 'Home')) returning id into hid;
  insert into members(user_id, household_id, username) values (auth.uid(), hid, p_username);
  return hid;
end $$;

create or replace function public.join_household(p_code text, p_username text)
returns uuid language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then
    raise exception 'already in a household';
  end if;
  select id into hid from households where join_code = upper(trim(p_code));
  if hid is null then raise exception 'invalid join code'; end if;
  insert into members(user_id, household_id, username) values (auth.uid(), hid, p_username);
  return hid;
end $$;

-- Titles + swipes ----------------------------------------------------------

-- A movie or show someone in the household has seen in their deck.
-- key is "movie:<tmdb id>", "tv:<tmdb id>", or "custom:<lowercased name>".
create table if not exists public.titles (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null default public.my_household() references public.households(id) on delete cascade,
  key          text not null,
  media_type   text not null default 'movie' check (media_type in ('movie', 'tv')),
  tmdb_id      integer,
  title        text not null check (length(trim(title)) > 0),
  year         integer,
  poster       text,
  overview     text,
  rating       numeric(3, 1),
  added_by     uuid default auth.uid() references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (household_id, key)
);

-- One per person per title: no (←), yes (→), liked (↑), disliked (↓).
create table if not exists public.swipes (
  title_id     uuid not null references public.titles(id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  household_id uuid not null default public.my_household() references public.households(id) on delete cascade,
  choice       text not null check (choice in ('no', 'yes', 'liked', 'disliked')),
  updated_at   timestamptz not null default now(),
  primary key (title_id, user_id)
);

-- Find-or-create a title in my household. Runs as the caller, so RLS applies.
create or replace function public.ensure_title(p jsonb)
returns uuid language plpgsql set search_path = public as $$
declare tid uuid;
begin
  insert into titles(key, media_type, tmdb_id, title, year, poster, overview, rating)
  values (p ->> 'key', coalesce(p ->> 'media_type', 'movie'), (p ->> 'tmdb_id')::int,
          regexp_replace(trim(p ->> 'title'), '\s+', ' ', 'g'), (p ->> 'year')::int,
          p ->> 'poster', p ->> 'overview', (p ->> 'rating')::numeric)
  on conflict (household_id, key) do update
    set poster = coalesce(excluded.poster, titles.poster),
        overview = coalesce(excluded.overview, titles.overview),
        rating = coalesce(excluded.rating, titles.rating)
  returning id into tid;
  return tid;
end $$;

-- Swipe on a title (creating it if needed). Swiping again replaces my choice.
create or replace function public.swipe(p_title jsonb, p_choice text)
returns uuid language plpgsql set search_path = public as $$
declare tid uuid;
begin
  tid := ensure_title(p_title);
  insert into swipes(title_id, choice) values (tid, p_choice)
  on conflict (title_id, user_id) do update set choice = excluded.choice, updated_at = now();
  return tid;
end $$;

-- Row-level security -------------------------------------------------------

alter table public.households enable row level security;
alter table public.members    enable row level security;
alter table public.titles     enable row level security;
alter table public.swipes     enable row level security;

drop policy if exists "own household" on public.households;
create policy "own household" on public.households
  for select using (id = public.my_household());

drop policy if exists "household members" on public.members;
create policy "household members" on public.members
  for select using (household_id = public.my_household());

drop policy if exists "household titles" on public.titles;
create policy "household titles" on public.titles
  for all using (household_id = public.my_household())
  with check (household_id = public.my_household());

drop policy if exists "read household swipes" on public.swipes;
create policy "read household swipes" on public.swipes
  for select using (household_id = public.my_household());

drop policy if exists "own swipes" on public.swipes;
create policy "own swipes" on public.swipes
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid() and household_id = public.my_household()
              and exists (select 1 from public.titles t where t.id = title_id and t.household_id = public.my_household()));

-- Grants (RLS above still decides which rows are visible) -----------------

revoke all on public.households, public.members, public.titles, public.swipes from anon;
grant select on public.households, public.members to authenticated;
grant select, insert, update on public.titles to authenticated;
grant select, insert, update, delete on public.swipes to authenticated;
revoke execute on function public.create_household(text, text), public.join_household(text, text), public.my_household(),
  public.ensure_title(jsonb), public.swipe(jsonb, text) from public, anon;
grant execute on function public.create_household(text, text), public.join_household(text, text), public.my_household(),
  public.ensure_title(jsonb), public.swipe(jsonb, text) to authenticated;

-- Live updates so a match shows up on both phones instantly ----------------

do $$ begin alter publication supabase_realtime add table public.titles;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.swipes;
exception when duplicate_object then null; end $$;

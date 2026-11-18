-- ORBES Trips — accounts and trips (SaaS, lot 1, Nov 2026). Run once in the Supabase SQL editor:
-- Dashboard → SQL Editor → New query → paste this whole file → Run. Safe to run twice.
--
-- From now on every user has their own trips. A trip is one row of "trips" (its whole content as data:
-- title, dates, hotel, days, flights, checklist, phrases, emergency info…). Who sees a trip is in
-- "trip_members" (owner / editor / viewer). Places, notes, photos, contacts and pins of a trip are readable
-- and writable by that trip's members only.
-- The shared space used so far (public.members + is_member()) keeps working exactly as before: its members keep
-- access to every trip that is not another user's trip (removing an e-mail from members still removes access).
-- A new trip always has a random id (uuid) chosen by the app: no one can claim an id that already holds data.

-- 1. Tables ----------------------------------------------------------------
create table if not exists public.trips (
  id         text primary key,
  owner      uuid references auth.users (id) on delete set null default auth.uid(),
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trip_members (
  trip_id    text not null references public.trips (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null default 'editor' check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);
create index if not exists trip_members_user on public.trip_members (user_id);

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Who can read / write a trip --------------------------------------------
-- (security definer: they read trip_members and trips whatever their own policies)
create or replace function public.trip_role(t text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.trip_members where trip_id = t and user_id = auth.uid();
$$;

-- the shared space of the first version: its members keep every trip that is not another user's trip
create or replace function public.legacy_access(t text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_member()
     and not exists (select 1 from public.trips x where x.id = t and x.id not in ('sha-2026', 'gz-2026'));
$$;

create or replace function public.can_read_trip(t text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.trip_role(t) is not null or public.legacy_access(t);
$$;

create or replace function public.can_write_trip(t text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.trip_role(t) in ('owner', 'editor'), false) or public.legacy_access(t);
$$;

-- ids of my trips / trips I can edit / trips of the SaaS that are not the shared space's (computed once per query)
create or replace function public.my_trip_ids()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select trip_id from public.trip_members where user_id = auth.uid();
$$;
create or replace function public.my_writable_trip_ids()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select trip_id from public.trip_members where user_id = auth.uid() and role in ('owner', 'editor');
$$;
create or replace function public.saas_trip_ids()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select id from public.trips where id not in ('sha-2026', 'gz-2026');
$$;
revoke all on function public.my_trip_ids() from public, anon;
revoke all on function public.my_writable_trip_ids() from public, anon;
revoke all on function public.saas_trip_ids() from public, anon;
grant execute on function public.my_trip_ids() to authenticated;
grant execute on function public.my_writable_trip_ids() to authenticated;
grant execute on function public.saas_trip_ids() to authenticated;

revoke all on function public.trip_role(text) from public, anon;
revoke all on function public.legacy_access(text) from public, anon;
revoke all on function public.can_read_trip(text) from public, anon;
revoke all on function public.can_write_trip(text) from public, anon;
grant execute on function public.trip_role(text) to authenticated;
grant execute on function public.legacy_access(text) to authenticated;
grant execute on function public.can_read_trip(text) to authenticated;
grant execute on function public.can_write_trip(text) to authenticated;

-- 3. A new trip: its creator becomes its owner -------------------------------
create or replace function public.trips_add_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    insert into public.trip_members (trip_id, user_id, role) values (new.id, auth.uid(), 'owner')
    on conflict (trip_id, user_id) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists trips_add_owner on public.trips;
create trigger trips_add_owner after insert on public.trips for each row execute function public.trips_add_owner();

-- 4. Field-by-field merge of a trip's content (same rule as places) ---------
create or replace function public.upsert_trip(p_trip text, p_data jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  cur jsonb;
  res jsonb;
  fa jsonb;
  k text;
  v jsonb;
  in_at numeric;
  cur_at numeric;
begin
  select data into cur from public.trips where id = p_trip for update;
  if cur is null then
    insert into public.trips (id, data, updated_at) values (p_trip, p_data, now())
    on conflict (id) do nothing;
    if found then return p_data; end if;
    select data into cur from public.trips where id = p_trip for update;
    if cur is null then
      raise exception 'no access to this trip' using errcode = '42501';
    end if;
  end if;
  res := cur;
  fa := coalesce(cur -> 'fieldsAt', '{}'::jsonb);
  for k, v in select * from jsonb_each(p_data) loop
    continue when k in ('fieldsAt', 'updatedAt');
    in_at := coalesce((p_data -> 'fieldsAt' ->> k)::numeric, (p_data ->> 'updatedAt')::numeric, 0);
    cur_at := case when cur ? k then coalesce((fa ->> k)::numeric, (cur ->> 'updatedAt')::numeric, 0) else -1 end;
    if in_at >= cur_at then
      res := jsonb_set(res, array[k], v, true);
      fa := jsonb_set(fa, array[k], to_jsonb(in_at), true);
    end if;
  end loop;
  res := jsonb_set(res, '{fieldsAt}', fa, true);
  res := jsonb_set(res, '{updatedAt}', to_jsonb(greatest(coalesce((cur ->> 'updatedAt')::numeric, 0), coalesce((p_data ->> 'updatedAt')::numeric, 0))), true);
  if res is distinct from cur then
    update public.trips set data = res, updated_at = now() where id = p_trip;
  end if;
  return res;
end;
$$;
revoke all on function public.upsert_trip(text, jsonb) from public, anon;
grant execute on function public.upsert_trip(text, jsonb) to authenticated;

-- 5. Row level security -----------------------------------------------------
alter table public.trips enable row level security;
drop policy if exists "trip read" on public.trips;
drop policy if exists "trip create" on public.trips;
drop policy if exists "trip update" on public.trips;
drop policy if exists "trip delete" on public.trips;
create policy "trip read" on public.trips for select to authenticated using ((select public.can_read_trip(id)));
-- a new trip: a random uuid id (never an id that could already hold someone's data), owned by its creator;
-- the two trips of the shared space only by its members
create policy "trip create" on public.trips for insert to authenticated
  with check (
    (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and owner = auth.uid())
    or (id in ('sha-2026', 'gz-2026') and (select public.is_member()))
  );
create policy "trip update" on public.trips for update to authenticated
  using ((select public.can_write_trip(id))) with check ((select public.can_write_trip(id)));
create policy "trip delete" on public.trips for delete to authenticated
  using (id not in ('sha-2026', 'gz-2026') and (select public.trip_role(id)) = 'owner');

alter table public.trip_members enable row level security;
drop policy if exists "members of my trips" on public.trip_members;
drop policy if exists "owner adds" on public.trip_members;
drop policy if exists "owner changes" on public.trip_members;
drop policy if exists "owner or self removes" on public.trip_members;
create policy "members of my trips" on public.trip_members for select to authenticated
  using (user_id = auth.uid() or (select public.can_read_trip(trip_id)));
create policy "owner adds" on public.trip_members for insert to authenticated with check ((select public.trip_role(trip_id)) = 'owner');
create policy "owner changes" on public.trip_members for update to authenticated
  using ((select public.trip_role(trip_id)) = 'owner') with check ((select public.trip_role(trip_id)) = 'owner');
create policy "owner or self removes" on public.trip_members for delete to authenticated
  using ((select public.trip_role(trip_id)) = 'owner' or user_id = auth.uid());

alter table public.profiles enable row level security;
drop policy if exists "my profile read" on public.profiles;
drop policy if exists "my profile create" on public.profiles;
drop policy if exists "my profile update" on public.profiles;
create policy "my profile read" on public.profiles for select to authenticated using (id = auth.uid());
create policy "my profile create" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "my profile update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- a trip's places, notes, photos, contacts, pins: its members (and the first shared space, see legacy_access)
do $$
declare t text;
begin
  foreach t in array array['place_states', 'places', 'contacts', 'pins', 'photos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "members read" on public.%I', t);
    execute format('drop policy if exists "members insert" on public.%I', t);
    execute format('drop policy if exists "members update" on public.%I', t);
    execute format('drop policy if exists "members delete" on public.%I', t);
    execute format('drop policy if exists "trip read" on public.%I', t);
    execute format('drop policy if exists "trip insert" on public.%I', t);
    execute format('drop policy if exists "trip update" on public.%I', t);
    execute format('drop policy if exists "trip delete" on public.%I', t);
    -- written with sets computed once per query (fast even on thousands of rows)
    execute format('create policy "trip read" on public.%I for select to authenticated using (trip_id in (select public.my_trip_ids()) or ((select public.is_member()) and trip_id not in (select public.saas_trip_ids())))', t);
    execute format('create policy "trip insert" on public.%I for insert to authenticated with check (trip_id in (select public.my_writable_trip_ids()) or ((select public.is_member()) and trip_id not in (select public.saas_trip_ids())))', t);
    execute format('create policy "trip update" on public.%I for update to authenticated using (trip_id in (select public.my_writable_trip_ids()) or ((select public.is_member()) and trip_id not in (select public.saas_trip_ids()))) with check (trip_id in (select public.my_writable_trip_ids()) or ((select public.is_member()) and trip_id not in (select public.saas_trip_ids())))', t);
    execute format('create policy "trip delete" on public.%I for delete to authenticated using (trip_id in (select public.my_writable_trip_ids()) or ((select public.is_member()) and trip_id not in (select public.saas_trip_ids())))', t);
  end loop;
end $$;

-- photo files: the first folder of the path is the trip
drop policy if exists "members read photos" on storage.objects;
drop policy if exists "members upload photos" on storage.objects;
drop policy if exists "members update photos" on storage.objects;
drop policy if exists "members delete photos" on storage.objects;
drop policy if exists "trip read photos" on storage.objects;
drop policy if exists "trip upload photos" on storage.objects;
drop policy if exists "trip update photos" on storage.objects;
drop policy if exists "trip delete photos" on storage.objects;
create policy "trip read photos" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (select public.can_read_trip(split_part(name, '/', 1))));
create policy "trip upload photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (select public.can_write_trip(split_part(name, '/', 1))));
create policy "trip update photos" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (select public.can_write_trip(split_part(name, '/', 1))));
create policy "trip delete photos" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (select public.can_write_trip(split_part(name, '/', 1))));

-- 6. The two existing trips get their row (access stays with the shared space, see legacy_access) --
insert into public.trips (id, owner)
select t, (select u.id from public.members m join auth.users u on lower(u.email) = lower(m.email) order by m.created_at, m.email limit 1)
from unnest(array['sha-2026', 'gz-2026']) as t
on conflict (id) do nothing;

-- 7. Live updates -----------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['trips', 'trip_members'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

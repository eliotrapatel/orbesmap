-- ORBES Trips — Pro by code, waiting list, admin, account deletion (SaaS, lot 6a, Nov 2026).
-- Run once AFTER saas.sql, saas-2.sql and saas-3.sql, in the Supabase SQL editor:
-- Dashboard → SQL Editor → New query → paste this whole file → replace the e-mail in section 9 → Run.
-- Safe to run twice.
--
-- Pro = the paid version, opened by codes for now (no payment yet). Free accounts: 1 trip prepared by the AI per
-- month, and once a trip is validated its programme can no longer be changed without Pro. Pro always: the first
-- shared space (public.members) and the admins.

-- 0. the previous files must have run first: otherwise stop here, nothing is changed
do $$
begin
  perform 'public.can_write_trip(text)'::regprocedure;
  perform 'public.reserve_ai_call(text, int, int)'::regprocedure;
  perform 'public.can_manage_trip(text)'::regprocedure;
exception when undefined_function then
  raise exception 'Lancez d''abord supabase/saas.sql, saas-2.sql puis saas-3.sql, puis ce fichier.';
end $$;

-- 1. Tables ----------------------------------------------------------------
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
create table if not exists public.pro_codes (
  code       text primary key check (code ~ '^[A-Z0-9-]{6,32}$'),
  days       int check (days is null or days between 1 and 3650),        -- null = for life
  max_uses   int not null default 1 check (max_uses between 1 and 100000),
  uses       int not null default 0,
  active     boolean not null default true,
  note       text check (note is null or length(note) <= 200),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.pro_grants (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  until      timestamptz,                                                 -- null = for life
  source     text,
  updated_at timestamptz not null default now()
);
create table if not exists public.code_redemptions (
  code    text not null references public.pro_codes (code) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  at      timestamptz not null default now(),
  primary key (code, user_id)
);
create table if not exists public.code_attempts (
  user_id uuid not null references auth.users (id) on delete cascade,
  at      timestamptz not null default now()
);
create index if not exists code_attempts_user_at on public.code_attempts (user_id, at desc);
create table if not exists public.waitlist (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  email      text not null,
  lang       text,
  created_at timestamptz not null default now()
);
create table if not exists public.prepared_trips (
  user_id uuid not null references auth.users (id) on delete cascade,
  trip_id text not null,
  at      timestamptz not null default now(),
  primary key (user_id, trip_id)
);
alter table public.admins enable row level security;
alter table public.pro_codes enable row level security;
alter table public.pro_grants enable row level security;
alter table public.code_redemptions enable row level security;
alter table public.code_attempts enable row level security;
alter table public.waitlist enable row level security;
alter table public.prepared_trips enable row level security;

-- 2. Who is admin, who is Pro ---------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.is_pro_user(u uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select u is not null and (
    exists (select 1 from public.admins a where a.user_id = u)
    or exists (select 1 from public.pro_grants g where g.user_id = u and (g.until is null or g.until > now()))
    or exists (
      select 1 from public.members m join auth.users x on lower(x.email) = lower(m.email)
      where x.id = u and x.email_confirmed_at is not null
    )
  );
$$;

create or replace function public.is_pro()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_pro_user(auth.uid());
$$;

-- a trip is Pro when its owner (trip_members, role owner) is: its invited travellers who can edit profit from it; the shared space's two trips always
create or replace function public.trip_pro(t text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select t in ('sha-2026', 'gz-2026')
    or exists (select 1 from public.trip_members m where m.trip_id = t and m.role = 'owner' and public.is_pro_user(m.user_id));
$$;

-- the owner of a trip never changes after its creation (an invited traveller who can edit could otherwise write it)
create or replace function public.trips_keep_owner()
returns trigger
language plpgsql
as $$
begin
  new.owner := old.owner;
  return new;
end;
$$;
drop trigger if exists trips_keep_owner on public.trips;
create trigger trips_keep_owner before update on public.trips for each row execute function public.trips_keep_owner();

-- the programme of a validated trip can only be changed with Pro (the trip's or the caller's own)
create or replace function public.trip_locked(t text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select x.data -> 'draft' ->> 'status' from public.trips x where x.id = t), '') = 'done'
     and not public.trip_pro(t) and not public.is_pro();
$$;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_pro_user(uuid) from public, anon, authenticated;
revoke all on function public.is_pro() from public, anon;
revoke all on function public.trip_pro(text) from public, anon;
revoke all on function public.trip_locked(text) from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_pro() to authenticated;
grant execute on function public.trip_pro(text) to authenticated;
grant execute on function public.trip_locked(text) to authenticated;

-- 3. Row access ----------------------------------------------------------------
drop policy if exists "codes admin" on public.pro_codes;
create policy "codes admin" on public.pro_codes for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "grants read" on public.pro_grants;
create policy "grants read" on public.pro_grants for select to authenticated
  using (user_id = auth.uid() or (select public.is_admin()));
drop policy if exists "redemptions read" on public.code_redemptions;
create policy "redemptions read" on public.code_redemptions for select to authenticated
  using (user_id = auth.uid() or (select public.is_admin()));
drop policy if exists "waitlist read" on public.waitlist;
drop policy if exists "waitlist join" on public.waitlist;
drop policy if exists "waitlist leave" on public.waitlist;
create policy "waitlist read" on public.waitlist for select to authenticated
  using (user_id = auth.uid() or (select public.is_admin()));
create policy "waitlist join" on public.waitlist for insert to authenticated
  with check (user_id = auth.uid() and lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy "waitlist leave" on public.waitlist for delete to authenticated using (user_id = auth.uid());
drop policy if exists "prepared read" on public.prepared_trips;
create policy "prepared read" on public.prepared_trips for select to authenticated using (user_id = auth.uid());
-- no policy on admins and code_attempts: only read through the functions above and below

-- 4. The account's plan, read by the app at each sync ---------------------------------
create or replace function public.my_plan()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'pro', public.is_pro(),
    'until', (select g.until from public.pro_grants g where g.user_id = auth.uid()),
    'granted', exists (select 1 from public.pro_grants g where g.user_id = auth.uid() and (g.until is null or g.until > now())),
    'admin', public.is_admin(),
    'waitlisted', exists (select 1 from public.waitlist w where w.user_id = auth.uid()),
    'prepLeft', case when public.is_pro() then 99 else greatest(0, 1 - (
      select count(*) from public.prepared_trips p where p.user_id = auth.uid() and p.at >= date_trunc('month', now())))::int end,
    'proTrips', coalesce((select jsonb_agg(m.trip_id) from public.trip_members m where m.user_id = auth.uid() and public.trip_pro(m.trip_id)), '[]'::jsonb)
  );
$$;
revoke all on function public.my_plan() from public, anon;
grant execute on function public.my_plan() to authenticated;

-- 5. Using a code: at most 10 tries per hour; a code works once per account ---------------
create or replace function public.redeem_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.pro_codes;
  cur public.pro_grants;
  new_until timestamptz;
  k text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
begin
  if me is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  perform pg_advisory_xact_lock(hashtext('code:' || me::text));
  if (select count(*) from public.code_attempts where user_id = me and at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false, 'error', 'too_many');
  end if;
  insert into public.code_attempts (user_id) values (me);
  select * into c from public.pro_codes where code = k for update;
  if c.code is null or not c.active then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  if c.uses >= c.max_uses then return jsonb_build_object('ok', false, 'error', 'used_up'); end if;
  if exists (select 1 from public.code_redemptions where code = k and user_id = me) then
    return jsonb_build_object('ok', false, 'error', 'already');
  end if;
  select * into cur from public.pro_grants where user_id = me;
  if c.days is null or (cur.user_id is not null and cur.until is null) then
    new_until := null;
  else
    new_until := greatest(coalesce(cur.until, now()), now()) + make_interval(days => c.days);
  end if;
  insert into public.pro_grants (user_id, until, source, updated_at) values (me, new_until, 'code:' || k, now())
  on conflict (user_id) do update set until = excluded.until, source = excluded.source, updated_at = now();
  insert into public.code_redemptions (code, user_id) values (k, me);
  update public.pro_codes set uses = uses + 1 where code = k;
  delete from public.code_attempts where user_id = me and at < now() - interval '1 day';
  return jsonb_build_object('ok', true, 'until', new_until);
end;
$$;
revoke all on function public.redeem_code(text) from public, anon;
grant execute on function public.redeem_code(text) to authenticated;

-- 6. AI requests: booked before the AI is called, with the plan's rules --------------------
-- refused: 'cap' (daily limit: free p_cap, Pro p_pro_cap; whole service p_global_cap), 'pro' (a validated trip's
-- programme without Pro), 'prep' (the free trip of the month already prepared). Returns {"id": n} or {"refused": "…"}
create or replace function public.reserve_ai(p_task text, p_trip text, p_cap int, p_pro_cap int, p_global_cap int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  pro boolean := public.is_pro();
  rid bigint;
  mine int;
  everyone int;
begin
  if me is null then return jsonb_build_object('refused', 'auth'); end if;
  perform pg_advisory_xact_lock(hashtext('ai:' || me::text));
  -- ('extract' is not here: the creation wizard reads bookings before its trip exists)
  if p_trip is not null and p_task in ('place', 'enrich', 'day', 'adjust') and public.trip_locked(p_trip) then
    return jsonb_build_object('refused', 'pro');
  end if;
  if p_task = 'outline' and not pro then
    if p_trip is null then return jsonb_build_object('refused', 'prep'); end if;
    if not exists (select 1 from public.prepared_trips where user_id = me and trip_id = p_trip)
       and (select count(*) from public.prepared_trips where user_id = me and at >= date_trunc('month', now())) >= 1 then
      return jsonb_build_object('refused', 'prep');
    end if;
  end if;
  select count(*) into mine from public.ai_usage where user_id = me and at > now() - interval '24 hours';
  select count(*) into everyone from public.ai_usage where at > now() - interval '24 hours';
  if mine >= (case when pro then p_pro_cap else p_cap end) or everyone >= p_global_cap then
    return jsonb_build_object('refused', 'cap');
  end if;
  -- the trip of the month is counted only once the request is accepted
  if p_task = 'outline' and p_trip is not null then
    insert into public.prepared_trips (user_id, trip_id) values (me, left(p_trip, 64)) on conflict do nothing;
  end if;
  insert into public.ai_usage (user_id, task) values (me, left(p_task, 20)) returning id into rid;
  return jsonb_build_object('id', rid);
end;
$$;
revoke all on function public.reserve_ai(text, text, int, int, int) from public, anon;
grant execute on function public.reserve_ai(text, text, int, int, int) to authenticated;

-- 7. A validated trip's programme without Pro: changes made after the validation are not taken
-- (same merge as before; places created or fields changed before the validation still arrive)
create or replace function public.upsert_place(p_trip text, p_place text, p_data jsonb)
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
  locked boolean;
  done_at numeric;
  taken boolean := false;
begin
  if not public.can_write_trip(p_trip) then
    raise exception 'no access to this trip' using errcode = '42501';
  end if;
  locked := public.trip_locked(p_trip);
  if locked then
    -- validated by an older version of the app (no time noted): nothing is refused
    select (x.data -> 'draft' ->> 'doneAt')::numeric into done_at from public.trips x where x.id = p_trip;
    locked := done_at is not null;
  end if;
  select data into cur from public.places where trip_id = p_trip and place_id = p_place for update;
  if cur is null then
    if locked and coalesce((p_data ->> 'updatedAt')::numeric, 0) > done_at then
      raise exception 'pro required' using errcode = '42501';
    end if;
    insert into public.places (trip_id, place_id, data, updated_at) values (p_trip, p_place, p_data, now())
    on conflict (trip_id, place_id) do nothing;
    if found then return p_data; end if;
    select data into cur from public.places where trip_id = p_trip and place_id = p_place for update;
  end if;
  res := cur;
  fa := coalesce(cur -> 'fieldsAt', '{}'::jsonb);
  for k, v in select * from jsonb_each(p_data) loop
    continue when k in ('fieldsAt', 'updatedAt');
    in_at := coalesce((p_data -> 'fieldsAt' ->> k)::numeric, (p_data ->> 'updatedAt')::numeric, 0);
    continue when locked and in_at > done_at;
    cur_at := case when cur ? k then coalesce((fa ->> k)::numeric, (cur ->> 'updatedAt')::numeric, 0) else -1 end;
    if in_at >= cur_at then
      res := jsonb_set(res, array[k], v, true);
      fa := jsonb_set(fa, array[k], to_jsonb(in_at), true);
      taken := true;
    end if;
  end loop;
  -- locked and nothing taken: the record stays exactly as it was
  if locked and not taken then return cur; end if;
  res := jsonb_set(res, '{fieldsAt}', fa, true);
  res := jsonb_set(res, '{updatedAt}', to_jsonb(greatest(coalesce((cur ->> 'updatedAt')::numeric, 0), coalesce((p_data ->> 'updatedAt')::numeric, 0))), true);
  if res is distinct from cur then
    update public.places set data = res, updated_at = now() where trip_id = p_trip and place_id = p_place;
  end if;
  return res;
end;
$$;
revoke all on function public.upsert_place(text, text, jsonb) from public, anon;
grant execute on function public.upsert_place(text, text, jsonb) to authenticated;

-- 8. Admin: figures, accounts, codes, Pro by hand ------------------------------------
create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'accounts', (select count(*) from auth.users),
    'accounts7', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'trips', (select count(*) from public.trips where id not in ('sha-2026', 'gz-2026')),
    'trips7', (select count(*) from public.trips where id not in ('sha-2026', 'gz-2026') and created_at > now() - interval '7 days'),
    'prepared30', (select count(*) from public.prepared_trips where at > now() - interval '30 days'),
    'pro', (select count(*) from public.pro_grants where until is null or until > now()),
    'waitlist', (select count(*) from public.waitlist),
    'aiToday', (select count(*) from public.ai_usage where at > now() - interval '24 hours'),
    'usdToday', (select coalesce(sum(usd), 0) from public.ai_usage where at > now() - interval '24 hours'),
    'usd30', (select coalesce(sum(usd), 0) from public.ai_usage where at > now() - interval '30 days'),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', d, 'calls', n, 'usd', u) order by d)
      from (select date_trunc('day', at)::date d, count(*) n, sum(usd) u from public.ai_usage
            where at > now() - interval '30 days' group by 1) s), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_accounts(p_search text default null)
returns table (user_id uuid, email text, name text, created_at timestamptz, last_seen timestamptz,
               pro boolean, until timestamptz, granted boolean, admin boolean, trips int, ai30 int, waitlisted boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
  select u.id, u.email::text, coalesce(p.data ->> 'name', ''), u.created_at, u.last_sign_in_at,
         public.is_pro_user(u.id), g.until, (g.user_id is not null and (g.until is null or g.until > now())),
         exists (select 1 from public.admins a where a.user_id = u.id),
         (select count(*)::int from public.trip_members m where m.user_id = u.id and m.role = 'owner'),
         (select count(*)::int from public.ai_usage x where x.user_id = u.id and x.at > now() - interval '30 days'),
         exists (select 1 from public.waitlist w where w.user_id = u.id)
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join public.pro_grants g on g.user_id = u.id
  where p_search is null or p_search = '' or u.email ilike '%' || p_search || '%' or (p.data ->> 'name') ilike '%' || p_search || '%'
  order by u.created_at desc
  limit 300;
end;
$$;

-- Pro given by hand: p_days = number of days from now, null = for life, 0 = removed
create or replace function public.admin_set_pro(p_user uuid, p_days int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_days = 0 then
    delete from public.pro_grants where user_id = p_user;
  else
    insert into public.pro_grants (user_id, until, source, updated_at)
    values (p_user, case when p_days is null then null else now() + make_interval(days => p_days) end, 'admin', now())
    on conflict (user_id) do update set until = excluded.until, source = 'admin', updated_at = now();
  end if;
end;
$$;

-- a new code, drawn at random by the server: ORB-XXXX-XXXX
create or replace function public.admin_create_code(p_days int, p_max_uses int, p_note text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  k text;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  loop
    k := upper(replace(gen_random_uuid()::text, '-', ''));
    k := 'ORB-' || substr(k, 1, 4) || '-' || substr(k, 5, 4);
    exit when not exists (select 1 from public.pro_codes where code = k);
  end loop;
  insert into public.pro_codes (code, days, max_uses, note) values (k, p_days, greatest(1, coalesce(p_max_uses, 1)), nullif(left(trim(coalesce(p_note, '')), 200), ''));
  return k;
end;
$$;
revoke all on function public.admin_overview() from public, anon;
revoke all on function public.admin_accounts(text) from public, anon;
revoke all on function public.admin_set_pro(uuid, int) from public, anon;
revoke all on function public.admin_create_code(int, int, text) from public, anon;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_accounts(text) to authenticated;
grant execute on function public.admin_set_pro(uuid, int) to authenticated;
grant execute on function public.admin_create_code(int, int, text) to authenticated;

-- 9. Deleting one's account: the trips it created go with it (for its invited travellers too), then the account.
-- The app first removes the photo files of those trips (my_account_files), the database cannot.
create or replace function public.my_owned_trip_ids()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select m.trip_id from public.trip_members m
  where m.user_id = auth.uid() and m.role = 'owner' and m.trip_id not in ('sha-2026', 'gz-2026');
$$;
create or replace function public.my_account_files()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select path from public.photos where trip_id in (select public.my_owned_trip_ids());
$$;
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  ids text[];
begin
  if me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select coalesce(array_agg(t), '{}') into ids from public.my_owned_trip_ids() t;
  delete from public.places where trip_id = any (ids);
  delete from public.place_states where trip_id = any (ids);
  delete from public.contacts where trip_id = any (ids);
  delete from public.pins where trip_id = any (ids);
  delete from public.photos where trip_id = any (ids);
  delete from public.trips where id = any (ids);
  delete from auth.users where id = me;
end;
$$;
revoke all on function public.my_owned_trip_ids() from public, anon;
revoke all on function public.my_account_files() from public, anon;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.my_owned_trip_ids() to authenticated;
grant execute on function public.my_account_files() to authenticated;
grant execute on function public.delete_my_account() to authenticated;

-- 10. The first admin: REPLACE the address below with the e-mail of your ORBES Trips account, then run.
-- (Nothing happens if no account has this address yet: sign in once in the app, then run this line again.)
insert into public.admins (user_id)
select id from auth.users where lower(email) = lower('votre-adresse@exemple.com')
on conflict do nothing;

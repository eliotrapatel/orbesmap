-- ORBES Trips — Pro per trip (the Pass, for the whole group), the AI budget of free accounts (lot "gratuit-pro", Nov 2026).
-- Run in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste this whole file → Run).
-- Safe to run twice, and in any order with the other new files (saas-12, saas-14…). It needs saas-4.sql and saas-11.sql.
-- The whole file is one transaction: if anything fails, nothing at all is changed.
--
-- What it adds:
--  1. trip_grants: one Pass per trip (until a date). Every traveller of that trip gets Pro on it (programme changes,
--     exports, offline map, business mode). Given by the admin by hand for now (no payment yet).
--  2. trip_pro() also reads trip_grants: the server lock, my_plan.proTrips and the app follow with no other change.
--  3. reserve_ai2: same rules as reserve_ai, plus a monthly AI budget for FREE accounts only (above it: the cheaper
--     model, then fewer requests a day outside the trip preparation; never a hard stop), the account's limit told
--     apart from the whole service's limit, and day / adjust refused on a trip created by hand (free accounts).
--     Members, admins and Pro accounts: exactly as before.
--  4. The admin's functions: give / remove a Pass, read the Passes, the AI cost by plan.
-- Nothing else is redefined (my_plan, trip_locked, upsert_place, reserve_ai, track_event stay as they are).

begin;

-- 0. the previous files must have run first: otherwise stop here, nothing is changed
do $$
begin
  perform 'public.is_admin()'::regprocedure;
  perform 'public.is_pro_user(uuid)'::regprocedure;
  perform 'public.trip_pro(text)'::regprocedure;
  perform 'public.can_read_trip(text)'::regprocedure;
  perform 'public.finish_ai_call2(bigint, numeric, boolean, jsonb)'::regprocedure;
  if to_regclass('public.prepared_trips') is null or to_regclass('public.events') is null or to_regclass('public.members') is null then
    raise exception 'Lancez d''abord supabase/saas-4.sql, saas-5.sql et saas-11.sql, puis ce fichier.';
  end if;
exception when undefined_function then
  raise exception 'Lancez d''abord supabase/saas-4.sql, saas-5.sql et saas-11.sql, puis ce fichier.';
end $$;

-- 1. One Pass per trip (created before trip_pro reads it) ------------------------------------
create table if not exists public.trip_grants (
  trip_id    text primary key references public.trips (id) on delete cascade,
  payer      uuid references auth.users (id) on delete set null,
  until      timestamptz not null,
  source     text not null default 'admin' check (length(source) <= 80),   -- later 'stripe:…'
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.trip_grants enable row level security;
revoke all on public.trip_grants from anon;
-- a traveller of the trip (and the admin) can read its Pass; nobody writes it by hand (admin_grant_trip_pass only)
drop policy if exists "trip grants read" on public.trip_grants;
create policy "trip grants read" on public.trip_grants for select to authenticated
  using ((select public.can_read_trip(trip_id)) or (select public.is_admin()));

-- 2. A trip is Pro: the shared space's two trips, a Pro owner (as before), or a Pass still running ----------
create or replace function public.trip_pro(t text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select t in ('sha-2026', 'gz-2026')
    or exists (select 1 from public.trip_members m where m.trip_id = t and m.role = 'owner' and public.is_pro_user(m.user_id))
    or exists (select 1 from public.trip_grants g where g.trip_id = t and g.until > now());
$$;
revoke all on function public.trip_pro(text) from public, anon;
grant execute on function public.trip_pro(text) to authenticated;

-- 3. The AI log: the trip and whether the request was booked above the free monthly budget ---------------
alter table public.ai_usage add column if not exists trip_id text;
alter table public.ai_usage add column if not exists budget text;   -- 'cheap' / 'slow': above the free monthly budget
create index if not exists prepared_trips_trip on public.prepared_trips (trip_id);
create index if not exists ai_usage_at on public.ai_usage (at desc);

-- 4. AI requests, booked before the AI is called -----------------------------------------------
-- Same refusals as reserve_ai ('auth', 'pro', 'prep'), plus:
--   'manual': day / adjust on a trip created by hand (no preparation), for a free account;
--   'cap' now says which limit: {"refused":"cap","scope":"account","plan":"free|pro","limit":n,"slowed":bool} or {"scope":"global"}.
-- The trip only counts for one of its travellers (can_read_trip): a free account cannot borrow another trip's Pro.
-- Budget (free accounts only, p_budget > 0): spent this month >= p_budget → "cheap" (the app's relay uses the
-- cheaper provider); >= 2 × p_budget → at most p_slow_cap requests a day, except the trip preparation and creation.
-- Returns {"id": n, "cheap": bool} or {"refused": "…"}.
create or replace function public.reserve_ai2(p_task text, p_trip text, p_cap int, p_pro_cap int, p_global_cap int, p_budget numeric, p_slow_cap int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  own boolean;
  traveller boolean;
  pro boolean;
  t text := nullif(left(coalesce(p_trip, ''), 64), '');
  rid bigint;
  mine int;
  everyone int;
  spent numeric := 0;
  cheap boolean := false;
  slowed boolean := false;
  cap int := p_cap;
  mark text := null;
  lim int;
begin
  if me is null then return jsonb_build_object('refused', 'auth'); end if;
  perform pg_advisory_xact_lock(hashtext('ai:' || me::text));
  own := public.is_pro();
  traveller := t is not null and public.can_read_trip(t);
  pro := own or (traveller and public.trip_pro(t));
  -- the same two rules as reserve_ai ('extract' is not here: the creation wizard reads bookings before its trip exists)
  if p_trip is not null and p_task in ('place', 'enrich', 'day', 'adjust') and public.trip_locked(p_trip) then
    return jsonb_build_object('refused', 'pro');
  end if;
  if p_task = 'outline' and not own then
    if p_trip is null then return jsonb_build_object('refused', 'prep'); end if;
    if not exists (select 1 from public.prepared_trips where user_id = me and trip_id = p_trip)
       and (select count(*) from public.prepared_trips where user_id = me and at >= date_trunc('month', now())) >= 1 then
      return jsonb_build_object('refused', 'prep');
    end if;
  end if;
  -- a trip created by hand (it exists, it has no preparation and no prepared request): completing it with the AI is Pro
  if p_task in ('day', 'adjust') and not pro and t is not null
     and exists (select 1 from public.trips x where x.id = t and jsonb_typeof(x.data -> 'draft') is distinct from 'object')
     and not exists (select 1 from public.prepared_trips p where p.trip_id = t) then
    return jsonb_build_object('refused', 'manual');
  end if;
  -- the free monthly budget (members, admins, Pro accounts and Pro trips: never)
  if not pro and coalesce(p_budget, 0) > 0 then
    select coalesce(sum(usd), 0) into spent from public.ai_usage where user_id = me and at >= date_trunc('month', now());
    if spent >= p_budget then
      cheap := true;
      mark := 'cheap';
    end if;
    if spent >= 2 * p_budget and p_task not in ('outline', 'essentials', 'day', 'adjust', 'extract', 'intake', 'concierge') then
      slowed := true;
      mark := 'slow';
      cap := least(p_cap, greatest(1, coalesce(p_slow_cap, p_cap)));
    end if;
  end if;
  select count(*) into mine from public.ai_usage where user_id = me and at > now() - interval '24 hours';
  lim := case when pro then p_pro_cap else cap end;
  if mine >= lim then
    return jsonb_build_object('refused', 'cap', 'scope', 'account', 'plan', case when pro then 'pro' else 'free' end, 'limit', lim, 'slowed', slowed);
  end if;
  select count(*) into everyone from public.ai_usage where at > now() - interval '24 hours';
  if everyone >= p_global_cap then
    return jsonb_build_object('refused', 'cap', 'scope', 'global');
  end if;
  -- the trip of the month is counted only once the request is accepted
  if p_task = 'outline' and p_trip is not null then
    insert into public.prepared_trips (user_id, trip_id) values (me, left(p_trip, 64)) on conflict do nothing;
  end if;
  insert into public.ai_usage (user_id, task, trip_id, budget) values (me, left(p_task, 20), t, mark) returning id into rid;
  return jsonb_build_object('id', rid, 'cheap', cheap);
end;
$$;
revoke all on function public.reserve_ai2(text, text, int, int, int, numeric, int) from public, anon;
grant execute on function public.reserve_ai2(text, text, int, int, int, numeric, int) to authenticated;

-- 5. The caller's trips that are Pro by a Pass or by their owner: who offers it (a first name, never an e-mail) ----
-- A Pass names its payer only (an admin's Pass has none: the plain "Pass voyage jusqu'au …", no "offert par").
create or replace function public.my_trip_passes()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('trip', x.trip, 'kind', x.kind, 'until', x.until, 'by', x.giver, 'mine', x.mine)), '[]'::jsonb)
  from (
    select m.trip_id as trip,
           case when g.trip_id is not null then 'pass' else 'owner' end as kind,
           g.until as until,
           nullif(split_part(trim(coalesce(p.data ->> 'name', '')), ' ', 1), '') as giver,
           coalesce(case when g.trip_id is not null then g.payer else o.user_id end = auth.uid(), false) as mine
    from public.trip_members m
    left join public.trip_grants g on g.trip_id = m.trip_id and g.until > now()
    left join lateral (
      select w.user_id from public.trip_members w
      where w.trip_id = m.trip_id and w.role = 'owner' and public.is_pro_user(w.user_id) limit 1
    ) o on true
    left join public.profiles p on p.id = case when g.trip_id is not null then g.payer else o.user_id end
    where m.user_id = auth.uid() and m.trip_id not in ('sha-2026', 'gz-2026')
      and (g.trip_id is not null or o.user_id is not null)
  ) x;
$$;
revoke all on function public.my_trip_passes() from public, anon;
grant execute on function public.my_trip_passes() to authenticated;

-- 6. The admin gives (or removes) a Pass on a trip ---------------------------------------------
-- p_days: 0 = removed; 1..365 = that many days from now; null = the Pass rule: the trip's end + 30 days, at least
-- 60 days from now, at most 365 days from now (no end date: 60 days). p_payer: null or a traveller of the trip (the
-- admin's screen sends null: nobody paid, so nobody is shown as the giver). The events go to p_payer, else to the
-- trip's owner (detail 'admin': the admin chose).
create or replace function public.admin_grant_trip_pass(p_trip text, p_payer uuid, p_days int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tr public.trips;
  e date;
  u timestamptz;
  who uuid;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into tr from public.trips where id = p_trip;
  if tr.id is null then return jsonb_build_object('error', 'trip'); end if;
  if p_payer is not null and not exists (select 1 from public.trip_members where trip_id = p_trip and user_id = p_payer) then
    return jsonb_build_object('error', 'payer');
  end if;
  if p_days is not null and (p_days < 0 or p_days > 365) then return jsonb_build_object('error', 'days'); end if;
  who := coalesce(p_payer, (select w.user_id from public.trip_members w where w.trip_id = p_trip and w.role = 'owner' limit 1));
  if p_days = 0 then
    delete from public.trip_grants where trip_id = p_trip;
    insert into public.events (user_id, name, detail, trip_id) values (who, 'pass_removed', 'admin', p_trip);
    return jsonb_build_object('until', null);
  end if;
  if p_days is null then
    begin
      e := (tr.data ->> 'end')::date;
    exception when others then
      e := null;
    end;
    -- valid until the end of the 30th day after the trip (Paris time)
    u := least(greatest(coalesce(((e + 31)::timestamp at time zone 'Europe/Paris') - interval '1 second', now() + interval '60 days'),
                        now() + interval '60 days'),
               now() + interval '365 days');
  else
    u := now() + make_interval(days => p_days);
  end if;
  insert into public.trip_grants (trip_id, payer, until, source, created_by, updated_at)
  values (p_trip, p_payer, u, 'admin', auth.uid(), now())
  on conflict (trip_id) do update set payer = excluded.payer, until = excluded.until, source = excluded.source,
                                     created_by = excluded.created_by, updated_at = now();
  insert into public.events (user_id, name, detail, trip_id) values (who, 'pass_granted', 'admin', p_trip);
  return jsonb_build_object('until', u);
end;
$$;
revoke all on function public.admin_grant_trip_pass(text, uuid, int) from public, anon;
grant execute on function public.admin_grant_trip_pass(text, uuid, int) to authenticated;

-- 7. The admin reads the Passes of some trips (each existing trip once, with its end date) ----------------
create or replace function public.admin_trip_passes(p_trips text[])
returns table (trip_id text, trip_end text, until timestamptz, payer_email text, source text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
  select x.id, x.data ->> 'end', g.until, u.email::text, g.source
  from public.trips x
  left join public.trip_grants g on g.trip_id = x.id and g.until > now()
  left join auth.users u on u.id = g.payer
  where x.id = any (coalesce(p_trips, '{}'::text[]))
  limit 200;
end;
$$;
revoke all on function public.admin_trip_passes(text[]) from public, anon;
grant execute on function public.admin_trip_passes(text[]) to authenticated;

-- 8. The admin's AI cost by plan (30 days), the free accounts above their budget this month, and the Pro accounts
--    above p_pro_alert dollars this month (an alert only: nothing changes for them). Revenue: none before payments.
create or replace function public.admin_ai_budget(p_budget numeric default 1, p_pro_alert numeric default 1.05)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return (
  with acc as (
    select u.id, u.email::text as email,
           case when exists (select 1 from public.admins a where a.user_id = u.id) then 'team'
                when u.email_confirmed_at is not null and exists (select 1 from public.members m where lower(m.email) = lower(u.email)) then 'shared'
                when exists (select 1 from public.pro_grants g where g.user_id = u.id and (g.until is null or g.until > now())) then 'pro'
                else 'free' end as plan
    from auth.users u
  ), d30 as (
    select user_id, count(*) as n, coalesce(sum(usd), 0) as usd from public.ai_usage where at > now() - interval '30 days' group by user_id
  ), mon as (
    select user_id, count(*) as n, coalesce(sum(usd), 0) as usd, max(at) as last_at, bool_or(budget is not null) as flagged
    from public.ai_usage where at >= date_trunc('month', now()) group by user_id
  )
  select jsonb_build_object(
    'budget', p_budget,
    'proAlertAt', p_pro_alert,
    'plans', (select coalesce(jsonb_agg(jsonb_build_object('plan', s.plan, 'accounts', s.n, 'requests', s.req, 'usd', s.usd) order by s.plan), '[]'::jsonb)
              from (select a.plan, count(*) as n, coalesce(sum(x.n), 0) as req, coalesce(sum(x.usd), 0) as usd
                    from acc a left join d30 x on x.user_id = a.id group by a.plan) s),
    'over', (select coalesce(jsonb_agg(jsonb_build_object('email', s.email, 'usd', s.usd, 'requests', s.n, 'last', s.last_at) order by s.usd desc), '[]'::jsonb)
             from (select a.email, m.usd, m.n, m.last_at from acc a join mon m on m.user_id = a.id
                   where a.plan = 'free' and (m.flagged or m.usd >= p_budget) order by m.usd desc limit 50) s),
    'proAlert', (select coalesce(jsonb_agg(jsonb_build_object('email', s.email, 'usd', s.usd, 'requests', s.n, 'last', s.last_at) order by s.usd desc), '[]'::jsonb)
                 from (select a.email, m.usd, m.n, m.last_at from acc a join mon m on m.user_id = a.id
                       where a.plan = 'pro' and m.usd >= p_pro_alert order by m.usd desc limit 50) s)
  ));
end;
$$;
revoke all on function public.admin_ai_budget(numeric, numeric) from public, anon;
grant execute on function public.admin_ai_budget(numeric, numeric) to authenticated;

commit;

-- Checks to run right after (each one alone):
--   select public.trip_pro('sha-2026');                          → true (Shanghai stays Pro)
--   select public.my_plan();                                      → in the SQL editor: pro false, proTrips [] (no session), no error
--   select public.reserve_ai2('ask', null, 25, 400, 1500, 1, 5);  → {"refused": "auth"} (no session: it runs and books nothing)

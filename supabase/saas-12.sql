-- ORBES Trips — measuring the path, step by step, and where people come from (lot « mesure », R03 + R11, Nov 2026).
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run). Safe to run twice, and in
-- any order with the other files of 18 Nov 2026 (saas-13, saas-14, saas-15…): it needs only saas-11.sql.
--
-- What it adds (nothing is removed, no table rewritten; accept_invites, admin_user and admin_funnel are unchanged):
--  1. each step can say the channel of the link it came from (src: email_day, invite, public…) and who shared it
--     (by_user, from an opaque code in the link, never an e-mail or a name);
--  2. every person's opaque sharer code (ref_codes, my_ref_code);
--  3. one list of steps for track_event (all three versions), open to the names other lots register in event_names;
--     the confirmed e-mail is written once per account, from auth.users;
--  4. an invitation accepted is recorded when the invited person joins the trip (trigger, never refuses a join);
--  5. the admin's views: the path by sign-up month or week, the sources, one account's first source.

-- 0. the previous files must have run first: otherwise stop here, nothing is changed
do $$
begin
  perform 'public.is_admin()'::regprocedure;
  perform 'public.track_event(text, text, text, text, text, text, text, text, text, text, text)'::regprocedure;
exception when undefined_function then
  raise exception 'Lancez d''abord supabase/saas-11.sql, puis ce fichier.';
end $$;

-- 1. the source of a step ---------------------------------------------------------------------------------------
alter table public.events add column if not exists src text;
alter table public.events add column if not exists by_user uuid references auth.users (id) on delete set null;
create index if not exists events_src on public.events (src, at desc) where src is not null;
create index if not exists events_by on public.events (by_user, at desc) where by_user is not null;
create index if not exists events_name_at on public.events (name, at desc);
-- the steps written once (a second write of the same one is ignored); skipped, with a notice, if copies already exist
do $$
begin
  create unique index if not exists events_email_confirmed_once on public.events (user_id) where name = 'email_confirmed';
exception when unique_violation then
  raise notice 'events_email_confirmed_once: des doublons existent déjà, index non créé';
end $$;
do $$
begin
  create unique index if not exists events_invite_accepted_once on public.events (user_id, trip_id) where name = 'invite_accepted';
exception when unique_violation then
  raise notice 'events_invite_accepted_once: des doublons existent déjà, index non créé';
end $$;

-- 2. the opaque code of a person who shares a link -------------------------------------------------------------
create table if not exists public.ref_codes (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  code       text not null unique,
  created_at timestamptz not null default now()
);
alter table public.ref_codes enable row level security;
drop policy if exists "ref code read own" on public.ref_codes;
create policy "ref code read own" on public.ref_codes for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.ref_codes from anon;

-- this account's code (made the first time): 10 lowercase letters and digits, at least one digit
create or replace function public.my_ref_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  c text;
  i int := 0;
begin
  if auth.uid() is null then return null; end if;
  select code into c from public.ref_codes where user_id = auth.uid();
  if c is not null then return c; end if;
  loop
    i := i + 1;
    if i > 8 then return null; end if;
    c := left(replace(gen_random_uuid()::text, '-', ''), 10);
    continue when c !~ '[0-9]';
    begin
      insert into public.ref_codes (user_id, code) values (auth.uid(), c);
      return c;
    exception when unique_violation then
      -- made meanwhile by another call of the same account, or the same code drawn twice: read again, else draw again
      select code into c from public.ref_codes where user_id = auth.uid();
      if c is not null then return c; end if;
    end;
  end loop;
end;
$$;
revoke all on function public.my_ref_code() from public, anon;
grant execute on function public.my_ref_code() to authenticated;

-- 3. one step: the full version (with its source), the two older ones call it ----------------------------------
create or replace function public.track_event(p_name text, p_detail text, p_device text, p_ref text, p_visitor text, p_trip text,
                                              p_city text, p_country text, p_region text, p_os text, p_browser text,
                                              p_src text, p_by text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v text := nullif(left(regexp_replace(coalesce(p_visitor, ''), '[^a-zA-Z0-9-]', '', 'g'), 40), '');
  clean text := '[[:cntrl:]<>"{}\\]';
  s text := case when lower(coalesce(p_src, '')) ~ '^[a-z][a-z0-9_]{1,23}$' then lower(p_src) end;
  b uuid;
  ok boolean;
  ca timestamptz;
begin
  ok := p_name = any (array[
    'visit', 'signup_email', 'signup_done', 'sign_in', 'app_open', 'trip_created', 'trip_opened', 'trip_validated',
    'place_added', 'invite_sent', 'export', 'pro_screen', 'code_redeemed', 'waitlist_join',
    'link_opened', 'public_view', 'trip_copied', 'expense_added',
    'place_opened', 'tool_opened', 'status_set', 'note_written', 'photo_added', 'vote', 'comment_added',
    'checklist_done', 'language_changed', 'alerts_changed', 'search', 'adjust_asked', 'day_redone', 'trip_shared_whatsapp',
    -- the measured path (R03) and the steps of the other lots of 18 Nov 2026
    'create_started', 'first_day_opened', 'paywall_closed', 'landing_cta', 'public_link_created', 'public_cta_clicked',
    'onboarding_done', 'signup_submitted', 'email_confirmed', 'prep_started', 'prep_ready', 'prep_failed',
    'invite_accepted', 'check_email_shown', 'confirm_resent', 'quota_seen', 'manual_trip_created', 'validate_explained',
    'trip_pass_granted', 'ai_budget_hit', 'landing_destination', 'invite_email_sent', 'reminder_sent', 'offline_ready',
    'offline_reminder_sent', 'offline_used', 'confirm_screen', 'landing_intent', 'intent_applied', 'public_copy_click',
    'app_redirect', 'link_preview']);
  -- a name another lot registered (public.event_names, when that table exists)
  if not ok and to_regclass('public.event_names') is not null then
    begin
      execute 'select exists (select 1 from public.event_names where name = $1)' into ok using p_name;
    exception when others then
      ok := false;
    end;
  end if;
  if not coalesce(ok, false) then return; end if;
  -- written only by the server (the invitation trigger below, api/prepare.ts with the service key): never from here,
  -- so that no early or forged row takes the place of the real one
  if p_name in ('invite_accepted', 'prep_started', 'prep_ready', 'prep_failed') then return; end if;
  -- written once per account: never from a device that is not signed in
  if p_name = 'email_confirmed' and auth.uid() is null then return; end if;
  -- limits: 5,000 steps a day per account or device, 500,000 for the whole service
  if (select count(*) from public.events where at > now() - interval '1 day'
      and ((auth.uid() is not null and user_id = auth.uid()) or (auth.uid() is null and v is not null and visitor = v))) >= 5000
     or (select count(*) from public.events where at > now() - interval '1 day') >= 500000 then
    return;
  end if;
  -- the confirmed e-mail, at the time auth.users says, once per account (the first step after confirming writes it)
  if auth.uid() is not null and not exists (select 1 from public.events where user_id = auth.uid() and name = 'email_confirmed') then
    select x.email_confirmed_at into ca from auth.users x where x.id = auth.uid();
    if ca is not null and ca > now() - interval '13 months' then
      insert into public.events (at, user_id, visitor, name, device)
      values (ca, auth.uid(), v, 'email_confirmed', case when p_device in ('phone', 'computer') then p_device end)
      on conflict do nothing;
    end if;
  end if;
  if p_name = 'email_confirmed' then return; end if;
  -- who shared the link (an unknown code, or the person's own: nobody)
  if p_by is not null and lower(p_by) ~ '^[a-z0-9]{8,16}$' then
    select r.user_id into b from public.ref_codes r where r.code = lower(p_by);
    if b = auth.uid() then b := null; end if;
  end if;
  insert into public.events (user_id, visitor, name, detail, trip_id, device, ref, city, country, region, os, browser, src, by_user)
  values (auth.uid(), v, p_name,
          nullif(left(regexp_replace(coalesce(p_detail, ''), '[^a-zA-Z0-9_-]', '', 'g'), 40), ''),
          nullif(left(coalesce(p_trip, ''), 64), ''),
          case when p_device in ('phone', 'computer') then p_device end,
          nullif(left(regexp_replace(lower(coalesce(p_ref, '')), '[^a-z0-9.-]', '', 'g'), 80), ''),
          nullif(left(regexp_replace(coalesce(p_city, ''), clean, '', 'g'), 80), ''),
          nullif(upper(left(regexp_replace(coalesce(p_country, ''), '[^A-Za-z]', '', 'g'), 2)), ''),
          nullif(left(regexp_replace(coalesce(p_region, ''), clean, '', 'g'), 80), ''),
          nullif(left(regexp_replace(coalesce(p_os, ''), clean, '', 'g'), 30), ''),
          nullif(left(regexp_replace(coalesce(p_browser, ''), clean, '', 'g'), 30), ''),
          s, b)
  on conflict do nothing;
  -- steps older than 13 months are not kept
  delete from public.events where id in (select id from public.events where at < now() - interval '13 months' order by id limit 100);
end;
$$;
revoke all on function public.track_event(text, text, text, text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.track_event(text, text, text, text, text, text, text, text, text, text, text, text, text) to anon, authenticated;

-- the version of supabase/saas-8.sql (place and device, no source): same list, same limits
create or replace function public.track_event(p_name text, p_detail text, p_device text, p_ref text, p_visitor text, p_trip text,
                                              p_city text, p_country text, p_region text, p_os text, p_browser text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.track_event(p_name, p_detail, p_device, p_ref, p_visitor, p_trip, p_city, p_country, p_region, p_os, p_browser,
                             null::text, null::text);
end;
$$;
revoke all on function public.track_event(text, text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.track_event(text, text, text, text, text, text, text, text, text, text, text) to anon, authenticated;

-- the first version (supabase/saas-5.sql, the app's direct fallback): same signature and defaults, same list, and its
-- own limits kept as in saas-6.sql (2,000 steps a day per account or device, 200,000 for the whole service)
create or replace function public.track_event(p_name text, p_detail text default null, p_device text default null, p_ref text default null,
                                              p_visitor text default null, p_trip text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v text := nullif(left(regexp_replace(coalesce(p_visitor, ''), '[^a-zA-Z0-9-]', '', 'g'), 40), '');
begin
  if (select count(*) from public.events where at > now() - interval '1 day'
      and ((auth.uid() is not null and user_id = auth.uid()) or (auth.uid() is null and v is not null and visitor = v))) >= 2000
     or (select count(*) from public.events where at > now() - interval '1 day') >= 200000 then
    return;
  end if;
  perform public.track_event(p_name, p_detail, p_device, p_ref, p_visitor, p_trip, null::text, null::text, null::text, null::text, null::text,
                             null::text, null::text);
end;
$$;
revoke all on function public.track_event(text, text, text, text, text, text) from public;
grant execute on function public.track_event(text, text, text, text, text, text) to anon, authenticated;

-- 4. an invitation accepted: someone joins a trip by themselves (accept_invites, a join link), never its owner ------
-- by_user = who invited them (the invitation), else the trip's owner. Written once per person and trip. Whatever
-- happens here, the join itself goes through (any error is ignored, the row is never changed).
create or replace function public.log_invite_accepted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inviter uuid;
begin
  begin
    if auth.uid() is null or new.user_id is distinct from auth.uid() or new.role = 'owner' then return new; end if;
    select i.invited_by into inviter
    from public.trip_invites i join auth.users u on lower(u.email) = lower(i.email)
    where i.trip_id = new.trip_id and u.id = new.user_id
    limit 1;
    if inviter is null then select t.owner into inviter from public.trips t where t.id = new.trip_id; end if;
    if inviter = new.user_id then inviter := null; end if;
    insert into public.events (user_id, name, detail, trip_id, src, by_user)
    select new.user_id, 'invite_accepted', new.role, left(new.trip_id, 64), 'invite', inviter
    where not exists (select 1 from public.events e where e.user_id = new.user_id and e.trip_id = left(new.trip_id, 64) and e.name = 'invite_accepted')
    on conflict do nothing;
  exception when others then
    null;
  end;
  return new;
end;
$$;
drop trigger if exists trip_members_invite_accepted on public.trip_members;
create trigger trip_members_invite_accepted after insert on public.trip_members for each row execute function public.log_invite_accepted();

-- 5. the admin's views ----------------------------------------------------------------------------------------------
-- (internal) when an account validated its first trip: the step, else a trip it owns marked done (a copied public
-- programme is marked done at once: never counted as validated)
create or replace function public.m_validated_at(p_user uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select least(
    (select min(e.at) from public.events e where e.user_id = p_user and e.name = 'trip_validated'),
    (select min(to_timestamp((t.data -> 'draft' ->> 'doneAt')::double precision / 1000)) from public.trips t
     where t.owner = p_user and coalesce(t.data ->> 'deleted', 'false') <> 'true'
       and coalesce(t.data -> 'draft' ->> 'copiedFrom', '') = ''
       and (t.data -> 'draft' ->> 'doneAt') ~ '^[0-9]{10,14}(\.[0-9]+)?$'));
$$;
-- (internal) when its first programme was ready (server preparations)
create or replace function public.m_ready_at(p_user uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select min(e.at) from public.events e where e.user_id = p_user and e.name = 'prep_ready';
$$;
revoke all on function public.m_validated_at(uuid) from public, anon, authenticated;
revoke all on function public.m_ready_at(uuid) from public, anon, authenticated;

-- the path by sign-up period (Paris time): visit → sign-up → e-mail confirmed → welcome done → preparation started →
-- ready → trip validated → second trip; activation (validated within 7 days), median time to the first programme,
-- back after 7 / 30 days. `suggest`: week once there are more than ~50 sign-ups a week; `since`: first new step names.
create or replace function public.admin_cohorts(p_unit text default 'month', p_periods int default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  u text := case when p_unit = 'week' then 'week' else 'month' end;
  n int := greatest(1, least(coalesce(p_periods, 12), 60));
  step interval := case when p_unit = 'week' then interval '1 week' else interval '1 month' end;
  last_p timestamp;
  first_p timestamp;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  last_p := date_trunc(u, now() at time zone 'Europe/Paris');
  first_p := last_p - step * (n - 1);
  return jsonb_build_object(
    'unit', u,
    'suggest', case when (select count(*) from auth.users where created_at > now() - interval '28 days') > 200 then 'week' else 'month' end,
    'since', coalesce((select jsonb_object_agg(x.name, x.m) from (
                select e.name, min(e.at) as m from public.events e
                where e.name in ('signup_submitted', 'onboarding_done', 'prep_started') group by e.name) x), '{}'::jsonb),
    'periods', coalesce((
      with acc as (
        select x.id, x.created_at, x.email_confirmed_at, date_trunc(u, x.created_at at time zone 'Europe/Paris') as p
        from auth.users x
        where x.created_at at time zone 'Europe/Paris' >= first_p
      ), f as (
        select a.id, a.p, a.created_at, a.email_confirmed_at is not null as confirmed,
               (exists (select 1 from public.profiles pr where pr.id = a.id and pr.data ? 'onboardedAt')
                or exists (select 1 from public.events e where e.user_id = a.id and e.name = 'onboarding_done')) as onboarded,
               (exists (select 1 from public.events e where e.user_id = a.id and e.name = 'prep_started')
                or exists (select 1 from public.trips t where t.owner = a.id and jsonb_typeof(t.data -> 'draft') = 'object'
                           and coalesce(t.data ->> 'deleted', 'false') <> 'true')) as started,
               (exists (select 1 from public.events e where e.user_id = a.id and e.name = 'prep_ready')
                or exists (select 1 from public.trips t where t.owner = a.id and t.data -> 'draft' ->> 'status' in ('review', 'done')
                           and coalesce(t.data ->> 'deleted', 'false') <> 'true')) as ready,
               public.m_validated_at(a.id) as validated_at,
               public.m_ready_at(a.id) as ready_at,
               (select count(*) from public.trips t where t.owner = a.id and coalesce(t.data ->> 'deleted', 'false') <> 'true') as trips,
               exists (select 1 from public.events e where e.user_id = a.id and e.name in ('app_open', 'trip_opened', 'sign_in')
                       and e.at >= a.created_at + interval '7 days') as back7,
               exists (select 1 from public.events e where e.user_id = a.id and e.name in ('app_open', 'trip_opened', 'sign_in')
                       and e.at >= a.created_at + interval '30 days') as back30
        from acc a
      ), vis as (
        -- a person (account, else device) counts in the period of their first visit
        select date_trunc(u, min(e.at) at time zone 'Europe/Paris') as p
        from public.events e
        where e.name in ('visit', 'public_view') and coalesce(e.user_id::text, e.visitor) is not null
        group by coalesce(e.user_id::text, e.visitor)
      ), per as (
        select g.p,
               count(f.id) as signups,
               count(f.id) filter (where f.confirmed) as confirmed,
               count(f.id) filter (where f.onboarded) as onboarded,
               count(f.id) filter (where f.started) as started,
               count(f.id) filter (where f.ready) as ready,
               count(f.id) filter (where f.validated_at is not null) as validated,
               count(f.id) filter (where f.trips >= 2) as second_trip,
               count(f.id) filter (where f.validated_at <= f.created_at + interval '7 days') as activated,
               count(f.id) filter (where f.ready_at is not null) as ready_n,
               percentile_cont(0.5) within group (order by extract(epoch from f.ready_at - f.created_at)::double precision)
                 filter (where f.ready_at is not null) as median_s,
               count(f.id) filter (where f.created_at <= now() - interval '7 days') as back7_of,
               count(f.id) filter (where f.created_at <= now() - interval '7 days' and f.back7) as back7,
               count(f.id) filter (where f.created_at <= now() - interval '30 days') as back30_of,
               count(f.id) filter (where f.created_at <= now() - interval '30 days' and f.back30) as back30
        from generate_series(first_p, last_p, step) as g(p)
        left join f on f.p = g.p
        group by g.p
      )
      select jsonb_agg(jsonb_build_object(
               'start', to_char(r.p, 'YYYY-MM-DD'),
               'visits', (select count(*) from vis where vis.p = r.p),
               'signups', r.signups, 'confirmed', r.confirmed, 'onboarded', r.onboarded, 'started', r.started,
               'ready', r.ready, 'validated', r.validated, 'second', r.second_trip, 'activated', r.activated,
               'readyN', r.ready_n, 'medianS', case when r.median_s is null then null else round(r.median_s::numeric) end,
               'back7', r.back7, 'back7Of', r.back7_of, 'back30', r.back30, 'back30Of', r.back30_of)
             order by r.p desc)
      from per r), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.admin_cohorts(text, int) from public, anon;
grant execute on function public.admin_cohorts(text, int) to authenticated;

-- the sources over the last days: per channel, people who came (visits), sign-ups (the account's first source),
-- activations among them, accounts brought back; and the 10 people whose shared links brought the most visits
create or replace function public.admin_channels(p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  d int := greatest(1, least(coalesce(p_days, 30), 400));
  since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 400)));
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'days', d,
    'channels', coalesce((
      with firsts as (
        select x.id, x.created_at,
               (select e.src from public.events e where e.user_id = x.id and e.src is not null and e.at <= x.created_at + interval '1 day'
                order by e.at limit 1) as src
        from auth.users x
        where x.created_at > since
      ), sig as (
        select f.src, count(*) as signups,
               count(*) filter (where public.m_validated_at(f.id) <= f.created_at + interval '7 days') as activations
        from firsts f where f.src is not null group by f.src
      ), vis as (
        select e.src, count(distinct coalesce(e.user_id::text, e.visitor)) filter (where e.by_user is null or e.user_id is distinct from e.by_user) as visits
        from public.events e where e.src is not null and e.at > since group by e.src
      ), ret as (
        select e.src, count(distinct e.user_id) as back
        from public.events e join auth.users x on x.id = e.user_id
        where e.src is not null and e.at > since and e.at > x.created_at + interval '1 day'
        group by e.src
      ), k as (
        select src from vis union select src from sig union select src from ret
      )
      select jsonb_agg(jsonb_build_object('src', k.src, 'visits', coalesce(v.visits, 0), 'signups', coalesce(s.signups, 0),
                                          'activations', coalesce(s.activations, 0), 'returns', coalesce(r.back, 0))
                       order by coalesce(v.visits, 0) desc, coalesce(s.signups, 0) desc, k.src)
      from k left join vis v on v.src = k.src left join sig s on s.src = k.src left join ret r on r.src = k.src), '[]'::jsonb),
    'sharers', coalesce((
      select jsonb_agg(jsonb_build_object('name', coalesce(nullif(pr.data ->> 'name', ''), split_part(u.email::text, '@', 1)),
                                          'email', u.email::text, 'visits', s.visits, 'signups', s.signups)
                       order by s.visits desc, s.signups desc)
      from (
        select e.by_user,
               -- the sharer opening their own link (signed out, then linked to their account) is not their own visit
               count(distinct coalesce(e.user_id::text, e.visitor)) filter (where e.user_id is distinct from e.by_user) as visits,
               count(distinct e.user_id) filter (where x.created_at > since and e.user_id <> e.by_user) as signups
        from public.events e left join auth.users x on x.id = e.user_id
        where e.by_user is not null and e.at > since
        group by e.by_user
        order by 2 desc, 3 desc
        limit 10
      ) s
      join auth.users u on u.id = s.by_user
      left join public.profiles pr on pr.id = s.by_user), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.admin_channels(int) from public, anon;
grant execute on function public.admin_channels(int) to authenticated;

-- one account: its first source (and when), who referred it, every source it came through
create or replace function public.admin_user_sources(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'firstSrc', (select e.src from public.events e where e.user_id = p_user and e.src is not null order by e.at limit 1),
    'firstSrcAt', (select e.at from public.events e where e.user_id = p_user and e.src is not null order by e.at limit 1),
    'referredBy', (select jsonb_build_object('email', u.email::text, 'name', coalesce(pr.data ->> 'name', ''))
                   from public.events e join auth.users u on u.id = e.by_user left join public.profiles pr on pr.id = e.by_user
                   where e.user_id = p_user and e.by_user is not null and e.by_user <> p_user
                   order by e.at limit 1),
    'srcs', coalesce((select jsonb_object_agg(x.src, x.n) from (
               select e.src, count(*) as n from public.events e where e.user_id = p_user and e.src is not null group by e.src) x), '{}'::jsonb)
  );
end;
$$;
revoke all on function public.admin_user_sources(uuid) from public, anon;
grant execute on function public.admin_user_sources(uuid) to authenticated;

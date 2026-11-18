-- ORBES Trips — usage, account by account (SaaS, lot 6b, Nov 2026).
-- Run once AFTER saas-4.sql, in the Supabase SQL editor: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to run twice.
--
-- Every step of a person's use is recorded: before signing up, under a random identifier kept on the device
-- (the "visitor"); once signed in, under the account, and the visitor's earlier steps are attached to it.
-- Read only by the admin, in the admin screen (global figures and one sheet per account).

-- 0. the previous file must have run first
do $$
begin
  perform 'public.is_admin()'::regprocedure;
exception when undefined_function then
  raise exception 'Lancez d''abord supabase/saas-4.sql, puis ce fichier.';
end $$;

create table if not exists public.events (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete cascade,
  visitor text,
  name    text not null,
  detail  text,
  trip_id text,
  device  text,
  ref     text
);
create index if not exists events_at on public.events (at desc);
create index if not exists events_user on public.events (user_id, at desc);
create index if not exists events_visitor on public.events (visitor);
alter table public.events enable row level security;
-- no policy: written only by track_event / link_visitor, read only by the admin functions

-- one step; the account is the signed-in one (never sent by the app), the visitor is the device's random id
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
  if p_name not in ('visit', 'signup_email', 'signup_done', 'sign_in', 'app_open', 'trip_created', 'trip_opened', 'trip_validated',
                    'place_added', 'invite_sent', 'export', 'pro_screen', 'code_redeemed', 'waitlist_join') then
    return;
  end if;
  -- limits: 2,000 steps a day per account or device, 200,000 for the whole service
  if (select count(*) from public.events where at > now() - interval '1 day'
      and ((auth.uid() is not null and user_id = auth.uid()) or (auth.uid() is null and v is not null and visitor = v))) >= 2000
     or (select count(*) from public.events where at > now() - interval '1 day') >= 200000 then
    return;
  end if;
  insert into public.events (user_id, visitor, name, detail, trip_id, device, ref)
  values (auth.uid(), v, p_name,
          nullif(left(regexp_replace(coalesce(p_detail, ''), '[^a-zA-Z0-9_-]', '', 'g'), 40), ''),
          nullif(left(coalesce(p_trip, ''), 64), ''),
          case when p_device in ('phone', 'computer') then p_device end,
          nullif(left(regexp_replace(lower(coalesce(p_ref, '')), '[^a-z0-9.-]', '', 'g'), 80), ''));
  -- steps older than 13 months are not kept
  delete from public.events where id in (select id from public.events where at < now() - interval '13 months' order by id limit 100);
end;
$$;
revoke all on function public.track_event(text, text, text, text, text, text) from public;
grant execute on function public.track_event(text, text, text, text, text, text) to anon, authenticated;

-- after signing in: the steps this device made before (not yet attached to anyone) become the account's
create or replace function public.link_visitor(p_visitor text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.events set user_id = auth.uid()
  where auth.uid() is not null and visitor = nullif(left(regexp_replace(coalesce(p_visitor, ''), '[^a-zA-Z0-9-]', '', 'g'), 40), '')
    and user_id is null;
$$;
revoke all on function public.link_visitor(text) from public, anon;
grant execute on function public.link_visitor(text) to authenticated;

-- the admin's global figures: each step over 30 days (and the 30 before), people behind them, phones / computers,
-- where visitors came from, why the Pro screen opened
create or replace function public.admin_funnel()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'steps', coalesce((
      select jsonb_object_agg(name, jsonb_build_object('now', n30, 'before', p30, 'people', u30))
      from (select name,
                   count(*) filter (where at > now() - interval '30 days') n30,
                   count(*) filter (where at <= now() - interval '30 days' and at > now() - interval '60 days') p30,
                   count(distinct coalesce(user_id::text, visitor)) filter (where at > now() - interval '30 days') u30
            from public.events where at > now() - interval '60 days' group by name) s), '{}'::jsonb),
    'active', (select count(distinct user_id) from public.events where user_id is not null and at > now() - interval '30 days'),
    'active7', (select count(distinct user_id) from public.events where user_id is not null and at > now() - interval '7 days'),
    'phones', (select count(*) from public.events where name = 'visit' and device = 'phone' and at > now() - interval '30 days'),
    'computers', (select count(*) from public.events where name = 'visit' and device = 'computer' and at > now() - interval '30 days'),
    'refs', coalesce((
      select jsonb_agg(jsonb_build_object('ref', ref, 'n', n) order by n desc)
      from (select ref, count(*) n from public.events
            where name = 'visit' and ref is not null and at > now() - interval '30 days'
            group by ref order by count(*) desc limit 8) r), '[]'::jsonb),
    'pro', coalesce((
      select jsonb_object_agg(coalesce(detail, 'info'), n)
      from (select detail, count(*) n from public.events where name = 'pro_screen' and at > now() - interval '30 days' group by detail) p), '{}'::jsonb)
  );
end;
$$;
revoke all on function public.admin_funnel() from public, anon;
grant execute on function public.admin_funnel() to authenticated;

-- one account's sheet: profile, plan, trips, AI use, where they came from, every step (latest 200)
create or replace function public.admin_user(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return (
    select jsonb_build_object(
      'email', u.email, 'created_at', u.created_at, 'last_seen', u.last_sign_in_at, 'confirmed', u.email_confirmed_at is not null,
      'profile', coalesce((select p.data from public.profiles p where p.id = u.id), '{}'::jsonb),
      'pro', public.is_pro_user(u.id),
      'grant', (select jsonb_build_object('until', g.until, 'source', g.source) from public.pro_grants g where g.user_id = u.id),
      'admin', exists (select 1 from public.admins a where a.user_id = u.id),
      'waitlisted', exists (select 1 from public.waitlist w where w.user_id = u.id),
      'trips', coalesce((
        select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.data ->> 'title', 'dates', t.data ->> 'dateLabel', 'role', m.role,
                                            'status', coalesce(t.data -> 'draft' ->> 'status', ''), 'created_at', t.created_at,
                                            'places', (select count(*) from public.places pl where pl.trip_id = t.id))
                         order by t.created_at desc)
        from public.trip_members m join public.trips t on t.id = m.trip_id where m.user_id = u.id), '[]'::jsonb),
      'ai', jsonb_build_object(
        'calls30', (select count(*) from public.ai_usage x where x.user_id = u.id and x.at > now() - interval '30 days'),
        'usd30', (select coalesce(sum(usd), 0) from public.ai_usage x where x.user_id = u.id and x.at > now() - interval '30 days'),
        'calls', (select count(*) from public.ai_usage x where x.user_id = u.id),
        'usd', (select coalesce(sum(usd), 0) from public.ai_usage x where x.user_id = u.id),
        'tasks', coalesce((select jsonb_object_agg(task, n) from (select task, count(*) n from public.ai_usage x where x.user_id = u.id group by task) k), '{}'::jsonb)),
      'firstSeen', (select min(at) from public.events e where e.user_id = u.id),
      'firstRef', (select e.ref from public.events e where e.user_id = u.id and e.name = 'visit' and e.ref is not null order by e.at limit 1),
      'visitsBefore', (select count(*) from public.events e where e.user_id = u.id and e.name = 'visit' and e.at < u.created_at),
      'counts', coalesce((select jsonb_object_agg(name, n) from (select name, count(*) n from public.events e where e.user_id = u.id group by name) c), '{}'::jsonb),
      'events', coalesce((
        select jsonb_agg(jsonb_build_object('at', e.at, 'name', e.name, 'detail', e.detail, 'device', e.device, 'trip', e.trip_id, 'ref', e.ref) order by e.at desc)
        from (select * from public.events e where e.user_id = u.id order by e.at desc limit 200) e), '[]'::jsonb)
    )
    from auth.users u where u.id = p_user
  );
end;
$$;
revoke all on function public.admin_user(uuid) from public, anon;
grant execute on function public.admin_user(uuid) to authenticated;

-- the accounts list also says when each person was last active (any step) and how many steps in 30 days
drop function if exists public.admin_accounts(text);
create function public.admin_accounts(p_search text default null)
returns table (user_id uuid, email text, name text, created_at timestamptz, last_seen timestamptz,
               pro boolean, until timestamptz, granted boolean, admin boolean, trips int, ai30 int, waitlisted boolean,
               last_active timestamptz, steps30 int)
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
         exists (select 1 from public.waitlist w where w.user_id = u.id),
         (select max(e.at) from public.events e where e.user_id = u.id),
         (select count(*)::int from public.events e where e.user_id = u.id and e.at > now() - interval '30 days')
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join public.pro_grants g on g.user_id = u.id
  where p_search is null or p_search = '' or u.email ilike '%' || p_search || '%' or (p.data ->> 'name') ilike '%' || p_search || '%'
  order by coalesce((select max(e.at) from public.events e where e.user_id = u.id), u.created_at) desc
  limit 300;
end;
$$;
revoke all on function public.admin_accounts(text) from public, anon;
grant execute on function public.admin_accounts(text) to authenticated;

-- ORBES Trips — lot « acquisition » (R07 · R08 · R10 · R14), Nov 2026.
-- Paste in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run). Safe to run twice, and in any
-- order with saas-12.sql, saas-13.sql and saas-14.sql. Nothing breaks before it runs: the app falls back to today's
-- behaviour (the new steps are simply not recorded, the cron reads the accounts through the Auth admin API).
--
-- 1. event_names + track_step: the steps added by this lot are recorded without rewriting track_event (each lot's
--    file rewrites track_event with its own fixed list; this one never touches it).
-- 2. unconfirmed_signups: the accounts that never confirmed their address, for the single reminder of api/cron.ts
--    (service role only).
-- 3. admin_link_funnel: for each public link, views → link previews → copy clicks → sign-ups → confirmed → copies,
--    credited to its owner (admin only, readable from the SQL editor: select * from public.admin_link_funnel(30);).

-- 0. the earlier files must have run first (events with its place columns, the admin check, public links)
do $$
begin
  perform 'public.events'::regclass;
  perform 'public.is_admin()'::regprocedure;
  perform 'public.trip_links'::regclass;
  perform 'public.alert_log'::regclass;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'events' and column_name = 'browser') then
    raise exception 'missing column';
  end if;
exception when undefined_table or undefined_function or raise_exception then
  raise exception 'Lancez d''abord supabase/saas-5.sql, saas-6.sql, saas-7.sql et saas-8.sql, puis ce fichier.';
end $$;

-- 1. the names track_step accepts (one row per name; a later lot adds its own rows, nothing is rewritten)
create table if not exists public.event_names (
  name     text primary key check (name ~ '^[a-z_]{2,40}$'),
  lot      text,
  added_at timestamptz not null default now()
);
alter table public.event_names enable row level security;
-- no policy: read only by track_step (security definer) and the SQL editor
revoke all on table public.event_names from anon, authenticated;
insert into public.event_names (name, lot) values
  ('check_email_shown', 'acquisition'),
  ('confirm_resent', 'acquisition'),
  ('confirm_screen', 'acquisition'),
  ('landing_destination', 'acquisition'),
  ('intent_applied', 'acquisition'),
  ('public_copy_click', 'acquisition'),
  ('link_preview', 'acquisition'),
  ('app_redirect', 'acquisition')
on conflict (name) do nothing;

-- one step, like track_event (same cleaning, same daily limits, same 13-month clean-up), for the names of event_names
create or replace function public.track_step(p_name text, p_detail text default null, p_device text default null, p_ref text default null,
                                             p_visitor text default null, p_trip text default null,
                                             p_city text default null, p_country text default null, p_region text default null,
                                             p_os text default null, p_browser text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v text := nullif(left(regexp_replace(coalesce(p_visitor, ''), '[^a-zA-Z0-9-]', '', 'g'), 40), '');
  clean text := '[[:cntrl:]<>"{}\\]';
begin
  if not exists (select 1 from public.event_names n where n.name = p_name) then
    return;
  end if;
  if (select count(*) from public.events where at > now() - interval '1 day'
      and ((auth.uid() is not null and user_id = auth.uid()) or (auth.uid() is null and v is not null and visitor = v))) >= 5000
     or (select count(*) from public.events where at > now() - interval '1 day') >= 500000 then
    return;
  end if;
  insert into public.events (user_id, visitor, name, detail, trip_id, device, ref, city, country, region, os, browser)
  values (auth.uid(), v, p_name,
          nullif(left(regexp_replace(coalesce(p_detail, ''), '[^a-zA-Z0-9_-]', '', 'g'), 40), ''),
          nullif(left(coalesce(p_trip, ''), 64), ''),
          case when p_device in ('phone', 'computer') then p_device end,
          nullif(left(regexp_replace(lower(coalesce(p_ref, '')), '[^a-z0-9.-]', '', 'g'), 80), ''),
          nullif(left(regexp_replace(coalesce(p_city, ''), clean, '', 'g'), 80), ''),
          nullif(upper(left(regexp_replace(coalesce(p_country, ''), '[^A-Za-z]', '', 'g'), 2)), ''),
          nullif(left(regexp_replace(coalesce(p_region, ''), clean, '', 'g'), 80), ''),
          nullif(left(regexp_replace(coalesce(p_os, ''), clean, '', 'g'), 30), ''),
          nullif(left(regexp_replace(coalesce(p_browser, ''), clean, '', 'g'), 30), ''));
  delete from public.events where id in (select id from public.events where at < now() - interval '13 months' order by id limit 100);
end;
$$;
revoke all on function public.track_step(text, text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.track_step(text, text, text, text, text, text, text, text, text, text, text) to anon, authenticated;

-- 2. accounts created between p_min_hours and p_max_hours ago that never confirmed their address (api/cron.ts sends
--    them the same confirmation e-mail once again). Never callable from the app.
create or replace function public.unconfirmed_signups(p_min_hours int default 2, p_max_hours int default 36, p_limit int default 50)
returns table (id uuid, email text, lang text, created_at timestamptz, confirmation_sent_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.email::text, coalesce(u.raw_user_meta_data ->> 'lang', 'fr'), u.created_at, u.confirmation_sent_at
  from auth.users u
  where u.email_confirmed_at is null
    and u.deleted_at is null
    and coalesce(u.is_anonymous, false) = false
    and u.email is not null
    -- an account invited or created by hand never asked for a « Confirm signup » e-mail
    and u.invited_at is null
    -- already reminded (or tried) once: never in the list again, so newer sign-ups are never pushed out by the limit
    and not exists (select 1 from public.alert_log a where a.key = 'confirm:' || u.id::text)
    -- its last confirmation e-mail left less than 2 hours ago (« Renvoyer l'e-mail »): not yet
    and (u.confirmation_sent_at is null or u.confirmation_sent_at <= now() - interval '2 hours')
    and u.created_at <= now() - make_interval(hours => greatest(0, least(p_min_hours, 720)))
    and u.created_at >= now() - make_interval(hours => greatest(1, least(p_max_hours, 720)))
  order by u.created_at
  limit greatest(1, least(p_limit, 200));
$$;
revoke all on function public.unconfirmed_signups(int, int, int) from public, anon, authenticated;
grant execute on function public.unconfirmed_signups(int, int, int) to service_role;

-- 3. each public link's way to new accounts, over the last p_days days (admin only)
create or replace function public.admin_link_funnel(p_days int default 30)
returns table (slug text, trip_id text, title text, owner_email text, active boolean, views bigint, previews bigint,
               copy_clicks bigint, signups bigint, confirmed bigint, copies bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  since timestamptz := now() - make_interval(days => greatest(1, least(p_days, 400)));
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
  select l.slug, l.trip_id, coalesce(t.data ->> 'title', l.trip_id), o.email::text, l.active,
         (select count(*) from public.events e where e.name = 'public_view' and e.detail = l.slug and e.at > since),
         (select count(*) from public.events e where e.name = 'link_preview' and e.detail = l.slug and e.at > since),
         (select count(*) from public.events e where e.name = 'public_copy_click' and e.detail = l.slug and e.at > since),
         (select count(*) from auth.users u where u.raw_user_meta_data #>> '{intent,copy}' = l.slug and u.created_at > since),
         (select count(*) from auth.users u where u.raw_user_meta_data #>> '{intent,copy}' = l.slug and u.created_at > since and u.email_confirmed_at is not null),
         (select count(*) from public.events e where e.name = 'trip_copied' and e.detail = l.slug and e.at > since)
  from public.trip_links l
  left join public.trips t on t.id = l.trip_id
  left join auth.users o on o.id = l.created_by
  order by 6 desc, 1;
end;
$$;
revoke all on function public.admin_link_funnel(int) from public, anon;
grant execute on function public.admin_link_funnel(int) to authenticated;

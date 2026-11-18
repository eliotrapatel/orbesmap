-- ORBES Trips — traveller profiles, personas and partner exports (lot 7, Nov 2026).
-- Run once AFTER saas-7.sql, in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run).
-- Safe to run twice.
--
-- Every visit also records the approximate city and country (from the connection, added by api/track on Vercel),
-- the phone's system and browser. The admin reads, per person and for everyone: trips, destinations, spending per
-- category (in euros), flights, hotels, kinds of places, cities and devices; and exports it for partners
-- (people who switched off partner offers in their account are left out of the export).

-- 0. the previous file must have run first
do $$
begin
  perform 'public.my_inbound_token()'::regprocedure;
exception when undefined_function then
  raise exception 'Lancez d''abord supabase/saas-7.sql, puis ce fichier.';
end $$;

-- 1. Where and on what each step happened
alter table public.events add column if not exists city text;
alter table public.events add column if not exists country text;
alter table public.events add column if not exists region text;
alter table public.events add column if not exists os text;
alter table public.events add column if not exists browser text;

-- the same step function, with the place and the device (sent by api/track, which reads them from the connection)
create or replace function public.track_event(p_name text, p_detail text, p_device text, p_ref text, p_visitor text, p_trip text,
                                              p_city text, p_country text, p_region text, p_os text, p_browser text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v text := nullif(left(regexp_replace(coalesce(p_visitor, ''), '[^a-zA-Z0-9-]', '', 'g'), 40), '');
  clean text := '[[:cntrl:]<>"{}\\]';
begin
  if p_name not in ('visit', 'signup_email', 'signup_done', 'sign_in', 'app_open', 'trip_created', 'trip_opened', 'trip_validated',
                    'place_added', 'invite_sent', 'export', 'pro_screen', 'code_redeemed', 'waitlist_join',
                    'link_opened', 'public_view', 'trip_copied', 'expense_added') then
    return;
  end if;
  if (select count(*) from public.events where at > now() - interval '1 day'
      and ((auth.uid() is not null and user_id = auth.uid()) or (auth.uid() is null and v is not null and visitor = v))) >= 2000
     or (select count(*) from public.events where at > now() - interval '1 day') >= 200000 then
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
revoke all on function public.track_event(text, text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.track_event(text, text, text, text, text, text, text, text, text, text, text) to anon, authenticated;

-- 2. Everything known about each person (all accounts, or one with p_user), for the admin's profiles, personas and exports
create or replace function public.admin_people(p_user uuid default null)
returns table (user_id uuid, email text, created_at timestamptz, last_seen timestamptz, profile jsonb, trips jsonb, spend jsonb,
               expenses int, flights jsonb, hotels jsonb, places jsonb, seen jsonb, pro boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
  with mine as (
    select m.user_id as uid, t.id as tid, t.data as td
    from public.trip_members m join public.trips t on t.id = m.trip_id
    where t.id not in ('sha-2026', 'gz-2026') and (p_user is null or m.user_id = p_user)
  ),
  exp as (
    select mi.uid, coalesce(nullif(s.data ->> 'category', ''), 'other') as cat,
           case when s.data ->> 'eur' ~ '^-?\d+(\.\d+)?$' then (s.data ->> 'eur')::numeric
                when s.data ->> 'currency' = 'EUR' and s.data ->> 'amount' ~ '^-?\d+(\.\d+)?$' then (s.data ->> 'amount')::numeric else 0 end as eur
    from mine mi join public.place_states s on s.trip_id = mi.tid
    where s.place_id like '\_exp:%' and coalesce(s.data ->> 'deleted', 'false') <> 'true'
  )
  select u.id, u.email::text, u.created_at, u.last_sign_in_at,
         coalesce(p.data, '{}'::jsonb) - 'fieldsAt',
         coalesce((select jsonb_agg(jsonb_build_object('id', mi.tid, 'title', mi.td ->> 'title', 'country', mi.td ->> 'country',
                   'start', mi.td ->> 'start', 'end', mi.td ->> 'end', 'mode', coalesce(mi.td ->> 'mode', 'leisure'),
                   'days', case when mi.td ->> 'start' ~ '^\d{4}-\d{2}-\d{2}$' and mi.td ->> 'end' ~ '^\d{4}-\d{2}-\d{2}$'
                                then greatest(1, ((mi.td ->> 'end')::date - (mi.td ->> 'start')::date) + 1) else 1 end,
                   'travellers', jsonb_array_length(coalesce(mi.td -> 'travellers', '[]'::jsonb))))
                   from mine mi where mi.uid = u.id), '[]'::jsonb),
         coalesce((select jsonb_object_agg(cat, round(total, 2)) from (select e.cat, sum(e.eur) as total from exp e where e.uid = u.id group by e.cat) x), '{}'::jsonb),
         (select count(*)::int from exp e where e.uid = u.id),
         coalesce((select jsonb_agg(f || jsonb_build_object('trip', mi.tid)) from mine mi, jsonb_array_elements(coalesce(mi.td -> 'flights', '[]'::jsonb)) f where mi.uid = u.id), '[]'::jsonb),
         coalesce((select jsonb_agg((mi.td -> 'hotel') || jsonb_build_object('trip', mi.tid, 'country', mi.td ->> 'country')) from mine mi where mi.uid = u.id and mi.td -> 'hotel' is not null), '[]'::jsonb),
         coalesce((select jsonb_object_agg(typ, n) from (
                   select coalesce(pl.data ->> 'type', 'ajout') as typ, count(*) as n from mine mi join public.places pl on pl.trip_id = mi.tid
                   where mi.uid = u.id and coalesce(pl.data ->> 'deleted', 'false') <> 'true' group by 1) y), '{}'::jsonb),
         jsonb_build_object(
           'cities', coalesce((select jsonb_agg(jsonb_build_object('city', c.city, 'country', c.country, 'n', c.n) order by c.n desc) from (
                     select ev.city, ev.country, count(*) as n from public.events ev where ev.user_id = u.id and ev.city is not null group by 1, 2 order by 3 desc limit 5) c), '[]'::jsonb),
           'os', coalesce((select jsonb_object_agg(o.os, o.n) from (select ev.os, count(*) as n from public.events ev where ev.user_id = u.id and ev.os is not null group by 1) o), '{}'::jsonb),
           'browsers', coalesce((select jsonb_object_agg(b.browser, b.n) from (select ev.browser, count(*) as n from public.events ev where ev.user_id = u.id and ev.browser is not null group by 1) b), '{}'::jsonb),
           'firstRef', (select ev.ref from public.events ev where ev.user_id = u.id and ev.ref is not null order by ev.at limit 1),
           'steps', (select count(*) from public.events ev where ev.user_id = u.id)
         ),
         public.is_pro_user(u.id)
  from auth.users u
  left join public.profiles p on p.id = u.id
  where p_user is null or u.id = p_user
  order by u.created_at desc
  limit 2000;
end;
$$;
revoke all on function public.admin_people(uuid) from public, anon;
grant execute on function public.admin_people(uuid) to authenticated;

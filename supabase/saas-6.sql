-- ORBES Trips — public link of a trip's programme, and copying it (SaaS, lot 6c, Nov 2026).
-- Run once AFTER saas-5.sql, in the Supabase SQL editor: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to run twice.
--
-- The owner of a trip can open a public link (theorbes.com/maps?t=…): anyone who has it sees the programme,
-- read only and without an account — days, places, times and their sheets. Never shown: the hotel, flights,
-- bookings, notes, statuses, photos, contacts, check-list, emergency details or the travellers.

-- 0. the previous file must have run first
do $$
begin
  perform 'public.link_visitor(text)'::regprocedure;
exception when undefined_function then
  raise exception 'Lancez d''abord supabase/saas-5.sql, puis ce fichier.';
end $$;

create table if not exists public.trip_links (
  trip_id    text primary key references public.trips (id) on delete cascade,
  slug       text not null unique check (slug ~ '^[a-z0-9]{10,24}$'),
  active     boolean not null default true,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.trip_links enable row level security;
drop policy if exists "links read" on public.trip_links;
create policy "links read" on public.trip_links for select to authenticated using ((select public.can_manage_trip(trip_id)));
-- written only by the two functions below

-- the owner opens (or reopens) the trip's public link; returns its slug
create or replace function public.open_trip_link(p_trip text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  s text;
begin
  if p_trip in ('sha-2026', 'gz-2026') or not public.can_manage_trip(p_trip) then
    raise exception 'owner only' using errcode = '42501';
  end if;
  select slug into s from public.trip_links where trip_id = p_trip;
  if s is null then
    s := substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 14);
    insert into public.trip_links (trip_id, slug) values (p_trip, s);
  else
    update public.trip_links set active = true where trip_id = p_trip;
  end if;
  return s;
end;
$$;
-- the owner closes it (the same link works again if reopened)
create or replace function public.close_trip_link(p_trip text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_manage_trip(p_trip) then raise exception 'owner only' using errcode = '42501'; end if;
  update public.trip_links set active = false where trip_id = p_trip;
end;
$$;

-- what anyone with the link sees: the programme only (allowed fields of the trip and of its places)
create or replace function public.public_trip(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'trip', (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(t.data) as e(k, v)
             where k in ('code', 'title', 'subtitle', 'dateLabel', 'start', 'end', 'timezone', 'country', 'lang', 'center', 'days')),
    'places', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.place_id) || (
               select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(p.data) as f(k, v)
               where k in ('name', 'nameCn', 'address', 'addressCn', 'lat', 'lng', 'type', 'day', 'slot', 'duration', 'order',
                           'desc', 'why', 'highlights', 'tip', 'metro', 'website', 'hours', 'hoursText', 'price', 'source')))
      from public.places p
      where p.trip_id = t.id
        and coalesce(p.data ->> 'deleted', 'false') <> 'true' and coalesce(p.data ->> 'removed', 'false') <> 'true'
        and coalesce(p.data ->> 'type', '') <> 'hotel'), '[]'::jsonb)
  )
  from public.trip_links l join public.trips t on t.id = l.trip_id
  where l.slug = lower(p_slug) and l.active;
$$;
revoke all on function public.open_trip_link(text) from public, anon;
revoke all on function public.close_trip_link(text) from public, anon;
revoke all on function public.public_trip(text) from public;
grant execute on function public.open_trip_link(text) to authenticated;
grant execute on function public.close_trip_link(text) to authenticated;
grant execute on function public.public_trip(text) to anon, authenticated;

-- the steps of this lot are recorded too (same function as saas-5.sql, three more steps)
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
                    'place_added', 'invite_sent', 'export', 'pro_screen', 'code_redeemed', 'waitlist_join',
                    'link_opened', 'public_view', 'trip_copied') then
    return;
  end if;
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
  delete from public.events where id in (select id from public.events where at < now() - interval '13 months' order by id limit 100);
end;
$$;
revoke all on function public.track_event(text, text, text, text, text, text) from public;
grant execute on function public.track_event(text, text, text, text, text, text) to anon, authenticated;

-- ORBES Trips — anonymous usage figures, without cookies (SaaS, lot 6b, Nov 2026).
-- Run once AFTER saas-4.sql, in the Supabase SQL editor: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to run twice.
--
-- What is counted: a few steps of the visitor's path (public page seen, sign-in e-mail sent, onboarding done, trip
-- created, trip validated, Pro screen seen, code activated, waiting list joined). No account, no IP address, no
-- identifier, no cookie: one row = one step, with the day, the kind of screen (phone / computer) and, for a visit,
-- the site the visitor came from. Read only by the admin, in the admin screen.

-- 0. the previous file must have run first
do $$
begin
  perform 'public.is_admin()'::regprocedure;
exception when undefined_function then
  raise exception 'Lancez d''abord supabase/saas-4.sql, puis ce fichier.';
end $$;

create table if not exists public.events (
  id     bigint generated always as identity primary key,
  at     timestamptz not null default now(),
  name   text not null,
  detail text,
  device text,
  ref    text
);
create index if not exists events_at on public.events (at desc);
alter table public.events enable row level security;
-- no policy: written only by track_event, read only by admin_funnel

-- one step of the path; anyone may send it (visitors are not signed in), only known steps are kept,
-- and at most 50,000 rows a day for the whole service
create or replace function public.track_event(p_name text, p_detail text default null, p_device text default null, p_ref text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_name not in ('visit', 'signup_email', 'signup_done', 'trip_created', 'trip_validated', 'pro_screen', 'code_redeemed', 'waitlist_join') then
    return;
  end if;
  if (select count(*) from public.events where at > now() - interval '1 day') >= 50000 then
    return;
  end if;
  insert into public.events (name, detail, device, ref)
  values (p_name, nullif(left(regexp_replace(coalesce(p_detail, ''), '[^a-z0-9_-]', '', 'g'), 20), ''),
          case when p_device in ('phone', 'computer') then p_device end,
          nullif(left(regexp_replace(lower(coalesce(p_ref, '')), '[^a-z0-9.-]', '', 'g'), 80), ''));
  -- figures older than 13 months are not kept
  delete from public.events where at < now() - interval '13 months' and id in (select id from public.events order by id limit 100);
end;
$$;
revoke all on function public.track_event(text, text, text, text) from public;
grant execute on function public.track_event(text, text, text, text) to anon, authenticated;

-- the admin's figures: each step over 30 days (and the 30 before), phones / computers, where visitors came from
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
      select jsonb_object_agg(name, jsonb_build_object('now', n30, 'before', p30))
      from (select name,
                   count(*) filter (where at > now() - interval '30 days') n30,
                   count(*) filter (where at <= now() - interval '30 days' and at > now() - interval '60 days') p30
            from public.events where at > now() - interval '60 days' group by name) s), '{}'::jsonb),
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

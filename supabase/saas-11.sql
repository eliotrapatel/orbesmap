-- ORBES Trips — the full detail of every AI request (Nov 2026).
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run). Safe to run twice.
-- Each request now keeps, besides its cost: the trip, the provider and model, the tokens read (from cache / new),
-- the tokens written, the web searches and pages read, the duration and, when it failed, why.
-- Report: supabase/ai-report.sql. Also: more steps recorded for each account, and the admin's AI detail (admin_ai).
alter table public.ai_usage add column if not exists trip_id text;
alter table public.ai_usage add column if not exists provider text;
alter table public.ai_usage add column if not exists model text;
alter table public.ai_usage add column if not exists tokens_cached int;
alter table public.ai_usage add column if not exists tokens_in int;
alter table public.ai_usage add column if not exists tokens_out int;
alter table public.ai_usage add column if not exists searches int;
alter table public.ai_usage add column if not exists fetches int;
alter table public.ai_usage add column if not exists ms int;
alter table public.ai_usage add column if not exists error text;

create or replace function public.finish_ai_call2(p_id bigint, p_usd numeric, p_ok boolean, p_detail jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  update public.ai_usage set
    usd = greatest(0, least(p_usd, 10)), ok = p_ok,
    trip_id = left(p_detail ->> 'trip', 64), provider = left(p_detail ->> 'provider', 20), model = left(p_detail ->> 'model', 40),
    tokens_cached = case when p_detail ->> 'hit' ~ '^\d+$' then (p_detail ->> 'hit')::int end,
    tokens_in = case when p_detail ->> 'miss' ~ '^\d+$' then (p_detail ->> 'miss')::int end,
    tokens_out = case when p_detail ->> 'out' ~ '^\d+$' then (p_detail ->> 'out')::int end,
    searches = case when p_detail ->> 'search' ~ '^\d+$' then (p_detail ->> 'search')::int end,
    fetches = case when p_detail ->> 'fetch' ~ '^\d+$' then (p_detail ->> 'fetch')::int end,
    ms = case when p_detail ->> 'ms' ~ '^\d+$' then (p_detail ->> 'ms')::int end,
    error = left(p_detail ->> 'error', 200)
  where id = p_id and user_id = auth.uid();
$$;
revoke all on function public.finish_ai_call2(bigint, numeric, boolean, jsonb) from public, anon;
grant execute on function public.finish_ai_call2(bigint, numeric, boolean, jsonb) to authenticated;


-- more steps are recorded (place or tool opened, status, note, photo, vote, comment, check-list, language, alerts…)
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
                    'link_opened', 'public_view', 'trip_copied', 'expense_added',
                    'place_opened', 'tool_opened', 'status_set', 'note_written', 'photo_added', 'vote', 'comment_added',
                    'checklist_done', 'language_changed', 'alerts_changed', 'search', 'adjust_asked', 'day_redone', 'trip_shared_whatsapp') then
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
revoke all on function public.track_event(text, text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.track_event(text, text, text, text, text, text, text, text, text, text, text) to anon, authenticated;

-- the admin's detail of the AI: every request of one account (or everyone), with tokens, searches, duration, trip, error
create or replace function public.admin_ai(p_user uuid default null, p_hours int default 720)
returns table (at timestamptz, email text, task text, trip text, ok boolean, error text, tokens_cached int, tokens_in int, tokens_out int,
               searches int, fetches int, ms int, usd numeric, model text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
  select x.at, u.email::text, x.task, coalesce(t.data ->> 'title', x.trip_id), x.ok, x.error, x.tokens_cached, x.tokens_in, x.tokens_out,
         x.searches, x.fetches, x.ms, x.usd, coalesce(x.provider || ' ' || x.model, '')
  from public.ai_usage x
  join auth.users u on u.id = x.user_id
  left join public.trips t on t.id = x.trip_id
  where (p_user is null or x.user_id = p_user) and x.at > now() - make_interval(hours => greatest(1, least(p_hours, 24 * 400)))
  order by x.at desc
  limit 1000;
end;
$$;
revoke all on function public.admin_ai(uuid, int) from public, anon;
grant execute on function public.admin_ai(uuid, int) to authenticated;

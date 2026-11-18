-- ORBES Trips — accounts (SaaS, lot 2, Nov 2026). Run once AFTER saas.sql, in the Supabase SQL editor:
-- Dashboard → SQL Editor → New query → paste this whole file → Run. Safe to run twice.
--
-- 1. Saving a place or a note checks access to its trip (members of the trip, or the first shared space)
--    instead of the shared space only, so every account can write in its own trips.
-- 2. AI usage per account (table ai_usage), so the AI relay can cap each account per day.

-- 0. saas.sql must have run first (this file uses its functions): otherwise stop here, nothing is changed
do $$
begin
  perform 'public.can_write_trip(text)'::regprocedure;
exception when undefined_function then
  raise exception 'Lancez d''abord supabase/saas.sql, puis ce fichier.';
end $$;

-- 1. Field-by-field merges: access per trip ----------------------------------
create or replace function public.upsert_place_state(p_trip text, p_place text, p_data jsonb)
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
  if not public.can_write_trip(p_trip) then
    raise exception 'no access to this trip' using errcode = '42501';
  end if;
  select data into cur from public.place_states where trip_id = p_trip and place_id = p_place for update;
  if cur is null then
    insert into public.place_states (trip_id, place_id, data, updated_at) values (p_trip, p_place, p_data, now())
    on conflict (trip_id, place_id) do nothing;
    if found then return p_data; end if;
    select data into cur from public.place_states where trip_id = p_trip and place_id = p_place for update;
  end if;
  res := cur;
  fa := coalesce(cur -> 'fieldsAt', '{}'::jsonb);
  for k, v in select * from jsonb_each(p_data) loop
    continue when k in ('fieldsAt', 'updatedAt');
    in_at := coalesce((p_data -> 'fieldsAt' ->> k)::numeric, (p_data ->> 'updatedAt')::numeric, 0);
    cur_at := coalesce((fa ->> k)::numeric, (cur ->> 'updatedAt')::numeric, -1);
    if in_at >= cur_at then
      res := jsonb_set(res, array[k], v, true);
      fa := jsonb_set(fa, array[k], to_jsonb(in_at), true);
    end if;
  end loop;
  res := jsonb_set(res, '{fieldsAt}', fa, true);
  res := jsonb_set(res, '{updatedAt}', to_jsonb(greatest(coalesce((cur ->> 'updatedAt')::numeric, 0), coalesce((p_data ->> 'updatedAt')::numeric, 0))), true);
  update public.place_states set data = res, updated_at = now() where trip_id = p_trip and place_id = p_place;
  return res;
end;
$$;
revoke all on function public.upsert_place_state(text, text, jsonb) from public, anon;
grant execute on function public.upsert_place_state(text, text, jsonb) to authenticated;

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
begin
  if not public.can_write_trip(p_trip) then
    raise exception 'no access to this trip' using errcode = '42501';
  end if;
  select data into cur from public.places where trip_id = p_trip and place_id = p_place for update;
  if cur is null then
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
    cur_at := case when cur ? k then coalesce((fa ->> k)::numeric, (cur ->> 'updatedAt')::numeric, 0) else -1 end;
    if in_at >= cur_at then
      res := jsonb_set(res, array[k], v, true);
      fa := jsonb_set(fa, array[k], to_jsonb(in_at), true);
    end if;
  end loop;
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

-- 2. AI usage per account ----------------------------------------------------
create table if not exists public.ai_usage (
  id      bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  at      timestamptz not null default now(),
  task    text not null,
  usd     numeric not null default 0,
  ok      boolean not null default true
);
create index if not exists ai_usage_user_at on public.ai_usage (user_id, at desc);
alter table public.ai_usage enable row level security;
drop policy if exists "my usage read" on public.ai_usage;
drop policy if exists "my usage write" on public.ai_usage;
-- an account reads its own usage; rows are only written by the two functions below (never by hand)
create policy "my usage read" on public.ai_usage for select to authenticated using (user_id = auth.uid());

-- Reserves one AI request for the calling account BEFORE the AI is called: one row added, then refused (and
-- removed) above the account's daily cap or the whole service's daily cap. One account at a time (lock), so
-- parallel requests cannot all pass. Returns the row id, or null when refused.
create or replace function public.reserve_ai_call(p_task text, p_cap int, p_global_cap int)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  rid bigint;
  mine int;
  everyone int;
begin
  if auth.uid() is null then return null; end if;
  perform pg_advisory_xact_lock(hashtext('ai:' || auth.uid()::text));
  select count(*) into mine from public.ai_usage where user_id = auth.uid() and at > now() - interval '24 hours';
  select count(*) into everyone from public.ai_usage where at > now() - interval '24 hours';
  if mine >= p_cap or everyone >= p_global_cap then return null; end if;
  insert into public.ai_usage (user_id, task) values (auth.uid(), left(p_task, 20)) returning id into rid;
  return rid;
end;
$$;
-- after the answer: its cost and whether it worked (the account's own row only)
create or replace function public.finish_ai_call(p_id bigint, p_usd numeric, p_ok boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.ai_usage set usd = greatest(0, least(p_usd, 10)), ok = p_ok where id = p_id and user_id = auth.uid();
$$;
revoke all on function public.reserve_ai_call(text, int, int) from public, anon;
revoke all on function public.finish_ai_call(bigint, numeric, boolean) from public, anon;
grant execute on function public.reserve_ai_call(text, int, int) to authenticated;
grant execute on function public.finish_ai_call(bigint, numeric, boolean) to authenticated;

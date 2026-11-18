-- ORBES Trips — accounts (SaaS, lot 2, Nov 2026). Run once AFTER saas.sql, in the Supabase SQL editor:
-- Dashboard → SQL Editor → New query → paste this whole file → Run. Safe to run twice.
--
-- 1. Saving a place or a note checks access to its trip (members of the trip, or the first shared space)
--    instead of the shared space only, so every account can write in its own trips.
-- 2. AI usage per account (table ai_usage), so the AI relay can cap each account per day.

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
create policy "my usage read" on public.ai_usage for select to authenticated using (user_id = auth.uid());
create policy "my usage write" on public.ai_usage for insert to authenticated with check (user_id = auth.uid());

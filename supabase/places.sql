-- ORBES Trips — places as data (Nov 2026). Run once in the Supabase SQL editor:
-- Dashboard → SQL Editor → New query → paste this whole file → Run. Safe to run twice.
--
-- Every place of a trip (the former programme in the code AND the places added in the app) is one row:
-- the whole sheet in one JSON (name, position, day, slot, type, addresses, metro, website, description,
-- highlights, tip, opening hours, visit length…). Same rules as place_states: members only, field-by-field
-- merge (two phones editing different fields never overwrite each other), live updates.
-- Notes, statuses, photos and contacts stay where they are (place_states, photos, contacts), on the same ids.

create table if not exists public.places (
  trip_id    text not null,
  place_id   text not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (trip_id, place_id)
);

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
  if not public.is_member() then
    raise exception 'not a member' using errcode = '42501';
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
    -- a field the record does not have yet is always taken (whatever the record's last change)
    cur_at := case when cur ? k then coalesce((fa ->> k)::numeric, (cur ->> 'updatedAt')::numeric, 0) else -1 end;
    if in_at >= cur_at then
      res := jsonb_set(res, array[k], v, true);
      fa := jsonb_set(fa, array[k], to_jsonb(in_at), true);
    end if;
  end loop;
  res := jsonb_set(res, '{fieldsAt}', fa, true);
  res := jsonb_set(res, '{updatedAt}', to_jsonb(greatest(coalesce((cur ->> 'updatedAt')::numeric, 0), coalesce((p_data ->> 'updatedAt')::numeric, 0))), true);
  -- nothing new: no write (a write would wake the other phone for nothing)
  if res is distinct from cur then
    update public.places set data = res, updated_at = now() where trip_id = p_trip and place_id = p_place;
  end if;
  return res;
end;
$$;
revoke all on function public.upsert_place(text, text, jsonb) from public, anon;
grant execute on function public.upsert_place(text, text, jsonb) to authenticated;

-- members only
alter table public.places enable row level security;
drop policy if exists "members read" on public.places;
drop policy if exists "members insert" on public.places;
drop policy if exists "members update" on public.places;
drop policy if exists "members delete" on public.places;
create policy "members read" on public.places for select to authenticated using ((select public.is_member()));
create policy "members insert" on public.places for insert to authenticated with check ((select public.is_member()));
create policy "members update" on public.places for update to authenticated using ((select public.is_member())) with check ((select public.is_member()));
create policy "members delete" on public.places for delete to authenticated using ((select public.is_member()));

-- live updates between the two phones
do $$
begin
  alter publication supabase_realtime add table public.places;
exception when duplicate_object then null;
end $$;

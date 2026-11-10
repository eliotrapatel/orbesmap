-- ORBES trip map — Supabase schema (shared space for Eliot and his father)
-- Run once in the Supabase SQL editor: Dashboard → SQL Editor → New query → paste → Run.
-- Then add the two e-mail addresses allowed to use the app (last section).
--
-- Access model: one shared space. Only e-mails listed in public.members can read or write
-- anything (tables and photos). Anyone else who signs in sees nothing and cannot write.

-- 0. Members --------------------------------------------------------------
create table if not exists public.members (
  email      text primary key,
  name       text,
  created_at timestamptz not null default now()
);
alter table public.members enable row level security;
-- no policy on members: it is only readable through is_member() below

create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members m
    where lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

-- 1. Per-place state (status, rating, appointment, supplier sheet, note, favourite, visited)
create table if not exists public.place_states (
  trip_id    text not null,
  place_id   text not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (trip_id, place_id)
);

-- 2. Contacts (WhatsApp / WeChat) attached to a place
create table if not exists public.contacts (
  id         uuid primary key,
  trip_id    text not null,
  place_id   text not null,
  name       text not null,
  kind       text not null check (kind in ('wa', 'wc')),
  value      text not null,
  message    text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists contacts_trip on public.contacts (trip_id);

-- 3. Places added by hand on the map
create table if not exists public.pins (
  id         uuid primary key,
  trip_id    text not null,
  name       text not null,
  lat        double precision not null,
  lng        double precision not null,
  note       text,
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists pins_trip on public.pins (trip_id);

-- 4. Photos (files live in the private "photos" storage bucket, path "<trip>/<place>/<id>.jpg")
create table if not exists public.photos (
  id         uuid primary key,
  trip_id    text not null,
  place_id   text not null,
  path       text not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists photos_trip on public.photos (trip_id);

-- 5. Shared settings (EUR → RMB rate), single row
create table if not exists public.settings (
  id       int primary key default 1 check (id = 1),
  eur_rate numeric not null default 7.7
);

-- Row Level Security: members only
do $$
declare t text;
begin
  foreach t in array array['place_states', 'contacts', 'pins', 'photos', 'settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "members read" on public.%I', t);
    execute format('drop policy if exists "members insert" on public.%I', t);
    execute format('drop policy if exists "members update" on public.%I', t);
    execute format('drop policy if exists "members delete" on public.%I', t);
    execute format('create policy "members read" on public.%I for select to authenticated using ((select public.is_member()))', t);
    execute format('create policy "members insert" on public.%I for insert to authenticated with check ((select public.is_member()))', t);
    execute format('create policy "members update" on public.%I for update to authenticated using ((select public.is_member())) with check ((select public.is_member()))', t);
    execute format('create policy "members delete" on public.%I for delete to authenticated using ((select public.is_member()))', t);
  end loop;
end $$;

-- Live updates between devices
do $$
declare t text;
begin
  foreach t in array array['place_states', 'contacts', 'pins', 'photos', 'settings'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- Private storage bucket for photos
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

drop policy if exists "members read photos" on storage.objects;
drop policy if exists "members upload photos" on storage.objects;
drop policy if exists "members update photos" on storage.objects;
drop policy if exists "members delete photos" on storage.objects;
create policy "members read photos" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (select public.is_member()));
create policy "members upload photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (select public.is_member()));
create policy "members update photos" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (select public.is_member()));
create policy "members delete photos" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (select public.is_member()));

-- 6. Who can use the app — replace with the real addresses, then run this part
-- insert into public.members (email, name) values
--   ('eliot@example.com', 'Eliot'),
--   ('papa@example.com', 'Papa')
-- on conflict (email) do nothing;

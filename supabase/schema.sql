-- ORBES sourcing map — Supabase schema
-- Run once in the Supabase SQL editor (Dashboard → SQL → New query → paste → Run).
-- Every row belongs to the signed-in user: Row Level Security makes sure each person
-- only ever reads and writes their own notes, contacts, pins and photos.

-- 1. Per-place state (status, rating, appointment, supplier sheet, note, favourite, visited)
create table if not exists public.place_states (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  trip_id    text not null,
  place_id   text not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, trip_id, place_id)
);

-- 2. Contacts (WhatsApp / WeChat) attached to a place
create table if not exists public.contacts (
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  trip_id    text not null,
  place_id   text not null,
  name       text not null,
  kind       text not null check (kind in ('wa', 'wc')),
  value      text not null,
  message    text,
  created_at timestamptz not null default now()
);
create index if not exists contacts_user_trip on public.contacts (user_id, trip_id);

-- 3. Places added by hand on the map
create table if not exists public.pins (
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  trip_id    text not null,
  name       text not null,
  lat        double precision not null,
  lng        double precision not null,
  note       text,
  updated_at timestamptz not null default now()
);
create index if not exists pins_user_trip on public.pins (user_id, trip_id);

-- 4. Photos (files live in the private "photos" storage bucket)
create table if not exists public.photos (
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  trip_id    text not null,
  place_id   text not null,
  path       text not null,
  created_at timestamptz not null default now()
);
create index if not exists photos_user_trip on public.photos (user_id, trip_id);

-- 5. Settings (EUR → RMB rate)
create table if not exists public.settings (
  user_id  uuid primary key default auth.uid() references auth.users on delete cascade,
  eur_rate numeric not null default 7.7
);

-- Row Level Security: owner only
do $$
declare t text;
begin
  foreach t in array array['place_states', 'contacts', 'pins', 'photos', 'settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "owner can read" on public.%I', t);
    execute format('drop policy if exists "owner can insert" on public.%I', t);
    execute format('drop policy if exists "owner can update" on public.%I', t);
    execute format('drop policy if exists "owner can delete" on public.%I', t);
    execute format('create policy "owner can read" on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t);
    execute format('create policy "owner can insert" on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "owner can update" on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "owner can delete" on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t);
  end loop;
end $$;

-- Private storage bucket for photos. Files are stored under "<user id>/<trip>/<place>/<photo id>.jpg".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "owner can read photos" on storage.objects;
drop policy if exists "owner can upload photos" on storage.objects;
drop policy if exists "owner can update photos" on storage.objects;
drop policy if exists "owner can delete photos" on storage.objects;
create policy "owner can read photos" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "owner can upload photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "owner can update photos" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "owner can delete photos" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

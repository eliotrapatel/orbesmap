-- ORBES Trips — sharing a trip (SaaS, lot 4, Nov 2026). Run once AFTER saas.sql and saas-2.sql, in the
-- Supabase SQL editor: Dashboard → SQL Editor → New query → paste this whole file → Run. Safe to run twice.
--
-- A trip is shared by e-mail: an invitation (trip_invites) waits until someone signs in with that address
-- (a new account or an existing one); the app then joins them to the trip (accept_invites), as editor or reader.

-- 0. the previous files must have run first: otherwise stop here, nothing is changed
do $$
begin
  perform 'public.can_write_trip(text)'::regprocedure;
  perform 'public.reserve_ai_call(text, int, int)'::regprocedure;
exception when undefined_function then
  raise exception 'Lancez d''abord supabase/saas.sql puis supabase/saas-2.sql, puis ce fichier.';
end $$;

-- 1. Who may share a trip: its owner, or the first shared space for its own trips
create or replace function public.can_manage_trip(t text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.trip_role(t) = 'owner', false) or public.legacy_access(t);
$$;
revoke all on function public.can_manage_trip(text) from public, anon;
grant execute on function public.can_manage_trip(text) to authenticated;

-- 2. Invitations by e-mail
create table if not exists public.trip_invites (
  trip_id    text not null references public.trips (id) on delete cascade,
  email      text not null,
  role       text not null default 'editor' check (role in ('editor', 'viewer')),
  invited_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (trip_id, email)
);
alter table public.trip_invites enable row level security;
drop policy if exists "invites read" on public.trip_invites;
drop policy if exists "invites create" on public.trip_invites;
drop policy if exists "invites remove" on public.trip_invites;
create policy "invites read" on public.trip_invites for select to authenticated
  using ((select public.can_read_trip(trip_id)) or lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy "invites create" on public.trip_invites for insert to authenticated
  with check ((select public.can_manage_trip(trip_id)) and email = lower(trim(email)) and position('@' in email) > 1);
create policy "invites remove" on public.trip_invites for delete to authenticated
  using ((select public.can_manage_trip(trip_id)));

-- 3. Joining: the invitations of the signed-in (confirmed) address become trip memberships
create or replace function public.accept_invites()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int := 0;
  me text;
begin
  select lower(email) into me from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if me is null then return 0; end if;
  insert into public.trip_members (trip_id, user_id, role)
  select i.trip_id, auth.uid(), i.role from public.trip_invites i where lower(i.email) = me
  on conflict (trip_id, user_id) do nothing;
  get diagnostics n = row_count;
  delete from public.trip_invites where lower(email) = me;
  return n;
end;
$$;
revoke all on function public.accept_invites() from public, anon;
grant execute on function public.accept_invites() to authenticated;

-- 4. The travellers of a trip (for its members): e-mail, first name, role
create or replace function public.trip_people(t text)
returns table (user_id uuid, email text, name text, role text)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id, u.email::text, coalesce(p.data ->> 'name', ''), m.role
  from public.trip_members m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.id = m.user_id
  where m.trip_id = t and public.can_read_trip(t)
  order by case m.role when 'owner' then 0 when 'editor' then 1 else 2 end, u.email;
$$;
revoke all on function public.trip_people(text) from public, anon;
grant execute on function public.trip_people(text) to authenticated;

-- 5. A traveller removed by the owner (or who leaves): the owner role itself is never removed this way
drop policy if exists "owner or self removes" on public.trip_members;
create policy "owner or self removes" on public.trip_members for delete to authenticated
  using (role <> 'owner' and ((select public.can_manage_trip(trip_id)) or user_id = auth.uid()));
-- the owner (or the shared space) changes a traveller's role (editor / reader), never to owner
drop policy if exists "owner changes" on public.trip_members;
create policy "owner changes" on public.trip_members for update to authenticated
  using ((select public.can_manage_trip(trip_id)) and role <> 'owner')
  with check ((select public.can_manage_trip(trip_id)) and role in ('editor', 'viewer'));

-- live updates (a new traveller, an invitation accepted)
do $$
begin
  alter publication supabase_realtime add table public.trip_invites;
exception when duplicate_object then null;
end $$;

-- ORBES Trips — creating a trip works again for every account (Nov 2026).
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run). Safe to run twice.
--
-- Why: the rule that says who can see a trip relied only on its list of travellers, which is filled in just AFTER
-- the trip is saved; while saving (insert … on conflict), Postgres checks that the new row is visible to its author,
-- found none, and refused every new trip ("new row violates row-level security policy for table trips").
-- Now the trip's owner (its creator, who can never be changed since saas-4.sql) always sees it.
drop policy if exists "trip read" on public.trips;
create policy "trip read" on public.trips for select to authenticated
  using ((select public.can_read_trip(id)) or owner = (select auth.uid()));

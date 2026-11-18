-- ORBES Trips — alerts and forwarded bookings (SaaS, lot 6g, Nov 2026).
-- BEFORE running: Supabase → Database → Extensions → enable "pg_cron" and "pg_net".
-- Then run once AFTER saas-6.sql, in the SQL editor (Dashboard → SQL Editor → New query → paste → Run).
-- Safe to run twice.
--
-- Alerts: every 10 minutes Supabase wakes the app (api/cron on Vercel), which sends the morning e-mail and
-- notification of each trip day (about 7:30 local time, with the places closed that day) and a notification
-- 30 minutes before each place at a set time. Forwarded bookings: each account has its own address
-- (…@in.theorbes.com); what arrives there is read by the AI and waits in the trip until the person adds it.

-- 0. the previous file must have run first, and the two extensions must be on
do $$
begin
  perform 'public.open_trip_link(text)'::regprocedure;
exception when undefined_function then
  raise exception 'Lancez d''abord supabase/saas-6.sql, puis ce fichier.';
end $$;
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception 'Activez d''abord les extensions pg_cron et pg_net (Database → Extensions), puis relancez ce fichier.';
  end if;
end $$;

-- 1. Phones that receive notifications (one row per phone and account)
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "my phones" on public.push_subscriptions;
create policy "my phones" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 2. What was already sent (so nothing is sent twice) and the app's private settings (never readable by accounts)
create table if not exists public.alert_log (
  key text primary key,
  at  timestamptz not null default now()
);
alter table public.alert_log enable row level security;
create table if not exists public.app_config (
  key   text primary key,
  value text not null
);
alter table public.app_config enable row level security;
-- the secret that proves a wake-up comes from this database (made once, read by api/cron with the service key)
insert into public.app_config (key, value) values ('cron_secret', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

-- 3. Forwarded bookings: each account's address, and what arrived
create table if not exists public.inbound_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  token   text not null unique check (token ~ '^[a-z0-9]{8,24}$')
);
alter table public.inbound_tokens enable row level security;
drop policy if exists "my address" on public.inbound_tokens;
create policy "my address" on public.inbound_tokens for select to authenticated using (user_id = auth.uid());

create table if not exists public.inbound_items (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  trip_id     text,
  received_at timestamptz not null default now(),
  from_addr   text,
  subject     text,
  extracted   jsonb not null default '{}'::jsonb,
  status      text not null default 'new' check (status in ('new', 'added', 'dismissed'))
);
create index if not exists inbound_items_user on public.inbound_items (user_id, received_at desc);
alter table public.inbound_items enable row level security;
drop policy if exists "my bookings read" on public.inbound_items;
drop policy if exists "my bookings change" on public.inbound_items;
drop policy if exists "my bookings remove" on public.inbound_items;
create policy "my bookings read" on public.inbound_items for select to authenticated using (user_id = auth.uid());
create policy "my bookings change" on public.inbound_items for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "my bookings remove" on public.inbound_items for delete to authenticated using (user_id = auth.uid());
-- written only by api/inbound (service key)

-- this account's forwarding address (made the first time)
create or replace function public.my_inbound_token()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
begin
  if auth.uid() is null then return null; end if;
  select token into t from public.inbound_tokens where user_id = auth.uid();
  if t is null then
    t := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
    insert into public.inbound_tokens (user_id, token) values (auth.uid(), t) on conflict (user_id) do nothing;
    select token into t from public.inbound_tokens where user_id = auth.uid();
  end if;
  return t;
end;
$$;
revoke all on function public.my_inbound_token() from public, anon;
grant execute on function public.my_inbound_token() to authenticated;

-- 4. The wake-up, every 10 minutes
select cron.unschedule('orbes-alerts') where exists (select 1 from cron.job where jobname = 'orbes-alerts');
select cron.schedule('orbes-alerts', '*/10 * * * *', $job$
  select net.http_post(
    url := 'https://orbesmap.vercel.app/api/cron',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', (select value from public.app_config where key = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$job$);

-- the log of what was sent is kept 30 days
select cron.unschedule('orbes-alert-log') where exists (select 1 from cron.job where jobname = 'orbes-alert-log');
select cron.schedule('orbes-alert-log', '17 3 * * *', $job$ delete from public.alert_log where at < now() - interval '30 days'; $job$);

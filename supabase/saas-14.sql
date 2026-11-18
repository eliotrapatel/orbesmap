-- ORBES Trips — the cycle: invitations sent by e-mail, reminders before and after a trip, offline follow-up
-- (lot "cycle", R09 R15 R18 R19, Nov 2026).
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste this whole file → Run).
-- Safe to run twice. Can run before or after saas-12, saas-13 and saas-15 (it never redefines their functions).
--
-- What it adds:
-- - mail_log: every new e-mail or notification of this lot, kept for good (one row per account and message, so
--   nothing is ever sent twice; the 48-hour gap between two tips is read from it);
-- - mail_optout: the addresses that asked to stop the tips and invitation e-mails (link at the bottom of each);
-- - invite_mails: the invitation e-mails (a private link per invited address, opened, joined, reminded);
-- - the functions the app and the server (api/cron, api/mail) call. Before this file runs, the app works as today.

-- 0. the earlier files must have run first: otherwise stop here, nothing is changed
do $$
begin
  perform 'public.can_manage_trip(text)'::regprocedure;
  perform 'public.is_pro_user(uuid)'::regprocedure;
  perform 'public.trip_pro(text)'::regprocedure;
  perform 'public.my_inbound_token()'::regprocedure;
  perform 'public.link_visitor(text)'::regprocedure;
exception when undefined_function then
  raise exception 'Lancez d''abord supabase/saas-3.sql, saas-4.sql, saas-5.sql et saas-7.sql, puis ce fichier.';
end $$;
do $$
begin
  if to_regclass('public.events') is null or to_regclass('public.alert_log') is null or to_regclass('public.trip_invites') is null
     or to_regclass('public.inbound_items') is null or to_regclass('public.push_subscriptions') is null then
    raise exception 'Lancez d''abord supabase/saas-3.sql, saas-5.sql et saas-7.sql, puis ce fichier.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'events' and column_name = 'browser') then
    raise exception 'Lancez d''abord supabase/saas-8.sql, puis ce fichier.';
  end if;
end $$;

-- 1. Tables ----------------------------------------------------------------
create table if not exists public.mail_log (
  key     text primary key,
  user_id uuid references auth.users (id) on delete cascade,
  email   text,
  kind    text not null,
  trip_id text,
  channel text not null check (channel in ('email', 'push', 'none')),
  tips    boolean not null default true,
  at      timestamptz not null default now()
);
-- 'none' = decided without sending anything (a booking already covered by a trip, a notification with no phone left):
-- never counted in the daily e-mail cap. Rewritten on each run so a table made by an earlier copy of this file gets it.
alter table public.mail_log drop constraint if exists mail_log_channel_check;
alter table public.mail_log add constraint mail_log_channel_check check (channel in ('email', 'push', 'none'));
create index if not exists mail_log_user on public.mail_log (user_id, at desc);
create index if not exists mail_log_email on public.mail_log (email, at desc);
alter table public.mail_log enable row level security;
-- no policy: written and read by the server only (service key)

create table if not exists public.mail_optout (
  email   text primary key check (email = lower(email)),
  user_id uuid references auth.users (id) on delete cascade,
  source  text,
  at      timestamptz not null default now()
);
alter table public.mail_optout enable row level security;
drop policy if exists "my optout read" on public.mail_optout;
create policy "my optout read" on public.mail_optout for select to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')));

create table if not exists public.invite_mails (
  id                  bigint generated always as identity primary key,
  token               text not null unique check (token ~ '^[A-Za-z0-9_-]{20,64}$'),
  trip_id             text not null references public.trips (id) on delete cascade,
  email               text not null check (email = lower(email)),
  invited_by          uuid references auth.users (id) on delete set null,
  lang                text,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null default now() + interval '30 days',
  sent_at             timestamptz,
  send_count          int not null default 0,
  reminded_at         timestamptz,
  opened_at           timestamptz,
  accepted_at         timestamptz,
  accepted_user       uuid references auth.users (id) on delete set null,
  claimed_at          timestamptz,
  inviter_notified_at timestamptz,
  unique (trip_id, email)
);
create index if not exists invite_mails_email on public.invite_mails (email, created_at desc);
create index if not exists invite_mails_by on public.invite_mails (invited_by, sent_at desc);
alter table public.invite_mails enable row level security;
drop policy if exists "my sent invites" on public.invite_mails;
create policy "my sent invites" on public.invite_mails for select to authenticated using (invited_by = auth.uid());

-- accounts only read what their policy allows; everything else goes through the server or the functions below
revoke all on public.mail_log, public.mail_optout, public.invite_mails from anon, authenticated;
grant select on public.mail_optout, public.invite_mails to authenticated;

-- 2. An invited person joins the trip: their invitation e-mail is marked as accepted (never blocks the joining) ----
create or replace function public.invite_mails_on_join()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    update public.invite_mails i
       set accepted_at = coalesce(i.accepted_at, now()), accepted_user = coalesce(i.accepted_user, new.user_id)
     where i.trip_id = new.trip_id and i.accepted_at is null
       and i.email = (select lower(u.email) from auth.users u where u.id = new.user_id);
  exception when others then
    null;
  end;
  return new;
end;
$$;
drop trigger if exists trip_members_invite_joined on public.trip_members;
create trigger trip_members_invite_joined after insert on public.trip_members
  for each row execute function public.invite_mails_on_join();

-- 3. The invitation page (?join=…): what the invited person may see before signing in ---------------------------
create or replace function public.invite_preview(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.invite_mails%rowtype;
  tr jsonb;
  n int := 0;
  inviter text := '';
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{20,64}$' then
    return jsonb_build_object('ok', false);
  end if;
  select * into r from public.invite_mails where token = p_token;
  if not found then
    return jsonb_build_object('ok', false);
  end if;
  if r.accepted_at is not null or r.claimed_at is not null then
    return jsonb_build_object('ok', false, 'used', true);
  end if;
  select data into tr from public.trips where id = r.trip_id;
  if r.expires_at < now() or tr is null or coalesce(tr ->> 'deleted', '') = 'true'
     or not exists (select 1 from public.trip_invites i where i.trip_id = r.trip_id and lower(i.email) = r.email) then
    return jsonb_build_object('ok', false, 'expired', true);
  end if;
  select count(*) into n from public.places p
   where p.trip_id = r.trip_id and coalesce(p.data ->> 'deleted', '') <> 'true' and coalesce(p.data ->> 'removed', '') <> 'true'
     and coalesce(p.data ->> 'type', '') <> 'hotel';
  select split_part(trim(coalesce(p.data ->> 'name', '')), ' ', 1) into inviter from public.profiles p where p.id = r.invited_by;
  if r.opened_at is null then
    insert into public.events (user_id, name, trip_id) values (auth.uid(), 'invite_opened', r.trip_id);
    update public.invite_mails set opened_at = now() where id = r.id;
  end if;
  return jsonb_build_object(
    'ok', true,
    'title', left(coalesce(tr ->> 'title', ''), 80),
    'start', tr ->> 'start',
    'end', tr ->> 'end',
    'places', n,
    'inviter', left(coalesce(inviter, ''), 40),
    'email', r.email,
    -- only once the e-mail went to that address (the link is then its owner's): a link made by hand never tells
    -- whether an address has an account
    'has_account', r.sent_at is not null and exists (select 1 from auth.users u where lower(u.email) = r.email)
  );
end;
$$;
revoke all on function public.invite_preview(text) from public;
grant execute on function public.invite_preview(text) to anon, authenticated;

-- 4. Signed in with the invited address: the trip the invitation opens (after accept_invites joined it) -----------
create or replace function public.invite_claim(p_token text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me text;
  r public.invite_mails%rowtype;
begin
  select lower(email) into me from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if me is null then
    return jsonb_build_object('reason', 'none');
  end if;
  if p_token is not null then
    if p_token !~ '^[A-Za-z0-9_-]{20,64}$' then
      return jsonb_build_object('reason', 'none');
    end if;
    select * into r from public.invite_mails where token = p_token;
    if not found then
      return jsonb_build_object('reason', 'none');
    end if;
    if r.email <> me then
      return jsonb_build_object('reason', 'other_email');
    end if;
    if not exists (select 1 from public.trip_members m where m.trip_id = r.trip_id and m.user_id = auth.uid()) then
      return jsonb_build_object('reason', 'not_member');
    end if;
  else
    -- another device, no link: the newest invitation of this address from the last 7 days that it already joined
    select i.* into r from public.invite_mails i
     where i.email = me and i.created_at > now() - interval '7 days' and i.claimed_at is null
       and exists (select 1 from public.trip_members m where m.trip_id = i.trip_id and m.user_id = auth.uid())
     order by i.created_at desc limit 1;
    if not found then
      return jsonb_build_object('reason', 'none');
    end if;
  end if;
  update public.invite_mails
     set claimed_at = coalesce(claimed_at, now()), accepted_at = coalesce(accepted_at, now()), accepted_user = coalesce(accepted_user, auth.uid())
   where id = r.id;
  return jsonb_build_object('trip', r.trip_id);
end;
$$;
revoke all on function public.invite_claim(text) from public, anon;
grant execute on function public.invite_claim(text) to authenticated;

-- 5. The tips switch turned back on in the app: the account's own address leaves the opt-out list -------------------
create or replace function public.mail_optin()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.mail_optout
   where email = (select lower(u.email) from auth.users u where u.id = auth.uid());
$$;
revoke all on function public.mail_optin() from public, anon;
grant execute on function public.mail_optin() to authenticated;

-- 6. Two more steps recorded per account (offline ready, offline used), with the same limits as track_event -------
-- (a separate function, so this file never rewrites the list another lot keeps in track_event)
create or replace function public.track_event_cycle(p_name text, p_detail text, p_device text, p_ref text, p_visitor text, p_trip text,
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
  if p_name not in ('offline_ready', 'offline_used') then
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
end;
$$;
revoke all on function public.track_event_cycle(text, text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.track_event_cycle(text, text, text, text, text, text, text, text, text, text, text) to anon, authenticated;

-- 7. Server only (api/cron, api/mail with the service key): who gets which message -------------------------------
-- the tips rules shared by the queries below: e-mails on (Alerts), tips on (account switch), address not opted out
create or replace function public.cycle_tips_ok(u uuid, mail text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select coalesce(p.data -> 'alerts' ->> 'email', 'true') <> 'false' and coalesce(p.data ->> 'mailTips', 'true') <> 'false'
                     from public.profiles p where p.id = u), true)
     and not exists (select 1 from public.mail_optout o where o.email = lower(coalesce(mail, '')));
$$;

-- J+3 without a trip: confirmed 3 to 10 days ago (older accounts get nothing), never joined or created a trip
create or replace function public.cycle_first_trip(p_limit int default 30)
returns table (user_id uuid, email text, lang text, name text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, lower(u.email::text), coalesce(p.data ->> 'lang', 'fr'), coalesce(p.data ->> 'name', '')
    from auth.users u
    left join public.profiles p on p.id = u.id
   where u.email is not null
     and u.email_confirmed_at between now() - interval '10 days' and now() - interval '3 days'
     and not exists (select 1 from public.trip_members m where m.user_id = u.id)
     and not exists (select 1 from public.members x where lower(x.email) = lower(u.email))
     and not exists (select 1 from public.admins a where a.user_id = u.id)
     and not exists (select 1 from public.mail_log l where l.key = 'first_trip:' || u.id::text)
     and public.cycle_tips_ok(u.id, u.email)
   order by u.email_confirmed_at
   limit greatest(1, least(coalesce(p_limit, 30), 200));
$$;

-- the 1st of the month: free accounts that used their prepared trip last month (UTC month, as my_plan), no trip to
-- come, not yet told this month, and at most 3 such e-mails without opening the app in between
create or replace function public.cycle_quota(p_limit int default 30)
returns table (user_id uuid, email text, lang text, name text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, lower(u.email::text), coalesce(p.data ->> 'lang', 'fr'), coalesce(p.data ->> 'name', '')
    from auth.users u
    left join public.profiles p on p.id = u.id
   where u.email is not null and u.email_confirmed_at is not null
     and exists (select 1 from public.prepared_trips t where t.user_id = u.id
                  and t.at >= date_trunc('month', now()) - interval '1 month' and t.at < date_trunc('month', now()))
     and not exists (select 1 from public.prepared_trips t where t.user_id = u.id and t.at >= date_trunc('month', now()))
     and not public.is_pro_user(u.id)
     and not exists (select 1 from public.trip_members m join public.trips x on x.id = m.trip_id
                      where m.user_id = u.id and coalesce(x.data ->> 'deleted', '') <> 'true'
                        and coalesce(x.data ->> 'end', '') >= to_char((now() at time zone 'Europe/Paris')::date, 'YYYY-MM-DD'))
     and not exists (select 1 from public.mail_log l where l.key = 'quota:' || u.id::text || ':' || to_char(date_trunc('month', now()), 'YYYY-MM'))
     and (select count(*) from public.mail_log l where l.user_id = u.id and l.kind = 'quota'
           and l.at > coalesce((select max(e.at) from public.events e where e.user_id = u.id and e.name = 'app_open'), '-infinity'::timestamptz)) < 3
     and public.cycle_tips_ok(u.id, u.email)
   order by u.id
   limit greatest(1, least(coalesce(p_limit, 30), 200));
$$;

-- the confirmed travellers of a trip, with what the departure messages need. "pro" = what the app unlocks: the
-- account's own Pro, or the trip's once saas-13 (the per-trip Pass, table trip_grants) is in.
create or replace function public.cycle_trip_people(p_trip text)
returns table (user_id uuid, role text, email text, lang text, name text, alerts jsonb, tips boolean, opted_out boolean,
               phones int, pro boolean, offline_full boolean, bookings int)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id, m.role, lower(u.email::text), coalesce(p.data ->> 'lang', 'fr'), coalesce(p.data ->> 'name', ''),
         coalesce(p.data -> 'alerts', '{}'::jsonb),
         coalesce(p.data ->> 'mailTips', 'true') <> 'false',
         exists (select 1 from public.mail_optout o where o.email = lower(u.email)),
         (select count(*)::int from public.push_subscriptions s where s.user_id = m.user_id),
         public.is_pro_user(m.user_id) or (to_regclass('public.trip_grants') is not null and public.trip_pro(p_trip)),
         exists (select 1 from public.events e where e.user_id = m.user_id and e.trip_id = p_trip and e.name = 'offline_ready'
                  and e.detail = 'full' and e.at > now() - interval '21 days'),
         (select count(*)::int from public.inbound_items b where b.user_id = m.user_id and b.trip_id = p_trip and b.status = 'new')
    from public.trip_members m
    join auth.users u on u.id = m.user_id and u.email_confirmed_at is not null and u.email is not null
    left join public.profiles p on p.id = m.user_id
   where m.trip_id = p_trip;
$$;

-- the language of the account that has this address (an invitation e-mail is written in it), else null
create or replace function public.cycle_email_lang(p_email text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.data ->> 'lang' from auth.users u join public.profiles p on p.id = u.id
   where lower(u.email) = lower(coalesce(p_email, '')) limit 1;
$$;

revoke all on function public.cycle_tips_ok(uuid, text) from public, anon, authenticated;
revoke all on function public.cycle_first_trip(int) from public, anon, authenticated;
revoke all on function public.cycle_quota(int) from public, anon, authenticated;
revoke all on function public.cycle_trip_people(text) from public, anon, authenticated;
revoke all on function public.cycle_email_lang(text) from public, anon, authenticated;
grant execute on function public.cycle_tips_ok(uuid, text) to service_role;
grant execute on function public.cycle_first_trip(int) to service_role;
grant execute on function public.cycle_quota(int) to service_role;
grant execute on function public.cycle_trip_people(text) to service_role;
grant execute on function public.cycle_email_lang(text) to service_role;
grant all on public.mail_log, public.mail_optout, public.invite_mails to service_role;

-- 8. Reports (copy one into a new query to read it) --------------------------------------------------------------
-- invitations sent by e-mail and joined within 14 days (R09):
--   select count(*) filter (where sent_at is not null) as sent,
--          count(*) filter (where sent_at is not null and accepted_at <= sent_at + interval '14 days') as joined_14d
--     from public.invite_mails where created_at > now() - interval '90 days';
-- e-mails and notifications of this lot, per kind, last 30 days:
--   select kind, channel, count(*) from public.mail_log where at > now() - interval '30 days' group by 1, 2 order by 3 desc;
-- Pro trips that were fully offline before their start (R19):
--   select count(distinct e.trip_id) from public.events e where e.name = 'offline_ready' and e.detail = 'full';
-- addresses that stopped the e-mails:
--   select source, count(*) from public.mail_optout group by 1;

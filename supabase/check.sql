-- ORBES Trips — checks what is only visible inside Supabase (reads only, changes nothing).
-- Supabase → SQL Editor → New query → paste → Run. One line per check: "ok" true = fine.
-- (Outside checks: bash scripts/check.sh)
with
last_wake as (select status_code, content, created from net._http_response order by created desc limit 1),
shared as (select id, owner, data from public.trips where id in ('sha-2026', 'gz-2026'))
select * from (values
  ('Extensions pg_cron et pg_net',
     (select string_agg(extname, ', ') from pg_extension where extname in ('pg_cron', 'pg_net')),
     (select count(*) = 2 from pg_extension where extname in ('pg_cron', 'pg_net'))),
  ('Horloge des alertes (toutes les 10 min)',
     (select coalesce(string_agg(jobname || ' ' || schedule || case when active then '' else ' (inactive)' end, ' · '), 'absente') from cron.job where jobname like 'orbes-%'),
     (select count(*) = 2 and bool_and(active) from cron.job where jobname in ('orbes-alerts', 'orbes-alert-log'))),
  ('Dernier réveil : réponse',
     (select status_code || ' · ' || left(content, 160) || ' · ' || to_char(created at time zone 'Europe/Paris', 'DD/MM HH24:MI') || ' (Paris)' from last_wake),
     (select status_code = 200 and content like '%"ok":true%' from last_wake)),
  ('Dernier réveil : clé des notifications acceptée',
     (select case when content like '%VAPID%' then 'refusée ou absente : recoller VAPID_PRIVATE_KEY puis Redeploy' else 'acceptée' end from last_wake),
     (select content not like '%VAPID%' from last_wake)),
  ('Dernier réveil : clé Resend (e-mails du matin)',
     (select case when content like '%RESEND_API_KEY missing%' then 'absente sur Vercel' else 'présente' end from last_wake),
     (select content not like '%RESEND_API_KEY missing%' from last_wake)),
  ('Réveil il y a moins de 15 min',
     (select to_char(now() - created, 'MI "min"') from last_wake),
     (select now() - created < interval '15 minutes' from last_wake)),
  ('Secret de l''horloge créé',
     (select case when exists (select 1 from public.app_config where key = 'cron_secret') then 'oui' else 'non' end),
     (select exists (select 1 from public.app_config where key = 'cron_secret'))),
  ('Vos deux voyages : propriétaire',
     (select string_agg(id || ' ' || case when owner is null then 'aucun' else 'oui' end, ' · ') from shared),
     (select bool_and(owner is not null) from shared)),
  ('Vos deux voyages : voyageurs',
     (select string_agg(m.trip_id || ' ' || m.role, ' · ' order by m.trip_id, m.role desc) from public.trip_members m where m.trip_id in ('sha-2026', 'gz-2026')),
     (select count(*) filter (where role = 'owner') = 2 and count(*) filter (where role = 'editor') >= 2 from public.trip_members where trip_id in ('sha-2026', 'gz-2026'))),
  ('Vos deux voyages : contenu complet sur le serveur',
     (select string_agg(id || ' ' || (select count(*) from jsonb_object_keys(data)) || ' champs', ' · ') from shared),
     (select bool_and(data ? 'days' and data ? 'flights' and data ? 'start' and data ? 'travellers') from shared)),
  ('Aucune perte depuis la migration (lieux, suivis, contacts, photos, épingles)',
     (select string_agg(x.id || ' ' ||
        (select count(*) from public.places p where p.trip_id = x.id) || '/' || (select count(*) from public.backup_20261118_places b where b.trip_id = x.id) || ' lieux', ' · ') from shared x),
     (select bool_and(
        (select count(*) from public.places p where p.trip_id = x.id) >= (select count(*) from public.backup_20261118_places b where b.trip_id = x.id)
        and (select count(*) from public.place_states s where s.trip_id = x.id) >= (select count(*) from public.backup_20261118_place_states b where b.trip_id = x.id)
        and (select count(*) from public.contacts c where c.trip_id = x.id) >= (select count(*) from public.backup_20261118_contacts b where b.trip_id = x.id)
        and (select count(*) from public.photos p where p.trip_id = x.id) >= (select count(*) from public.backup_20261118_photos b where b.trip_id = x.id)
        and (select count(*) from public.pins p where p.trip_id = x.id) >= (select count(*) from public.backup_20261118_pins b where b.trip_id = x.id)) from shared x)),
  ('Pro à vie pour vous deux',
     (select count(*) || ' compte(s) de l''espace partagé Pro à vie' from public.pro_grants g join auth.users u on u.id = g.user_id join public.members m on lower(m.email) = lower(u.email) where g.until is null),
     (select count(*) >= 2 from public.pro_grants g join auth.users u on u.id = g.user_id join public.members m on lower(m.email) = lower(u.email) where g.until is null)),
  ('Administrateurs',
     (select count(*) || ' compte(s)' from public.admins),
     (select count(*) >= 1 from public.admins)),
  ('Suivi par compte : actions des dernières 24 h',
     (select count(*) || ' actions, dont ' || count(*) filter (where city is not null) || ' avec ville' from public.events where at > now() - interval '24 hours'),
     true),
  ('Téléphones abonnés aux notifications',
     (select count(*) || '' from public.push_subscriptions),
     true),
  ('Adresses de transfert créées / réservations en attente',
     (select (select count(*) from public.inbound_tokens) || ' / ' || (select count(*) from public.inbound_items where status = 'new')),
     true),
  ('Comptes / voyages',
     (select (select count(*) from auth.users) || ' / ' || (select count(*) from public.trips)),
     true)
) as c(verification, resultat, ok);

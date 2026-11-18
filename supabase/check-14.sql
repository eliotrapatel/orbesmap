-- ORBES Trips — checks the cycle lot (supabase/saas-14.sql) inside Supabase (reads only, changes nothing, sends nothing).
-- Optional. Supabase → SQL Editor → New query → paste → Run, after saas-14.sql. One line per check: "ok" true = fine.
-- invite_preview and invite_claim are not called here (they note an opening or a claim).
select * from (values
  ('Tables mail_log, mail_optout, invite_mails',
     (select string_agg(t, ', ') from unnest(array['mail_log', 'mail_optout', 'invite_mails']) t where to_regclass('public.' || t) is not null),
     (select count(*) = 3 from unnest(array['mail_log', 'mail_optout', 'invite_mails']) t where to_regclass('public.' || t) is not null)),
  ('RLS active sur les trois tables',
     (select string_agg(relname || case when relrowsecurity then ' oui' else ' NON' end, ' · ') from pg_class
       where oid in (to_regclass('public.mail_log'), to_regclass('public.mail_optout'), to_regclass('public.invite_mails'))),
     (select count(*) = 3 and bool_and(relrowsecurity) from pg_class
       where oid in (to_regclass('public.mail_log'), to_regclass('public.mail_optout'), to_regclass('public.invite_mails')))),
  ('mail_log accepte le canal « none »',
     (select pg_get_constraintdef(oid) from pg_constraint where conname = 'mail_log_channel_check'),
     (select coalesce(bool_or(pg_get_constraintdef(oid) like '%none%'), false) from pg_constraint where conname = 'mail_log_channel_check')),
  ('Fonctions du cycle présentes',
     (select count(*) || ' / 9' from unnest(array['public.invite_preview(text)', 'public.invite_claim(text)', 'public.mail_optin()',
        'public.cycle_tips_ok(uuid,text)', 'public.cycle_first_trip(integer)', 'public.cycle_quota(integer)',
        'public.cycle_trip_people(text)', 'public.cycle_email_lang(text)', 'public.invite_mails_on_join()']) f where to_regprocedure(f) is not null),
     (select count(*) = 9 from unnest(array['public.invite_preview(text)', 'public.invite_claim(text)', 'public.mail_optin()',
        'public.cycle_tips_ok(uuid,text)', 'public.cycle_first_trip(integer)', 'public.cycle_quota(integer)',
        'public.cycle_trip_people(text)', 'public.cycle_email_lang(text)', 'public.invite_mails_on_join()']) f where to_regprocedure(f) is not null)),
  ('Déclencheur « rejoint » sur trip_members',
     (select coalesce(string_agg(tgname, ', '), 'absent') from pg_trigger where tgname = 'trip_members_invite_joined' and not tgisinternal),
     (select count(*) = 1 from pg_trigger where tgname = 'trip_members_invite_joined' and not tgisinternal)),
  ('J+3 sans voyage : comptes concernés aujourd''hui (lecture)',
     (select count(*)::text from public.cycle_first_trip(200)),
     true),
  ('Voyage du mois : comptes concernés (lecture)',
     (select count(*)::text from public.cycle_quota(200)),
     true),
  ('sha-2026 : voyageurs lus par le cycle (jamais de message J-2 / J-3 pour ce voyage)',
     (select count(*)::text from public.cycle_trip_people('sha-2026')),
     true),
  ('Aucune fonction serveur ouverte aux comptes',
     (select coalesce(string_agg(f, ', '), 'aucune') from unnest(array['public.cycle_first_trip(integer)', 'public.cycle_quota(integer)',
        'public.cycle_trip_people(text)', 'public.cycle_email_lang(text)']) f
       where to_regprocedure(f) is not null and has_function_privilege('authenticated', f, 'execute')),
     (select count(*) = 0 from unnest(array['public.cycle_first_trip(integer)', 'public.cycle_quota(integer)',
        'public.cycle_trip_people(text)', 'public.cycle_email_lang(text)']) f
       where to_regprocedure(f) is not null and has_function_privilege('authenticated', f, 'execute')))
) as c(check_name, value, ok);

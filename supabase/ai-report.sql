-- ORBES Trips — AI report for one account: every request, then the totals per step and per trip, then the grand total.
-- Change the e-mail and the period (hours) on the next line, then Run. Reads only.
with p as (select 'rfidout@gmail.com'::text as email, 6 as hours),
calls as (
  select x.*, t.data ->> 'title' as trip_title
  from public.ai_usage x
  join auth.users u on u.id = x.user_id
  left join public.trips t on t.id = x.trip_id
  cross join p
  where lower(u.email) = lower(p.email) and x.at > now() - make_interval(hours => p.hours)
),
labels(task, step) as (values
  ('intake', 'lecture de ce que vous avez collé'), ('concierge', 'échange avec le concierge'), ('extract', 'lecture d''une réservation'), ('outline', 'trame du voyage'),
  ('essentials', 'essentiel pratique'), ('day', 'préparation d''un jour'), ('adjust', 'ajustement en une phrase'),
  ('enrich', 'fiche complète d''un lieu'), ('place', 'recherche d''un lieu'), ('ask', 'question à l''assistant'),
  ('photo', 'photo traduite'), ('interpret', 'interprète'), ('inbound', 'réservation transférée')
)
select * from (
  -- 1. every request, in order
  select 1 as ordre, to_char(c.at at time zone 'Europe/Paris', 'DD/MM HH24:MI:SS') as quand,
         coalesce(l.step, c.task) as etape, coalesce(c.trip_title, c.trip_id, '') as voyage,
         case when c.ok then 'ok' else 'échec' || coalesce(' : ' || c.error, '') end as etat,
         c.tokens_cached as tokens_lus_cache, c.tokens_in as tokens_lus_nouveaux, c.tokens_out as tokens_ecrits,
         c.searches as recherches_web, c.fetches as pages_lues, round(c.ms / 1000.0, 1) as secondes,
         round(c.usd, 5) as cout_usd, coalesce(c.provider || ' ' || c.model, '') as modele
  from calls c left join labels l on l.task = c.task
  union all
  -- 2. totals per step
  select 2, 'TOTAL', coalesce(l.step, c.task) || ' (' || count(*) || ')', '', count(*) filter (where not c.ok) || ' échec(s)',
         sum(c.tokens_cached)::int, sum(c.tokens_in)::int, sum(c.tokens_out)::int, sum(c.searches)::int, sum(c.fetches)::int,
         round(sum(c.ms) / 1000.0, 1), round(sum(c.usd), 5), ''
  from calls c left join labels l on l.task = c.task group by coalesce(l.step, c.task)
  union all
  -- 3. totals per trip
  select 3, 'TOTAL VOYAGE', count(*) || ' demandes', coalesce(c.trip_title, c.trip_id, '(sans voyage)'), count(*) filter (where not c.ok) || ' échec(s)',
         sum(c.tokens_cached)::int, sum(c.tokens_in)::int, sum(c.tokens_out)::int, sum(c.searches)::int, sum(c.fetches)::int,
         round(sum(c.ms) / 1000.0, 1), round(sum(c.usd), 5), ''
  from calls c group by coalesce(c.trip_title, c.trip_id, '(sans voyage)')
  union all
  -- 4. grand total
  select 4, 'TOTAL GÉNÉRAL', count(*) || ' demandes', '', count(*) filter (where not c.ok) || ' échec(s)',
         sum(c.tokens_cached)::int, sum(c.tokens_in)::int, sum(c.tokens_out)::int, sum(c.searches)::int, sum(c.fetches)::int,
         round(sum(c.ms) / 1000.0, 1), round(sum(c.usd), 5), ''
  from calls c
) r
order by ordre, quand;

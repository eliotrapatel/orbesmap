-- ORBES Trips — the full detail of every AI request (Nov 2026).
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run). Safe to run twice.
-- Each request now keeps, besides its cost: the trip, the provider and model, the tokens read (from cache / new),
-- the tokens written, the web searches and pages read, the duration and, when it failed, why.
-- Report: supabase/ai-report.sql.
alter table public.ai_usage add column if not exists trip_id text;
alter table public.ai_usage add column if not exists provider text;
alter table public.ai_usage add column if not exists model text;
alter table public.ai_usage add column if not exists tokens_cached int;
alter table public.ai_usage add column if not exists tokens_in int;
alter table public.ai_usage add column if not exists tokens_out int;
alter table public.ai_usage add column if not exists searches int;
alter table public.ai_usage add column if not exists fetches int;
alter table public.ai_usage add column if not exists ms int;
alter table public.ai_usage add column if not exists error text;

create or replace function public.finish_ai_call2(p_id bigint, p_usd numeric, p_ok boolean, p_detail jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  update public.ai_usage set
    usd = greatest(0, least(p_usd, 10)), ok = p_ok,
    trip_id = left(p_detail ->> 'trip', 64), provider = left(p_detail ->> 'provider', 20), model = left(p_detail ->> 'model', 40),
    tokens_cached = case when p_detail ->> 'hit' ~ '^\d+$' then (p_detail ->> 'hit')::int end,
    tokens_in = case when p_detail ->> 'miss' ~ '^\d+$' then (p_detail ->> 'miss')::int end,
    tokens_out = case when p_detail ->> 'out' ~ '^\d+$' then (p_detail ->> 'out')::int end,
    searches = case when p_detail ->> 'search' ~ '^\d+$' then (p_detail ->> 'search')::int end,
    fetches = case when p_detail ->> 'fetch' ~ '^\d+$' then (p_detail ->> 'fetch')::int end,
    ms = case when p_detail ->> 'ms' ~ '^\d+$' then (p_detail ->> 'ms')::int end,
    error = left(p_detail ->> 'error', 200)
  where id = p_id and user_id = auth.uid();
$$;
revoke all on function public.finish_ai_call2(bigint, numeric, boolean, jsonb) from public, anon;
grant execute on function public.finish_ai_call2(bigint, numeric, boolean, jsonb) to authenticated;

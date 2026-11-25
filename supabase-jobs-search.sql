-- GoodFit: add job-search-engine results (Adzuna) on top of the company careers feeds.
-- Run in Supabase -> SQL Editor, after supabase-jobs.sql. Safe to run twice.

-- 1. Jobs no longer have to come from a company in job_sources: search results can be from any employer.
--    "source" says where a job came from ('feed' = a company careers feed, 'adzuna' = the search engine),
--    and "search_id" which saved search found it (used to close jobs that stop appearing).
alter table public.jobs drop constraint if exists jobs_company_fkey;
alter table public.jobs add column if not exists source text not null default 'feed';
alter table public.jobs add column if not exists search_id int;
alter table public.jobs add column if not exists salary_min int;
alter table public.jobs add column if not exists salary_max int;
create index if not exists jobs_search_idx on public.jobs (search_id);

-- 2. The searches to run every morning. Add rows to widen GoodFit (no code change needed).
--    what  = keywords, e.g. 'product manager'
--    where = a city as Adzuna knows it, e.g. 'Bangalore', 'Hyderabad', 'Pune', 'Chennai', or '' for all of India
--    max_pages = up to 50 results per page; 10 pages = up to 500 newest results for this search
create table if not exists public.job_searches (
  id serial primary key,
  provider text not null default 'adzuna' check (provider in ('adzuna')),
  what text not null,
  "where" text not null default '',
  max_pages int not null default 10 check (max_pages between 1 and 20),
  max_days_old int not null default 30,
  active boolean not null default true,
  last_fetched_at timestamptz,
  last_count int,
  last_error text,
  unique (provider, what, "where")
);

insert into public.job_searches (what, "where") values
  ('product manager', 'Bangalore'),
  ('product manager', 'Hyderabad'),
  ('product manager', 'Pune'),
  ('product manager', 'Chennai')
on conflict (provider, what, "where") do nothing;

alter table public.job_searches enable row level security;
drop policy if exists "job searches readable" on public.job_searches;
create policy "job searches readable" on public.job_searches for select to authenticated using (true);
grant select on public.job_searches to authenticated;
grant all on public.job_searches to service_role;
grant usage, select on sequence public.job_searches_id_seq to service_role;

-- 3. After adding the ADZUNA_APP_ID and ADZUNA_APP_KEY secrets and redeploying fetch-jobs (README step 8),
--    run a refresh now instead of waiting for 06:00:
-- select net.http_post(
--   url := (select decrypted_secret from vault.decrypted_secrets where name = 'goodfit_project_url') || '/functions/v1/fetch-jobs',
--   headers := jsonb_build_object(
--     'Content-Type', 'application/json',
--     'x-fetch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'goodfit_fetch_secret')),
--   body := '{}'::jsonb,
--   timeout_milliseconds := 120000);
--
-- Check it:  select what, "where", last_count, last_error from public.job_searches order by id;

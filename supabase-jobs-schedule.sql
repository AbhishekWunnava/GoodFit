-- GoodFit: refresh jobs every day at 06:00 India time (00:30 UTC).
-- Run in Supabase -> SQL Editor, after supabase-jobs.sql and after deploying the fetch-jobs function.
--
-- Before running:
--   1. Database -> Extensions: turn on "pg_cron" and "pg_net".
--   2. Replace the two values in step 1 below:
--      <PROJECT_URL>   your Project URL, e.g. https://abcd1234.supabase.co (same as SUPABASE_URL in config.js)
--      <FETCH_SECRET>  the same random text you saved as the FETCH_JOBS_SECRET function secret

-- 1. Keep the two values in Supabase's encrypted Vault (not in the job text).
select vault.create_secret('<PROJECT_URL>', 'goodfit_project_url');
select vault.create_secret('<FETCH_SECRET>', 'goodfit_fetch_secret');

-- 2. The daily schedule.
select cron.schedule('goodfit-fetch-jobs', '30 0 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'goodfit_project_url') || '/functions/v1/fetch-jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-fetch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'goodfit_fetch_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000);
$$);

-- 3. Fill the table now instead of waiting until tomorrow morning.
select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'goodfit_project_url') || '/functions/v1/fetch-jobs',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-fetch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'goodfit_fetch_secret')),
  body := '{}'::jsonb,
  timeout_milliseconds := 120000);

-- Useful later (run one line at a time):
-- How the last refresh went:  select company, last_fetched_at, last_count, last_error from public.job_sources order by company;
-- Open jobs per company:      select company, count(*) from public.jobs where closed_at is null group by 1 order by 2 desc;
-- Stop the daily refresh:     select cron.unschedule('goodfit-fetch-jobs');

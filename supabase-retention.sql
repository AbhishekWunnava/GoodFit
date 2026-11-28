-- GoodFit: account deletion and the 12-month retention rule (see privacy.html).
-- Run in Supabase -> SQL Editor AFTER deploying the `account` function (README step "Your data and retention").
-- Uses the same Vault values as the daily job refresh (supabase-jobs-schedule.sql).

-- 1. Let the account function (service role) delete a person's rows.
grant select, delete on public.profiles, public.resumes to service_role;

-- 2. Every day at 06:30 India time (01:00 UTC): delete accounts not signed in for 12 months,
--    and email / assistant log rows older than 12 months.
select cron.schedule('goodfit-retention', '0 1 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'goodfit_project_url') || '/functions/v1/account',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-fetch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'goodfit_fetch_secret')),
    body := '{"action":"retention"}'::jsonb,
    timeout_milliseconds := 120000);
$$);

-- 3. Check what it would delete today, without deleting anything (see the result with the query below):
select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'goodfit_project_url') || '/functions/v1/account',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-fetch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'goodfit_fetch_secret')),
  body := '{"action":"retention","dry_run":true}'::jsonb,
  timeout_milliseconds := 120000);

-- A few seconds later:  select status_code, content::text from net._http_response order by created desc limit 1;
-- Stop the rule:        select cron.unschedule('goodfit-retention');

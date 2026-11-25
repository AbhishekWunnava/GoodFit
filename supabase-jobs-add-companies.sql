-- GoodFit: follow 16 more companies, chosen because they post product manager roles in
-- Bengaluru, Hyderabad, Pune or Chennai on a public Greenhouse / Lever / Ashby feed.
-- Run in Supabase -> SQL Editor. Safe to run twice.

insert into public.job_sources (company, ats, board, industry, company_size) values
  ('Tekion',       'ashby',      'tekion',      'SaaS',          'Mid-size (501–5,000)'),     -- Bengaluru, Chennai
  ('Zenoti',       'greenhouse', 'zenoti',      'SaaS',          'Mid-size (501–5,000)'),     -- Hyderabad
  ('PubMatic',     'greenhouse', 'pubmatic',    'Media',         'Mid-size (501–5,000)'),     -- Pune
  ('Mindtickle',   'lever',      'mindtickle',  'SaaS',          'Mid-size (501–5,000)'),     -- Pune, Bengaluru
  ('FourKites',    'greenhouse', 'fourkites',   'Logistics',     'Mid-size (501–5,000)'),     -- Chennai
  ('Bureau',       'ashby',      'bureau',      'Fintech',       'Growth startup (51–500)'),
  ('SpotDraft',    'ashby',      'spotdraft',   'SaaS',          'Growth startup (51–500)'),
  ('FamPay',       'lever',      'fampay',      'Fintech',       'Growth startup (51–500)'),
  ('Hevo Data',    'lever',      'hevodata',    'SaaS',          'Growth startup (51–500)'),
  ('Sumo Logic',   'greenhouse', 'sumologic',   'SaaS',          'Mid-size (501–5,000)'),
  ('Rubrik',       'greenhouse', 'rubrik',      'SaaS',          'Mid-size (501–5,000)'),
  ('Harness',      'greenhouse', 'harnessinc',  'SaaS',          'Mid-size (501–5,000)'),
  ('Okta',         'greenhouse', 'okta',        'SaaS',          'Large / MNC (5,000+)'),
  ('Pure Storage', 'greenhouse', 'purestorage', 'SaaS',          'Large / MNC (5,000+)'),
  ('Glance',       'greenhouse', 'glance',      'Consumer tech', 'Mid-size (501–5,000)'),
  ('Netskope',     'greenhouse', 'netskope',    'SaaS',          'Mid-size (501–5,000)')
on conflict (company) do nothing;

-- Fetch their jobs now instead of waiting for tomorrow's 06:00 refresh.
select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'goodfit_project_url') || '/functions/v1/fetch-jobs',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-fetch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'goodfit_fetch_secret')),
  body := '{}'::jsonb,
  timeout_milliseconds := 120000);

-- After a minute, check:
-- select company, last_count, last_error from public.job_sources order by company;

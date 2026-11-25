-- GoodFit job feed: run in Supabase -> SQL Editor -> New query, AFTER supabase-setup.sql.
-- Creates the job tables. Run once. The daily refresh is set up in supabase-jobs-schedule.sql.

-- A1. Which companies to read. Add a row to follow a new company (no code change needed).
--     ats = 'greenhouse' | 'lever' | 'ashby'; board = the company's name in its careers URL,
--     e.g. job-boards.greenhouse.io/<board>, jobs.lever.co/<board>, jobs.ashbyhq.com/<board>.
create table if not exists public.job_sources (
  company text primary key,
  ats text not null check (ats in ('greenhouse', 'lever', 'ashby')),
  board text not null,
  industry text not null default 'Other',
  company_size text not null default 'Mid-size (501–5,000)',
  active boolean not null default true,
  last_fetched_at timestamptz,
  last_count int,
  last_error text
);

insert into public.job_sources (company, ats, board, industry, company_size) values
  ('Airbnb',     'greenhouse', 'airbnb',                         'Consumer tech', 'Large / MNC (5,000+)'),
  ('Atlan',      'ashby',      'atlan',                          'SaaS',          'Growth startup (51–500)'),
  ('CRED',       'lever',      'cred',                           'Fintech',       'Mid-size (501–5,000)'),
  ('Databricks', 'greenhouse', 'databricks',                     'AI / ML',       'Large / MNC (5,000+)'),
  ('Druva',      'greenhouse', 'druva',                          'SaaS',          'Mid-size (501–5,000)'),
  ('Figma',      'greenhouse', 'figma',                          'SaaS',          'Mid-size (501–5,000)'),
  ('GitLab',     'greenhouse', 'gitlab',                         'SaaS',          'Mid-size (501–5,000)'),
  ('Groww',      'greenhouse', 'groww',                          'Fintech',       'Mid-size (501–5,000)'),
  ('InMobi',     'greenhouse', 'inmobi',                         'Media',         'Mid-size (501–5,000)'),
  ('Meesho',     'lever',      'meesho',                         'E-commerce',    'Mid-size (501–5,000)'),
  ('Paytm',      'lever',      'paytm',                          'Fintech',       'Large / MNC (5,000+)'),
  ('Razorpay',   'greenhouse', 'razorpaysoftwareprivatelimited', 'Fintech',       'Mid-size (501–5,000)'),
  ('Stripe',     'greenhouse', 'stripe',                         'Fintech',       'Large / MNC (5,000+)'),
  ('Zeta',       'lever',      'zeta',                           'Fintech',       'Mid-size (501–5,000)')
on conflict (company) do nothing;

-- A2. The openings themselves. Filled only by the fetch-jobs function; users can only read.
--     closed_at is set when a posting disappears from the company's feed (and cleared if it comes back).
create table if not exists public.jobs (
  id text primary key,
  company text not null references public.job_sources(company) on delete cascade,
  industry text,
  company_size text,
  title text not null,
  location text,
  cities text[] not null default '{}',
  work_mode text,
  job_type text,
  department text,
  posted_at date,
  url text not null,
  exp_min int,
  exp_max int,
  description text not null default '',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists jobs_open_idx on public.jobs (closed_at, posted_at desc);
create index if not exists jobs_company_idx on public.jobs (company);

alter table public.job_sources enable row level security;
alter table public.jobs enable row level security;

drop policy if exists "job sources readable" on public.job_sources;
create policy "job sources readable" on public.job_sources for select to authenticated using (true);
drop policy if exists "jobs readable" on public.jobs;
create policy "jobs readable" on public.jobs for select to authenticated using (true);

-- Logged-in users can read; only the server function (service role) can write.
grant select on public.job_sources, public.jobs to authenticated;
grant all on public.job_sources, public.jobs to service_role;

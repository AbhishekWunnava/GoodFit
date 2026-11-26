-- GoodFit match emails: a log of every daily / weekly email sent (or failed).
-- The sender (GitHub Action, scripts/send-reports.mjs) uses it to know when each person last got one.
-- Run once in Supabase -> SQL Editor. Safe to run twice.
create table if not exists public.report_log (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  sent_at timestamptz not null default now(),
  frequency text not null,
  job_count int not null default 0,
  status text not null default 'sent' check (status in ('sent', 'failed')),
  error text
);
create index if not exists report_log_user_idx on public.report_log (user_id, sent_at desc);

alter table public.report_log enable row level security;
drop policy if exists "report log read own" on public.report_log;
create policy "report log read own" on public.report_log for select to authenticated using (auth.uid() = user_id);

grant select on public.report_log to authenticated;
grant all on public.report_log to service_role;
grant usage, select on sequence public.report_log_id_seq to service_role;

-- The sender reads every finished profile with the service role key.
grant select on public.profiles to service_role;

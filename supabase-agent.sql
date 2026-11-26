-- GoodFit agent: one row per model turn, so the agent function can apply usage limits
-- (30 typed messages an hour, 150 a day) and you can see token use per person.
-- Run once in Supabase -> SQL Editor. Safe to run twice.
create table if not exists public.agent_usage (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('message', 'tool')),  -- 'message' = the person typed; 'tool' = a tool round
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0
);
create index if not exists agent_usage_user_idx on public.agent_usage (user_id, kind, created_at desc);

alter table public.agent_usage enable row level security;
drop policy if exists "agent usage read own" on public.agent_usage;
create policy "agent usage read own" on public.agent_usage for select to authenticated using (auth.uid() = user_id);

grant select on public.agent_usage to authenticated;
grant all on public.agent_usage to service_role;
grant usage, select on sequence public.agent_usage_id_seq to service_role;

-- Handy: tokens per person in the last 7 days.
-- select user_id, count(*) filter (where kind = 'message') as messages, sum(input_tokens) as input, sum(output_tokens) as output
-- from public.agent_usage where created_at > now() - interval '7 days' group by 1 order by 3 desc;

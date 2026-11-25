-- Run this ONCE in Supabase: SQL Editor -> New query -> paste -> Run.

-- 1. Private storage bucket for resumes
insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;

-- 2. Each user can only touch files inside their own folder (folder name = their user id)
create policy "resumes read own" on storage.objects for select to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "resumes insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "resumes delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);

-- 3. A table that remembers each user's resume file
create table public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  file_path text not null,
  file_name text not null,
  created_at timestamptz not null default now()
);

alter table public.resumes enable row level security;

create policy "resumes table read own" on public.resumes for select to authenticated
  using (auth.uid() = user_id);
create policy "resumes table insert own" on public.resumes for insert to authenticated
  with check (auth.uid() = user_id);
create policy "resumes table delete own" on public.resumes for delete to authenticated
  using (auth.uid() = user_id);

-- 4. Each user's profile: details read from the resume + job preferences.
--    (Added in step 2. Safe to run on its own if you already ran the parts above.)
create table if not exists public.profiles (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  details jsonb not null default '{}'::jsonb,
  preferences jsonb not null default '{}'::jsonb,
  step text not null default 'resume',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles read own" on public.profiles for select to authenticated
  using (auth.uid() = user_id);
create policy "profiles insert own" on public.profiles for insert to authenticated
  with check (auth.uid() = user_id);
create policy "profiles update own" on public.profiles for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 5. Let logged-in users reach the tables at all. (Newer Supabase projects don't grant
--    this automatically.) The row-level rules above still limit each user to their own rows.
grant select, insert, delete on public.resumes to authenticated;
grant select, insert, update on public.profiles to authenticated;

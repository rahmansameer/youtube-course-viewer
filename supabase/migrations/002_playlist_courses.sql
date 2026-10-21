-- Playlist courses. Run once in the Supabase SQL Editor on a project that was
-- set up with an earlier supabase/schema.sql. It is safe to run again.

-- Lesson videos of a playlist live in course_videos like any other video, so
-- progress and notes work the same way; standalone = false keeps them off the
-- home page unless they were also added on their own.
alter table public.course_videos
  add column if not exists standalone boolean not null default true;

create table if not exists public.courses (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The YouTube playlist ID.
  id text not null,
  youtube_url text not null default '',
  title text not null default 'Untitled course',
  description text not null default '',
  channel text not null default '',
  thumbnail text not null default '',
  -- Lesson video IDs in playlist order.
  lesson_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists courses_user_created_idx
  on public.courses (user_id, created_at desc);

alter table public.courses enable row level security;
grant select, insert, update, delete on public.courses to authenticated;

drop policy if exists "Users can read their own courses" on public.courses;
create policy "Users can read their own courses"
  on public.courses for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can add their own courses" on public.courses;
create policy "Users can add their own courses"
  on public.courses for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own courses" on public.courses;
create policy "Users can update their own courses"
  on public.courses for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own courses" on public.courses;
create policy "Users can delete their own courses"
  on public.courses for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Make the new table and column visible to the REST API right away.
notify pgrst, 'reload schema';

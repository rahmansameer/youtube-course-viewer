create table if not exists public.course_videos (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  youtube_url text not null default '',
  title text not null default 'Untitled video',
  description text not null default '',
  thumbnail text not null default '',
  duration double precision,
  current_time_seconds double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  notes text not null default '',
  completed boolean not null default false,
  -- False for playlist lessons that weren't also added on their own.
  standalone boolean not null default true,
  primary key (user_id, id)
);

create index if not exists course_videos_user_created_idx
  on public.course_videos (user_id, created_at desc);

alter table public.course_videos enable row level security;
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.course_videos to authenticated;

drop policy if exists "Users can read their own course videos"
  on public.course_videos;
create policy "Users can read their own course videos"
  on public.course_videos for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can add their own course videos"
  on public.course_videos;
create policy "Users can add their own course videos"
  on public.course_videos for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own course videos"
  on public.course_videos;
create policy "Users can update their own course videos"
  on public.course_videos for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own course videos"
  on public.course_videos;
create policy "Users can delete their own course videos"
  on public.course_videos for delete
  to authenticated
  using ((select auth.uid()) = user_id);

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

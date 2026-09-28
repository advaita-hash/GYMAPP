-- GymApp ("Iron Pact") schema. Already applied to the shared Supabase project
-- (common-room / iltosbkrqufpjprxbnmz) on 2026-09-21 as migration
-- create_gymapp_schema. Kept here as the reference copy.
--
-- All tables are prefixed gym_ to stay isolated from the study app that shares
-- this project. Identity reuses auth.users + public.profiles (auto-created by
-- the existing handle_new_user trigger on signup).

-- Per-user gym profile (joining the gym app = having a row here)
create table public.gym_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  height_cm numeric(5,1) check (height_cm is null or (height_cm > 50 and height_cm < 280)),
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Body stats history (weight / body fat / muscle mass), one entry per user per day
create table public.gym_body_stats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  recorded_on date not null default current_date,
  weight_kg numeric(5,2) check (weight_kg is null or (weight_kg > 0 and weight_kg < 400)),
  body_fat_pct numeric(4,1) check (body_fat_pct is null or (body_fat_pct >= 0 and body_fat_pct <= 75)),
  muscle_mass_kg numeric(5,2) check (muscle_mass_kg is null or (muscle_mass_kg >= 0 and muscle_mass_kg < 200)),
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, recorded_on)
);
create index gym_body_stats_user_date on public.gym_body_stats (user_id, recorded_on desc);

-- Shared pool of punishment ideas, decided up front; one is drawn per week for the loser
create table public.gym_punishments (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  created_by uuid not null references public.profiles(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Day-wise weekly workout schedule. weekday: 0 = Monday ... 6 = Sunday
create table public.gym_schedule (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  weekday int not null check (weekday between 0 and 6),
  workout_type text not null check (workout_type in ('strength','cardio','sport','rest','other')),
  title text not null check (char_length(title) between 1 and 120),
  details text not null default '',
  time_label text not null default '',
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index gym_schedule_user on public.gym_schedule (user_id, weekday, position);

-- Logged workouts. Type-specific fields are nullable; photo_path points into gym-photos bucket
create table public.gym_workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  logged_on date not null default current_date,
  schedule_id uuid references public.gym_schedule(id) on delete set null,
  workout_type text not null check (workout_type in ('strength','cardio','sport','other')),
  title text not null check (char_length(title) between 1 and 120),
  duration_min int check (duration_min is null or (duration_min > 0 and duration_min <= 600)),
  distance_km numeric(6,2) check (distance_km is null or (distance_km > 0 and distance_km <= 300)),
  intensity text check (intensity is null or intensity in ('light','moderate','hard')),
  notes text not null default '',
  photo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index gym_workouts_user_date on public.gym_workouts (user_id, logged_on desc);
create index gym_workouts_date on public.gym_workouts (logged_on desc, created_at desc);

-- Strength detail: one row per set, enabling per-exercise progression tracking
create table public.gym_workout_sets (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.gym_workouts(id) on delete cascade,
  exercise text not null check (char_length(exercise) between 1 and 80),
  set_no int not null check (set_no between 1 and 50),
  reps int check (reps is null or (reps between 1 and 200)),
  weight_kg numeric(6,2) check (weight_kg is null or (weight_kg >= 0 and weight_kg <= 500)),
  created_at timestamptz not null default now()
);
create index gym_workout_sets_workout on public.gym_workout_sets (workout_id);

-- Daily non-negotiables (micro habits): e.g. 8 h sleep, 10k steps, 3 L water, 120 g protein
create table public.gym_habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  target_value numeric(8,2),
  unit text not null default '',
  direction text not null default 'at_least' check (direction in ('at_least','at_most')),
  position int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index gym_habits_user on public.gym_habits (user_id, position);

create table public.gym_habit_logs (
  habit_id uuid not null references public.gym_habits(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  log_date date not null,
  value numeric(8,2),
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (habit_id, log_date)
);
create index gym_habit_logs_user_date on public.gym_habit_logs (user_id, log_date desc);

-- Goals in three timeframes; resolved manually by their owner when the timeframe ends
create table public.gym_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  timeframe text not null check (timeframe in ('weekly','short_term','long_term')),
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '',
  target_date date,
  status text not null default 'active' check (status in ('active','achieved','missed')),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index gym_goals_user on public.gym_goals (user_id, status);

-- Finalized weekly leaderboard snapshot. week_start is always a Monday.
-- Any member can finalize a finished week; results are written for every member.
create table public.gym_week_results (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  points numeric(8,1) not null default 0,
  rank int not null,
  workouts_count int not null default 0,
  habits_completed int not null default 0,
  is_top2 boolean not null default false,
  is_last boolean not null default false,
  punishment_id uuid references public.gym_punishments(id) on delete set null,
  punishment_status text not null default 'none' check (punishment_status in ('none','pending','done','skipped')),
  punishment_done_at timestamptz,
  finalized_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (week_start, user_id)
);
create index gym_week_results_week on public.gym_week_results (week_start desc, rank);

-- ---------------------------------------------------------------------------
-- RLS: the whole friend group can SEE everything (that's the point of the app);
-- writes are restricted to the owner, except week results (anyone finalizes).
-- ---------------------------------------------------------------------------
alter table public.gym_profiles enable row level security;
alter table public.gym_body_stats enable row level security;
alter table public.gym_punishments enable row level security;
alter table public.gym_schedule enable row level security;
alter table public.gym_workouts enable row level security;
alter table public.gym_workout_sets enable row level security;
alter table public.gym_habits enable row level security;
alter table public.gym_habit_logs enable row level security;
alter table public.gym_goals enable row level security;
alter table public.gym_week_results enable row level security;

create policy "gym_profiles read" on public.gym_profiles for select to authenticated using (true);
create policy "gym_profiles insert own" on public.gym_profiles for insert to authenticated with check (user_id = auth.uid());
create policy "gym_profiles update own" on public.gym_profiles for update to authenticated using (user_id = auth.uid());
create policy "gym_profiles delete own" on public.gym_profiles for delete to authenticated using (user_id = auth.uid());

create policy "gym_body_stats read" on public.gym_body_stats for select to authenticated using (true);
create policy "gym_body_stats insert own" on public.gym_body_stats for insert to authenticated with check (user_id = auth.uid());
create policy "gym_body_stats update own" on public.gym_body_stats for update to authenticated using (user_id = auth.uid());
create policy "gym_body_stats delete own" on public.gym_body_stats for delete to authenticated using (user_id = auth.uid());

create policy "gym_punishments read" on public.gym_punishments for select to authenticated using (true);
create policy "gym_punishments insert own" on public.gym_punishments for insert to authenticated with check (created_by = auth.uid());
create policy "gym_punishments update own" on public.gym_punishments for update to authenticated using (created_by = auth.uid());
create policy "gym_punishments delete own" on public.gym_punishments for delete to authenticated using (created_by = auth.uid());

create policy "gym_schedule read" on public.gym_schedule for select to authenticated using (true);
create policy "gym_schedule insert own" on public.gym_schedule for insert to authenticated with check (user_id = auth.uid());
create policy "gym_schedule update own" on public.gym_schedule for update to authenticated using (user_id = auth.uid());
create policy "gym_schedule delete own" on public.gym_schedule for delete to authenticated using (user_id = auth.uid());

create policy "gym_workouts read" on public.gym_workouts for select to authenticated using (true);
create policy "gym_workouts insert own" on public.gym_workouts for insert to authenticated with check (user_id = auth.uid());
create policy "gym_workouts update own" on public.gym_workouts for update to authenticated using (user_id = auth.uid());
create policy "gym_workouts delete own" on public.gym_workouts for delete to authenticated using (user_id = auth.uid());

create policy "gym_workout_sets read" on public.gym_workout_sets for select to authenticated using (true);
create policy "gym_workout_sets insert own" on public.gym_workout_sets for insert to authenticated
  with check (exists (select 1 from public.gym_workouts w where w.id = workout_id and w.user_id = auth.uid()));
create policy "gym_workout_sets update own" on public.gym_workout_sets for update to authenticated
  using (exists (select 1 from public.gym_workouts w where w.id = workout_id and w.user_id = auth.uid()));
create policy "gym_workout_sets delete own" on public.gym_workout_sets for delete to authenticated
  using (exists (select 1 from public.gym_workouts w where w.id = workout_id and w.user_id = auth.uid()));

create policy "gym_habits read" on public.gym_habits for select to authenticated using (true);
create policy "gym_habits insert own" on public.gym_habits for insert to authenticated with check (user_id = auth.uid());
create policy "gym_habits update own" on public.gym_habits for update to authenticated using (user_id = auth.uid());
create policy "gym_habits delete own" on public.gym_habits for delete to authenticated using (user_id = auth.uid());

create policy "gym_habit_logs read" on public.gym_habit_logs for select to authenticated using (true);
create policy "gym_habit_logs insert own" on public.gym_habit_logs for insert to authenticated with check (user_id = auth.uid());
create policy "gym_habit_logs update own" on public.gym_habit_logs for update to authenticated using (user_id = auth.uid());
create policy "gym_habit_logs delete own" on public.gym_habit_logs for delete to authenticated using (user_id = auth.uid());

create policy "gym_goals read" on public.gym_goals for select to authenticated using (true);
create policy "gym_goals insert own" on public.gym_goals for insert to authenticated with check (user_id = auth.uid());
create policy "gym_goals update own" on public.gym_goals for update to authenticated using (user_id = auth.uid());
create policy "gym_goals delete own" on public.gym_goals for delete to authenticated using (user_id = auth.uid());

-- Week results: any signed-in member may finalize a week (writes rows for everyone)
-- and the loser marks their punishment done. Trust-based within the friend group.
create policy "gym_week_results read" on public.gym_week_results for select to authenticated using (true);
create policy "gym_week_results insert" on public.gym_week_results for insert to authenticated with check (auth.uid() is not null);
create policy "gym_week_results update" on public.gym_week_results for update to authenticated using (auth.uid() is not null);
create policy "gym_week_results delete" on public.gym_week_results for delete to authenticated using (auth.uid() is not null);

-- ---------------------------------------------------------------------------
-- Storage: private bucket for workout proof photos; app uses signed URLs.
-- Uploads must go into a folder named by the uploader's user id.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('gym-photos', 'gym-photos', false)
on conflict (id) do nothing;

create policy "gym-photos: signed-in read" on storage.objects for select to authenticated
  using (bucket_id = 'gym-photos');
create policy "gym-photos: upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'gym-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "gym-photos: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'gym-photos' and (storage.foldername(name))[1] = auth.uid()::text);

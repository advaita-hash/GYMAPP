-- Close the pact. Applied to the shared Supabase project (common-room /
-- iltosbkrqufpjprxbnmz) on 2026-09-21 as migration gymapp_invite_gate.
--
-- Before this, every gym_* read policy was `using (true)`, so ANY signed-in
-- account could read the crew's body stats, schedules and workout photos —
-- and Supabase signup is open to anyone who finds the app URL. Membership is
-- now explicit: you are in the pact only if you have a gym_profiles row, and
-- that row can only be created by redeeming an invite code via join_pact().

create table public.gym_pact_codes (
  code text primary key,
  label text not null default '',
  created_at timestamptz not null default now()
);
-- RLS on with NO policies: unreachable from the client API. Only the
-- SECURITY DEFINER function below ever reads it.
alter table public.gym_pact_codes enable row level security;

insert into public.gym_pact_codes (code, label) values ('IRONPACT', 'founding crew');

-- Membership test used by every gym_* policy. SECURITY DEFINER so it bypasses
-- RLS on gym_profiles and cannot recurse into the policy that calls it.
create or replace function public.is_pact_member()
returns boolean
language sql
security definer
stable
set search_path to 'public'
as $$
  select exists (select 1 from public.gym_profiles where user_id = auth.uid());
$$;

-- The only way into the pact. Codes compare case/space-insensitively.
create or replace function public.join_pact(p_code text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ok boolean;
begin
  if auth.uid() is null then
    return false;
  end if;
  select exists (
    select 1 from public.gym_pact_codes
    where upper(code) = upper(btrim(coalesce(p_code, '')))
  ) into v_ok;
  if not v_ok then
    return false;
  end if;
  insert into public.gym_profiles (user_id, onboarded)
  values (auth.uid(), false)
  on conflict (user_id) do nothing;
  return true;
end $$;

revoke execute on function public.join_pact(text) from anon;
revoke execute on function public.is_pact_member() from anon;

-- Reads: members only (was: every signed-in user).
drop policy "gym_profiles read" on public.gym_profiles;
create policy "gym_profiles read" on public.gym_profiles for select to authenticated
  using (user_id = auth.uid() or public.is_pact_member());

drop policy "gym_body_stats read" on public.gym_body_stats;
create policy "gym_body_stats read" on public.gym_body_stats for select to authenticated using (public.is_pact_member());
drop policy "gym_punishments read" on public.gym_punishments;
create policy "gym_punishments read" on public.gym_punishments for select to authenticated using (public.is_pact_member());
drop policy "gym_schedule read" on public.gym_schedule;
create policy "gym_schedule read" on public.gym_schedule for select to authenticated using (public.is_pact_member());
drop policy "gym_workouts read" on public.gym_workouts;
create policy "gym_workouts read" on public.gym_workouts for select to authenticated using (public.is_pact_member());
drop policy "gym_workout_sets read" on public.gym_workout_sets;
create policy "gym_workout_sets read" on public.gym_workout_sets for select to authenticated using (public.is_pact_member());
drop policy "gym_habits read" on public.gym_habits;
create policy "gym_habits read" on public.gym_habits for select to authenticated using (public.is_pact_member());
drop policy "gym_habit_logs read" on public.gym_habit_logs;
create policy "gym_habit_logs read" on public.gym_habit_logs for select to authenticated using (public.is_pact_member());
drop policy "gym_goals read" on public.gym_goals;
create policy "gym_goals read" on public.gym_goals for select to authenticated using (public.is_pact_member());
drop policy "gym_week_results read" on public.gym_week_results;
create policy "gym_week_results read" on public.gym_week_results for select to authenticated using (public.is_pact_member());

-- Writes: own rows AND a member of the pact.
drop policy "gym_profiles insert own" on public.gym_profiles;  -- join_pact() only

drop policy "gym_body_stats insert own" on public.gym_body_stats;
create policy "gym_body_stats insert own" on public.gym_body_stats for insert to authenticated
  with check (user_id = auth.uid() and public.is_pact_member());
drop policy "gym_punishments insert own" on public.gym_punishments;
create policy "gym_punishments insert own" on public.gym_punishments for insert to authenticated
  with check (created_by = auth.uid() and public.is_pact_member());
drop policy "gym_schedule insert own" on public.gym_schedule;
create policy "gym_schedule insert own" on public.gym_schedule for insert to authenticated
  with check (user_id = auth.uid() and public.is_pact_member());
drop policy "gym_workouts insert own" on public.gym_workouts;
create policy "gym_workouts insert own" on public.gym_workouts for insert to authenticated
  with check (user_id = auth.uid() and public.is_pact_member());
drop policy "gym_workout_sets insert own" on public.gym_workout_sets;
create policy "gym_workout_sets insert own" on public.gym_workout_sets for insert to authenticated
  with check (exists (select 1 from public.gym_workouts w where w.id = workout_id and w.user_id = auth.uid()));
drop policy "gym_habits insert own" on public.gym_habits;
create policy "gym_habits insert own" on public.gym_habits for insert to authenticated
  with check (user_id = auth.uid() and public.is_pact_member());
drop policy "gym_habit_logs insert own" on public.gym_habit_logs;
create policy "gym_habit_logs insert own" on public.gym_habit_logs for insert to authenticated
  with check (user_id = auth.uid() and public.is_pact_member());
drop policy "gym_goals insert own" on public.gym_goals;
create policy "gym_goals insert own" on public.gym_goals for insert to authenticated
  with check (user_id = auth.uid() and public.is_pact_member());

-- Week results stay writable by any MEMBER (anyone may finalize a week).
drop policy "gym_week_results insert" on public.gym_week_results;
create policy "gym_week_results insert" on public.gym_week_results for insert to authenticated with check (public.is_pact_member());
drop policy "gym_week_results update" on public.gym_week_results;
create policy "gym_week_results update" on public.gym_week_results for update to authenticated using (public.is_pact_member());
drop policy "gym_week_results delete" on public.gym_week_results;
create policy "gym_week_results delete" on public.gym_week_results for delete to authenticated using (public.is_pact_member());

-- Photos: members only.
drop policy "gym-photos: signed-in read" on storage.objects;
create policy "gym-photos: members read" on storage.objects for select to authenticated
  using (bucket_id = 'gym-photos' and public.is_pact_member());
drop policy "gym-photos: upload own folder" on storage.objects;
create policy "gym-photos: upload own folder" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'gym-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_pact_member()
  );

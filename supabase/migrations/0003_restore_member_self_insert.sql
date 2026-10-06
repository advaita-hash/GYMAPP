-- Regression fix. Applied to the shared Supabase project (common-room /
-- iltosbkrqufpjprxbnmz) on 2026-09-28 as migration
-- gymapp_restore_member_self_insert.
--
-- 0002 dropped the gym_profiles INSERT policy entirely, on the assumption that
-- join_pact() would be the only way a row is created. But the app performs an
-- idempotent
--   upsert({user_id, onboarded:false}, {onConflict:'user_id', ignoreDuplicates:true})
-- when it opens onboarding, and Postgres evaluates the INSERT policy BEFORE
-- ON CONFLICT DO NOTHING resolves -- so that call began raising 42501 even for
-- people whose row already existed. Anyone not yet marked onboarded therefore
-- hit an error every time they opened the app and could never finish setup or
-- save anything.
--
-- Allow a member to re-insert their own row (a no-op that satisfies the client)
-- while still refusing strangers: a non-member fails this check and must go
-- through join_pact(), which is SECURITY DEFINER and bypasses RLS.
create policy "gym_profiles insert own" on public.gym_profiles for insert to authenticated
  with check (user_id = auth.uid() and public.is_pact_member());

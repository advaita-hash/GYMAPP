// Shared data-fetch helpers. The crew is small (≈5 people), so we fetch raw rows
// for a date range and compute standings/recaps client-side with lib/points.ts —
// one transparent scoring implementation everywhere.

import { supabase } from './supabase'
import type {
  GymProfile, HabitLog, Member, Profile, Punishment, WeekResult, Workout, WorkoutSet,
} from './types'
import { MEMBER_COLORS } from './types'
import { addDays } from './dates'

/**
 * Everyone who has joined the gym app (has a gym_profiles row), with a stable
 * chart color slot assigned by join order (append-only, never re-derived).
 */
export async function fetchMembers(): Promise<Member[]> {
  const [{ data: gyms, error: e1 }, { data: profiles, error: e2 }] = await Promise.all([
    supabase.from('gym_profiles').select('*').order('created_at', { ascending: true }),
    supabase.from('profiles').select('id,name,color,created_at'),
  ])
  if (e1) throw e1
  if (e2) throw e2
  const byId = new Map((profiles as Profile[] | null)?.map((p) => [p.id, p]) ?? [])
  // The color slot comes from join order across the *unfiltered* list, so one
  // person leaving never repaints everyone who joined after them.
  return ((gyms as GymProfile[] | null) ?? [])
    .map((g, i) => ({ g, slot: i }))
    .filter(({ g }) => byId.has(g.user_id))
    .map(({ g, slot }) => {
      const p = byId.get(g.user_id)!
      return {
        id: g.user_id,
        name: p.name,
        color: MEMBER_COLORS[slot % MEMBER_COLORS.length],
        slot,
        gym: g,
      }
    })
}

export interface RangeBundle {
  workouts: Workout[]
  setsByWorkout: Map<string, WorkoutSet[]>
  habitLogs: HabitLog[]
}

/** All members' workouts (+sets) and habit logs for an inclusive date range. */
export async function fetchRangeBundle(start: string, end: string): Promise<RangeBundle> {
  const [{ data: workouts, error: e1 }, { data: habitLogs, error: e2 }] = await Promise.all([
    supabase
      .from('gym_workouts')
      .select('*')
      .gte('logged_on', start)
      .lte('logged_on', end)
      .order('created_at', { ascending: true }),
    supabase.from('gym_habit_logs').select('*').gte('log_date', start).lte('log_date', end),
  ])
  if (e1) throw e1
  if (e2) throw e2
  const ws = (workouts as Workout[] | null) ?? []
  const setsByWorkout = new Map<string, WorkoutSet[]>()
  if (ws.length > 0) {
    const ids = ws.map((w) => w.id)
    const { data: sets, error: e3 } = await supabase
      .from('gym_workout_sets')
      .select('*')
      .in('workout_id', ids)
      .order('set_no', { ascending: true })
    if (e3) throw e3
    for (const s of (sets as WorkoutSet[] | null) ?? []) {
      const list = setsByWorkout.get(s.workout_id) ?? []
      list.push(s)
      setsByWorkout.set(s.workout_id, list)
    }
  }
  return { workouts: ws, setsByWorkout, habitLogs: (habitLogs as HabitLog[] | null) ?? [] }
}

/** Week bundle: Monday..Sunday of the given week start. */
export function fetchWeekBundle(weekStart: string): Promise<RangeBundle> {
  return fetchRangeBundle(weekStart, addDays(weekStart, 6))
}

export async function fetchPunishments(): Promise<Punishment[]> {
  const { data, error } = await supabase
    .from('gym_punishments')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data as Punishment[] | null) ?? []
}

export async function fetchWeekResults(weekStarts?: string[]): Promise<WeekResult[]> {
  let q = supabase.from('gym_week_results').select('*').order('week_start', { ascending: false })
  if (weekStarts && weekStarts.length > 0) q = q.in('week_start', weekStarts)
  const { data, error } = await q
  if (error) throw error
  return (data as WeekResult[] | null) ?? []
}

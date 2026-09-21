// The scoring engine. One transparent rulebook, computed identically everywhere
// (live standings, week finalization, recaps). Keep POINT_RULES in sync with README.
//
//   Workout (only the first 2 workouts per day score):
//     base                 +20
//     duration             +1 per full 5 min, capped +12 (60 min)
//     cardio distance      +2 per full km, capped +20 (10 km)
//     strength exercises   +2 per distinct exercise, capped +12 (6)
//     intensity            light +2 / moderate +5 / hard +10
//     photo proof          +5
//   Habits:
//     +3 per completed habit-day, capped +15 per day (5 habits)

import type { HabitLog, Member, Workout, WorkoutSet } from './types'
import { INTENSITY_META } from './types'

export const POINT_RULES = [
  { label: 'Logging a workout', pts: '+20' },
  { label: 'Duration', pts: '+1 / 5 min (max +12)' },
  { label: 'Cardio distance', pts: '+2 / km (max +20)' },
  { label: 'Strength exercises', pts: '+2 each (max +12)' },
  { label: 'Intensity', pts: 'light +2 · moderate +5 · hard +10' },
  { label: 'Photo proof', pts: '+5' },
  { label: 'Micro habit done', pts: '+3 each (max +15 / day)' },
  { label: 'Daily cap', pts: 'first 2 workouts of the day score' },
]

export interface PointsBreakdown {
  total: number
  parts: { label: string; pts: number }[]
}

export function workoutPoints(w: Workout, sets: WorkoutSet[]): PointsBreakdown {
  const parts: { label: string; pts: number }[] = [{ label: 'Workout logged', pts: 20 }]
  if (w.duration_min && w.duration_min > 0) {
    const pts = Math.min(12, Math.floor(w.duration_min / 5))
    if (pts > 0) parts.push({ label: `${w.duration_min} min`, pts })
  }
  if (w.distance_km && w.distance_km > 0) {
    const pts = Math.min(20, Math.floor(w.distance_km) * 2)
    if (pts > 0) parts.push({ label: `${w.distance_km} km`, pts })
  }
  const exercises = new Set(sets.map((s) => s.exercise.trim().toLowerCase())).size
  if (exercises > 0) {
    parts.push({ label: `${exercises} exercise${exercises > 1 ? 's' : ''}`, pts: Math.min(12, exercises * 2) })
  }
  if (w.intensity) {
    parts.push({ label: `${INTENSITY_META[w.intensity].label} intensity`, pts: INTENSITY_META[w.intensity].pts })
  }
  if (w.photo_path) parts.push({ label: 'Photo proof', pts: 5 })
  return { total: parts.reduce((s, p) => s + p.pts, 0), parts }
}

/** Habit points for one day given how many habits were completed. */
export function habitDayPoints(completedCount: number): number {
  return Math.min(15, completedCount * 3)
}

/**
 * Whether a logged value satisfies a habit. Habits without a target are simple
 * check-offs (any log with `completed` true counts); value-based habits compare
 * against target in the habit's direction.
 */
export function isHabitComplete(
  habit: { target_value: number | null; direction: 'at_least' | 'at_most' },
  value: number | null,
): boolean {
  if (habit.target_value == null) return true
  if (value == null) return false
  return habit.direction === 'at_least' ? value >= habit.target_value : value <= habit.target_value
}

export interface StandingRow {
  userId: string
  name: string
  color: string
  points: number
  workoutPts: number
  habitPts: number
  workoutsCount: number
  habitsCompleted: number
  rank: number
  isTop2: boolean
  isLast: boolean
}

/**
 * Compute ranked standings for a set of members over any date range.
 * Only the first 2 workouts (by created_at) per member per day score points.
 * Ties are broken deterministically: workouts desc, habits desc, name asc.
 */
export function computeStandings(
  members: Member[],
  workouts: Workout[],
  setsByWorkout: Map<string, WorkoutSet[]>,
  habitLogs: HabitLog[],
): StandingRow[] {
  const rows = members.map((m) => {
    const mine = workouts
      .filter((w) => w.user_id === m.id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
    const byDay = new Map<string, number>()
    let workoutPts = 0
    for (const w of mine) {
      const n = byDay.get(w.logged_on) ?? 0
      byDay.set(w.logged_on, n + 1)
      if (n < 2) workoutPts += workoutPoints(w, setsByWorkout.get(w.id) ?? []).total
    }
    const myLogs = habitLogs.filter((l) => l.user_id === m.id && l.completed)
    const perDay = new Map<string, number>()
    for (const l of myLogs) perDay.set(l.log_date, (perDay.get(l.log_date) ?? 0) + 1)
    let habitPts = 0
    for (const count of perDay.values()) habitPts += habitDayPoints(count)
    return {
      userId: m.id,
      name: m.name,
      color: m.color,
      points: workoutPts + habitPts,
      workoutPts,
      habitPts,
      workoutsCount: mine.length,
      habitsCompleted: myLogs.length,
      rank: 0,
      isTop2: false,
      isLast: false,
    }
  })
  rows.sort(
    (a, b) =>
      b.points - a.points ||
      b.workoutsCount - a.workoutsCount ||
      b.habitsCompleted - a.habitsCompleted ||
      a.name.localeCompare(b.name),
  )
  rows.forEach((r, i) => {
    r.rank = i + 1
    r.isTop2 = i < 2
    r.isLast = i === rows.length - 1 && rows.length >= 2
  })
  return rows
}

/**
 * Deterministic weekly punishment draw: everyone finalizing the same week over
 * the same punishment pool picks the same one ("shuffled" each week).
 */
export function pickPunishment<T>(weekStart: string, pool: T[]): T | null {
  if (pool.length === 0) return null
  let h = 0
  for (let i = 0; i < weekStart.length; i++) h = (h * 31 + weekStart.charCodeAt(i)) >>> 0
  return pool[h % pool.length]
}

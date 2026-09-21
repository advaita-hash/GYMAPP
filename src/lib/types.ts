// Row types for the gym_* tables (see supabase/migrations). Weekday convention:
// 0 = Monday ... 6 = Sunday, everywhere in the app.

export type WorkoutType = 'strength' | 'cardio' | 'sport' | 'other'
export type ScheduleType = WorkoutType | 'rest'
export type Intensity = 'light' | 'moderate' | 'hard'
export type HabitDirection = 'at_least' | 'at_most'
export type GoalTimeframe = 'weekly' | 'short_term' | 'long_term'
export type GoalStatus = 'active' | 'achieved' | 'missed'
export type PunishmentStatus = 'none' | 'pending' | 'done' | 'skipped'

export interface Profile {
  id: string
  name: string
  color: string
  created_at: string
}

export interface GymProfile {
  user_id: string
  height_cm: number | null
  onboarded: boolean
  created_at: string
  updated_at: string
}

/** A crew member: base profile + gym profile, with a stable categorical color slot. */
export interface Member {
  id: string
  name: string
  /** Validated categorical chart color (assigned by join order, stable). */
  color: string
  slot: number
  gym: GymProfile
}

export interface BodyStat {
  id: string
  user_id: string
  recorded_on: string
  weight_kg: number | null
  body_fat_pct: number | null
  muscle_mass_kg: number | null
  notes: string
  created_at: string
}

export interface Punishment {
  id: string
  title: string
  created_by: string
  active: boolean
  created_at: string
}

export interface ScheduleEntry {
  id: string
  user_id: string
  weekday: number
  workout_type: ScheduleType
  title: string
  details: string
  time_label: string
  position: number
  created_at: string
  updated_at: string
}

export interface Workout {
  id: string
  user_id: string
  logged_on: string
  schedule_id: string | null
  workout_type: WorkoutType
  title: string
  duration_min: number | null
  distance_km: number | null
  intensity: Intensity | null
  notes: string
  photo_path: string | null
  created_at: string
  updated_at: string
}

export interface WorkoutSet {
  id: string
  workout_id: string
  exercise: string
  set_no: number
  reps: number | null
  weight_kg: number | null
  created_at: string
}

export interface Habit {
  id: string
  user_id: string
  name: string
  target_value: number | null
  unit: string
  direction: HabitDirection
  position: number
  active: boolean
  created_at: string
}

export interface HabitLog {
  habit_id: string
  user_id: string
  log_date: string
  value: number | null
  completed: boolean
  created_at: string
}

export interface Goal {
  id: string
  user_id: string
  timeframe: GoalTimeframe
  title: string
  description: string
  target_date: string | null
  status: GoalStatus
  resolved_at: string | null
  created_at: string
}

export interface WeekResult {
  id: string
  week_start: string
  user_id: string
  points: number
  rank: number
  workouts_count: number
  habits_completed: number
  is_top2: boolean
  is_last: boolean
  punishment_id: string | null
  punishment_status: PunishmentStatus
  punishment_done_at: string | null
  finalized_by: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Display metadata
// ---------------------------------------------------------------------------

export const WORKOUT_TYPE_META: Record<
  ScheduleType,
  { label: string; emoji: string; color: string; chip: string }
> = {
  strength: { label: 'Strength', emoji: '🏋️', color: '#9085e9', chip: 'bg-[#9085e9]/15 text-[#b9b2f2]' },
  cardio: { label: 'Cardio', emoji: '🏃', color: '#3987e5', chip: 'bg-[#3987e5]/15 text-[#7cb0ef]' },
  sport: { label: 'Sport', emoji: '🏀', color: '#d95926', chip: 'bg-[#d95926]/15 text-[#eb8c66]' },
  other: { label: 'Activity', emoji: '🚶', color: '#199e70', chip: 'bg-[#199e70]/15 text-[#4cc397]' },
  rest: { label: 'Rest', emoji: '😴', color: '#898781', chip: 'bg-white/5 text-faint' },
}

export const INTENSITY_META: Record<Intensity, { label: string; pts: number }> = {
  light: { label: 'Light', pts: 2 },
  moderate: { label: 'Moderate', pts: 5 },
  hard: { label: 'Hard', pts: 10 },
}

export interface PresetHabit {
  name: string
  target: number
  unit: string
  direction: HabitDirection
}

/**
 * The suggested daily non-negotiables, offered both during onboarding and on the
 * habits page. Both screens hide a preset the user already has by matching on
 * name, so this list lives in one place — two copies drifting by a single word
 * ("Screen" vs "Screen time") silently creates duplicate, double-scoring habits.
 */
export const PRESET_HABITS: PresetHabit[] = [
  { name: 'Sleep', target: 8, unit: 'h', direction: 'at_least' },
  { name: 'Steps', target: 10000, unit: 'steps', direction: 'at_least' },
  { name: 'Water', target: 3, unit: 'L', direction: 'at_least' },
  { name: 'Protein', target: 120, unit: 'g', direction: 'at_least' },
  { name: 'Screen time', target: 2, unit: 'h', direction: 'at_most' },
  { name: 'Study', target: 3, unit: 'h', direction: 'at_least' },
]

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * Validated categorical chart palette (dark-surface steps, fixed order — assigned
 * to members by join order and never re-derived from filtered lists).
 */
export const MEMBER_COLORS = [
  '#3987e5', // blue
  '#d95926', // orange
  '#199e70', // aqua
  '#c98500', // yellow
  '#d55181', // magenta
  '#008300', // green
  '#9085e9', // violet
  '#e66767', // red
]

/** Chart chrome tokens (dark mode) from the validated reference palette. */
export const CHART = {
  surface: '#1a1a19',
  grid: '#2c2c2a',
  axis: '#383835',
  muted: '#898781',
  ink: '#ffffff',
  sub: '#c3c2b7',
  seq: ['#86b6ef', '#5598e7', '#3987e5', '#256abf', '#184f95'], // ordinal-safe blue ramp
}

// Monthly recap — what the crew tangibly achieved this month and where each
// member can improve. Everything is computed live from raw logs with the same
// scoring rulebook (lib/points) as the weekly leaderboard.

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { BodyStat, Goal, Habit, HabitLog, Workout, WorkoutType } from '../lib/types'
import { WEEKDAYS, WORKOUT_TYPE_META } from '../lib/types'
import {
  addDays, currentMonthKey, fmtMonth, monthKeyOf, monthRange, parseISODate,
  prevMonthKey, toISODate, today, weekStartOf, weekdayOf,
} from '../lib/dates'
import { computeStandings } from '../lib/points'
import { fetchRangeBundle, type RangeBundle } from '../lib/data'
import { useAuth } from '../ctx/AuthContext'
import { PageHeader } from '../components/Layout'
import {
  Avatar, Button, Card, Chip, EmptyState, ErrorNote, ProgressBar, SectionTitle, Spinner,
} from '../components/ui'
import { CategoryBars, StatTile } from '../components/charts'

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

interface Totals {
  workouts: number
  activeDays: number
  durationMin: number
  distanceKm: number
  volumeKg: number
  habitsDone: number
}

/** Aggregate a bundle: counts, active (member, day) pairs, time, km, Σ reps×weight, habits done. */
function totals(bundle: RangeBundle): Totals {
  const days = new Set<string>()
  let durationMin = 0
  let distanceKm = 0
  let volumeKg = 0
  for (const w of bundle.workouts) {
    days.add(`${w.user_id}|${w.logged_on}`)
    durationMin += w.duration_min ?? 0
    distanceKm += w.distance_km ?? 0
    for (const s of bundle.setsByWorkout.get(w.id) ?? []) {
      volumeKg += (s.reps ?? 0) * (s.weight_kg ?? 0)
    }
  }
  return {
    workouts: bundle.workouts.length,
    activeDays: days.size,
    durationMin,
    distanceKm,
    volumeKg,
    habitsDone: bundle.habitLogs.filter((l) => l.completed).length,
  }
}

/** The bundle restricted to one member (sets map can stay shared). */
function memberBundle(bundle: RangeBundle, userId: string): RangeBundle {
  return {
    workouts: bundle.workouts.filter((w) => w.user_id === userId),
    setsByWorkout: bundle.setsByWorkout,
    habitLogs: bundle.habitLogs.filter((l) => l.user_id === userId),
  }
}

/** Signed number for delta subs and body changes, typographic minus. */
function fmtSigned(n: number, decimals = 0): string {
  const abs = Math.abs(n)
  return `${n < 0 ? '−' : '+'}${decimals > 0 ? abs.toFixed(decimals) : String(Math.round(abs))}`
}

/** "12.4 t" when ≥ 1000 kg, else "840 kg". */
function fmtVolume(kg: number): string {
  return kg >= 1000 ? `${(kg / 1000).toFixed(1)} t` : `${Math.round(kg)} kg`
}

function fmtVolumeSigned(kg: number): string {
  return `${kg < 0 ? '−' : '+'}${fmtVolume(Math.abs(kg))}`
}

function fmtDuration(min: number): string {
  return min >= 60 ? `${(min / 60).toFixed(1)} h` : `${Math.round(min)} min`
}

function nextMonthKey(mk: string): string {
  return monthKeyOf(addDays(monthRange(mk).end, 1))
}

/** Early in a month, the interesting recap is last month's. */
function defaultMonthKey(): string {
  return Number(today().slice(8, 10)) <= 7 ? prevMonthKey(currentMonthKey()) : currentMonthKey()
}

/** Inclusive day count between two ISO dates. */
function daysBetween(start: string, end: string): number {
  return Math.round((parseISODate(end).getTime() - parseISODate(start).getTime()) / 86400000) + 1
}

/** "15–21" — day numbers of a covered range, for tight chart ticks. */
function rangeLabel(from: string, to: string): string {
  return `${parseISODate(from).getDate()}–${parseISODate(to).getDate()}`
}

/**
 * Days of [start, lastDay] the habit actually existed for — a habit created
 * mid-month (or after the month) must not be charged for days before it existed.
 * `active` is a current flag, so paused habits still count for their past days.
 */
function habitDaysInWindow(h: Habit, start: string, lastDay: string): number {
  const created = toISODate(new Date(h.created_at))
  const from = created > start ? created : start
  return from > lastDay ? 0 : daysBetween(from, lastDay)
}

/** Last minus first non-null value of a body metric (needs ≥ 2 values). */
function metricDelta(
  stats: BodyStat[],
  key: 'weight_kg' | 'body_fat_pct' | 'muscle_mass_kg',
): number | null {
  const vals = stats.map((s) => s[key]).filter((v): v is number => v != null)
  if (vals.length < 2) return null
  return vals[vals.length - 1] - vals[0]
}

/** "Weight −0.8 kg · Fat −0.5% · Muscle +0.4 kg" from in-month stats, or "—". */
function bodyChangeLabel(stats: BodyStat[]): string {
  const parts: string[] = []
  const weight = metricDelta(stats, 'weight_kg')
  if (weight != null) parts.push(`Weight ${fmtSigned(weight, 1)} kg`)
  const fat = metricDelta(stats, 'body_fat_pct')
  if (fat != null) parts.push(`Fat ${fmtSigned(fat, 1)}%`)
  const muscle = metricDelta(stats, 'muscle_mass_kg')
  if (muscle != null) parts.push(`Muscle ${fmtSigned(muscle, 1)} kg`)
  return parts.length > 0 ? parts.join(' · ') : '—'
}

/** "🏋️ 6 · 🏃 4" — workout counts by type, biggest first. */
function workoutMix(workouts: Workout[]): string {
  const counts = new Map<WorkoutType, number>()
  for (const w of workouts) counts.set(w.workout_type, (counts.get(w.workout_type) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${WORKOUT_TYPE_META[t].emoji} ${n}`)
    .join(' · ')
}

/** The sharpest 1–2 things to fix next month, in priority order. */
function improveBullets(args: {
  habits: { id: string; name: string; days: number }[]
  habitLogs: HabitLog[]
  workouts: Workout[]
  bodyStats: BodyStat[]
}): string[] {
  const out: string[] = []
  let worst: { name: string; pct: number } | null = null
  for (const h of args.habits) {
    if (h.days <= 0) continue
    const done = args.habitLogs.filter((l) => l.habit_id === h.id && l.completed).length
    const pct = Math.min(100, Math.round((100 * done) / h.days))
    if (worst === null || pct < worst.pct) worst = { name: h.name, pct }
  }
  if (worst && worst.pct < 60) out.push(`${worst.name} slipped — ${worst.pct}%`)
  if (args.workouts.length > 0) {
    const byWeekday = [0, 0, 0, 0, 0, 0, 0]
    for (const w of args.workouts) byWeekday[weekdayOf(w.logged_on)] += 1
    const idle = byWeekday.findIndex((n) => n === 0)
    if (idle >= 0) out.push(`No sessions on ${WEEKDAYS[idle]}s`)
  }
  if (args.bodyStats.length === 0) out.push('Log your body stats')
  if (args.workouts.length > 0 && args.workouts.every((w) => !w.photo_path)) {
    out.push("No photo proof — pics or it didn't happen")
  }
  return out.slice(0, 2)
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

interface RecapData {
  bundle: RangeBundle
  prevBundle: RangeBundle
  bodyStats: BodyStat[]
  goals: Goal[]
  habits: Habit[]
}

async function loadRecap(mk: string): Promise<RecapData> {
  const { start, end } = monthRange(mk)
  const prev = monthRange(prevMonthKey(mk))
  const [bundle, prevBundle, statsRes, goalsRes, habitsRes] = await Promise.all([
    fetchRangeBundle(start, end),
    fetchRangeBundle(prev.start, prev.end),
    supabase.from('gym_body_stats').select('*').order('recorded_on', { ascending: true }),
    supabase.from('gym_goals').select('*'),
    // Every habit, not just the active ones: `active` is today's flag, but a
    // paused habit still existed (and counted) for the month being recapped.
    supabase.from('gym_habits').select('*'),
  ])
  if (statsRes.error) throw statsRes.error
  if (goalsRes.error) throw goalsRes.error
  if (habitsRes.error) throw habitsRes.error
  return {
    bundle,
    prevBundle,
    bodyStats: (statsRes.data as BodyStat[] | null) ?? [],
    goals: (goalsRes.data as Goal[] | null) ?? [],
    habits: (habitsRes.data as Habit[] | null) ?? [],
  }
}

function errMsg(e: unknown): string {
  if (e instanceof Error && e.message) return e.message
  const m = (e as { message?: unknown } | null)?.message
  return typeof m === 'string' && m ? m : 'Could not load the recap.'
}

// ---------------------------------------------------------------------------
// Local UI
// ---------------------------------------------------------------------------

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-sub shrink-0">{label}</span>
      <span className="text-ink text-right">{children}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RecapPage() {
  const { members } = useAuth()
  const [mk, setMk] = useState(defaultMonthKey)
  const [data, setData] = useState<RecapData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    loadRecap(mk)
      .then((d) => {
        if (alive) setData(d)
      })
      .catch((e: unknown) => {
        if (alive) setError(errMsg(e))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [mk])

  const view = useMemo(() => {
    if (!data || members.length === 0) return null
    const { start, end } = monthRange(mk)
    const crew = totals(data.bundle)
    const prev = totals(data.prevBundle)
    const standings = computeStandings(
      members, data.bundle.workouts, data.bundle.setsByWorkout, data.bundle.habitLogs,
    )
    const prevShort = fmtMonth(prevMonthKey(mk)).split(' ')[0].slice(0, 3)

    // Weekly crew points across every week overlapping the month. A week that
    // straddles the month boundary only holds the days inside the month, so it is
    // labelled by the range it actually covers and flagged as partial.
    const weeks: { label: string; value: number; partial: boolean }[] = []
    for (let ws = weekStartOf(start); ws <= end; ws = addDays(ws, 7)) {
      const wEnd = addDays(ws, 6)
      const from = ws < start ? start : ws
      const to = wEnd > end ? end : wEnd
      const wWorkouts = data.bundle.workouts.filter((w) => w.logged_on >= from && w.logged_on <= to)
      const wLogs = data.bundle.habitLogs.filter((l) => l.log_date >= from && l.log_date <= to)
      const pts = computeStandings(members, wWorkouts, data.bundle.setsByWorkout, wLogs)
        .reduce((sum, r) => sum + r.points, 0)
      const partial = from !== ws || to !== wEnd
      weeks.push({ label: `${rangeLabel(from, to)}${partial ? '*' : ''}`, value: pts, partial })
    }

    const lastDay = today() < end ? today() : end

    const cards = standings.map((row) => {
      const mine = memberBundle(data.bundle, row.userId)
      const t = totals(mine)
      const habitWindows = data.habits
        .filter((h) => h.user_id === row.userId)
        .map((h) => ({ id: h.id, name: h.name, days: habitDaysInWindow(h, start, lastDay) }))
      const denom = habitWindows.reduce((sum, h) => sum + h.days, 0)
      const adherencePct = denom > 0 ? Math.min(100, Math.round((100 * t.habitsDone) / denom)) : null
      const monthStats = data.bodyStats.filter(
        (s) => s.user_id === row.userId && s.recorded_on >= start && s.recorded_on <= end,
      )
      const resolved = data.goals.filter(
        (g) =>
          g.user_id === row.userId &&
          g.resolved_at != null &&
          toISODate(new Date(g.resolved_at)) >= start &&
          toISODate(new Date(g.resolved_at)) <= end,
      )
      return {
        row,
        t,
        mix: workoutMix(mine.workouts),
        adherencePct,
        bodyChange: bodyChangeLabel(monthStats),
        achieved: resolved.filter((g) => g.status === 'achieved').length,
        missed: resolved.filter((g) => g.status === 'missed').length,
        resolvedCount: resolved.length,
        bullets: improveBullets({
          habits: habitWindows,
          habitLogs: mine.habitLogs,
          workouts: mine.workouts,
          bodyStats: monthStats,
        }),
      }
    })

    return {
      empty: data.bundle.workouts.length === 0 && data.bundle.habitLogs.length === 0,
      crew,
      prev,
      prevShort,
      standings,
      weeks,
      cards,
    }
  }, [data, members, mk])

  const atCurrentMonth = mk >= currentMonthKey()
  const mvp = view?.standings[0]

  return (
    <div>
      <PageHeader title="Monthly recap" back subtitle={fmtMonth(mk)} />

      <div className="flex items-center justify-between gap-3 mb-2">
        <Button variant="soft" size="sm" aria-label="Previous month" onClick={() => setMk((k) => prevMonthKey(k))}>
          ‹
        </Button>
        <div className="text-sm font-semibold text-ink text-center flex-1">{fmtMonth(mk)}</div>
        <Button
          variant="soft"
          size="sm"
          aria-label="Next month"
          disabled={atCurrentMonth}
          onClick={() => setMk((k) => nextMonthKey(k))}
        >
          ›
        </Button>
      </div>

      {loading ? (
        <Spinner label="Crunching the month…" />
      ) : error ? (
        <ErrorNote message={error} />
      ) : !view ? null : view.empty ? (
        <div className="mt-4">
          <EmptyState
            emoji="📭"
            title={`Nothing logged in ${fmtMonth(mk)}`}
            hint="Workouts and habit check-ins land here as the crew logs them."
            action={
              atCurrentMonth ? (
                <Link to="/log">
                  <Button>Log a workout</Button>
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <SectionTitle>Crew totals</SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            <StatTile
              label="Workouts"
              value={view.crew.workouts}
              sub={`${fmtSigned(view.crew.workouts - view.prev.workouts)} vs ${view.prevShort}`}
            />
            <StatTile
              label="Hours trained"
              value={(view.crew.durationMin / 60).toFixed(1)}
              sub={`${fmtSigned((view.crew.durationMin - view.prev.durationMin) / 60, 1)} vs ${view.prevShort}`}
            />
            <StatTile
              label="Distance km"
              value={view.crew.distanceKm.toFixed(1)}
              sub={`${fmtSigned(view.crew.distanceKm - view.prev.distanceKm, 1)} vs ${view.prevShort}`}
            />
            <StatTile
              label="Volume lifted"
              value={fmtVolume(view.crew.volumeKg)}
              sub={`${fmtVolumeSigned(view.crew.volumeKg - view.prev.volumeKg)} vs ${view.prevShort}`}
            />
            <StatTile
              label="Habits done"
              value={view.crew.habitsDone}
              sub={`${fmtSigned(view.crew.habitsDone - view.prev.habitsDone)} vs ${view.prevShort}`}
            />
            <StatTile
              label="Active days"
              value={view.crew.activeDays}
              sub={`${fmtSigned(view.crew.activeDays - view.prev.activeDays)} vs ${view.prevShort}`}
            />
          </div>

          <SectionTitle>Crew points by week</SectionTitle>
          <Card>
            <CategoryBars data={view.weeks} unit="pts" />
            {view.weeks.some((w) => w.partial) && (
              <p className="text-[11px] text-faint mt-2 px-1">
                * Partial week — only the days inside {fmtMonth(mk)} are counted.
              </p>
            )}
          </Card>

          {mvp && (
            <>
              <SectionTitle>Month MVP</SectionTitle>
              <Card className="bg-accent/10 border-accent/40">
                <div className="flex items-center gap-3">
                  <div className="text-3xl" aria-hidden>
                    🏆
                  </div>
                  <Avatar name={mvp.name} color={mvp.color} size={40} />
                  <div className="min-w-0">
                    <div className="font-bold truncate">{mvp.name}</div>
                    <div className="text-sm text-sub">{mvp.points} pts this month</div>
                  </div>
                </div>
              </Card>
            </>
          )}

          <SectionTitle>Member recaps</SectionTitle>
          <div className="space-y-3">
            {view.cards.map((mc) => (
              <Card key={mc.row.userId}>
                <div className="flex items-center gap-3 mb-3">
                  <Avatar name={mc.row.name} color={mc.row.color} />
                  <div className="font-bold flex-1 truncate">{mc.row.name}</div>
                  <Chip className="bg-white/10 text-ink">{mc.row.points} pts</Chip>
                </div>
                <div className="space-y-2">
                  <Row label="Workouts">
                    {mc.t.workouts} total{mc.mix ? ` · ${mc.mix}` : ''}
                  </Row>
                  {mc.t.durationMin > 0 && <Row label="Time">{fmtDuration(mc.t.durationMin)}</Row>}
                  {mc.t.distanceKm > 0 && <Row label="Distance">{mc.t.distanceKm.toFixed(1)} km</Row>}
                  {mc.t.volumeKg > 0 && <Row label="Volume">{fmtVolume(mc.t.volumeKg)}</Row>}
                  <div>
                    <Row label="Habit adherence">
                      {mc.adherencePct != null ? `${mc.adherencePct}%` : '—'}
                    </Row>
                    {mc.adherencePct != null && (
                      <div className="mt-1.5">
                        <ProgressBar value={mc.adherencePct} max={100} color={mc.row.color} />
                      </div>
                    )}
                  </div>
                  <Row label="Body change">{mc.bodyChange}</Row>
                  <Row label="Goals">
                    {mc.resolvedCount > 0 ? `${mc.achieved} achieved · ${mc.missed} missed` : '—'}
                  </Row>
                </div>
                {mc.bullets.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-line space-y-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">
                      Improve next month
                    </div>
                    {mc.bullets.map((b) => (
                      <div key={b} className="text-xs text-warn/90">
                        • {b}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>

          <p className="text-xs text-faint text-center mt-6 px-4">
            Recaps are computed live from everyone's logs — same rulebook as the leaderboard.
          </p>
        </>
      )}
    </div>
  )
}

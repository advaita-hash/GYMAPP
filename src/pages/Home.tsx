// Home — the daily dashboard: pending punishment, today's plan & habits,
// live week standings and quick links. Everything loads in one parallel fetch.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type {
  Habit, HabitLog, Punishment, ScheduleEntry, WeekResult, Workout,
} from '../lib/types'
import { WORKOUT_TYPE_META } from '../lib/types'
import { currentWeekStart, fmtDate, fmtWeek, today, weekdayOf } from '../lib/dates'
import { computeStandings, habitDayPoints, isHabitComplete } from '../lib/points'
import {
  fetchPunishments, fetchWeekBundle, fetchWeekResults, type RangeBundle,
} from '../lib/data'
import { useAuth } from '../ctx/AuthContext'
import { PageHeader } from '../components/Layout'
import {
  Avatar, Button, Card, Chip, EmptyState, ErrorNote, Input, ProgressBar,
  SectionTitle, Spinner,
} from '../components/ui'

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

interface HomeData {
  weekResults: WeekResult[]
  punishments: Punishment[]
  mySchedule: ScheduleEntry[]
  todaysWorkouts: Workout[]
  habits: Habit[]
  todayLogs: HabitLog[]
  week: RangeBundle
}

async function fetchAll(userId: string): Promise<HomeData> {
  const iso = today()
  const [weekResults, punishments, week, scheduleRes, workoutsRes, habitsRes, logsRes] =
    await Promise.all([
      fetchWeekResults(),
      fetchPunishments(),
      fetchWeekBundle(currentWeekStart()),
      supabase
        .from('gym_schedule')
        .select('*')
        .eq('user_id', userId)
        .order('position', { ascending: true }),
      supabase.from('gym_workouts').select('*').eq('user_id', userId).eq('logged_on', iso),
      supabase
        .from('gym_habits')
        .select('*')
        .eq('user_id', userId)
        .eq('active', true)
        .order('position', { ascending: true }),
      supabase.from('gym_habit_logs').select('*').eq('user_id', userId).eq('log_date', iso),
    ])
  if (scheduleRes.error) throw scheduleRes.error
  if (workoutsRes.error) throw workoutsRes.error
  if (habitsRes.error) throw habitsRes.error
  if (logsRes.error) throw logsRes.error
  return {
    weekResults,
    punishments,
    week,
    mySchedule: (scheduleRes.data as ScheduleEntry[] | null) ?? [],
    todaysWorkouts: (workoutsRes.data as Workout[] | null) ?? [],
    habits: (habitsRes.data as Habit[] | null) ?? [],
    todayLogs: (logsRes.data as HabitLog[] | null) ?? [],
  }
}

function errMsg(e: unknown): string {
  if (
    e &&
    typeof e === 'object' &&
    'message' in e &&
    typeof (e as { message: unknown }).message === 'string'
  ) {
    return (e as { message: string }).message
  }
  return 'Something went wrong.'
}

// ---------------------------------------------------------------------------
// Local pieces
// ---------------------------------------------------------------------------

function SectionLink({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className="text-xs font-medium text-accent active:opacity-70">
      {children}
    </Link>
  )
}

function PlanEntryCard({ entry, done }: { entry: ScheduleEntry; done: boolean }) {
  const meta = WORKOUT_TYPE_META[entry.workout_type]
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Chip className={meta.chip}>
            {meta.emoji} {meta.label}
          </Chip>
          {done && <Chip className="bg-good/20 text-good">✓ Done</Chip>}
        </div>
        {entry.time_label && (
          <span className="text-[11px] text-faint shrink-0">{entry.time_label}</span>
        )}
      </div>
      <div className="font-semibold mt-1.5">{entry.title}</div>
      {entry.details && <div className="text-sm text-sub mt-0.5">{entry.details}</div>}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Home() {
  const { me, members } = useAuth()
  const nav = useNavigate()
  const myId = me?.id ?? ''

  const [data, setData] = useState<HomeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [busyPunishment, setBusyPunishment] = useState<string | null>(null)
  const [busyHabit, setBusyHabit] = useState<string | null>(null)
  const [expandedHabit, setExpandedHabit] = useState<string | null>(null)
  const [draftValue, setDraftValue] = useState('')

  const reload = useCallback(async () => {
    if (!myId) return
    setData(await fetchAll(myId))
  }, [myId])

  useEffect(() => {
    if (!myId) return
    let cancelled = false
    setLoading(true)
    fetchAll(myId)
      .then((d) => {
        if (!cancelled) {
          setData(d)
          setError(null)
        }
      })
      .catch((e) => {
        if (!cancelled) setError(errMsg(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [myId])

  // ---- derived --------------------------------------------------------------

  const todayISO = today()
  const firstName = me ? me.name.split(/\s+/)[0] : ''

  const pendingPunishments = useMemo(
    () =>
      (data?.weekResults ?? []).filter(
        (r) => r.user_id === myId && r.punishment_status === 'pending',
      ),
    [data, myId],
  )

  const todayPlan = useMemo(
    () => (data?.mySchedule ?? []).filter((e) => e.weekday === weekdayOf(todayISO)),
    [data, todayISO],
  )

  const entryDone = useCallback(
    (entry: ScheduleEntry) =>
      (data?.todaysWorkouts ?? []).some(
        (w) =>
          w.schedule_id === entry.id ||
          (w.schedule_id == null && w.workout_type === entry.workout_type),
      ),
    [data],
  )

  const actionableEntries = todayPlan.filter((e) => e.workout_type !== 'rest')
  const allPlannedDone =
    actionableEntries.length > 0 && actionableEntries.every((e) => entryDone(e))

  const logByHabit = useMemo(() => {
    const map = new Map<string, HabitLog>()
    for (const l of data?.todayLogs ?? []) map.set(l.habit_id, l)
    return map
  }, [data])

  const habitsDoneCount = (data?.habits ?? []).filter(
    (h) => logByHabit.get(h.id)?.completed ?? false,
  ).length

  const standings = useMemo(
    () =>
      data
        ? computeStandings(members, data.week.workouts, data.week.setsByWorkout, data.week.habitLogs)
        : [],
    [data, members],
  )

  // ---- mutations ------------------------------------------------------------

  async function markPunishmentDone(row: WeekResult) {
    setBusyPunishment(row.id)
    setActionError(null)
    try {
      const { error: err } = await supabase
        .from('gym_week_results')
        .update({ punishment_status: 'done', punishment_done_at: new Date().toISOString() })
        .eq('id', row.id)
      if (err) throw err
      await reload()
    } catch (e) {
      setActionError(errMsg(e))
    } finally {
      setBusyPunishment(null)
    }
  }

  async function toggleHabit(habit: Habit) {
    setBusyHabit(habit.id)
    setActionError(null)
    try {
      const current = logByHabit.get(habit.id)?.completed ?? false
      const { error: err } = await supabase.from('gym_habit_logs').upsert(
        { habit_id: habit.id, user_id: myId, log_date: todayISO, completed: !current },
        { onConflict: 'habit_id,log_date' },
      )
      if (err) throw err
      await reload()
    } catch (e) {
      setActionError(errMsg(e))
    } finally {
      setBusyHabit(null)
    }
  }

  async function saveHabitValue(habit: Habit) {
    const raw = draftValue.trim()
    const value = raw === '' ? null : Number(raw)
    if (value != null && Number.isNaN(value)) {
      setActionError('Enter a valid number.')
      return
    }
    setBusyHabit(habit.id)
    setActionError(null)
    try {
      const { error: err } = await supabase.from('gym_habit_logs').upsert(
        {
          habit_id: habit.id,
          user_id: myId,
          log_date: todayISO,
          value,
          completed: isHabitComplete(habit, value),
        },
        { onConflict: 'habit_id,log_date' },
      )
      if (err) throw err
      await reload()
      setExpandedHabit(null)
    } catch (e) {
      setActionError(errMsg(e))
    } finally {
      setBusyHabit(null)
    }
  }

  // ---- render ---------------------------------------------------------------

  const header = (
    <PageHeader title={`Hey ${firstName}`} subtitle={fmtDate(todayISO)} />
  )

  if (loading) {
    return (
      <div>
        {header}
        <Spinner label="Loading your day…" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div>
        {header}
        <ErrorNote message={error ?? 'Could not load the dashboard.'} />
        <div className="mt-3">
          <Button
            variant="soft"
            onClick={() => {
              setError(null)
              setLoading(true)
              fetchAll(myId)
                .then((d) => setData(d))
                .catch((e) => setError(errMsg(e)))
                .finally(() => setLoading(false))
            }}
          >
            Try again
          </Button>
        </div>
      </div>
    )
  }

  const quickLinks = [
    { emoji: '📈', label: 'Stats', to: '/stats' },
    { emoji: '🗓', label: 'Schedule', to: '/schedule' },
    { emoji: '✅', label: 'Habits', to: '/habits' },
    { emoji: '🎯', label: 'Goals', to: '/goals' },
    { emoji: '📆', label: 'Recap', to: '/recap' },
    { emoji: '⚖️', label: 'Rules', to: '/leaderboard' },
  ]

  return (
    <div>
      {header}

      {actionError && (
        <div className="mb-3">
          <ErrorNote message={actionError} />
        </div>
      )}

      {/* 1 — Pending punishment banner */}
      {pendingPunishments.map((row) => {
        const title =
          data.punishments.find((p) => p.id === row.punishment_id)?.title ?? 'Punishment'
        return (
          <Card key={row.id} className="border-warn/40 bg-warn/10 mb-3">
            <div className="font-semibold">💀 Punishment due — {title}</div>
            <div className="text-xs text-sub mt-0.5">
              Week of {fmtWeek(row.week_start)} — finish it before the crew notices.
            </div>
            <div className="mt-3">
              <Button
                size="sm"
                onClick={() => markPunishmentDone(row)}
                disabled={busyPunishment === row.id}
              >
                {busyPunishment === row.id ? 'Saving…' : 'Mark done'}
              </Button>
            </div>
          </Card>
        )
      })}

      {/* 2 — Today's plan */}
      <SectionTitle action={<SectionLink to="/schedule">Edit →</SectionLink>}>
        Today's plan
      </SectionTitle>
      {todayPlan.length > 0 ? (
        <div className="space-y-2">
          {todayPlan.map((entry) => (
            <PlanEntryCard key={entry.id} entry={entry} done={entryDone(entry)} />
          ))}
        </div>
      ) : data.mySchedule.length > 0 ? (
        <div className="text-sm text-faint px-1 py-2">Rest / nothing planned today 😌</div>
      ) : (
        <EmptyState
          emoji="🗓"
          title="No workout schedule yet"
          hint="Plan your week so the crew knows what you're committing to."
          action={<Button onClick={() => nav('/schedule')}>Set up my schedule</Button>}
        />
      )}
      {data.mySchedule.length > 0 && (
        <div className="mt-3">
          {allPlannedDone ? (
            <Button variant="soft" full onClick={() => nav('/log')}>
              Log another
            </Button>
          ) : (
            <Button full onClick={() => nav('/log')}>
              Log a workout
            </Button>
          )}
        </div>
      )}

      {/* 3 — Today's habits */}
      <SectionTitle action={<SectionLink to="/habits">Manage →</SectionLink>}>
        Today's habits
      </SectionTitle>
      {data.habits.length === 0 ? (
        <EmptyState
          emoji="✅"
          title="No micro habits yet"
          hint="Add your daily non-negotiables — sleep, steps, water, protein…"
          action={<Button onClick={() => nav('/habits')}>Add habits</Button>}
        />
      ) : (
        <Card>
          <div className="divide-y divide-line">
            {data.habits.map((habit) => {
              const log = logByHabit.get(habit.id)
              const done = log?.completed ?? false
              const hasTarget = habit.target_value != null
              const expanded = expandedHabit === habit.id
              return (
                <div key={habit.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{habit.name}</div>
                      {hasTarget && (
                        <div className="text-[11px] text-faint mt-0.5">
                          {habit.direction === 'at_least' ? '≥' : '≤'} {habit.target_value}{' '}
                          {habit.unit}
                        </div>
                      )}
                    </div>
                    {hasTarget ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (expanded) {
                            setExpandedHabit(null)
                          } else {
                            setExpandedHabit(habit.id)
                            setDraftValue(log?.value != null ? String(log.value) : '')
                          }
                        }}
                        className={`text-sm font-semibold px-3 py-1.5 rounded-xl border transition-colors ${
                          done
                            ? 'border-accent/50 bg-accent/10 text-accent'
                            : 'border-line bg-raised text-sub active:bg-white/10'
                        }`}
                      >
                        {log?.value != null ? `${log.value} ${habit.unit}` : '—'}
                        {done ? ' ✓' : ''}
                      </button>
                    ) : (
                      <button
                        type="button"
                        aria-label={`${habit.name}: ${done ? 'mark not done' : 'mark done'}`}
                        onClick={() => toggleHabit(habit)}
                        disabled={busyHabit === habit.id}
                        className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-colors disabled:opacity-40 ${
                          done
                            ? 'border-accent bg-accent/15 text-accent'
                            : 'border-line text-transparent active:bg-white/10'
                        }`}
                      >
                        ●
                      </button>
                    )}
                  </div>
                  {expanded && (
                    <div className="flex items-center gap-2 mt-2">
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={draftValue}
                        onChange={(e) => setDraftValue(e.target.value)}
                        placeholder={`${habit.target_value} ${habit.unit}`}
                        autoFocus
                      />
                      <Button
                        size="sm"
                        onClick={() => saveHabitValue(habit)}
                        disabled={busyHabit === habit.id}
                      >
                        {busyHabit === habit.id ? 'Saving…' : 'Save'}
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className="mt-3 pt-3 border-t border-line">
            <ProgressBar value={habitsDoneCount} max={data.habits.length} />
            <div className="flex items-center justify-between text-xs mt-1.5">
              <span className="text-sub">
                {habitsDoneCount}/{data.habits.length} done
              </span>
              <span className="font-semibold text-accent">
                +{habitDayPoints(habitsDoneCount)} pts today
              </span>
            </div>
          </div>
        </Card>
      )}

      {/* 4 — This week */}
      <SectionTitle action={<SectionLink to="/leaderboard">Leaderboard →</SectionLink>}>
        This week
      </SectionTitle>
      <Card>
        <div className="text-[11px] text-faint px-2 mb-1">{fmtWeek(currentWeekStart())}</div>
        {standings.length === 0 ? (
          <div className="text-sm text-faint px-2 py-2">No crew members yet.</div>
        ) : (
          standings.map((row) => {
            const mine = row.userId === myId
            return (
              <div
                key={row.userId}
                className={`flex items-center gap-3 px-2 py-1.5 ${
                  mine ? 'ring-1 ring-accent rounded-lg' : ''
                }`}
              >
                <span className="w-4 text-right text-xs font-semibold text-faint shrink-0">
                  {row.rank}
                </span>
                <Avatar name={row.name} color={row.color} size={28} />
                <span className="flex-1 min-w-0 text-sm font-medium truncate">
                  {row.name.split(/\s+/)[0]}
                </span>
                <span className="text-sm font-bold">
                  {row.points} <span className="text-[11px] font-medium text-faint">pts</span>
                </span>
              </div>
            )
          })
        )}
      </Card>

      {/* 5 — Quick links */}
      <div className="grid grid-cols-3 gap-2 mt-6">
        {quickLinks.map((link) => (
          <Card key={link.to} onClick={() => nav(link.to)} className="text-center py-3">
            <div className="text-xl" aria-hidden>
              {link.emoji}
            </div>
            <div className="text-[11px] font-medium text-sub mt-1">{link.label}</div>
          </Card>
        ))}
      </div>
    </div>
  )
}

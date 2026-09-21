import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../components/Layout'
import {
  Avatar,
  Button,
  Card,
  ConfirmButton,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  ProgressBar,
  SectionTitle,
  Segmented,
  Sheet,
  Spinner,
} from '../components/ui'
import { useAuth } from '../ctx/AuthContext'
import { supabase } from '../lib/supabase'
import type { Habit, HabitDirection, HabitLog, Member, PresetHabit } from '../lib/types'
import { PRESET_HABITS, WEEKDAYS_SHORT } from '../lib/types'
import { addDays, currentWeekStart, fmtDate, today, weekDates, weekdayOf } from '../lib/dates'
import { habitDayPoints, isHabitComplete } from '../lib/points'

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

type Preset = PresetHabit


function dirSym(d: HabitDirection): string {
  return d === 'at_least' ? '≥' : '≤'
}

function targetLabel(h: Habit): string {
  if (h.target_value == null) return 'check-off'
  return `${dirSym(h.direction)} ${h.target_value}${h.unit ? ` ${h.unit}` : ''}`
}

interface CrewRow {
  member: Member
  done: number
  possible: number
  pct: number
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HabitsPage() {
  const { me, loading } = useAuth()
  return (
    <div>
      <PageHeader title="Habits" back subtitle="Daily non-negotiables" />
      {me ? (
        <HabitsBody me={me} />
      ) : loading ? (
        <Spinner />
      ) : (
        <ErrorNote message="Finish setting up your profile to manage habits." />
      )}
    </div>
  )
}

function HabitsBody({ me }: { me: Member }) {
  const { members } = useAuth()

  const [habits, setHabits] = useState<Habit[] | null>(null)
  const [logs, setLogs] = useState<HabitLog[]>([])
  const [loadError, setLoadError] = useState('')

  // Grid tap state
  const [savingCell, setSavingCell] = useState<string | null>(null)
  const [gridError, setGridError] = useState('')

  // Value-log sheet
  const [valueSheet, setValueSheet] = useState<{ habit: Habit; date: string } | null>(null)
  const [valueInput, setValueInput] = useState('')
  const [valueBusy, setValueBusy] = useState(false)
  const [valueError, setValueError] = useState('')

  // Edit/new habit sheet
  const [editSheet, setEditSheet] = useState<{ habit: Habit | null } | null>(null)
  const [fName, setFName] = useState('')
  const [fTarget, setFTarget] = useState('')
  const [fUnit, setFUnit] = useState('')
  const [fDirection, setFDirection] = useState<HabitDirection>('at_least')
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState('')

  // Preset quick-adds
  const [presetBusy, setPresetBusy] = useState<string | null>(null)
  const [manageError, setManageError] = useState('')

  const weekStart = currentWeekStart()
  const weekEnd = addDays(weekStart, 6)
  const week = useMemo(() => weekDates(weekStart), [weekStart])
  const todayIso = today()
  const todayIdx = weekdayOf(todayIso)
  const elapsed = todayIdx + 1 // days of this week incl. today

  const load = useCallback(async () => {
    setLoadError('')
    const [h, l] = await Promise.all([
      supabase.from('gym_habits').select('*').order('position', { ascending: true }),
      supabase.from('gym_habit_logs').select('*').gte('log_date', weekStart).lte('log_date', weekEnd),
    ])
    const err = h.error ?? l.error
    if (err) {
      setLoadError(err.message)
      return
    }
    setHabits((h.data as Habit[] | null) ?? [])
    setLogs((l.data as HabitLog[] | null) ?? [])
  }, [weekStart, weekEnd])

  useEffect(() => {
    void load()
  }, [load])

  // -------------------------------------------------------------------------
  // Derived data
  // -------------------------------------------------------------------------

  const myAll = useMemo(
    () =>
      (habits ?? [])
        .filter((h) => h.user_id === me.id)
        .sort(
          (a, b) =>
            Number(b.active) - Number(a.active) ||
            a.position - b.position ||
            a.created_at.localeCompare(b.created_at),
        ),
    [habits, me.id],
  )
  const myActive = useMemo(() => myAll.filter((h) => h.active), [myAll])

  const logMap = useMemo(() => {
    const m = new Map<string, HabitLog>()
    for (const l of logs) m.set(`${l.habit_id}|${l.log_date}`, l)
    return m
  }, [logs])

  const myWeek = useMemo(() => {
    const activeIds = new Set(myActive.map((h) => h.id))
    let done = 0
    for (const l of logs) if (l.user_id === me.id && l.completed && activeIds.has(l.habit_id)) done++
    let pts = 0
    for (const d of week) {
      if (d > todayIso) continue
      let n = 0
      for (const l of logs) if (l.user_id === me.id && l.log_date === d && l.completed) n++
      pts += habitDayPoints(n)
    }
    return { done, possible: myActive.length * elapsed, pts }
  }, [logs, myActive, me.id, week, todayIso, elapsed])

  const crew = useMemo<CrewRow[]>(() => {
    const rows = members
      .map((m) => {
        const active = (habits ?? []).filter((h) => h.user_id === m.id && h.active)
        if (active.length === 0) return null
        const ids = new Set(active.map((h) => h.id))
        let done = 0
        for (const l of logs) if (l.user_id === m.id && l.completed && ids.has(l.habit_id)) done++
        const possible = active.length * elapsed
        const pct = possible > 0 ? Math.round(Math.min(100, (done / possible) * 100)) : 0
        return { member: m, done, possible, pct }
      })
      .filter((r): r is CrewRow => r !== null)
    rows.sort((a, b) => b.pct - a.pct || a.member.name.localeCompare(b.member.name))
    return rows
  }, [members, habits, logs, elapsed])

  // myAll covers paused habits too, so a paused preset is never offered again.
  const existingNames = useMemo(() => new Set(myAll.map((h) => h.name.trim().toLowerCase())), [myAll])
  const presets = PRESET_HABITS.filter((p) => !existingNames.has(p.name.trim().toLowerCase()))

  // -------------------------------------------------------------------------
  // Mutations (always: check error, then refetch)
  // -------------------------------------------------------------------------

  function onCellTap(habit: Habit, date: string) {
    if (date > todayIso) return
    if (habit.target_value == null) {
      void toggleCheck(habit, date)
      return
    }
    const log = logMap.get(`${habit.id}|${date}`)
    setValueInput(log?.value != null ? String(log.value) : '')
    setValueError('')
    setValueSheet({ habit, date })
  }

  async function toggleCheck(habit: Habit, date: string) {
    const key = `${habit.id}|${date}`
    if (savingCell) return
    setSavingCell(key)
    setGridError('')
    const cur = logMap.get(key)
    const { error } = await supabase.from('gym_habit_logs').upsert(
      {
        habit_id: habit.id,
        user_id: me.id,
        log_date: date,
        value: null,
        completed: !(cur?.completed ?? false),
      },
      { onConflict: 'habit_id,log_date' },
    )
    if (error) setGridError(error.message)
    else await load()
    setSavingCell(null)
  }

  async function saveValue() {
    if (!valueSheet) return
    const raw = valueInput.trim()
    const v = raw === '' ? NaN : Number(raw)
    if (Number.isNaN(v)) {
      setValueError('Enter a number.')
      return
    }
    setValueBusy(true)
    setValueError('')
    const { habit, date } = valueSheet
    const { error } = await supabase.from('gym_habit_logs').upsert(
      {
        habit_id: habit.id,
        user_id: me.id,
        log_date: date,
        value: v,
        completed: isHabitComplete(habit, v),
      },
      { onConflict: 'habit_id,log_date' },
    )
    if (error) setValueError(error.message)
    else {
      await load()
      setValueSheet(null)
    }
    setValueBusy(false)
  }

  async function clearValue() {
    if (!valueSheet) return
    setValueBusy(true)
    setValueError('')
    const { habit, date } = valueSheet
    const { error } = await supabase
      .from('gym_habit_logs')
      .delete()
      .eq('habit_id', habit.id)
      .eq('log_date', date)
    if (error) setValueError(error.message)
    else {
      await load()
      setValueSheet(null)
    }
    setValueBusy(false)
  }

  function openEdit(habit: Habit | null) {
    setFName(habit?.name ?? '')
    setFTarget(habit?.target_value != null ? String(habit.target_value) : '')
    setFUnit(habit?.unit ?? '')
    setFDirection(habit?.direction ?? 'at_least')
    setEditError('')
    setEditSheet({ habit })
  }

  async function saveHabit() {
    if (!editSheet) return
    const name = fName.trim()
    if (!name) {
      setEditError('Give the habit a name.')
      return
    }
    const rawT = fTarget.trim()
    const target = rawT === '' ? null : Number(rawT)
    if (target !== null && Number.isNaN(target)) {
      setEditError('Target must be a number — or leave it empty for a check-off.')
      return
    }
    setEditBusy(true)
    setEditError('')
    const fields = { name, target_value: target, unit: fUnit.trim(), direction: fDirection }
    const { error } = editSheet.habit
      ? await supabase.from('gym_habits').update(fields).eq('id', editSheet.habit.id)
      : await supabase
          .from('gym_habits')
          .insert({ ...fields, user_id: me.id, position: myAll.length, active: true })
    if (error) setEditError(error.message)
    else {
      await load()
      setEditSheet(null)
    }
    setEditBusy(false)
  }

  async function togglePause(habit: Habit) {
    setEditBusy(true)
    setEditError('')
    const { error } = await supabase.from('gym_habits').update({ active: !habit.active }).eq('id', habit.id)
    if (error) setEditError(error.message)
    else {
      await load()
      setEditSheet(null)
    }
    setEditBusy(false)
  }

  async function deleteHabit(habit: Habit) {
    setEditBusy(true)
    setEditError('')
    // Logs go too — remove them first so the habit row can always be deleted.
    const { error: e1 } = await supabase.from('gym_habit_logs').delete().eq('habit_id', habit.id)
    if (e1) {
      setEditError(e1.message)
      setEditBusy(false)
      return
    }
    const { error: e2 } = await supabase.from('gym_habits').delete().eq('id', habit.id)
    if (e2) setEditError(e2.message)
    else {
      await load()
      setEditSheet(null)
    }
    setEditBusy(false)
  }

  async function addPreset(p: Preset) {
    setManageError('')
    setPresetBusy(p.name)
    const { error } = await supabase.from('gym_habits').insert({
      user_id: me.id,
      name: p.name,
      target_value: p.target,
      unit: p.unit,
      direction: p.direction,
      position: myAll.length,
      active: true,
    })
    if (error) setManageError(error.message)
    else await load()
    setPresetBusy(null)
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (habits === null && loadError) {
    return (
      <div className="space-y-3">
        <ErrorNote message={loadError} />
        <Button variant="soft" size="sm" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    )
  }
  if (habits === null) return <Spinner label="Loading habits…" />

  return (
    <>
      {loadError && (
        <div className="mb-3">
          <ErrorNote message={loadError} />
        </div>
      )}

      {/* ------------------------------------------------ 1 · This week */}
      <SectionTitle>This week</SectionTitle>
      {myActive.length === 0 ? (
        <EmptyState
          emoji="🌱"
          title="No active habits yet"
          hint="Add your daily non-negotiables and check them off every day."
          action={
            <Button size="sm" onClick={() => openEdit(null)}>
              + New habit
            </Button>
          }
        />
      ) : (
        <Card>
          <div className="grid grid-cols-[minmax(0,1fr)_repeat(7,2rem)] gap-y-1 items-center">
            <span />
            {WEEKDAYS_SHORT.map((d, i) => (
              <span
                key={d}
                className={`text-center text-[10px] font-semibold ${i === todayIdx ? 'text-accent' : 'text-faint'}`}
              >
                {d[0]}
              </span>
            ))}
            {myActive.map((h) => (
              <Fragment key={h.id}>
                <span className="pr-2 text-sm truncate">{h.name}</span>
                {week.map((d) => {
                  const key = `${h.id}|${d}`
                  const log = logMap.get(key)
                  const future = d > todayIso
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={future || savingCell !== null}
                      onClick={() => onCellTap(h, d)}
                      aria-label={`${h.name}, ${fmtDate(d)}`}
                      className={`h-8 flex items-center justify-center ${savingCell === key ? 'opacity-50' : ''}`}
                    >
                      {future ? (
                        <span className="w-1 h-1 rounded-full bg-white/15" aria-hidden />
                      ) : log?.completed ? (
                        <span className="w-6 h-6 rounded-full bg-accent" aria-hidden />
                      ) : log ? (
                        <span className="w-6 h-6 rounded-full border-2 border-bad/60" aria-hidden />
                      ) : (
                        <span className="w-6 h-6 rounded-full border border-line" aria-hidden />
                      )}
                    </button>
                  )
                })}
              </Fragment>
            ))}
          </div>
          {gridError && (
            <div className="mt-3">
              <ErrorNote message={gridError} />
            </div>
          )}
          <div className="mt-3 text-xs text-sub">
            {myWeek.done}/{myWeek.possible} done · +{myWeek.pts} pts
          </div>
        </Card>
      )}

      {/* ------------------------------------------------ 2 · My habits */}
      <SectionTitle
        action={
          <Button variant="soft" size="sm" onClick={() => openEdit(null)}>
            + New habit
          </Button>
        }
      >
        My habits
      </SectionTitle>
      {manageError && (
        <div className="mb-2">
          <ErrorNote message={manageError} />
        </div>
      )}
      {myAll.length === 0 ? (
        <Card className="text-sm text-sub">No habits yet — start with a preset below or add your own.</Card>
      ) : (
        <Card className="py-1 divide-y divide-line">
          {myAll.map((h) => (
            <div key={h.id} className={`flex items-center gap-3 py-2.5 ${h.active ? '' : 'opacity-50'}`}>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {h.name}
                  {!h.active && <span className="text-faint font-normal"> · paused</span>}
                </div>
                <div className="text-xs text-faint mt-0.5">{targetLabel(h)}</div>
              </div>
              <Button variant="soft" size="sm" onClick={() => openEdit(h)}>
                Edit
              </Button>
            </div>
          ))}
        </Card>
      )}
      {presets.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3 px-1">
          {presets.map((p) => (
            <button
              key={p.name}
              type="button"
              disabled={presetBusy !== null}
              onClick={() => void addPreset(p)}
              className="text-[11px] font-medium px-2.5 py-1.5 rounded-full bg-white/10 text-sub active:bg-white/15 disabled:opacity-40"
            >
              {presetBusy === p.name ? 'Adding…' : `+ ${p.name} ${dirSym(p.direction)} ${p.target} ${p.unit}`}
            </button>
          ))}
        </div>
      )}

      {/* ------------------------------------------------ 3 · Crew this week */}
      <SectionTitle>Crew this week</SectionTitle>
      {crew.length === 0 ? (
        <Card className="text-sm text-sub">Nobody in the crew has active habits yet.</Card>
      ) : (
        <Card className="space-y-3">
          {crew.map((r) => (
            <div key={r.member.id} className="flex items-center gap-3">
              <Avatar name={r.member.name} color={r.member.color} size={30} />
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate mb-1">{r.member.name}</div>
                <ProgressBar value={r.done} max={r.possible} color={r.member.color} />
              </div>
              <div className="text-sm font-semibold w-11 text-right tabular-nums">{r.pct}%</div>
            </div>
          ))}
          <div className="text-xs text-faint pt-1">Consistency, not perfection.</div>
        </Card>
      )}

      {/* ------------------------------------------------ Value-log sheet */}
      <Sheet
        open={valueSheet !== null}
        onClose={() => {
          if (!valueBusy) setValueSheet(null)
        }}
        title={valueSheet ? `${valueSheet.habit.name} — ${fmtDate(valueSheet.date)}` : ''}
      >
        {valueSheet && (
          <div className="space-y-4">
            {valueError && <ErrorNote message={valueError} />}
            <Field
              label={valueSheet.habit.unit ? `Value (${valueSheet.habit.unit})` : 'Value'}
              hint={`target ${dirSym(valueSheet.habit.direction)} ${valueSheet.habit.target_value} ${valueSheet.habit.unit}`.trim()}
            >
              <Input
                type="number"
                inputMode="decimal"
                value={valueInput}
                onChange={(e) => setValueInput(e.target.value)}
                placeholder="0"
                autoFocus
              />
            </Field>
            <Button full disabled={valueBusy} onClick={() => void saveValue()}>
              {valueBusy ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="ghost" full disabled={valueBusy} onClick={() => void clearValue()}>
              Clear
            </Button>
          </div>
        )}
      </Sheet>

      {/* ------------------------------------------------ Edit/new habit sheet */}
      <Sheet
        open={editSheet !== null}
        onClose={() => {
          if (!editBusy) setEditSheet(null)
        }}
        title={editSheet?.habit ? 'Edit habit' : 'New habit'}
      >
        {editSheet && (
          <div className="space-y-4">
            {editError && <ErrorNote message={editError} />}
            <Field label="Name">
              <Input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="e.g. Sleep" />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Target" hint="Empty = simple check-off">
                <Input
                  type="number"
                  inputMode="decimal"
                  value={fTarget}
                  onChange={(e) => setFTarget(e.target.value)}
                  placeholder="e.g. 8"
                />
              </Field>
              <Field label="Unit">
                <Input value={fUnit} onChange={(e) => setFUnit(e.target.value)} placeholder="h, L, g…" />
              </Field>
            </div>
            <Field label="Direction">
              <Segmented<HabitDirection>
                options={[
                  { value: 'at_least', label: '≥ at least' },
                  { value: 'at_most', label: '≤ at most' },
                ]}
                value={fDirection}
                onChange={setFDirection}
              />
            </Field>
            <Button full disabled={editBusy} onClick={() => void saveHabit()}>
              {editBusy ? 'Saving…' : 'Save'}
            </Button>
            {editSheet.habit && (
              <div className="flex items-center justify-between pt-1">
                <Button
                  variant="soft"
                  size="sm"
                  disabled={editBusy}
                  onClick={() => void togglePause(editSheet.habit!)}
                >
                  {editSheet.habit.active ? 'Pause' : 'Resume'}
                </Button>
                <ConfirmButton
                  label="Delete"
                  confirmLabel="Delete + logs?"
                  onConfirm={() => void deleteHabit(editSheet.habit!)}
                />
              </div>
            )}
          </div>
        )}
      </Sheet>
    </>
  )
}

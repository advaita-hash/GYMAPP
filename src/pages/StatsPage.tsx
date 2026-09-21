import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { BodyStat, Member } from '../lib/types'
import { fmtDate, fmtRelative, today } from '../lib/dates'
import { useAuth } from '../ctx/AuthContext'
import { PageHeader } from '../components/Layout'
import {
  Avatar, Button, Card, EmptyState, ErrorNote, Field, Input, SectionTitle,
  Segmented, Select, Sheet, Spinner, TextArea,
} from '../components/ui'
import { TrendChart } from '../components/charts'
import type { Series } from '../components/charts'

// ---------------------------------------------------------------------------
// Local types & helpers
// ---------------------------------------------------------------------------

type MetricKey = 'weight' | 'fat' | 'muscle'
type MetricField = 'weight_kg' | 'body_fat_pct' | 'muscle_mass_kg'

const METRICS: Record<MetricKey, { label: string; short: string; unit: string; field: MetricField }> = {
  weight: { label: 'Weight', short: 'Weight kg', unit: 'kg', field: 'weight_kg' },
  fat: { label: 'Body fat', short: 'Fat %', unit: '%', field: 'body_fat_pct' },
  muscle: { label: 'Muscle', short: 'Muscle kg', unit: 'kg', field: 'muscle_mass_kg' },
}

const METRIC_KEYS: MetricKey[] = ['weight', 'fat', 'muscle']

/** Shape of the joined strength-set rows (nested join comes back as an object). */
interface StrengthSetRow {
  exercise: string
  weight_kg: number | null
  gym_workouts: { user_id: string; logged_on: string }
}

/** 'Mon 15 Sep' → '15 Sep' */
function shortDate(iso: string): string {
  return fmtDate(iso).slice(4)
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

function fmtValue(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

function errMsg(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Something went wrong.'
}

function parseNum(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Latest non-null value of a metric plus the delta vs the previous non-null one. */
function latestWithDelta(stats: BodyStat[], field: MetricField): { value: number | null; delta: number | null } {
  const vals = stats.map((s) => s[field]).filter((v): v is number => v != null)
  if (vals.length === 0) return { value: null, delta: null }
  const value = vals[vals.length - 1]
  const delta = vals.length >= 2 ? value - vals[vals.length - 2] : null
  return { value, delta }
}

function DeltaNote({ delta }: { delta: number | null }) {
  if (delta == null) return null
  const rounded = Math.round(delta * 10) / 10
  if (rounded === 0) return <div className="text-[11px] text-sub mt-0.5">0.0</div>
  const up = rounded > 0
  return (
    <div className="text-[11px] text-sub mt-0.5">
      {up ? '▲' : '▼'} {up ? '+' : '−'}
      {Math.abs(rounded).toFixed(1)}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Crew member card
// ---------------------------------------------------------------------------

function MemberStatsCard({ member, stats }: { member: Member; stats: BodyStat[] }) {
  const last = stats.length > 0 ? stats[stats.length - 1] : null
  return (
    <Card>
      <div className="flex items-center gap-3 mb-3">
        <Avatar name={member.name} color={member.color} />
        <div className="min-w-0">
          <div className="font-semibold truncate">{member.name}</div>
          <div className="text-xs text-faint">
            {last ? `updated ${fmtRelative(last.recorded_on)}` : 'no entries yet'}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {METRIC_KEYS.map((k) => {
          const { value, delta } = latestWithDelta(stats, METRICS[k].field)
          return (
            <div key={k} className="bg-raised border border-line rounded-xl px-2.5 py-2">
              <div className="text-[11px] text-faint font-medium">{METRICS[k].short}</div>
              <div className="text-lg font-bold text-ink mt-0.5">{value != null ? fmtValue(value) : '—'}</div>
              <DeltaNote delta={delta} />
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function StatsPage() {
  const { me, members } = useAuth()

  const [stats, setStats] = useState<BodyStat[]>([])
  const [strengthSets, setStrengthSets] = useState<StrengthSetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [metric, setMetric] = useState<MetricKey>('weight')
  const [exercisePick, setExercisePick] = useState('')

  // Add-entry sheet state
  const [sheetOpen, setSheetOpen] = useState(false)
  const [date, setDate] = useState(today())
  const [weight, setWeight] = useState('')
  const [fat, setFat] = useState('')
  const [muscle, setMuscle] = useState('')
  const [notes, setNotes] = useState('')
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)

  async function fetchStats(): Promise<BodyStat[]> {
    const { data, error: e } = await supabase
      .from('gym_body_stats')
      .select('*')
      .order('recorded_on', { ascending: true })
    if (e) throw e
    return (data as BodyStat[] | null) ?? []
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [statRows, setsRes] = await Promise.all([
          fetchStats(),
          supabase
            .from('gym_workout_sets')
            .select('exercise,weight_kg,gym_workouts!inner(user_id,logged_on)'),
        ])
        if (setsRes.error) throw setsRes.error
        if (cancelled) return
        setStats(statRows)
        setStrengthSets(((setsRes.data ?? []) as unknown as StrengthSetRow[]).filter((r) => r.weight_kg != null))
      } catch (e) {
        if (!cancelled) setError(errMsg(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const statsByMember = useMemo(() => {
    const map = new Map<string, BodyStat[]>()
    for (const m of members) map.set(m.id, [])
    for (const s of stats) map.get(s.user_id)?.push(s)
    return map
  }, [stats, members])

  // ----- Body-stat trend -----------------------------------------------------

  const trend = useMemo(() => {
    const field = METRICS[metric].field
    const rowsWithValue = stats.filter((s) => s[field] != null && statsByMember.has(s.user_id))
    const dates = [...new Set(rowsWithValue.map((s) => s.recorded_on))].sort()
    const byDate = new Map<string, Record<string, string | number>>(
      dates.map((d) => [d, { label: shortDate(d) }]),
    )
    for (const s of rowsWithValue) {
      const row = byDate.get(s.recorded_on)
      if (row) row[s.user_id] = s[field] as number
    }
    const withData = new Set(rowsWithValue.map((s) => s.user_id))
    const series: Series[] = members
      .filter((m) => withData.has(m.id))
      .map((m) => ({ key: m.id, label: firstName(m.name), color: m.color }))
    return { data: dates.map((d) => byDate.get(d)!), series, points: rowsWithValue.length }
  }, [stats, metric, members, statsByMember])

  // ----- Strength progression ------------------------------------------------

  const exercises = useMemo(() => {
    const byKey = new Map<string, { key: string; name: string; count: number }>()
    for (const r of strengthSets) {
      const key = r.exercise.trim().toLowerCase()
      if (!key) continue
      const entry = byKey.get(key)
      if (entry) entry.count += 1
      else byKey.set(key, { key, name: r.exercise.trim(), count: 1 })
    }
    return [...byKey.values()].sort((a, b) => b.count - a.count)
  }, [strengthSets])

  const selectedExercise = exercisePick || (exercises.length > 0 ? exercises[0].key : '')

  const strengthTrend = useMemo(() => {
    const rows = strengthSets.filter(
      (r) => r.weight_kg != null && r.exercise.trim().toLowerCase() === selectedExercise,
    )
    // max weight per member per date
    const maxByDate = new Map<string, Map<string, number>>()
    for (const r of rows) {
      const d = r.gym_workouts.logged_on
      const uid = r.gym_workouts.user_id
      const perUser = maxByDate.get(d) ?? new Map<string, number>()
      perUser.set(uid, Math.max(perUser.get(uid) ?? -Infinity, r.weight_kg as number))
      maxByDate.set(d, perUser)
    }
    const dates = [...maxByDate.keys()].sort()
    const data = dates.map((d) => {
      const row: Record<string, string | number> = { label: shortDate(d) }
      for (const [uid, w] of maxByDate.get(d)!) row[uid] = w
      return row
    })
    const withData = new Set(rows.map((r) => r.gym_workouts.user_id))
    const series: Series[] = members
      .filter((m) => withData.has(m.id))
      .map((m) => ({ key: m.id, label: firstName(m.name), color: m.color }))
    return { data, series }
  }, [strengthSets, selectedExercise, members])

  // ----- Add entry -----------------------------------------------------------

  function openSheet() {
    setDate(today())
    setWeight('')
    setFat('')
    setMuscle('')
    setNotes('')
    setFormError('')
    setSheetOpen(true)
  }

  async function saveEntry(e: FormEvent) {
    e.preventDefault()
    if (!me || busy) return
    const w = parseNum(weight)
    const f = parseNum(fat)
    const m = parseNum(muscle)
    if (w == null && f == null && m == null) {
      setFormError('Enter at least one measurement.')
      return
    }
    if (!date || date > today()) {
      setFormError('Pick a date up to today.')
      return
    }
    setBusy(true)
    setFormError('')
    const { error: upErr } = await supabase.from('gym_body_stats').upsert(
      {
        user_id: me.id,
        recorded_on: date,
        weight_kg: w,
        body_fat_pct: f,
        muscle_mass_kg: m,
        notes: notes.trim(),
      },
      { onConflict: 'user_id,recorded_on' },
    )
    if (upErr) {
      setFormError(upErr.message)
      setBusy(false)
      return
    }
    try {
      setStats(await fetchStats())
    } catch (err) {
      setError(errMsg(err))
    }
    setBusy(false)
    setSheetOpen(false)
  }

  // ----- Render --------------------------------------------------------------

  return (
    <div>
      <PageHeader
        title="Stats"
        back
        subtitle="Weight, body fat, muscle — the whole crew"
        action={
          <Button variant="soft" size="sm" onClick={openSheet}>
            + Entry
          </Button>
        }
      />

      {loading ? (
        <Spinner label="Loading stats…" />
      ) : error ? (
        <ErrorNote message={error} />
      ) : (
        <>
          <SectionTitle>Crew</SectionTitle>
          <div className="grid grid-cols-1 gap-2">
            {members.map((m) => (
              <MemberStatsCard key={m.id} member={m} stats={statsByMember.get(m.id) ?? []} />
            ))}
          </div>

          <SectionTitle>Trends</SectionTitle>
          <Segmented<MetricKey>
            options={METRIC_KEYS.map((k) => ({ value: k, label: METRICS[k].label }))}
            value={metric}
            onChange={setMetric}
          />
          {trend.points < 2 ? (
            <div className="mt-2">
              <EmptyState
                emoji="📈"
                title="Not enough data yet"
                hint="Log at least two entries and the trend lines show up here."
                action={
                  <Button variant="soft" size="sm" onClick={openSheet}>
                    + Entry
                  </Button>
                }
              />
            </div>
          ) : (
            <Card className="mt-2">
              <TrendChart data={trend.data} series={trend.series} unit={METRICS[metric].unit} height={220} />
            </Card>
          )}

          <SectionTitle>Strength progression</SectionTitle>
          {exercises.length === 0 ? (
            <EmptyState
              emoji="🏋️"
              title="No strength sets logged yet"
              hint="Log a strength workout with sets and weights to track progression."
            />
          ) : (
            <>
              <Select
                value={selectedExercise}
                onChange={(e) => setExercisePick(e.target.value)}
                aria-label="Exercise"
              >
                {exercises.map((ex) => (
                  <option key={ex.key} value={ex.key}>
                    {ex.name}
                  </option>
                ))}
              </Select>
              <Card className="mt-2">
                <div className="text-[11px] text-faint mb-2">Heaviest set per session</div>
                <TrendChart data={strengthTrend.data} series={strengthTrend.series} unit="kg" height={220} />
              </Card>
            </>
          )}
        </>
      )}

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Add entry">
        <form onSubmit={saveEntry} className="space-y-3">
          {formError && <ErrorNote message={formError} />}
          <Field label="Date" hint="One entry per day — saving again overwrites that day.">
            <Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Weight (kg)">
              <Input
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                placeholder="82.5"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
              />
            </Field>
            <Field label="Fat (%)">
              <Input
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                max="100"
                placeholder="18.0"
                value={fat}
                onChange={(e) => setFat(e.target.value)}
              />
            </Field>
            <Field label="Muscle (kg)">
              <Input
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                placeholder="36.2"
                value={muscle}
                onChange={(e) => setMuscle(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Notes">
            <TextArea
              placeholder="Morning weigh-in, after cut week…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          <Button type="submit" full disabled={busy}>
            {busy ? 'Saving…' : 'Save entry'}
          </Button>
        </form>
      </Sheet>
    </div>
  )
}

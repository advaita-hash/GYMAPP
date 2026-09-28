// Onboarding wizard — profile setup for new (or re-onboarding) crew members.
// Renders OUTSIDE the app shell: App shows it whenever me is null or not onboarded.

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchMembers, fetchPunishments } from '../lib/data'
import { addDays, currentWeekStart, fmtDate, today } from '../lib/dates'
import type { Goal, GoalTimeframe, Habit, HabitDirection, Member, Profile, Punishment } from '../lib/types'
import { PRESET_HABITS } from '../lib/types'
import { useAuth } from '../ctx/AuthContext'
import {
  Avatar,
  Button,
  Card,
  Chip,
  ConfirmButton,
  ErrorNote,
  Field,
  Input,
  Segmented,
  Select,
  Spinner,
  TextArea,
} from '../components/ui'

// ---------------------------------------------------------------------------
// Local constants & helpers
// ---------------------------------------------------------------------------

const STEPS = ['Welcome', 'Starting stats', 'Punishment pool', 'Micro habits', 'Goals']


interface CustomHabitRow {
  key: number
  name: string
  target: string
  unit: string
  direction: HabitDirection
}

const TF_OPTIONS: { value: GoalTimeframe; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'short_term', label: 'Short-term' },
  { value: 'long_term', label: 'Long-term' },
]

const TF_LABEL: Record<GoalTimeframe, string> = {
  weekly: 'Weekly',
  short_term: 'Short-term',
  long_term: 'Long-term',
}

const GOAL_PLACEHOLDER: Record<GoalTimeframe, string> = {
  weekly: 'e.g. 4 workouts this week',
  short_term: 'e.g. Run 5 km under 30 min',
  long_term: 'e.g. Get to 15% body fat',
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return 'Something went wrong. Please try again.'
}

/** '' → null; otherwise Number (null when not a finite number). */
function numOrNull(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function habitTargetLabel(target: number | null, unit: string, direction: HabitDirection): string {
  if (target == null) return 'check-off'
  return `${direction === 'at_least' ? '≥' : '≤'} ${target}${unit ? ` ${unit}` : ''}`
}

function PactCard({ emoji, title, text }: { emoji: string; title: string; text: string }) {
  return (
    <Card>
      <div className="text-xl mb-1" aria-hidden>
        {emoji}
      </div>
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-xs text-sub mt-0.5">{text}</div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Onboarding() {
  const { session, refreshMembers, signOut } = useAuth()
  const uid = session?.user.id ?? ''

  const [step, setStep] = useState(0)
  const [initLoading, setInitLoading] = useState(true)
  const [initError, setInitError] = useState('')
  // Invite gate: null while unknown, true when this account still has to redeem
  // a code before it can see or write anything in the pact.
  const [needsCode, setNeedsCode] = useState(false)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [initNonce, setInitNonce] = useState(0)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  // Step 1 — welcome
  const [name, setName] = useState('')
  const [savedName, setSavedName] = useState('')
  const [height, setHeight] = useState('')

  // Step 2 — starting stats
  const [weight, setWeight] = useState('')
  const [bodyFat, setBodyFat] = useState('')
  const [muscle, setMuscle] = useState('')
  const [statNotes, setStatNotes] = useState('')

  // Step 3 — punishment pool
  const [pool, setPool] = useState<Punishment[]>([])
  const [roster, setRoster] = useState<Member[]>([])
  const [newPunishment, setNewPunishment] = useState('')
  const [poolBusy, setPoolBusy] = useState(false)

  // Step 4 — micro habits
  const [existingHabits, setExistingHabits] = useState<Habit[]>([])
  const [selectedPresets, setSelectedPresets] = useState<Set<string>>(new Set())
  const [customs, setCustoms] = useState<CustomHabitRow[]>([])
  const customKeyRef = useRef(1)

  // Step 5 — goals
  const thisSunday = useMemo(() => addDays(currentWeekStart(), 6), [])
  const [goals, setGoals] = useState<Goal[]>([])
  const [goalTf, setGoalTf] = useState<GoalTimeframe>('weekly')
  const [goalTitle, setGoalTitle] = useState('')
  const [goalDate, setGoalDate] = useState(thisSunday)
  const [goalBusy, setGoalBusy] = useState(false)

  const existingNames = useMemo(
    () => new Set(existingHabits.map((h) => h.name.trim().toLowerCase())),
    [existingHabits],
  )

  // -------------------------------------------------------------------------
  // Init: ensure a gym_profiles row exists, then load everything the wizard shows.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!uid) return
    let cancelled = false
    ;(async () => {
      try {
        // Membership is what gates every gym_* read, so check it before loading
        // anything: a signed-in stranger sees the invite gate, not the wizard.
        const { data: membership, error: memErr } = await supabase
          .from('gym_profiles')
          .select('user_id')
          .eq('user_id', uid)
          .maybeSingle()
        if (memErr) throw memErr
        if (cancelled) return
        if (!membership) {
          setNeedsCode(true)
          setInitLoading(false)
          return
        }
        setNeedsCode(false)
        const [profRes, punishments, membersList, habitsRes, goalsRes] = await Promise.all([
          supabase.from('profiles').select('id,name,color,created_at').eq('id', uid).single(),
          fetchPunishments(),
          fetchMembers(),
          supabase
            .from('gym_habits')
            .select('*')
            .eq('user_id', uid)
            .eq('active', true)
            .order('position', { ascending: true }),
          supabase.from('gym_goals').select('*').eq('user_id', uid).order('created_at', { ascending: true }),
        ])
        if (profRes.error) throw profRes.error
        if (habitsRes.error) throw habitsRes.error
        if (goalsRes.error) throw goalsRes.error
        if (cancelled) return
        const prof = profRes.data as Profile
        setName(prof.name)
        setSavedName(prof.name)
        setPool(punishments)
        setRoster(membersList)
        const habits = (habitsRes.data as Habit[] | null) ?? []
        setExistingHabits(habits)
        const have = new Set(habits.map((h) => h.name.trim().toLowerCase()))
        setSelectedPresets(
          new Set(PRESET_HABITS.filter((p) => !have.has(p.name.toLowerCase())).map((p) => p.name)),
        )
        setGoals((goalsRes.data as Goal[] | null) ?? [])
        setInitLoading(false)
      } catch (e) {
        if (!cancelled) {
          setInitError(errMsg(e))
          setInitLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [uid, initNonce])

  /** Redeem an invite code, which creates this account's pact membership. */
  async function redeemCode() {
    const entered = code.trim()
    if (!entered) {
      setCodeError('Enter the code your crew gave you.')
      return
    }
    setRedeeming(true)
    setCodeError('')
    try {
      const { data, error } = await supabase.rpc('join_pact', { p_code: entered })
      if (error) throw error
      if (data !== true) {
        setCodeError("That code doesn't match. Ask the crew for the current one.")
        return
      }
      await refreshMembers()
      setInitLoading(true)
      setNeedsCode(false)
      setInitNonce((n) => n + 1)
    } catch (e) {
      setCodeError(errMsg(e))
    } finally {
      setRedeeming(false)
    }
  }

  // -------------------------------------------------------------------------
  // Step commits
  // -------------------------------------------------------------------------

  async function commitWelcome() {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('Pick a name — the crew needs to know who to beat.')
    const h = numOrNull(height)
    if (height.trim() !== '' && (h == null || h <= 0)) {
      throw new Error('Height should be a number in cm (or leave it blank).')
    }
    if (trimmed !== savedName) {
      const { error } = await supabase.from('profiles').update({ name: trimmed }).eq('id', uid)
      if (error) throw error
      setSavedName(trimmed)
    }
  }

  async function commitStats() {
    const w = numOrNull(weight)
    const bf = numOrNull(bodyFat)
    const mm = numOrNull(muscle)
    const notes = statNotes.trim()
    if (w == null && bf == null && mm == null && notes === '') return // skipped
    const { error } = await supabase.from('gym_body_stats').upsert(
      {
        user_id: uid,
        recorded_on: today(),
        weight_kg: w,
        body_fat_pct: bf,
        muscle_mass_kg: mm,
        notes,
      },
      { onConflict: 'user_id,recorded_on' },
    )
    if (error) throw error
  }

  async function reloadHabits() {
    const { data, error } = await supabase
      .from('gym_habits')
      .select('*')
      .eq('user_id', uid)
      .eq('active', true)
      .order('position', { ascending: true })
    if (error) throw error
    setExistingHabits((data as Habit[] | null) ?? [])
  }

  async function commitHabits() {
    const have = new Set(existingNames)
    const chosen: { name: string; target_value: number | null; unit: string; direction: HabitDirection }[] = []
    for (const p of PRESET_HABITS) {
      if (selectedPresets.has(p.name) && !have.has(p.name.toLowerCase())) {
        chosen.push({ name: p.name, target_value: p.target, unit: p.unit, direction: p.direction })
        have.add(p.name.toLowerCase())
      }
    }
    for (const c of customs) {
      const n = c.name.trim()
      if (!n || have.has(n.toLowerCase())) continue
      chosen.push({ name: n, target_value: numOrNull(c.target), unit: c.unit.trim(), direction: c.direction })
      have.add(n.toLowerCase())
    }
    if (chosen.length === 0) return
    const rows = chosen.map((c, i) => ({
      user_id: uid,
      position: existingHabits.length + i,
      active: true,
      ...c,
    }))
    const { error } = await supabase.from('gym_habits').insert(rows)
    if (error) throw error
    await reloadHabits()
    setSelectedPresets(new Set())
    setCustoms([])
  }

  async function handleContinue() {
    if (busy) return
    setErr('')
    if (step === 4) {
      await finish()
      return
    }
    setBusy(true)
    try {
      if (step === 0) await commitWelcome()
      if (step === 1) await commitStats()
      if (step === 3) await commitHabits()
      setStep(step + 1)
      window.scrollTo(0, 0)
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  async function finish() {
    if (busy) return
    setErr('')
    setBusy(true)
    try {
      const h = numOrNull(height)
      const patch: { onboarded: boolean; height_cm?: number } = { onboarded: true }
      if (h != null && h > 0) patch.height_cm = h
      const { error } = await supabase.from('gym_profiles').update(patch).eq('user_id', uid)
      if (error) throw error
      await refreshMembers() // App routes to Home once me.gym.onboarded is true
    } catch (e) {
      setErr(errMsg(e))
      setBusy(false)
    }
  }

  // -------------------------------------------------------------------------
  // Punishment pool actions
  // -------------------------------------------------------------------------

  async function addPunishment() {
    const t = newPunishment.trim()
    if (!t || poolBusy) return
    setErr('')
    setPoolBusy(true)
    try {
      const { error } = await supabase
        .from('gym_punishments')
        .insert({ title: t, created_by: uid, active: true })
      if (error) throw error
      setNewPunishment('')
      setPool(await fetchPunishments())
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setPoolBusy(false)
    }
  }

  async function deletePunishment(id: string) {
    setErr('')
    try {
      const { error } = await supabase.from('gym_punishments').delete().eq('id', id)
      if (error) throw error
      setPool(await fetchPunishments())
    } catch (e) {
      setErr(errMsg(e))
    }
  }

  function authorOf(p: Punishment): { name: string; member: Member | null } {
    const m = roster.find((x) => x.id === p.created_by) ?? null
    if (p.created_by === uid) return { name: 'you', member: m }
    return { name: m?.name ?? 'crew', member: m }
  }

  // -------------------------------------------------------------------------
  // Habit helpers
  // -------------------------------------------------------------------------

  function togglePreset(presetName: string) {
    setSelectedPresets((prev) => {
      const next = new Set(prev)
      if (next.has(presetName)) next.delete(presetName)
      else next.add(presetName)
      return next
    })
  }

  function addCustomRow() {
    const key = customKeyRef.current++
    setCustoms((prev) => [...prev, { key, name: '', target: '', unit: '', direction: 'at_least' }])
  }

  function updateCustom(key: number, patch: Partial<Omit<CustomHabitRow, 'key'>>) {
    setCustoms((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  function removeCustom(key: number) {
    setCustoms((prev) => prev.filter((r) => r.key !== key))
  }

  // -------------------------------------------------------------------------
  // Goal actions
  // -------------------------------------------------------------------------

  async function reloadGoals() {
    const { data, error } = await supabase
      .from('gym_goals')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: true })
    if (error) throw error
    setGoals((data as Goal[] | null) ?? [])
  }

  async function addGoal() {
    const t = goalTitle.trim()
    if (!t || goalBusy) return
    setErr('')
    setGoalBusy(true)
    try {
      const { error } = await supabase.from('gym_goals').insert({
        user_id: uid,
        timeframe: goalTf,
        title: t,
        description: '',
        target_date: goalDate || null,
        status: 'active',
      })
      if (error) throw error
      setGoalTitle('')
      await reloadGoals()
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setGoalBusy(false)
    }
  }

  async function deleteGoal(id: string) {
    setErr('')
    try {
      const { error } = await supabase.from('gym_goals').delete().eq('id', id)
      if (error) throw error
      await reloadGoals()
    } catch (e) {
      setErr(errMsg(e))
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-page">
      <div className="max-w-md mx-auto px-4 py-6">
        <div className="text-center mb-6">
          <div className="text-3xl mb-1" aria-hidden>
            🤝
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">Iron Pact</h1>
          {!needsCode && (
            <>
              <div className="text-sm text-sub mt-1">
                Step {step + 1} of {STEPS.length} · {STEPS[step]}
              </div>
              <div className="flex justify-center gap-1.5 mt-3" aria-hidden>
                {STEPS.map((label, i) => (
                  <div
                    key={label}
                    className={`h-1.5 rounded-full transition-all ${
                      i === step ? 'w-6 bg-accent' : i < step ? 'w-1.5 bg-accent/50' : 'w-1.5 bg-white/15'
                    }`}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {needsCode ? (
          <div className="space-y-4">
            <Card>
              <div className="text-center">
                <div className="text-3xl mb-2" aria-hidden>
                  🔒
                </div>
                <div className="font-bold text-lg">This pact is invite-only</div>
                <p className="text-sm text-sub mt-2">
                  Everyone in the pact can see everyone's weight, body fat, photos and logs — so
                  only people with the crew's code get in.
                </p>
              </div>
              <div className="mt-5 space-y-3">
                <Field label="Invite code">
                  <Input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !redeeming) redeemCode()
                    }}
                    placeholder="e.g. IRONPACT"
                    autoCapitalize="characters"
                    autoComplete="off"
                    maxLength={64}
                  />
                </Field>
                {codeError && <ErrorNote message={codeError} />}
                <Button full size="lg" onClick={redeemCode} disabled={redeeming}>
                  {redeeming ? 'Checking…' : 'Join the pact'}
                </Button>
              </div>
            </Card>
            <div className="text-center">
              <Button variant="ghost" size="sm" onClick={() => signOut()}>
                Sign out
              </Button>
            </div>
          </div>
        ) : initLoading ? (
          <Spinner label="Setting things up…" />
        ) : initError ? (
          <div className="space-y-3">
            <ErrorNote message={initError} />
            <Button variant="soft" full onClick={() => window.location.reload()}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            {/* ------------------------------------------------ Step 1: Welcome */}
            {step === 0 && (
              <div className="space-y-4">
                <p className="text-sm text-sub px-1">
                  A few friends. One pact. Everything you log is visible to the whole crew — that’s the point.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <PactCard emoji="📸" title="Proof it" text="Log every workout — runs, lifts, sport — with a photo." />
                  <PactCard emoji="🏆" title="Weekly board" text="Points rank the crew each week. Top 2 earn a treat." />
                  <PactCard
                    emoji="😈"
                    title="Last place pays"
                    text="A punishment drawn from the shared pool, due within a week."
                  />
                  <PactCard
                    emoji="🎯"
                    title="Habits & goals"
                    text="Daily non-negotiables, plus weekly, short and long-term goals."
                  />
                </div>
                <Card className="space-y-4">
                  <Field label="Your name" hint="How the crew sees you everywhere in the app.">
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Alex"
                      maxLength={40}
                      autoComplete="name"
                    />
                  </Field>
                  <Field label="Height (cm) — optional" hint="Saved when you finish setup.">
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={height}
                      onChange={(e) => setHeight(e.target.value)}
                      placeholder="175"
                    />
                  </Field>
                </Card>
              </div>
            )}

            {/* ------------------------------------------ Step 2: Starting stats */}
            {step === 1 && (
              <div className="space-y-4">
                <Card>
                  <div className="text-sm font-semibold mb-1">Your starting line 📏</div>
                  <p className="text-xs text-sub">
                    The crew sees these numbers, and your progress is tracked from here. Log at least your weight —
                    future you will want the baseline.
                  </p>
                </Card>
                <Card className="space-y-4">
                  <Field label="Weight (kg)" hint="Strongly encouraged — it anchors your trend chart.">
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={weight}
                      onChange={(e) => setWeight(e.target.value)}
                      placeholder="72.5"
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Body fat (%)">
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={bodyFat}
                        onChange={(e) => setBodyFat(e.target.value)}
                        placeholder="18"
                      />
                    </Field>
                    <Field label="Muscle mass (kg)">
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={muscle}
                        onChange={(e) => setMuscle(e.target.value)}
                        placeholder="32"
                      />
                    </Field>
                  </div>
                  <Field label="Notes — optional">
                    <TextArea
                      value={statNotes}
                      onChange={(e) => setStatNotes(e.target.value)}
                      placeholder="e.g. Post-holiday baseline, morning weigh-in"
                    />
                  </Field>
                </Card>
                <p className="text-xs text-faint px-1">
                  All optional — leave everything blank and hit Continue to skip this step.
                </p>
              </div>
            )}

            {/* ------------------------------------------ Step 3: Punishment pool */}
            {step === 2 && (
              <div className="space-y-4">
                <Card>
                  <div className="text-sm font-semibold mb-1">The stakes 😈</div>
                  <p className="text-xs text-sub">
                    Each week, whoever finishes last on the leaderboard draws one task from this shared pool — the
                    draw shuffles every week. The whole crew decides the ideas up front, so pitch in.
                  </p>
                </Card>
                <Card className="space-y-3">
                  <Field label="Add an idea">
                    <div className="flex gap-2">
                      <Input
                        value={newPunishment}
                        onChange={(e) => setNewPunishment(e.target.value)}
                        placeholder="e.g. Extra 20k steps within the week"
                        maxLength={120}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            addPunishment()
                          }
                        }}
                      />
                      <Button variant="soft" onClick={addPunishment} disabled={poolBusy || !newPunishment.trim()}>
                        {poolBusy ? '…' : 'Add'}
                      </Button>
                    </div>
                  </Field>
                  {pool.length === 0 ? (
                    <p className="text-xs text-warn">
                      The pool is empty — add at least one idea so week 1 has real stakes.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {pool.map((p) => {
                        const a = authorOf(p)
                        return (
                          <li
                            key={p.id}
                            className="flex items-center gap-2 bg-raised border border-line rounded-xl px-3 py-2"
                          >
                            {a.member ? (
                              <Avatar name={a.member.name} color={a.member.color} size={24} />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-white/10 shrink-0" aria-hidden />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-ink">{p.title}</div>
                              <div className="text-[11px] text-faint">by {a.name}</div>
                            </div>
                            {p.created_by === uid && (
                              <ConfirmButton label="✕" confirmLabel="Delete?" onConfirm={() => deletePunishment(p.id)} />
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </Card>
              </div>
            )}

            {/* -------------------------------------------- Step 4: Micro habits */}
            {step === 3 && (
              <div className="space-y-4">
                <Card>
                  <div className="text-sm font-semibold mb-1">Daily non-negotiables ✅</div>
                  <p className="text-xs text-sub">
                    The small things you commit to every single day. Tick them off daily for points — tap the presets
                    you want, or add your own.
                  </p>
                </Card>
                {existingHabits.length > 0 && (
                  <Card className="space-y-2">
                    <div className="text-xs font-medium text-sub">Already in your list — these stay as they are</div>
                    {existingHabits.map((h) => (
                      <div key={h.id} className="flex items-center justify-between text-sm">
                        <span className="text-ink">{h.name}</span>
                        <span className="text-xs text-faint">
                          {habitTargetLabel(h.target_value, h.unit, h.direction)}
                        </span>
                      </div>
                    ))}
                  </Card>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {PRESET_HABITS.map((p) => {
                    const already = existingNames.has(p.name.toLowerCase())
                    const on = selectedPresets.has(p.name)
                    return (
                      <button
                        key={p.name}
                        type="button"
                        disabled={already}
                        onClick={() => togglePreset(p.name)}
                        aria-pressed={on}
                        className={`text-left rounded-2xl border px-3 py-3 transition-colors ${
                          already
                            ? 'bg-surface border-line opacity-50'
                            : on
                              ? 'bg-accent/15 border-accent/60'
                              : 'bg-surface border-line active:bg-raised'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-ink">{p.name}</span>
                          <span className={`text-xs ${on && !already ? 'text-accent' : 'text-faint'}`}>
                            {already ? '✓ added' : on ? '✓' : '+'}
                          </span>
                        </div>
                        <div className="text-xs text-sub mt-0.5">
                          {habitTargetLabel(p.target, p.unit, p.direction)} daily
                        </div>
                      </button>
                    )
                  })}
                </div>
                {customs.map((row) => (
                  <Card key={row.key} className="space-y-2">
                    <div className="flex gap-2 items-center">
                      <Input
                        value={row.name}
                        onChange={(e) => updateCustom(row.key, { name: e.target.value })}
                        placeholder="Habit name (e.g. Meditate)"
                        maxLength={60}
                      />
                      <Button variant="ghost" size="sm" onClick={() => removeCustom(row.key)} aria-label="Remove habit">
                        ✕
                      </Button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={row.target}
                        onChange={(e) => updateCustom(row.key, { target: e.target.value })}
                        placeholder="Target"
                      />
                      <Input
                        value={row.unit}
                        onChange={(e) => updateCustom(row.key, { unit: e.target.value })}
                        placeholder="Unit"
                        maxLength={12}
                      />
                      <Select
                        value={row.direction}
                        onChange={(e) => updateCustom(row.key, { direction: e.target.value as HabitDirection })}
                        aria-label="Direction"
                      >
                        <option value="at_least">At least</option>
                        <option value="at_most">At most</option>
                      </Select>
                    </div>
                  </Card>
                ))}
                <Button variant="soft" full onClick={addCustomRow}>
                  + Custom habit
                </Button>
              </div>
            )}

            {/* --------------------------------------------------- Step 5: Goals */}
            {step === 4 && (
              <div className="space-y-4">
                <Card>
                  <div className="text-sm font-semibold mb-1">Three horizons 🎯</div>
                  <p className="text-xs text-sub">
                    Weekly goals reset with the leaderboard, short-term goals span weeks or months, long-term is the
                    big one. When the time is up, each gets marked achieved or missed.
                  </p>
                </Card>
                <Card className="space-y-3">
                  <Segmented
                    options={TF_OPTIONS}
                    value={goalTf}
                    onChange={(v) => {
                      setGoalTf(v)
                      setGoalDate(v === 'weekly' ? thisSunday : '')
                    }}
                  />
                  <Field label="Goal">
                    <Input
                      value={goalTitle}
                      onChange={(e) => setGoalTitle(e.target.value)}
                      placeholder={GOAL_PLACEHOLDER[goalTf]}
                      maxLength={120}
                    />
                  </Field>
                  <Field
                    label="Target date — optional"
                    hint={goalTf === 'weekly' ? 'Defaults to this Sunday, when the week wraps.' : undefined}
                  >
                    <Input type="date" value={goalDate} onChange={(e) => setGoalDate(e.target.value)} />
                  </Field>
                  <Button variant="soft" full onClick={addGoal} disabled={goalBusy || !goalTitle.trim()}>
                    {goalBusy ? 'Adding…' : 'Add goal'}
                  </Button>
                </Card>
                {goals.length > 0 && (
                  <Card className="space-y-2">
                    <div className="text-xs font-medium text-sub">Your goals</div>
                    {goals.map((g) => (
                      <div key={g.id} className="flex items-center gap-2">
                        <Chip className="bg-white/10 text-sub shrink-0">{TF_LABEL[g.timeframe]}</Chip>
                        <div className="flex-1 min-w-0 text-sm text-ink truncate">{g.title}</div>
                        {g.target_date && (
                          <span className="text-[11px] text-faint shrink-0">{fmtDate(g.target_date)}</span>
                        )}
                        <ConfirmButton label="✕" confirmLabel="Delete?" onConfirm={() => deleteGoal(g.id)} />
                      </div>
                    ))}
                  </Card>
                )}
                <p className="text-xs text-faint px-1">Goals are optional for now — you can add more any time.</p>
              </div>
            )}

            {/* ------------------------------------------------------- Footer */}
            <div className="mt-6 space-y-2">
              {err && <ErrorNote message={err} />}
              <div className="flex gap-2">
                {step > 0 && (
                  <Button
                    variant="soft"
                    onClick={() => {
                      setErr('')
                      setStep(step - 1)
                    }}
                    disabled={busy}
                  >
                    Back
                  </Button>
                )}
                <Button full onClick={handleContinue} disabled={busy}>
                  {busy ? 'Saving…' : step === 4 ? 'Finish — enter the pact' : 'Continue'}
                </Button>
              </div>
              {step >= 2 && step < 4 && (
                <Button variant="ghost" size="sm" full onClick={finish} disabled={busy}>
                  Skip the rest & finish setup
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

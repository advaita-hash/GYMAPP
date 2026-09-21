import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { fetchPunishments } from '../lib/data'
import type { BodyStat, Member, WeekResult } from '../lib/types'
import { fmtDate, fmtWeek, today } from '../lib/dates'
import { POINT_RULES } from '../lib/points'
import { useAuth } from '../ctx/AuthContext'
import { PageHeader } from '../components/Layout'
import {
  Avatar, Button, Card, Chip, ConfirmButton, ErrorNote, Field, Input, SectionTitle, Spinner,
} from '../components/ui'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseNum(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function statLine(s: BodyStat): string {
  const parts: string[] = []
  if (s.weight_kg != null) parts.push(`${s.weight_kg} kg`)
  if (s.body_fat_pct != null) parts.push(`${s.body_fat_pct}%`)
  if (s.muscle_mass_kg != null) parts.push(`${s.muscle_mass_kg} kg`)
  return parts.length > 0 ? parts.join(' · ') : '—'
}

const PUNISHMENT_CHIP: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pending', cls: 'bg-warn/15 text-warn' },
  done: { label: 'Done', cls: 'bg-good/15 text-good' },
  skipped: { label: 'Skipped', cls: 'bg-white/5 text-faint' },
}

const SHORTCUTS = [
  { emoji: '🗓', label: 'Schedule', to: '/schedule' },
  { emoji: '✅', label: 'Habits', to: '/habits' },
  { emoji: '🎯', label: 'Goals', to: '/goals' },
  { emoji: '📆', label: 'Monthly recap', to: '/recap' },
]

// ---------------------------------------------------------------------------
// Inline-editable row (name / height share this pattern)
// ---------------------------------------------------------------------------

function InlineEdit({
  display, initial, placeholder, inputType, onSave, ariaLabel,
}: {
  display: React.ReactNode
  initial: string
  placeholder: string
  inputType?: 'text' | 'number'
  onSave: (value: string) => Promise<string | null>
  ariaLabel: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = () => {
    setDraft(initial)
    setError(null)
    setEditing(true)
  }

  const save = async () => {
    setBusy(true)
    setError(null)
    const err = await onSave(draft)
    setBusy(false)
    if (err) setError(err)
    else setEditing(false)
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-1 min-w-0">
        {display}
        <Button variant="ghost" size="sm" onClick={start} aria-label={`Edit ${ariaLabel}`}>
          ✏️
        </Button>
      </div>
    )
  }
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <Input
          type={inputType ?? 'text'}
          inputMode={inputType === 'number' ? 'decimal' : undefined}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={ariaLabel}
          autoFocus
        />
        <Button size="sm" onClick={() => void save()} disabled={busy}>
          {busy ? '…' : 'Save'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={busy}>
          ✕
        </Button>
      </div>
      {error && <div className="mt-2"><ErrorNote message={error} /></div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MePage() {
  const { me, session, signOut, refreshMembers } = useAuth()
  if (!me || !session) {
    return (
      <div>
        <PageHeader title="Me" />
        <Spinner />
      </div>
    )
  }
  return <MeInner me={me} session={session} signOut={signOut} refreshMembers={refreshMembers} />
}

function MeInner({
  me, session, signOut, refreshMembers,
}: {
  me: Member
  session: Session
  signOut: () => Promise<void>
  refreshMembers: () => Promise<void>
}) {
  const nav = useNavigate()

  // ----- fetched data -----
  const [stats, setStats] = useState<BodyStat[]>([])
  const [punRows, setPunRows] = useState<WeekResult[]>([])
  const [punTitles, setPunTitles] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const refetchStats = useCallback(async () => {
    const { data, error } = await supabase
      .from('gym_body_stats')
      .select('*')
      .eq('user_id', me.id)
      .order('recorded_on', { ascending: false })
      .limit(10)
    if (error) throw error
    setStats((data as BodyStat[] | null) ?? [])
  }, [me.id])

  const refetchPunishmentRows = useCallback(async () => {
    const { data, error } = await supabase
      .from('gym_week_results')
      .select('*')
      .eq('user_id', me.id)
      .neq('punishment_status', 'none')
      .order('week_start', { ascending: false })
    if (error) throw error
    setPunRows((data as WeekResult[] | null) ?? [])
  }, [me.id])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setLoadError(null)
      try {
        const pool = await fetchPunishments()
        if (cancelled) return
        setPunTitles(new Map(pool.map((p) => [p.id, p.title])))
        await Promise.all([refetchStats(), refetchPunishmentRows()])
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not load your data.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refetchStats, refetchPunishmentRows])

  // ----- profile edits -----
  const saveName = async (value: string): Promise<string | null> => {
    const name = value.trim()
    if (!name) return 'Name cannot be empty.'
    const { error } = await supabase.from('profiles').update({ name }).eq('id', me.id)
    if (error) return error.message
    await refreshMembers()
    return null
  }

  const saveHeight = async (value: string): Promise<string | null> => {
    const height_cm = parseNum(value)
    if (value.trim() && height_cm == null) return 'Enter a number, e.g. 178.'
    const { error } = await supabase
      .from('gym_profiles')
      .update({ height_cm, updated_at: new Date().toISOString() })
      .eq('user_id', me.id)
    if (error) return error.message
    await refreshMembers()
    return null
  }

  // ----- body stat quick add -----
  const [statDate, setStatDate] = useState(today())
  const [weight, setWeight] = useState('')
  const [fat, setFat] = useState('')
  const [muscle, setMuscle] = useState('')
  const [savingStat, setSavingStat] = useState(false)
  const [statError, setStatError] = useState<string | null>(null)

  const saveStat = async () => {
    setStatError(null)
    const weight_kg = parseNum(weight)
    const body_fat_pct = parseNum(fat)
    const muscle_mass_kg = parseNum(muscle)
    if (weight_kg == null && body_fat_pct == null && muscle_mass_kg == null) {
      setStatError('Enter at least one measurement.')
      return
    }
    if (!statDate || statDate > today()) {
      setStatError('Pick a date up to today.')
      return
    }
    setSavingStat(true)
    const { error } = await supabase.from('gym_body_stats').upsert(
      { user_id: me.id, recorded_on: statDate, weight_kg, body_fat_pct, muscle_mass_kg },
      { onConflict: 'user_id,recorded_on' },
    )
    if (error) {
      setStatError(error.message)
      setSavingStat(false)
      return
    }
    setWeight('')
    setFat('')
    setMuscle('')
    try {
      await refetchStats()
    } catch (e) {
      setStatError(e instanceof Error ? e.message : 'Saved, but could not refresh the list.')
    }
    setSavingStat(false)
  }

  const deleteStat = async (id: string) => {
    setStatError(null)
    const { error } = await supabase.from('gym_body_stats').delete().eq('id', id)
    if (error) {
      setStatError(error.message)
      return
    }
    try {
      await refetchStats()
    } catch (e) {
      setStatError(e instanceof Error ? e.message : 'Deleted, but could not refresh the list.')
    }
  }

  // ----- punishments -----
  const [punBusyId, setPunBusyId] = useState<string | null>(null)
  const [punError, setPunError] = useState<string | null>(null)

  const markPunishmentDone = async (row: WeekResult) => {
    setPunError(null)
    setPunBusyId(row.id)
    const { error } = await supabase
      .from('gym_week_results')
      .update({ punishment_status: 'done', punishment_done_at: new Date().toISOString() })
      .eq('id', row.id)
    if (error) {
      setPunError(error.message)
      setPunBusyId(null)
      return
    }
    try {
      await refetchPunishmentRows()
    } catch (e) {
      setPunError(e instanceof Error ? e.message : 'Updated, but could not refresh the list.')
    }
    setPunBusyId(null)
  }

  return (
    <div>
      <PageHeader
        title="Me"
        action={
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            Sign out
          </Button>
        }
      />

      {/* 1. Profile */}
      <Card>
        <div className="flex items-center gap-4">
          <Avatar name={me.name} color={me.color} size={56} />
          <div className="flex-1 min-w-0">
            <InlineEdit
              display={<div className="font-bold text-lg truncate">{me.name}</div>}
              initial={me.name}
              placeholder="Your name"
              onSave={saveName}
              ariaLabel="name"
            />
            <div className="text-faint text-xs truncate">{session.user.email ?? ''}</div>
          </div>
        </div>
        <div className="mt-4 pt-3 border-t border-line flex items-center justify-between gap-2">
          <div className="text-sm text-sub">Height</div>
          <InlineEdit
            display={
              <div className="text-sm font-medium">
                {me.gym.height_cm != null ? `${me.gym.height_cm} cm` : '—'}
              </div>
            }
            initial={me.gym.height_cm != null ? String(me.gym.height_cm) : ''}
            placeholder="cm"
            inputType="number"
            onSave={saveHeight}
            ariaLabel="height"
          />
        </div>
        <div className="mt-2 text-xs text-faint">
          In the pact since {fmtDate(me.gym.created_at.slice(0, 10))}
        </div>
      </Card>

      {loadError && (
        <div className="mt-4">
          <ErrorNote message={loadError} />
        </div>
      )}

      {/* 2. Body stats */}
      <SectionTitle
        action={
          <Button variant="ghost" size="sm" onClick={() => nav('/stats')}>
            Charts →
          </Button>
        }
      >
        Body stats
      </SectionTitle>
      <Card>
        <Field label="Date">
          <Input
            type="date"
            value={statDate}
            max={today()}
            onChange={(e) => setStatDate(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-3 gap-2 mt-3">
          <Field label="Weight kg">
            <Input
              type="number"
              inputMode="decimal"
              placeholder="72.4"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </Field>
          <Field label="Fat %">
            <Input
              type="number"
              inputMode="decimal"
              placeholder="18.2"
              value={fat}
              onChange={(e) => setFat(e.target.value)}
            />
          </Field>
          <Field label="Muscle kg">
            <Input
              type="number"
              inputMode="decimal"
              placeholder="33.1"
              value={muscle}
              onChange={(e) => setMuscle(e.target.value)}
            />
          </Field>
        </div>
        <div className="mt-3">
          <Button full onClick={() => void saveStat()} disabled={savingStat}>
            {savingStat ? 'Saving…' : 'Save entry'}
          </Button>
        </div>
        {statError && (
          <div className="mt-3">
            <ErrorNote message={statError} />
          </div>
        )}
        {loading ? (
          <Spinner />
        ) : stats.length > 0 ? (
          <div className="mt-4 divide-y divide-line border-t border-line">
            {stats.map((s) => (
              <div key={s.id} className="flex items-center gap-2 py-2">
                <div className="text-xs text-faint w-24 shrink-0">{fmtDate(s.recorded_on)}</div>
                <div className="text-sm flex-1 min-w-0 truncate">{statLine(s)}</div>
                <ConfirmButton label="✕" onConfirm={() => void deleteStat(s.id)} />
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 pt-3 border-t border-line text-sm text-faint text-center">
            No entries yet — log your first weigh-in above.
          </div>
        )}
      </Card>

      {/* 3. My punishments */}
      {punRows.length > 0 && (
        <>
          <SectionTitle>My punishments</SectionTitle>
          <Card>
            {punError && (
              <div className="mb-3">
                <ErrorNote message={punError} />
              </div>
            )}
            <div className="divide-y divide-line">
              {punRows.map((r) => {
                const chip = PUNISHMENT_CHIP[r.punishment_status] ?? PUNISHMENT_CHIP.skipped
                return (
                  <div key={r.id} className="flex items-center gap-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-faint">{fmtWeek(r.week_start)}</div>
                      <div className="text-sm font-medium truncate">
                        {(r.punishment_id && punTitles.get(r.punishment_id)) || 'Punishment'}
                      </div>
                    </div>
                    <Chip className={chip.cls}>{chip.label}</Chip>
                    {r.punishment_status === 'pending' && (
                      <Button
                        size="sm"
                        onClick={() => void markPunishmentDone(r)}
                        disabled={punBusyId === r.id}
                      >
                        {punBusyId === r.id ? '…' : 'Mark done'}
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          </Card>
        </>
      )}

      {/* 4. How points work */}
      <SectionTitle>How points work</SectionTitle>
      <Card>
        <div className="divide-y divide-line">
          {POINT_RULES.map((r) => (
            <div key={r.label} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="text-sub">{r.label}</div>
              <div className="font-medium text-right">{r.pts}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* 5. Shortcuts */}
      <SectionTitle>Shortcuts</SectionTitle>
      <div className="space-y-2">
        {SHORTCUTS.map((s) => (
          <Card key={s.to} onClick={() => nav(s.to)}>
            <div className="flex items-center gap-3">
              <span className="text-xl" aria-hidden>
                {s.emoji}
              </span>
              <span className="flex-1 font-medium text-sm">{s.label}</span>
              <span className="text-faint" aria-hidden>
                →
              </span>
            </div>
          </Card>
        ))}
      </div>

      {/* 6. Footer */}
      <div className="text-center text-faint text-xs mt-8 mb-2">
        Iron Pact · train together, answer to each other
      </div>
    </div>
  )
}

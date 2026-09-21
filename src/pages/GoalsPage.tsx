import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { PageHeader } from '../components/Layout'
import {
  Avatar,
  Button,
  Card,
  Chip,
  ConfirmButton,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  SectionTitle,
  Segmented,
  Sheet,
  Spinner,
  TextArea,
} from '../components/ui'
import { supabase } from '../lib/supabase'
import { useAuth } from '../ctx/AuthContext'
import { addDays, currentWeekStart, fmtDate, today } from '../lib/dates'
import type { Goal, GoalStatus, GoalTimeframe } from '../lib/types'

type View = 'mine' | 'crew'

const SECTIONS: { tf: GoalTimeframe; title: string }[] = [
  { tf: 'weekly', title: 'This week' },
  { tf: 'short_term', title: 'Short term' },
  { tf: 'long_term', title: 'Long term' },
]

const TF_OPTIONS: { value: GoalTimeframe; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'short_term', label: 'Short term' },
  { value: 'long_term', label: 'Long term' },
]

interface GoalForm {
  id: string | null
  timeframe: GoalTimeframe
  title: string
  description: string
  targetDate: string
}

function defaultDateFor(tf: GoalTimeframe): string {
  return tf === 'weekly' ? addDays(currentWeekStart(), 6) : ''
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

export default function GoalsPage() {
  const { me, members } = useAuth()

  const [goals, setGoals] = useState<Goal[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [view, setView] = useState<View>('mine')

  // Add / edit sheet
  const [sheetOpen, setSheetOpen] = useState(false)
  const [form, setForm] = useState<GoalForm>({
    id: null,
    timeframe: 'weekly',
    title: '',
    description: '',
    targetDate: defaultDateFor('weekly'),
  })
  const [dateTouched, setDateTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sheetError, setSheetError] = useState<string | null>(null)

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('gym_goals')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) {
      setLoadError(error.message)
      return
    }
    setLoadError(null)
    setGoals((data ?? []) as Goal[])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const viewGoals = useMemo(() => {
    if (!goals) return []
    return view === 'mine' && me ? goals.filter((g) => g.user_id === me.id) : goals
  }, [goals, view, me])

  const history = useMemo(
    () =>
      viewGoals
        .filter((g) => g.status !== 'active')
        .sort((a, b) => (b.resolved_at ?? b.created_at).localeCompare(a.resolved_at ?? a.created_at))
        .slice(0, 12),
    [viewGoals],
  )

  function openAdd() {
    setForm({ id: null, timeframe: 'weekly', title: '', description: '', targetDate: defaultDateFor('weekly') })
    setDateTouched(false)
    setSheetError(null)
    setSheetOpen(true)
  }

  function openEdit(g: Goal) {
    setForm({
      id: g.id,
      timeframe: g.timeframe,
      title: g.title,
      description: g.description,
      targetDate: g.target_date ?? '',
    })
    setDateTouched(true)
    setSheetError(null)
    setSheetOpen(true)
  }

  function changeTimeframe(tf: GoalTimeframe) {
    setForm((f) => ({
      ...f,
      timeframe: tf,
      targetDate: dateTouched ? f.targetDate : defaultDateFor(tf),
    }))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!me) return
    const title = form.title.trim()
    if (!title || saving) return
    setSaving(true)
    setSheetError(null)
    const payload = {
      timeframe: form.timeframe,
      title,
      description: form.description.trim(),
      target_date: form.targetDate || null,
    }
    const { error } = form.id
      ? await supabase.from('gym_goals').update(payload).eq('id', form.id)
      : await supabase.from('gym_goals').insert({ user_id: me.id, status: 'active', ...payload })
    if (error) {
      setSheetError(error.message)
      setSaving(false)
      return
    }
    await load()
    setSaving(false)
    setSheetOpen(false)
  }

  async function deleteGoal() {
    if (!form.id || saving) return
    setSaving(true)
    setSheetError(null)
    const { error } = await supabase.from('gym_goals').delete().eq('id', form.id)
    if (error) {
      setSheetError(error.message)
      setSaving(false)
      return
    }
    await load()
    setSaving(false)
    setSheetOpen(false)
  }

  async function setStatus(g: Goal, status: GoalStatus) {
    if (busyId) return
    setBusyId(g.id)
    setActionError(null)
    const patch =
      status === 'active'
        ? { status, resolved_at: null }
        : { status, resolved_at: new Date().toISOString() }
    const { error } = await supabase.from('gym_goals').update(patch).eq('id', g.id)
    if (error) setActionError(error.message)
    else await load()
    setBusyId(null)
  }

  function renderTargetChip(g: Goal) {
    if (!g.target_date) return null
    const overdue = g.target_date < today() && g.status === 'active'
    return overdue ? (
      <Chip className="bg-bad/15 text-[#e88]">⏰ {fmtDate(g.target_date)}</Chip>
    ) : (
      <Chip className="bg-white/5 text-faint">🗓 {fmtDate(g.target_date)}</Chip>
    )
  }

  function renderGoalCard(g: Goal) {
    const isMine = !!me && g.user_id === me.id
    const owner = memberById.get(g.user_id)
    return (
      <Card key={g.id} className="mb-2" onClick={isMine ? () => openEdit(g) : undefined}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {view === 'crew' && owner && (
              <div className="flex items-center gap-1.5 mb-1">
                <Avatar name={owner.name} color={owner.color} size={20} />
                <span className="text-xs text-sub">{firstName(owner.name)}</span>
              </div>
            )}
            <div className="font-semibold">{g.title}</div>
            {g.description && <div className="text-sub text-sm mt-0.5">{g.description}</div>}
          </div>
          {isMine && (
            <div className="flex gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" disabled={busyId !== null} onClick={() => setStatus(g, 'achieved')}>
                ✓ Done
              </Button>
              <Button variant="ghost" size="sm" disabled={busyId !== null} onClick={() => setStatus(g, 'missed')}>
                ✗ Missed
              </Button>
            </div>
          )}
        </div>
        {g.target_date && <div className="mt-2">{renderTargetChip(g)}</div>}
      </Card>
    )
  }

  function renderHistoryRow(g: Goal) {
    const isMine = !!me && g.user_id === me.id
    const owner = memberById.get(g.user_id)
    const missed = g.status === 'missed'
    const resolvedOn = g.resolved_at ? fmtDate(g.resolved_at.slice(0, 10)) : null
    return (
      <div key={g.id} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
        {missed ? (
          <Chip className="bg-bad/15 text-[#e88] shrink-0">✗ missed</Chip>
        ) : (
          <Chip className="bg-good/15 text-[#7ad47a] shrink-0">✓ achieved</Chip>
        )}
        <span className={`text-sm flex-1 min-w-0 truncate ${missed ? 'line-through text-sub' : 'text-ink'}`}>
          {g.title}
        </span>
        {view === 'crew' && owner && (
          <span className="text-xs text-faint shrink-0">{firstName(owner.name)}</span>
        )}
        {resolvedOn && <span className="text-xs text-faint shrink-0">{resolvedOn}</span>}
        {isMine && (
          <Button
            variant="ghost"
            size="sm"
            className="px-2 py-1 text-[11px] shrink-0"
            disabled={busyId !== null}
            onClick={() => setStatus(g, 'active')}
          >
            Reopen
          </Button>
        )}
      </div>
    )
  }

  const loading = goals === null && !loadError
  const nothingAtAll = goals !== null && viewGoals.length === 0

  return (
    <div>
      <PageHeader
        title="Goals"
        back
        subtitle="Say it. Chase it. Answer for it."
        action={
          <Button variant="soft" size="sm" onClick={openAdd}>
            + Goal
          </Button>
        }
      />

      <Segmented<View>
        options={[
          { value: 'mine', label: 'Mine' },
          { value: 'crew', label: 'Crew' },
        ]}
        value={view}
        onChange={setView}
      />

      {loadError && (
        <div className="mt-4">
          <ErrorNote message={loadError} />
        </div>
      )}
      {actionError && (
        <div className="mt-4">
          <ErrorNote message={actionError} />
        </div>
      )}

      {loading ? (
        <Spinner label="Loading goals…" />
      ) : nothingAtAll ? (
        <div className="mt-4">
          <EmptyState
            emoji="🎯"
            title={view === 'mine' ? 'No goals yet' : 'The crew has no goals yet'}
            hint="Weekly, short term or long term — put it on the record."
            action={
              <Button variant="soft" size="sm" onClick={openAdd}>
                + Add a goal
              </Button>
            }
          />
        </div>
      ) : (
        goals !== null && (
          <>
            {SECTIONS.map(({ tf, title }) => {
              const active = viewGoals.filter((g) => g.status === 'active' && g.timeframe === tf)
              return (
                <section key={tf}>
                  <SectionTitle>{title}</SectionTitle>
                  {active.length === 0 ? (
                    <div className="text-faint text-sm px-1">Nothing here yet</div>
                  ) : (
                    active.map(renderGoalCard)
                  )}
                </section>
              )
            })}

            <SectionTitle>History</SectionTitle>
            {history.length === 0 ? (
              <div className="text-faint text-sm px-1">Nothing here yet</div>
            ) : (
              <Card className="divide-y divide-line">{history.map(renderHistoryRow)}</Card>
            )}
          </>
        )
      )}

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={form.id ? 'Edit goal' : 'New goal'}
      >
        <form onSubmit={submit} className="space-y-4">
          <Field label="Timeframe">
            <Segmented<GoalTimeframe> options={TF_OPTIONS} value={form.timeframe} onChange={changeTimeframe} />
          </Field>
          <Field label="Title">
            <Input
              required
              value={form.title}
              placeholder="e.g. Squat 100 kg for 5"
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </Field>
          <Field label="Description" hint="Optional — how will you get there?">
            <TextArea
              value={form.description}
              placeholder="Details, plan, why it matters…"
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </Field>
          <Field label="Target date" hint="Optional deadline">
            <Input
              type="date"
              value={form.targetDate}
              onChange={(e) => {
                setDateTouched(true)
                setForm((f) => ({ ...f, targetDate: e.target.value }))
              }}
            />
          </Field>
          {sheetError && <ErrorNote message={sheetError} />}
          <Button type="submit" full disabled={saving || !form.title.trim()}>
            {saving ? 'Saving…' : form.id ? 'Save changes' : 'Add goal'}
          </Button>
        </form>
        {form.id && (
          <div className="mt-2 flex justify-center">
            <ConfirmButton label="Delete goal" confirmLabel="Really delete?" onConfirm={deleteGoal} />
          </div>
        )}
      </Sheet>
    </div>
  )
}

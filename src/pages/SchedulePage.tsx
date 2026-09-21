import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { WEEKDAYS, WEEKDAYS_SHORT, WORKOUT_TYPE_META } from '../lib/types'
import type { ScheduleEntry, ScheduleType } from '../lib/types'
import { today, weekdayOf } from '../lib/dates'
import { useAuth } from '../ctx/AuthContext'
import {
  Button,
  Card,
  Chip,
  ConfirmButton,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Segmented,
  Sheet,
  Spinner,
  TextArea,
} from '../components/ui'
import { PageHeader } from '../components/Layout'

const TYPE_OPTIONS: { value: ScheduleType; label: string }[] = (
  ['strength', 'cardio', 'sport', 'other', 'rest'] as ScheduleType[]
).map((t) => ({ value: t, label: WORKOUT_TYPE_META[t].label }))

interface FormState {
  workout_type: ScheduleType
  title: string
  time_label: string
  details: string
}

const EMPTY_FORM: FormState = { workout_type: 'strength', title: '', time_label: '', details: '' }

type SheetState =
  | { mode: 'add'; weekday: number }
  | { mode: 'edit'; entry: ScheduleEntry }
  | null

export default function SchedulePage() {
  const { me, members } = useAuth()
  const myId = me?.id ?? null

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const viewedId = selectedId ?? myId
  const isMine = viewedId !== null && viewedId === myId

  const [entries, setEntries] = useState<ScheduleEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [sheet, setSheet] = useState<SheetState>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [sheetError, setSheetError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [copying, setCopying] = useState(false)
  const [copyDays, setCopyDays] = useState<Set<number>>(new Set())

  const todayWd = weekdayOf(today())

  const orderedMembers = useMemo(() => {
    if (!me) return members
    return [me, ...members.filter((m) => m.id !== me.id)]
  }, [members, me])

  const viewedMember = useMemo(
    () => orderedMembers.find((m) => m.id === viewedId) ?? null,
    [orderedMembers, viewedId],
  )

  const load = useCallback(async (userId: string) => {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('gym_schedule')
      .select('*')
      .eq('user_id', userId)
      .order('weekday')
      .order('position')
    if (err) {
      setError(err.message)
    } else {
      setEntries((data ?? []) as ScheduleEntry[])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (viewedId) void load(viewedId)
  }, [viewedId, load])

  const maxPosition = useCallback(
    (weekday: number) =>
      entries.filter((e) => e.weekday === weekday).reduce((m, e) => Math.max(m, e.position), 0),
    [entries],
  )

  function openAdd(weekday: number) {
    setForm(EMPTY_FORM)
    setSheetError(null)
    setCopyDays(new Set())
    setSheet({ mode: 'add', weekday })
  }

  function openEdit(entry: ScheduleEntry) {
    setForm({
      workout_type: entry.workout_type,
      title: entry.title,
      time_label: entry.time_label,
      details: entry.details,
    })
    setSheetError(null)
    setCopyDays(new Set())
    setSheet({ mode: 'edit', entry })
  }

  function closeSheet() {
    setSheet(null)
  }

  function changeType(t: ScheduleType) {
    setForm((f) => {
      let title = f.title
      if (t === 'rest' && title.trim() === '') title = 'Rest day'
      else if (t !== 'rest' && title === 'Rest day') title = ''
      return { ...f, workout_type: t, title }
    })
  }

  /** Trimmed form values, with the rest-day title fallback applied. */
  function formValues(): { workout_type: ScheduleType; title: string; time_label: string; details: string } | null {
    const title = form.title.trim() || (form.workout_type === 'rest' ? 'Rest day' : '')
    if (!title) {
      setSheetError('Give it a title first.')
      return null
    }
    return {
      workout_type: form.workout_type,
      title,
      time_label: form.time_label.trim(),
      details: form.details.trim(),
    }
  }

  async function save() {
    if (!sheet || !myId || !viewedId) return
    const values = formValues()
    if (!values) return
    setSaving(true)
    setSheetError(null)
    if (sheet.mode === 'add') {
      const { error: err } = await supabase.from('gym_schedule').insert({
        user_id: myId,
        weekday: sheet.weekday,
        position: maxPosition(sheet.weekday) + 1,
        ...values,
      })
      if (err) {
        setSheetError(err.message)
        setSaving(false)
        return
      }
    } else {
      const { error: err } = await supabase
        .from('gym_schedule')
        .update({ ...values, updated_at: new Date().toISOString() })
        .eq('id', sheet.entry.id)
      if (err) {
        setSheetError(err.message)
        setSaving(false)
        return
      }
    }
    setSaving(false)
    setSheet(null)
    await load(viewedId)
  }

  async function copyToDays() {
    if (!sheet || sheet.mode !== 'edit' || !myId || !viewedId || copyDays.size === 0) return
    const values = formValues()
    if (!values) return
    setCopying(true)
    setSheetError(null)
    const rows = [...copyDays].map((d) => ({
      user_id: myId,
      weekday: d,
      position: maxPosition(d) + 1,
      ...values,
    }))
    const { error: err } = await supabase.from('gym_schedule').insert(rows)
    if (err) {
      setSheetError(err.message)
      setCopying(false)
      return
    }
    setCopying(false)
    setSheet(null)
    await load(viewedId)
  }

  async function removeEntry() {
    if (!sheet || sheet.mode !== 'edit' || !viewedId) return
    setSheetError(null)
    const { error: err } = await supabase.from('gym_schedule').delete().eq('id', sheet.entry.id)
    if (err) {
      setSheetError(err.message)
      return
    }
    setSheet(null)
    await load(viewedId)
  }

  function toggleCopyDay(d: number) {
    setCopyDays((prev) => {
      const next = new Set(prev)
      if (next.has(d)) next.delete(d)
      else next.add(d)
      return next
    })
  }

  const viewedFirstName = viewedMember ? viewedMember.name.split(/\s+/)[0] : ''
  const showEmptyOther = !loading && !error && !isMine && entries.length === 0

  const sheetTitle =
    sheet?.mode === 'add'
      ? `Add · ${WEEKDAYS[sheet.weekday]}`
      : sheet?.mode === 'edit'
        ? `Edit · ${WEEKDAYS[sheet.entry.weekday]}`
        : ''

  return (
    <div>
      <PageHeader title="Schedule" back subtitle="The plan you answer to" />

      {/* Member switcher */}
      <div className="flex gap-2 overflow-x-auto pb-1 mb-2 -mx-1 px-1">
        {orderedMembers.map((m) => {
          const selected = m.id === viewedId
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setSelectedId(m.id)}
              className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                selected ? 'bg-accent text-black border-accent' : 'bg-surface border-line text-sub active:bg-raised'
              }`}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: m.color }} aria-hidden />
              {m.id === myId ? 'Me' : m.name}
            </button>
          )
        })}
      </div>

      {loading ? (
        <Spinner label="Loading plan…" />
      ) : error ? (
        <div className="mt-4">
          <ErrorNote message={error} />
          <div className="mt-3">
            <Button variant="soft" size="sm" onClick={() => viewedId && void load(viewedId)}>
              Try again
            </Button>
          </div>
        </div>
      ) : showEmptyOther ? (
        <div className="mt-4">
          <EmptyState emoji="🗓" title="No plan yet" hint={`${viewedFirstName} hasn't set a schedule`} />
        </div>
      ) : (
        WEEKDAYS.map((dayName, day) => {
          const dayEntries = entries.filter((e) => e.weekday === day)
          return (
            <section key={day} className="mt-5">
              <div className="flex items-center justify-between mb-2 px-1">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-faint">
                  {dayName}
                  {day === todayWd && (
                    <span className="text-accent normal-case tracking-normal"> · today</span>
                  )}
                </h2>
                {isMine && (
                  <Button variant="ghost" size="sm" onClick={() => openAdd(day)}>
                    + Add
                  </Button>
                )}
              </div>
              {dayEntries.length === 0 ? (
                <div className="text-faint text-sm px-1">—</div>
              ) : (
                <div className="space-y-2">
                  {dayEntries.map((e) => {
                    const meta = WORKOUT_TYPE_META[e.workout_type]
                    return (
                      <Card key={e.id} onClick={isMine ? () => openEdit(e) : undefined}>
                        <div className="flex items-center gap-2">
                          <Chip className={meta.chip}>
                            {meta.emoji} {meta.label}
                          </Chip>
                          <div className="flex-1 min-w-0 font-semibold text-sm truncate">{e.title}</div>
                          {e.time_label && <div className="text-xs text-faint shrink-0">{e.time_label}</div>}
                        </div>
                        {e.details && (
                          <div className="text-sub text-xs mt-1.5 whitespace-pre-line">{e.details}</div>
                        )}
                      </Card>
                    )
                  })}
                </div>
              )}
            </section>
          )
        })
      )}

      {/* Add / edit sheet */}
      <Sheet open={sheet !== null} onClose={closeSheet} title={sheetTitle}>
        {sheet && (
          <div className="space-y-4">
            {sheetError && <ErrorNote message={sheetError} />}
            <Field label="Type">
              <Segmented<ScheduleType> options={TYPE_OPTIONS} value={form.workout_type} onChange={changeType} />
            </Field>
            <Field label="Title">
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder={form.workout_type === 'rest' ? 'Rest day' : 'e.g. Push day'}
              />
            </Field>
            <Field label="Time (optional)">
              <Input
                value={form.time_label}
                onChange={(e) => setForm((f) => ({ ...f, time_label: e.target.value }))}
                placeholder="6:30 AM"
              />
            </Field>
            <Field label="Details (optional)">
              <TextArea
                value={form.details}
                onChange={(e) => setForm((f) => ({ ...f, details: e.target.value }))}
                placeholder="Be specific — e.g. Bench 4×8 @60kg, Incline DB 3×10, Dips 3×AMRAP"
              />
            </Field>
            <Button type="button" full disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : sheet.mode === 'add' ? 'Add to plan' : 'Save changes'}
            </Button>

            {sheet.mode === 'edit' && (
              <>
                <div className="pt-4 border-t border-line">
                  <div className="text-xs font-semibold uppercase tracking-wider text-faint mb-2">Copy to…</div>
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAYS_SHORT.map((label, d) => {
                      const own = d === sheet.entry.weekday
                      const on = copyDays.has(d)
                      return (
                        <button
                          key={d}
                          type="button"
                          disabled={own}
                          onClick={() => toggleCopyDay(d)}
                          className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                            own
                              ? 'bg-raised border-line text-faint opacity-40'
                              : on
                                ? 'bg-accent text-black border-accent'
                                : 'bg-raised border-line text-sub active:bg-white/10'
                          }`}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                  <div className="mt-3">
                    <Button
                      type="button"
                      variant="soft"
                      size="sm"
                      disabled={copying || copyDays.size === 0}
                      onClick={() => void copyToDays()}
                    >
                      {copying ? 'Copying…' : 'Copy'}
                    </Button>
                  </div>
                </div>
                <div className="flex justify-center pt-1">
                  <ConfirmButton label="Delete" confirmLabel="Delete for good?" onConfirm={() => void removeEntry()} />
                </div>
              </>
            )}
          </div>
        )}
      </Sheet>
    </div>
  )
}

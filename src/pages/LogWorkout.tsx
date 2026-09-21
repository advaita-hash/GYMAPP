import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../ctx/AuthContext'
import { PageHeader } from '../components/Layout'
import { Button, Card, ErrorNote, Field, Input, Segmented, Select, TextArea } from '../components/ui'
import { addDays, today, weekdayOf } from '../lib/dates'
import { workoutPoints } from '../lib/points'
import { deleteWorkoutPhoto, uploadWorkoutPhoto } from '../lib/photos'
import type { Intensity, ScheduleEntry, Workout, WorkoutSet, WorkoutType } from '../lib/types'
import { INTENSITY_META, WORKOUT_TYPE_META } from '../lib/types'

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

interface SetDraft {
  reps: string
  weight: string
}

interface ExerciseDraft {
  name: string
  sets: SetDraft[]
}

const WORKOUT_TYPES: WorkoutType[] = ['strength', 'cardio', 'sport', 'other']
const INTENSITIES: Intensity[] = ['light', 'moderate', 'hard']

const TITLE_PLACEHOLDER: Record<WorkoutType, string> = {
  strength: 'Push day',
  cardio: 'Morning run',
  sport: 'Basketball',
  other: 'Trek / long walk',
}

function parseNumOrNull(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function parseIntOrNull(s: string): number | null {
  const n = parseNumOrNull(s)
  return n == null ? null : Math.round(n)
}

/** Flatten the exercise builder into set rows (without workout_id). */
function buildSetRows(
  exercises: ExerciseDraft[],
): { exercise: string; set_no: number; reps: number | null; weight_kg: number | null }[] {
  const rows: { exercise: string; set_no: number; reps: number | null; weight_kg: number | null }[] = []
  for (const ex of exercises) {
    const name = ex.name.trim()
    if (!name) continue
    let setNo = 0
    for (const s of ex.sets) {
      const reps = parseIntOrNull(s.reps)
      const weight = parseNumOrNull(s.weight)
      if (reps == null && weight == null) continue
      setNo += 1
      rows.push({ exercise: name, set_no: setNo, reps, weight_kg: weight })
    }
  }
  return rows
}

function loadImageSource(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file)
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Image failed to load'))
    }
    img.src = url
  })
}

/** Downscale a photo client-side (longest side ≤1600px, JPEG q0.85). Falls back to the original. */
async function downscalePhoto(file: File): Promise<File> {
  try {
    const source = await loadImageSource(file)
    const w = source instanceof ImageBitmap ? source.width : source.naturalWidth
    const h = source instanceof ImageBitmap ? source.height : source.naturalHeight
    if (!w || !h) return file
    const scale = Math.min(1, 1600 / Math.max(w, h))
    const cw = Math.max(1, Math.round(w * scale))
    const ch = Math.max(1, Math.round(h * scale))
    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(source, 0, 0, cw, ch)
    if (source instanceof ImageBitmap) source.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (!blob) return file
    const base = file.name.replace(/\.[^.]+$/, '') || 'photo'
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' })
  } catch {
    return file
  }
}

/** Plain labeled block for controls that must not live inside a <label> (Segmented, photo picker). */
function FieldBlock({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-sub mb-1.5">{label}</div>
      {children}
      {hint && <div className="text-[11px] text-faint mt-1">{hint}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LogWorkout() {
  const { me } = useAuth()
  const navigate = useNavigate()

  const maxDate = today()
  const minDate = addDays(maxDate, -14)

  // Form state (top-down)
  const [date, setDate] = useState(maxDate)
  const [type, setType] = useState<WorkoutType>('strength')
  const [planned, setPlanned] = useState<ScheduleEntry[]>([])
  const [scheduleErr, setScheduleErr] = useState<string | null>(null)
  const [scheduleId, setScheduleId] = useState('')
  const [title, setTitle] = useState('')
  const [durationMin, setDurationMin] = useState('')
  const [distanceKm, setDistanceKm] = useState('')
  const [intensity, setIntensity] = useState<Intensity>('moderate')
  const [exercises, setExercises] = useState<ExerciseDraft[]>([
    { name: '', sets: [{ reps: '', weight: '' }] },
  ])
  const [notes, setNotes] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const weekday = date ? weekdayOf(date) : -1

  // Planned sessions for the chosen date's weekday (mine, excluding rest days)
  useEffect(() => {
    const uid = me?.id
    if (!uid || weekday < 0) {
      setPlanned([])
      return
    }
    let cancelled = false
    setScheduleErr(null)
    supabase
      .from('gym_schedule')
      .select('*')
      .eq('user_id', uid)
      .eq('weekday', weekday)
      .neq('workout_type', 'rest')
      .order('position', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          setScheduleErr(error.message)
          setPlanned([])
          return
        }
        const rows = (data as ScheduleEntry[] | null) ?? []
        setPlanned(rows)
        setScheduleId((cur) => (cur && !rows.some((r) => r.id === cur) ? '' : cur))
      })
    return () => {
      cancelled = true
    }
  }, [me?.id, weekday])

  // Photo preview object URL
  const previewUrl = useMemo(() => (photoFile ? URL.createObjectURL(photoFile) : null), [photoFile])
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const onPickPhoto = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null
    if (f) setPhotoFile(f)
    e.target.value = ''
  }

  const onPlanChange = (id: string) => {
    if (!id) {
      setScheduleId('')
      return
    }
    const entry = planned.find((p) => p.id === id)
    if (!entry) return
    setScheduleId(id)
    setTitle(entry.title)
    if (entry.workout_type !== 'rest') setType(entry.workout_type)
  }

  // Exercise builder ops
  const updateExerciseName = (ei: number, name: string) =>
    setExercises((xs) => xs.map((x, i) => (i === ei ? { ...x, name } : x)))
  const removeExercise = (ei: number) => setExercises((xs) => xs.filter((_, i) => i !== ei))
  const addExercise = () =>
    setExercises((xs) => [...xs, { name: '', sets: [{ reps: '', weight: '' }] }])
  const updateSet = (ei: number, si: number, patch: Partial<SetDraft>) =>
    setExercises((xs) =>
      xs.map((x, i) =>
        i === ei ? { ...x, sets: x.sets.map((s, j) => (j === si ? { ...s, ...patch } : s)) } : x,
      ),
    )
  const removeSet = (ei: number, si: number) =>
    setExercises((xs) =>
      xs.map((x, i) => (i === ei ? { ...x, sets: x.sets.filter((_, j) => j !== si) } : x)),
    )
  const addSet = (ei: number) =>
    setExercises((xs) =>
      xs.map((x, i) => {
        if (i !== ei) return x
        const prev = x.sets[x.sets.length - 1]
        return { ...x, sets: [...x.sets, { reps: prev ? prev.reps : '', weight: prev ? prev.weight : '' }] }
      }),
    )

  // Live points preview
  const preview = useMemo(() => {
    const candidate: Workout = {
      id: 'preview',
      user_id: me?.id ?? '',
      logged_on: date,
      schedule_id: scheduleId || null,
      workout_type: type,
      title,
      duration_min: parseNumOrNull(durationMin),
      distance_km: type === 'cardio' ? parseNumOrNull(distanceKm) : null,
      intensity: type === 'sport' || type === 'other' ? intensity : null,
      notes,
      photo_path: photoFile ? 'x' : null,
      created_at: '',
      updated_at: '',
    }
    const candidateSets: WorkoutSet[] =
      type === 'strength'
        ? buildSetRows(exercises).map((r, i) => ({
            id: `preview-${i}`,
            workout_id: 'preview',
            created_at: '',
            ...r,
          }))
        : []
    return workoutPoints(candidate, candidateSets)
  }, [me?.id, date, scheduleId, type, title, durationMin, distanceKm, intensity, exercises, notes, photoFile])

  const validate = (): string | null => {
    if (!date) return 'Pick a date.'
    if (date < minDate || date > maxDate) return 'Pick a date within the last two weeks.'
    if (!title.trim()) return 'Give your workout a title.'
    const dur = parseNumOrNull(durationMin)
    if (durationMin.trim() && (dur == null || dur <= 0)) return 'Duration must be a positive number of minutes.'
    if (type === 'cardio') {
      const dist = parseNumOrNull(distanceKm)
      if (distanceKm.trim() && (dist == null || dist <= 0)) return 'Distance must be a positive number of km.'
      if (dur == null && dist == null) return 'Cardio needs a distance or a duration.'
    }
    if (type === 'strength' && !exercises.some((x) => x.name.trim())) {
      return 'Add at least one named exercise.'
    }
    return null
  }

  const save = async () => {
    const msg = validate()
    if (msg) {
      setErr(msg)
      return
    }
    if (!me) return
    setErr(null)
    setBusy(true)
    let photoPath: string | null = null
    let inserted = false
    try {
      if (photoFile) {
        const processed = await downscalePhoto(photoFile)
        photoPath = await uploadWorkoutPhoto(me.id, processed)
      }
      const payload = {
        user_id: me.id,
        logged_on: date,
        schedule_id: scheduleId || null,
        workout_type: type,
        title: title.trim(),
        duration_min: parseNumOrNull(durationMin),
        distance_km: type === 'cardio' ? parseNumOrNull(distanceKm) : null,
        intensity: type === 'sport' || type === 'other' ? intensity : null,
        notes: notes.trim(),
        photo_path: photoPath,
      }
      const { data, error } = await supabase.from('gym_workouts').insert(payload).select().single()
      if (error || !data) {
        if (photoPath) await deleteWorkoutPhoto(photoPath).catch(() => {})
        setErr(error?.message ?? 'Could not save the workout.')
        setBusy(false)
        return
      }
      inserted = true
      const workout = data as Workout
      if (type === 'strength') {
        const rows = buildSetRows(exercises).map((r) => ({ workout_id: workout.id, ...r }))
        if (rows.length > 0) {
          const { error: setsError } = await supabase.from('gym_workout_sets').insert(rows)
          if (setsError) {
            setErr(`Workout saved, but sets failed: ${setsError.message}`)
            setBusy(false)
            return
          }
        }
      }
      navigate('/feed')
    } catch (e) {
      if (photoPath && !inserted) await deleteWorkoutPhoto(photoPath).catch(() => {})
      setErr(e instanceof Error ? e.message : 'Something went wrong while saving.')
      setBusy(false)
    }
  }

  const intensityHint = `${INTENSITIES.map((i) => `${INTENSITY_META[i].label} +${INTENSITY_META[i].pts}`).join(' · ')} pts`

  return (
    <div>
      <PageHeader title="Log workout" subtitle="Points are earned per the crew rulebook" />

      <div className="space-y-4">
        <Field label="Date">
          <Input
            type="date"
            value={date}
            min={minDate}
            max={maxDate}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>

        <FieldBlock label="Type">
          <Segmented<WorkoutType>
            options={WORKOUT_TYPES.map((t) => ({
              value: t,
              label: `${WORKOUT_TYPE_META[t].emoji} ${WORKOUT_TYPE_META[t].label}`,
            }))}
            value={type}
            onChange={setType}
          />
        </FieldBlock>

        {scheduleErr && <ErrorNote message={`Couldn't load your planned sessions: ${scheduleErr}`} />}
        {planned.length > 0 && (
          <Field label="Planned session (optional)" hint="Picking one links this log to your schedule">
            <Select value={scheduleId} onChange={(e) => onPlanChange(e.target.value)}>
              <option value="">None / unplanned</option>
              {planned.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                  {p.time_label ? ` · ${p.time_label}` : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Title">
          <Input
            value={title}
            placeholder={TITLE_PLACEHOLDER[type]}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>

        <Field label="Duration (min)">
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="e.g. 45"
            value={durationMin}
            onChange={(e) => setDurationMin(e.target.value)}
          />
        </Field>

        {type === 'cardio' && (
          <Field label="Distance (km)">
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.1"
              placeholder="e.g. 5.2"
              value={distanceKm}
              onChange={(e) => setDistanceKm(e.target.value)}
            />
          </Field>
        )}

        {(type === 'sport' || type === 'other') && (
          <FieldBlock label="Intensity" hint={intensityHint}>
            <Segmented<Intensity>
              options={INTENSITIES.map((i) => ({ value: i, label: INTENSITY_META[i].label }))}
              value={intensity}
              onChange={setIntensity}
            />
          </FieldBlock>
        )}

        {type === 'strength' && (
          <FieldBlock label="Exercises">
            <div className="space-y-3">
              {exercises.map((ex, ei) => (
                <Card key={ei} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      value={ex.name}
                      placeholder="Exercise, e.g. Bench press"
                      onChange={(e) => updateExerciseName(ei, e.target.value)}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeExercise(ei)}
                      aria-label={`Remove exercise ${ei + 1}`}
                    >
                      ✕
                    </Button>
                  </div>
                  {ex.sets.map((s, si) => (
                    <div key={si} className="flex items-center gap-2">
                      <div className="text-xs text-faint w-10 shrink-0">Set {si + 1}</div>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        placeholder="Reps"
                        value={s.reps}
                        onChange={(e) => updateSet(ei, si, { reps: e.target.value })}
                      />
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.5"
                        placeholder="Weight (kg)"
                        value={s.weight}
                        onChange={(e) => updateSet(ei, si, { weight: e.target.value })}
                      />
                      <button
                        type="button"
                        onClick={() => removeSet(ei, si)}
                        aria-label={`Remove set ${si + 1}`}
                        className="text-faint px-1.5 py-2 active:text-ink"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <Button variant="soft" size="sm" onClick={() => addSet(ei)}>
                    + Add set
                  </Button>
                </Card>
              ))}
              <Button variant="soft" size="sm" full onClick={addExercise}>
                + Add exercise
              </Button>
            </div>
          </FieldBlock>
        )}

        <Field label="Notes (optional)">
          <TextArea
            value={notes}
            placeholder="How did it go?"
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>

        <FieldBlock label="Photo proof">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={onPickPhoto}
          />
          {photoFile && previewUrl ? (
            <div className="relative rounded-xl overflow-hidden border border-line">
              <img src={previewUrl} alt="Workout proof preview" className="w-full max-h-64 object-cover" />
              <button
                type="button"
                onClick={() => setPhotoFile(null)}
                aria-label="Remove photo"
                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/70 text-white flex items-center justify-center"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full border border-dashed border-line rounded-xl py-6 text-sm text-sub active:bg-white/5"
            >
              📷 Add photo proof (+5 pts)
            </button>
          )}
        </FieldBlock>

        <Card>
          <div className="text-xs font-semibold uppercase tracking-wider text-faint mb-2">
            Points preview
          </div>
          <div className="space-y-1">
            {preview.parts.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-sub">{p.label}</span>
                <span>+{p.pts}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-line mt-2 pt-2 font-bold">
            <span>Total</span>
            <span className="text-accent">+{preview.total} pts</span>
          </div>
        </Card>

        {err && <ErrorNote message={err} />}

        <Button size="lg" full disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save workout'}
        </Button>
      </div>
    </div>
  )
}

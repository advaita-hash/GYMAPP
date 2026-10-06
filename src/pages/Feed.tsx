import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Member, Workout, WorkoutSet } from '../lib/types'
import { INTENSITY_META, WORKOUT_TYPE_META } from '../lib/types'
import { fmtRelative } from '../lib/dates'
import { workoutPoints } from '../lib/points'
import { deleteWorkoutPhoto, photoUrl, photoUrls } from '../lib/photos'
import { useAuth } from '../ctx/AuthContext'
import { PageHeader } from '../components/Layout'
import {
  Avatar, Button, Card, Chip, ConfirmButton, EmptyState, ErrorNote, Spinner,
} from '../components/ui'

const PAGE_SIZE = 20
const FALLBACK_COLOR = '#898781'

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/** "45 min · 5.2 km · Hard · 4 exercises · 12 sets" — only what's present. */
function metricLine(w: Workout, sets: WorkoutSet[]): string {
  const parts: string[] = []
  if (w.duration_min != null && w.duration_min > 0) parts.push(`${w.duration_min} min`)
  if (w.distance_km != null && w.distance_km > 0) parts.push(`${w.distance_km} km`)
  if (w.intensity) parts.push(INTENSITY_META[w.intensity].label)
  if (sets.length > 0) {
    const n = new Set(sets.map((s) => s.exercise.trim().toLowerCase())).size
    parts.push(`${n} exercise${n === 1 ? '' : 's'} · ${sets.length} set${sets.length === 1 ? '' : 's'}`)
  }
  return parts.join(' · ')
}

/** Group sets by exercise, preserving first-seen order. */
function groupSets(sets: WorkoutSet[]): { name: string; sets: WorkoutSet[] }[] {
  const out: { name: string; sets: WorkoutSet[] }[] = []
  const byKey = new Map<string, { name: string; sets: WorkoutSet[] }>()
  for (const s of sets) {
    const key = s.exercise.trim().toLowerCase()
    let g = byKey.get(key)
    if (!g) {
      g = { name: s.exercise.trim(), sets: [] }
      byKey.set(key, g)
      out.push(g)
    }
    g.sets.push(s)
  }
  return out
}

/** "60×8", '—' for missing halves. */
function fmtSet(s: WorkoutSet): string {
  if (s.weight_kg == null && s.reps == null) return '—'
  return `${s.weight_kg ?? '—'}×${s.reps ?? '—'}`
}

function FilterChip({ active, onClick, children }: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 flex items-center gap-1.5 text-xs font-medium rounded-full px-3 py-1.5 transition-colors ${
        active ? 'bg-accent text-black' : 'bg-surface border border-line text-sub active:bg-raised'
      }`}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Workout card
// ---------------------------------------------------------------------------

function WorkoutCard({ w, sets, member, signedUrl, isMine, capped, onDelete }: {
  w: Workout
  sets: WorkoutSet[]
  member: Member | undefined
  signedUrl: string | undefined
  isMine: boolean
  /** True when the loaded feed proves this is the 3rd+ workout of that day (scores nothing). */
  capped: boolean
  onDelete: () => void
}) {
  const [pointsOpen, setPointsOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [imgSrc, setImgSrc] = useState<string | undefined>(signedUrl)
  const retriedRef = useRef(false)
  const meta = WORKOUT_TYPE_META[w.workout_type]
  const breakdown = workoutPoints(w, sets)
  const name = member?.name ?? 'Member'
  const color = member?.color ?? FALLBACK_COLOR
  const metric = metricLine(w, sets)
  const exercises = groupSets(sets)

  useEffect(() => {
    setImgSrc(signedUrl)
    retriedRef.current = false
  }, [signedUrl])

  // Signed links expire after ~1 h; re-sign once if the browser can't load it.
  const onImgError = useCallback(async () => {
    if (retriedRef.current || !w.photo_path) return
    retriedRef.current = true
    const fresh = await photoUrl(w.photo_path)
    if (fresh) setImgSrc(fresh)
  }, [w.photo_path])

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2 min-w-0">
        <Avatar name={name} color={color} size={32} />
        <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
          <span className="font-bold truncate">{name}</span>
          <span className="text-faint text-xs shrink-0">{fmtRelative(w.logged_on)}</span>
        </div>
        <Chip className={meta.chip}>
          {meta.emoji} {meta.label}
        </Chip>
      </div>

      <div>
        <div className="font-semibold">{w.title}</div>
        {metric && <div className="text-sub text-sm mt-0.5">{metric}</div>}
      </div>

      {w.photo_path && imgSrc && (
        <img
          src={imgSrc}
          onError={onImgError}
          className="w-full max-h-80 object-cover rounded-xl border border-line"
          loading="lazy"
          alt=""
        />
      )}

      {w.notes && <div className="text-sub text-sm">{w.notes}</div>}

      <div className="flex items-center gap-1">
        <button type="button" onClick={() => setPointsOpen((o) => !o)} aria-expanded={pointsOpen}>
          <Chip className={capped ? 'bg-white/5 text-faint line-through' : 'bg-accent/15 text-accent'}>
            +{breakdown.total} pts
          </Chip>
        </button>
        {capped && <span className="text-faint text-[11px]">doesn't count (daily cap)</span>}
        {exercises.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setDetailsOpen((o) => !o)}>
            {detailsOpen ? 'Hide details' : 'Details'}
          </Button>
        )}
        <div className="flex-1" />
        {isMine && <ConfirmButton label="Delete" confirmLabel="Delete?" onConfirm={onDelete} />}
      </div>

      {pointsOpen && (
        <div className="space-y-1 bg-raised border border-line rounded-xl px-3 py-2">
          {breakdown.parts.map((p, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="text-sub">{p.label}</span>
              <span className="text-accent font-medium">+{p.pts}</span>
            </div>
          ))}
        </div>
      )}

      {detailsOpen && exercises.length > 0 && (
        <div className="space-y-1.5 bg-raised border border-line rounded-xl px-3 py-2">
          {exercises.map((ex) => (
            <div key={ex.name.toLowerCase()} className="text-sm text-sub">
              <span className="text-ink font-medium">{ex.name}</span>
              {' — '}
              {ex.sets.map(fmtSet).join(', ')}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Feed() {
  const { members, me } = useAuth()
  const navigate = useNavigate()

  const [filter, setFilter] = useState<string | null>(null)
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [setsByWorkout, setSetsByWorkout] = useState<Map<string, WorkoutSet[]>>(new Map())
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pageRef = useRef(0)
  const reqRef = useRef(0)

  const memberById = new Map(members.map((m) => [m.id, m]))

  // Only the first 2 workouts per member per day score (see computeStandings).
  // The feed is paginated, so a workout counts as capped only when the loaded
  // rows prove it: 2+ strictly earlier same-day workouts for that member in hand.
  const cappedIds = new Set<string>()
  const byMemberDay = new Map<string, Workout[]>()
  for (const w of workouts) {
    const key = `${w.user_id}|${w.logged_on}`
    const list = byMemberDay.get(key) ?? []
    list.push(w)
    byMemberDay.set(key, list)
  }
  for (const list of byMemberDay.values()) {
    if (list.length < 3) continue
    for (const w of list) {
      const earlier = list.filter((o) => o.created_at.localeCompare(w.created_at) < 0).length
      if (earlier >= 2) cappedIds.add(w.id)
    }
  }

  const loadPage = useCallback(async (page: number, userId: string | null) => {
    const req = ++reqRef.current
    if (page === 0) {
      setLoading(true)
      setError(null)
    } else {
      setLoadingMore(true)
    }
    try {
      let q = supabase.from('gym_workouts').select('*')
      if (userId) q = q.eq('user_id', userId)
      const { data, error: e1 } = await q
        .order('logged_on', { ascending: false })
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (e1) throw e1
      const rows = (data as Workout[] | null) ?? []

      const pageSets = new Map<string, WorkoutSet[]>()
      if (rows.length > 0) {
        const { data: sets, error: e2 } = await supabase
          .from('gym_workout_sets')
          .select('*')
          .in('workout_id', rows.map((w) => w.id))
          .order('set_no', { ascending: true })
        if (e2) throw e2
        for (const s of (sets as WorkoutSet[] | null) ?? []) {
          const list = pageSets.get(s.workout_id) ?? []
          list.push(s)
          pageSets.set(s.workout_id, list)
        }
      }

      const paths = rows.map((w) => w.photo_path).filter((p): p is string => !!p)
      const signed = paths.length > 0 ? await photoUrls(paths) : new Map<string, string>()

      if (req !== reqRef.current) return
      pageRef.current = page
      setHasMore(rows.length === PAGE_SIZE)
      setWorkouts((prev) => {
        if (page === 0) return rows
        // Offset paging can hand back a row we already hold if the feed shifted.
        const seen = new Set(prev.map((x) => x.id))
        return [...prev, ...rows.filter((r) => !seen.has(r.id))]
      })
      setSetsByWorkout((prev) => {
        const next = page === 0 ? new Map<string, WorkoutSet[]>() : new Map(prev)
        for (const [k, v] of pageSets) next.set(k, v)
        return next
      })
      setUrls((prev) => {
        const next = page === 0 ? new Map<string, string>() : new Map(prev)
        for (const [k, v] of signed) next.set(k, v)
        return next
      })
    } catch (e) {
      if (req !== reqRef.current) return
      setError(e instanceof Error ? e.message : 'Could not load the feed.')
    } finally {
      if (req === reqRef.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [])

  useEffect(() => {
    loadPage(0, filter)
  }, [filter, loadPage])

  const handleDelete = useCallback(async (w: Workout) => {
    setError(null)
    try {
      // Row first: a failed photo delete only orphans an object, but a failed row
      // delete after the photo is gone would leave a workout with dead proof.
      const { error: e } = await supabase.from('gym_workouts').delete().eq('id', w.id)
      if (e) throw e
      if (w.photo_path) await deleteWorkoutPhoto(w.photo_path)
      setWorkouts((prev) => prev.filter((x) => x.id !== w.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the workout.')
    }
  }, [])

  return (
    <div>
      <PageHeader title="Feed" subtitle="Every session, receipts included" />

      <div className="flex gap-2 overflow-x-auto pb-2 mb-2">
        <FilterChip active={filter === null} onClick={() => setFilter(null)}>
          All
        </FilterChip>
        {members.map((m) => (
          <FilterChip key={m.id} active={filter === m.id} onClick={() => setFilter(m.id)}>
            <Avatar name={m.name} color={m.color} size={20} />
            {m.name.split(/\s+/)[0]}
          </FilterChip>
        ))}
      </div>

      {error && (
        <div className="mb-3">
          <ErrorNote message={error} />
        </div>
      )}

      {loading ? (
        <Spinner label="Loading the feed…" />
      ) : workouts.length === 0 ? (
        !error && (
          <EmptyState
            emoji="📸"
            title="No workouts yet"
            hint="Log a session and claim your points."
            action={<Button onClick={() => navigate('/log')}>Log a workout</Button>}
          />
        )
      ) : (
        <div className="space-y-3">
          {workouts.map((w) => (
            <WorkoutCard
              key={w.id}
              w={w}
              sets={setsByWorkout.get(w.id) ?? []}
              member={memberById.get(w.user_id)}
              signedUrl={w.photo_path ? urls.get(w.photo_path) : undefined}
              isMine={w.user_id === me?.id}
              capped={cappedIds.has(w.id)}
              onDelete={() => handleDelete(w)}
            />
          ))}
          {hasMore && (
            <Button
              variant="soft"
              full
              disabled={loadingMore}
              onClick={() => loadPage(pageRef.current + 1, filter)}
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Member, Punishment, PunishmentStatus, WeekResult } from '../lib/types'
import { addDays, currentWeekStart, fmtWeek, toISODate, weekStartOf } from '../lib/dates'
import { POINT_RULES, computeStandings, pickPunishment } from '../lib/points'
import { fetchPunishments, fetchRangeBundle, fetchWeekBundle, fetchWeekResults } from '../lib/data'
import type { RangeBundle } from '../lib/data'
import { useAuth } from '../ctx/AuthContext'
import {
  Avatar, Button, Card, Chip, ConfirmButton, EmptyState, ErrorNote, Input, SectionTitle, Spinner,
} from '../components/ui'
import { PageHeader } from '../components/Layout'
import { EntityBars } from '../components/charts'

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message
  }
  return 'Something went wrong — try again.'
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** How many weeks back the finalize section scans for unsealed weeks with activity. */
const FINALIZE_WEEKS_BACK = 12

/**
 * Members who were already in the pact during a given week — someone who joined
 * later can't be ranked (or punished) for a week they weren't part of.
 * gym.created_at is an ISO timestamp; compare its local calendar date.
 */
function membersInWeek(list: Member[], weekStart: string): Member[] {
  const lastDay = addDays(weekStart, 6)
  return list.filter((m) => toISODate(new Date(m.gym.created_at)) <= lastDay)
}

/** Rank icon: 💀 for last place (crews of 3+), medals for the podium, plain number otherwise. */
function RankBadge({ rank, isLast, total }: { rank: number; isLast: boolean; total: number }) {
  const icon =
    isLast && total >= 3 ? '💀' : rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null
  return (
    <span className="w-7 text-center text-lg shrink-0" aria-label={`Rank ${rank}`}>
      {icon ?? <span className="text-sm font-semibold text-sub">{rank}</span>}
    </span>
  )
}

function PunishmentChip({ status }: { status: PunishmentStatus }) {
  if (status === 'pending') return <Chip className="bg-warn/15 text-warn">⏳ pending</Chip>
  if (status === 'done') return <Chip className="bg-good/15 text-[#7ad47a]">✓ done</Chip>
  if (status === 'skipped') return <Chip className="bg-white/10 text-sub">skipped</Chip>
  return null
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Leaderboard() {
  const { me, members } = useAuth()
  const nav = useNavigate()
  const weekStart = currentWeekStart()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [weekBundle, setWeekBundle] = useState<RangeBundle | null>(null)
  const [punishments, setPunishments] = useState<Punishment[]>([])
  const [weekResults, setWeekResults] = useState<WeekResult[]>([])
  const [pendingWeeks, setPendingWeeks] = useState<string[]>([])

  const [finalizing, setFinalizing] = useState<string | null>(null)
  const [finalizeError, setFinalizeError] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [marking, setMarking] = useState<string | null>(null)
  const [showAllHistory, setShowAllHistory] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)

  const [newPun, setNewPun] = useState('')
  const [adding, setAdding] = useState(false)
  const [punBusy, setPunBusy] = useState<string | null>(null)
  const [punishError, setPunishError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const ws = currentWeekStart()
      const [bundle, puns, results] = await Promise.all([
        fetchWeekBundle(ws),
        fetchPunishments(),
        fetchWeekResults(),
      ])
      // Recent past weeks, oldest first — candidates for finalization. Only the
      // ones that aren't sealed yet are looked at, in a single range fetch.
      const prevStarts = Array.from({ length: FINALIZE_WEEKS_BACK }, (_, i) =>
        addDays(ws, -7 * (FINALIZE_WEEKS_BACK - i)),
      )
      const sealed = new Set(results.map((r) => r.week_start))
      const unsealed = prevStarts.filter((p) => !sealed.has(p))
      let pending: string[] = []
      if (unsealed.length > 0) {
        const span = await fetchRangeBundle(unsealed[0], addDays(unsealed[unsealed.length - 1], 6))
        const active = new Set<string>()
        for (const w of span.workouts) active.add(weekStartOf(w.logged_on))
        for (const l of span.habitLogs) active.add(weekStartOf(l.log_date))
        pending = unsealed.filter((p) => active.has(p))
      }
      setWeekBundle(bundle)
      setPunishments(puns)
      setWeekResults(results)
      setPendingWeeks(pending)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // ---- Section 1: live standings -----------------------------------------

  const standings = useMemo(
    () =>
      weekBundle
        ? computeStandings(
            membersInWeek(members, weekStart),
            weekBundle.workouts,
            weekBundle.setsByWorkout,
            weekBundle.habitLogs,
          )
        : [],
    [members, weekBundle, weekStart],
  )

  const weekIsQuiet =
    weekBundle != null && weekBundle.workouts.length === 0 && weekBundle.habitLogs.length === 0

  // ---- Section 2: finalize ------------------------------------------------

  async function finalizeWeek(ws: string) {
    if (!me) return
    setFinalizing(ws)
    setFinalizeError(null)
    try {
      const [bundle, puns] = await Promise.all([fetchWeekBundle(ws), fetchPunishments()])
      // Only the people who were in the pact that week get ranked for it.
      const eligible = membersInWeek(members, ws)
      const rows = computeStandings(eligible, bundle.workouts, bundle.setsByWorkout, bundle.habitLogs)
      // Nobody can lose a week they were alone in.
      const canLose = eligible.length >= 2
      const pool = puns.filter((p) => p.active)
      const loserPunishment = canLose ? pickPunishment(ws, pool) : null
      const payload = rows.map((s) => {
        const isLast = canLose && s.isLast
        return {
          week_start: ws,
          user_id: s.userId,
          points: s.points,
          rank: s.rank,
          workouts_count: s.workoutsCount,
          habits_completed: s.habitsCompleted,
          is_top2: s.isTop2,
          is_last: isLast,
          punishment_id: isLast && loserPunishment ? loserPunishment.id : null,
          punishment_status: isLast && loserPunishment ? 'pending' : 'none',
          finalized_by: me.id,
        }
      })
      if (payload.length > 0) {
        const { error: upErr } = await supabase
          .from('gym_week_results')
          .upsert(payload, { onConflict: 'week_start,user_id', ignoreDuplicates: true })
        if (upErr) throw upErr
      }
      await load()
    } catch (e) {
      setFinalizeError(errMsg(e))
    } finally {
      setFinalizing(null)
    }
  }

  // ---- Section 3: history -------------------------------------------------

  const historyWeeks = useMemo(() => {
    const map = new Map<string, WeekResult[]>()
    for (const r of weekResults) {
      const list = map.get(r.week_start) ?? []
      list.push(r)
      map.set(r.week_start, list)
    }
    // fetchWeekResults is newest-first, Map preserves insertion order.
    return Array.from(map.entries()).map(([ws, rows]) => ({
      ws,
      rows: [...rows].sort((a, b) => a.rank - b.rank),
    }))
  }, [weekResults])

  const shownHistory = showAllHistory ? historyWeeks : historyWeeks.slice(0, 6)

  async function markPunishmentDone(r: WeekResult) {
    setMarking(r.id)
    setHistoryError(null)
    try {
      const { error: upErr } = await supabase
        .from('gym_week_results')
        .update({ punishment_status: 'done', punishment_done_at: new Date().toISOString() })
        .eq('id', r.id)
      if (upErr) throw upErr
      setWeekResults(await fetchWeekResults())
    } catch (e) {
      setHistoryError(errMsg(e))
    } finally {
      setMarking(null)
    }
  }

  // ---- Section 5: punishment pool ----------------------------------------

  async function addPunishment(e: FormEvent) {
    e.preventDefault()
    const title = newPun.trim()
    if (!title || !me) return
    setAdding(true)
    setPunishError(null)
    try {
      const { error: insErr } = await supabase
        .from('gym_punishments')
        .insert({ title, created_by: me.id })
      if (insErr) throw insErr
      setNewPun('')
      setPunishments(await fetchPunishments())
    } catch (err) {
      setPunishError(errMsg(err))
    } finally {
      setAdding(false)
    }
  }

  async function togglePunishment(p: Punishment) {
    setPunBusy(p.id)
    setPunishError(null)
    try {
      const { error: upErr } = await supabase
        .from('gym_punishments')
        .update({ active: !p.active })
        .eq('id', p.id)
      if (upErr) throw upErr
      setPunishments(await fetchPunishments())
    } catch (err) {
      setPunishError(errMsg(err))
    } finally {
      setPunBusy(null)
    }
  }

  async function deletePunishment(p: Punishment) {
    setPunBusy(p.id)
    setPunishError(null)
    try {
      const { error: delErr } = await supabase.from('gym_punishments').delete().eq('id', p.id)
      if (delErr) throw delErr
      setPunishments(await fetchPunishments())
    } catch (err) {
      setPunishError(errMsg(err))
    } finally {
      setPunBusy(null)
    }
  }

  const memberById = (id: string) => members.find((m) => m.id === id)

  // ---- Render -------------------------------------------------------------

  return (
    <div>
      <PageHeader title="Leaderboard" subtitle={fmtWeek(weekStart)} />

      {loading ? (
        <Spinner label="Crunching the numbers…" />
      ) : error ? (
        <ErrorNote message={error} />
      ) : (
        <>
          {/* 1 — Current week (live) */}
          <SectionTitle>This week</SectionTitle>
          {weekIsQuiet ? (
            <EmptyState
              emoji="🏁"
              title="Nothing logged yet this week"
              hint="Points appear as soon as the crew logs workouts and habits."
              action={<Button onClick={() => nav('/log')}>Log a workout</Button>}
            />
          ) : (
            <Card>
              <div className="space-y-1">
                {standings.map((r) => (
                  <div
                    key={r.userId}
                    className={`flex items-center gap-3 py-2 px-2 rounded-xl ${
                      r.userId === me?.id ? 'ring-1 ring-accent' : ''
                    }`}
                  >
                    <RankBadge rank={r.rank} isLast={r.isLast} total={standings.length} />
                    <Avatar name={r.name} color={r.color} size={32} />
                    <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
                      <span className="font-medium truncate">{r.name}</span>
                      {r.userId === me?.id && <span className="text-xs text-faint shrink-0">you</span>}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold">{r.points}</div>
                      <div className="text-[11px] text-sub">
                        {plural(r.workoutsCount, 'workout')} · {plural(r.habitsCompleted, 'habit')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-line">
                <EntityBars
                  data={standings.map((r) => ({
                    name: r.name.split(/\s+/)[0],
                    value: r.points,
                    color: r.color,
                  }))}
                  unit="pts"
                />
              </div>
              <div className="text-[11px] text-faint mt-2">
                Top 2 earn the weekly treat 🏆 · last place draws a punishment 💀
              </div>
            </Card>
          )}

          {/* 2 — Finalize past weeks */}
          {pendingWeeks.length > 0 && (
            <>
              <SectionTitle>Finalize</SectionTitle>
              <div className="space-y-2">
                {pendingWeeks.map((ws) => (
                  <Card key={ws}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-sm">{fmtWeek(ws)}</div>
                        <div className="text-xs text-sub mt-0.5">This week hasn't been sealed yet</div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => finalizeWeek(ws)}
                        disabled={finalizing !== null}
                        className="shrink-0"
                      >
                        {finalizing === ws ? 'Sealing…' : 'Finalize week'}
                      </Button>
                    </div>
                  </Card>
                ))}
                {finalizeError && <ErrorNote message={finalizeError} />}
              </div>
            </>
          )}

          {/* 3 — History */}
          <SectionTitle>Past weeks</SectionTitle>
          {historyError && (
            <div className="mb-2">
              <ErrorNote message={historyError} />
            </div>
          )}
          {historyWeeks.length === 0 ? (
            <EmptyState
              emoji="📜"
              title="No sealed weeks yet"
              hint="Once a past week is finalized, its podium lands here."
            />
          ) : (
            <div className="space-y-2">
              {shownHistory.map(({ ws, rows }) => (
                <Card key={ws}>
                  <div className="font-semibold text-sm mb-2">{fmtWeek(ws)}</div>
                  <div className="space-y-0.5">
                    {rows.map((r) => {
                      const m = memberById(r.user_id)
                      const name = m?.name ?? 'crew'
                      const pun = r.punishment_id
                        ? punishments.find((p) => p.id === r.punishment_id)
                        : null
                      return (
                        <div key={r.id}>
                          <div
                            className={`flex items-center gap-3 py-1.5 px-2 rounded-lg ${
                              r.is_top2 ? 'bg-accent/5' : ''
                            }`}
                          >
                            <RankBadge rank={r.rank} isLast={r.is_last} total={rows.length} />
                            <Avatar name={name} color={m?.color ?? '#898781'} size={26} />
                            <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
                              <span className="text-sm font-medium truncate">{name}</span>
                              {r.user_id === me?.id && (
                                <span className="text-xs text-faint shrink-0">you</span>
                              )}
                            </div>
                            <span className="font-semibold text-sm shrink-0">{r.points}</span>
                          </div>
                          {r.is_last && (
                            <div className="flex items-center gap-2 flex-wrap pl-12 pr-2 pt-0.5 pb-1">
                              {r.punishment_status !== 'none' ? (
                                <>
                                  <span className="text-xs text-sub">
                                    💀 {pun ? pun.title : 'punishment removed from the pool'}
                                  </span>
                                  <PunishmentChip status={r.punishment_status} />
                                  {r.user_id === me?.id && r.punishment_status === 'pending' && (
                                    <Button
                                      variant="soft"
                                      size="sm"
                                      onClick={() => markPunishmentDone(r)}
                                      disabled={marking !== null}
                                    >
                                      {marking === r.id ? 'Saving…' : 'Mark done'}
                                    </Button>
                                  )}
                                </>
                              ) : (
                                <span className="text-xs text-faint">
                                  no punishment in the pool that week
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </Card>
              ))}
              {historyWeeks.length > 6 && (
                <Button variant="ghost" size="sm" full onClick={() => setShowAllHistory((v) => !v)}>
                  {showAllHistory ? 'Show less' : `Show all ${historyWeeks.length} weeks`}
                </Button>
              )}
            </div>
          )}

          {/* 4 — Rulebook */}
          <SectionTitle>How points work</SectionTitle>
          <Card onClick={() => setRulesOpen((v) => !v)}>
            <div className="flex items-center justify-between">
              <div className="font-semibold text-sm">The rulebook</div>
              <span className="text-xs text-faint">{rulesOpen ? 'Hide ▴' : 'Show ▾'}</span>
            </div>
            {rulesOpen && (
              <div className="mt-3 space-y-2">
                {POINT_RULES.map((r) => (
                  <div key={r.label} className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-sub">{r.label}</span>
                    <span className="text-sm font-medium text-right">{r.pts}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* 5 — Punishment pool */}
          <SectionTitle>Punishment pool</SectionTitle>
          <Card>
            {punishError && (
              <div className="mb-2">
                <ErrorNote message={punishError} />
              </div>
            )}
            {punishments.length === 0 ? (
              <div className="text-sm text-faint py-1">
                No punishments in the pool yet — add the first one below.
              </div>
            ) : (
              <div className="divide-y divide-line">
                {punishments.map((p) => (
                  <div
                    key={p.id}
                    className={`flex items-center gap-2 py-2.5 ${p.active ? '' : 'opacity-50'}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium truncate">{p.title}</span>
                        {!p.active && <Chip className="bg-white/10 text-faint shrink-0">retired</Chip>}
                      </div>
                      <div className="text-[11px] text-faint mt-0.5">
                        by {memberById(p.created_by)?.name ?? 'crew'}
                      </div>
                    </div>
                    {p.created_by === me?.id && (
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="soft"
                          size="sm"
                          disabled={punBusy === p.id}
                          onClick={() => togglePunishment(p)}
                        >
                          {p.active ? 'Retire' : 'Revive'}
                        </Button>
                        <ConfirmButton label="Delete" onConfirm={() => deletePunishment(p)} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={addPunishment} className="flex gap-2 mt-3">
              <Input
                className="flex-1 min-w-0"
                value={newPun}
                onChange={(e) => setNewPun(e.target.value)}
                placeholder="e.g. Extra 20k steps this week"
                aria-label="New punishment"
              />
              <Button type="submit" disabled={adding || !newPun.trim()} className="shrink-0">
                {adding ? 'Adding…' : 'Add'}
              </Button>
            </form>
            <div className="text-[11px] text-faint mt-3">
              The week's punishment is drawn from the active pool — same draw for everyone, reshuffled
              every week.
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

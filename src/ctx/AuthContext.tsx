import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { fetchMembers } from '../lib/data'
import type { Member } from '../lib/types'

interface AuthState {
  session: Session | null
  /** All crew members (people with a gym profile), stable color slots. */
  members: Member[]
  /** The signed-in user's member record (null until they join/onboard). */
  me: Member | null
  loading: boolean
  /** Set when the roster fetch gave up after retries; null while things are fine. */
  membersError?: Error | null
  refreshMembers: () => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState>({
  session: null,
  members: [],
  me: null,
  loading: true,
  membersError: null,
  refreshMembers: async () => {},
  signOut: async () => {},
})

/** Extra attempts after the first one, and the pause before each retry. */
const ROSTER_RETRIES = 2
const ROSTER_BACKOFF_MS = 600

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [booted, setBooted] = useState(false)
  const [membersLoaded, setMembersLoaded] = useState(false)
  const [membersError, setMembersError] = useState<Error | null>(null)
  /** True once a roster fetch has succeeded for the current user. */
  const loadedOnce = useRef(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setBooted(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const refreshMembers = useCallback(async () => {
    let last: unknown = null
    for (let attempt = 0; attempt <= ROSTER_RETRIES; attempt++) {
      try {
        const roster = await fetchMembers()
        loadedOnce.current = true
        setMembers(roster)
        setMembersError(null)
        setMembersLoaded(true)
        return
      } catch (e) {
        last = e
        if (attempt < ROSTER_RETRIES) {
          await new Promise((r) => setTimeout(r, ROSTER_BACKOFF_MS * (attempt + 1)))
        }
      }
    }
    // Gave up: surface the failure and stop retrying. We only report the roster
    // as "loaded" if we already have a known-good one — otherwise an empty
    // roster would look like "signed in but not a member" and App.tsx would
    // drop an existing member into the onboarding wizard.
    setMembersError(last instanceof Error ? last : new Error('Could not load the crew.'))
    setMembersLoaded(loadedOnce.current)
  }, [])

  // Keyed on the user id, not the session object: Supabase hands us a fresh
  // session on every token refresh / tab focus, and reloading the roster there
  // would flip `loading` back on and unmount the whole page tree mid-edit.
  const userId = session?.user.id ?? null

  useEffect(() => {
    if (userId) {
      setMembersLoaded(false)
      setMembersError(null)
      refreshMembers()
    } else {
      loadedOnce.current = false
      setMembers([])
      setMembersError(null)
      setMembersLoaded(false)
    }
  }, [userId, refreshMembers])

  const me = useMemo(
    () => members.find((m) => m.id === userId) ?? null,
    [members, userId],
  )

  const value: AuthState = {
    session,
    members,
    me,
    loading: !booted || (!!session && !membersLoaded),
    membersError,
    refreshMembers,
    signOut: async () => {
      await supabase.auth.signOut()
    },
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  return useContext(Ctx)
}

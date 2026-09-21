import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
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
  refreshMembers: () => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState>({
  session: null,
  members: [],
  me: null,
  loading: true,
  refreshMembers: async () => {},
  signOut: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [booted, setBooted] = useState(false)
  const [membersLoaded, setMembersLoaded] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setBooted(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const refreshMembers = useCallback(async () => {
    try {
      setMembers(await fetchMembers())
    } catch {
      // keep last known roster on transient failures
    }
    setMembersLoaded(true)
  }, [])

  useEffect(() => {
    if (session) {
      setMembersLoaded(false)
      refreshMembers()
    } else {
      setMembers([])
    }
  }, [session, refreshMembers])

  const me = useMemo(
    () => members.find((m) => m.id === session?.user.id) ?? null,
    [members, session],
  )

  const value: AuthState = {
    session,
    members,
    me,
    loading: !booted || (!!session && !membersLoaded),
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

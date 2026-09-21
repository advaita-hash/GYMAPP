import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './ctx/AuthContext'
import { Layout } from './components/Layout'
import { Spinner } from './components/ui'
import SignIn from './pages/SignIn'
import Home from './pages/Home'
import Feed from './pages/Feed'
import LogWorkout from './pages/LogWorkout'
import SchedulePage from './pages/SchedulePage'
import HabitsPage from './pages/HabitsPage'
import GoalsPage from './pages/GoalsPage'
import MePage from './pages/MePage'

// Chart-heavy pages (recharts) and the one-time onboarding flow load on demand.
const Onboarding = lazy(() => import('./pages/Onboarding'))
const Leaderboard = lazy(() => import('./pages/Leaderboard'))
const StatsPage = lazy(() => import('./pages/StatsPage'))
const RecapPage = lazy(() => import('./pages/RecapPage'))

export default function App() {
  const { session, me, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <Spinner label="Loading Iron Pact…" />
      </div>
    )
  }

  if (!session) return <SignIn />

  // Signed in but not yet a member (or onboarding unfinished) → onboarding flow.
  if (!me || !me.gym.onboarded) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-page"><Spinner /></div>}>
        <Onboarding />
      </Suspense>
    )
  }

  return (
    <Layout>
      <Suspense fallback={<Spinner />}>
        <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/feed" element={<Feed />} />
        <Route path="/log" element={<LogWorkout />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/schedule" element={<SchedulePage />} />
        <Route path="/habits" element={<HabitsPage />} />
        <Route path="/goals" element={<GoalsPage />} />
        <Route path="/recap" element={<RecapPage />} />
        <Route path="/me" element={<MePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  )
}

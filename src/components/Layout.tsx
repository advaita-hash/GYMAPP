import type { ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'

const tabs = [
  { to: '/', label: 'Home', icon: '⌂' },
  { to: '/feed', label: 'Feed', icon: '▣' },
  { to: '/log', label: 'Log', icon: '+', big: true },
  { to: '/leaderboard', label: 'Board', icon: '♛' },
  { to: '/me', label: 'Me', icon: '●' },
]

/** App shell: centered phone-width column + fixed bottom tab bar. */
export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-page">
      <div
        className="max-w-md mx-auto px-4 pt-4"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 92px)' }}
      >
        {children}
      </div>
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 bg-page/95 backdrop-blur border-t border-line"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="Main"
      >
        <div className="max-w-md mx-auto flex items-center justify-around py-2">
          {tabs.map((t) =>
            t.big ? (
              <NavLink
                key={t.to}
                to={t.to}
                className="w-12 h-12 -mt-4 rounded-full bg-accent text-black text-2xl font-bold flex items-center justify-center shadow-lg shadow-accent/20 active:bg-accent-deep"
                aria-label="Log a workout"
              >
                +
              </NavLink>
            ) : (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.to === '/'}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-0.5 px-3 py-1 text-[11px] font-medium ${
                    isActive ? 'text-accent' : 'text-faint'
                  }`
                }
              >
                <span className="text-lg leading-none" aria-hidden>
                  {t.icon}
                </span>
                {t.label}
              </NavLink>
            ),
          )}
        </div>
      </nav>
    </div>
  )
}

/** Page header with optional back button and right-side action. */
export function PageHeader({ title, back, action, subtitle }: { title: string; back?: boolean; action?: ReactNode; subtitle?: string }) {
  const nav = useNavigate()
  return (
    <header className="flex items-center gap-3 mb-4">
      {back && (
        <button
          onClick={() => nav(-1)}
          aria-label="Back"
          className="w-9 h-9 rounded-xl bg-surface border border-line text-sub flex items-center justify-center active:bg-raised"
        >
          ←
        </button>
      )}
      <div className="flex-1 min-w-0">
        <h1 className="text-xl font-extrabold tracking-tight truncate">{title}</h1>
        {subtitle && <div className="text-xs text-faint mt-0.5">{subtitle}</div>}
      </div>
      {action}
    </header>
  )
}

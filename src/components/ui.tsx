import { useEffect, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger' | 'soft'
  size?: 'sm' | 'md' | 'lg'
  full?: boolean
}

export function Button({ variant = 'primary', size = 'md', full, className = '', ...rest }: ButtonProps) {
  const v = {
    primary: 'bg-accent text-black font-semibold active:bg-accent-deep disabled:opacity-40',
    soft: 'bg-white/10 text-ink active:bg-white/15 disabled:opacity-40',
    ghost: 'bg-transparent text-sub active:bg-white/10 disabled:opacity-40',
    danger: 'bg-bad/90 text-white font-semibold active:bg-bad disabled:opacity-40',
  }[variant]
  const s = { sm: 'text-xs px-3 py-1.5', md: 'text-sm px-4 py-2.5', lg: 'text-base px-5 py-3' }[size]
  return (
    <button
      className={`rounded-xl transition-colors ${v} ${s} ${full ? 'w-full' : ''} ${className}`}
      {...rest}
    />
  )
}

// ---------------------------------------------------------------------------
// Surfaces & structure
// ---------------------------------------------------------------------------

export function Card({ children, className = '', onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              // Only act when the card itself has focus — a nested <button> handles
              // its own Enter/Space and must not also fire the card.
              if (e.target !== e.currentTarget) return
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
      className={`bg-surface border border-line rounded-2xl p-4 ${onClick ? 'cursor-pointer active:bg-raised' : ''} ${className}`}
    >
      {children}
    </div>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mt-6 mb-2 px-1">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-faint">{children}</h2>
      {action}
    </div>
  )
}

export function EmptyState({ emoji, title, hint, action }: { emoji: string; title: string; hint?: string; action?: ReactNode }) {
  return (
    <Card className="text-center py-8">
      <div className="text-4xl mb-2">{emoji}</div>
      <div className="font-semibold">{title}</div>
      {hint && <div className="text-sm text-sub mt-1">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </Card>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3 text-sub">
      <div className="w-7 h-7 border-2 border-white/20 border-t-accent rounded-full animate-spin" />
      {label && <div className="text-sm">{label}</div>}
    </div>
  )
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="bg-bad/15 border border-bad/40 text-rose-200 rounded-xl px-3 py-2 text-sm" role="alert">
      ⚠️ {message}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-sub mb-1.5">{label}</div>
      {children}
      {hint && <div className="text-[11px] text-faint mt-1">{hint}</div>}
    </label>
  )
}

const inputCls =
  'w-full bg-raised border border-line rounded-xl px-3 py-2.5 text-sm text-ink placeholder:text-faint focus:outline-none focus:border-accent/60'

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props
  return <input className={`${inputCls} ${className}`} {...rest} />
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = '', ...rest } = props
  return <textarea className={`${inputCls} min-h-[72px] ${className}`} {...rest} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = '', ...rest } = props
  return <select className={`${inputCls} appearance-none ${className}`} {...rest} />
}

export function Segmented<T extends string>({
  options, value, onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex bg-raised border border-line rounded-xl p-1 gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 text-xs font-medium rounded-lg py-2 transition-colors ${
            value === o.value ? 'bg-accent text-black' : 'text-sub active:bg-white/10'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Chip({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${className}`}>
      {children}
    </span>
  )
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export function Avatar({ name, color, size = 36 }: { name: string; color: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold text-black shrink-0"
      style={{ width: size, height: size, background: color, fontSize: size * 0.38 }}
      aria-hidden
    >
      {initials}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bottom sheet
// ---------------------------------------------------------------------------

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div
        ref={ref}
        className="relative w-full max-w-md bg-surface border-t border-line rounded-t-3xl px-4 pt-4 max-h-[88vh] overflow-y-auto"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
      >
        <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mb-3" />
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function ProgressBar({ value, max, color = '#a3e635' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

/** Confirm-on-second-tap button for destructive actions. */
export function ConfirmButton({ label, confirmLabel = 'Sure?', onConfirm, size = 'sm' }: {
  label: string
  confirmLabel?: string
  onConfirm: () => void
  size?: 'sm' | 'md'
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 2500)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <Button
      variant={armed ? 'danger' : 'ghost'}
      size={size}
      onClick={() => {
        if (armed) {
          setArmed(false)
          onConfirm()
        } else setArmed(true)
      }}
    >
      {armed ? confirmLabel : label}
    </Button>
  )
}

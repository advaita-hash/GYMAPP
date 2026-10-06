import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { Button, Card, ErrorNote, Field, Input } from '../components/ui'

export default function SignIn() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setNotice('')
    setBusy(true)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name.trim() } },
        })
        if (error) throw error
        if (!data.session) setNotice('Check your inbox to confirm your email, then sign in.')
      }
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-page flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🏋️</div>
          <h1 className="text-3xl font-extrabold tracking-tight">Iron Pact</h1>
          <p className="text-sub text-sm mt-1">Train together. Answer to each other.</p>
        </div>
        <Card>
          <form onSubmit={submit} className="space-y-4">
            {mode === 'signup' && (
              <Field label="Your name">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Advaita" required maxLength={40} />
              </Field>
            )}
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required autoComplete="email" />
            </Field>
            <Field label="Password">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required minLength={6} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
            </Field>
            {error && <ErrorNote message={error} />}
            {notice && <div className="text-sm text-accent">{notice}</div>}
            <Button type="submit" full size="lg" disabled={busy}>
              {busy ? '…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </Button>
          </form>
          <button
            className="w-full text-center text-sm text-sub mt-4 py-1"
            onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
          >
            {mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}
          </button>
        </Card>
      </div>
    </div>
  )
}

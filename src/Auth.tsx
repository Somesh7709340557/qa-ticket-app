import { useState, type FormEvent } from 'react'
import { supabase } from './supabaseClient'

export default function Auth() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsLoading(true)
    setErrorMessage('')

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (error) {
      setErrorMessage(error.message)
    }

    setIsLoading(false)
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '24px',
      }}
    >
      <form
        onSubmit={handleSignIn}
        style={{
          display: 'grid',
          gap: '16px',
          width: '100%',
          maxWidth: '400px',
          padding: '28px',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          background: 'white',
          color: '#172033',
        }}
      >
        <div>
          <h1 style={{ margin: '0 0 8px' }}>QA Ticket Management</h1>
          <p style={{ margin: 0, color: '#64748b' }}>Sign in to continue.</p>
        </div>

        <label style={{ display: 'grid', gap: '6px' }}>
          Email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label style={{ display: 'grid', gap: '6px' }}>
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {errorMessage && (
          <p role="alert" style={{ margin: 0, color: '#b91c1c' }}>
            {errorMessage}
          </p>
        )}

        <button className="primary-button" type="submit" disabled={isLoading}>
          {isLoading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
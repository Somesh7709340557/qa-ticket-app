import { useState, type FormEvent } from 'react'
import { supabase } from './supabaseClient'

export default function Auth() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsLoading(true)
    setErrorMessage('')
    setStatusMessage('')

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (error) {
      setErrorMessage(error.message)
    }

    setIsLoading(false)
  }

  async function handlePasswordResetRequest() {
    const normalizedEmail = email.trim()
    setErrorMessage('')
    setStatusMessage('')

    if (!normalizedEmail) {
      setErrorMessage('Enter your email address first, then choose Forgot password.')
      return
    }

    setIsLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: window.location.origin,
    })

    if (error) {
      setErrorMessage(error.message)
    } else {
      setStatusMessage('If this email has an account, a password reset link has been sent.')
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
        {statusMessage && (
          <p role="status" style={{ margin: 0, color: '#15803d' }}>
            {statusMessage}
          </p>
        )}

        <button className="primary-button" type="submit" disabled={isLoading}>
          {isLoading ? 'Signing in…' : 'Sign in'}
        </button>
        <button
          type="button"
          disabled={isLoading}
          onClick={() => void handlePasswordResetRequest()}
          style={{
            justifySelf: 'center',
            border: 0,
            padding: '4px 8px',
            background: 'transparent',
            color: '#4f46e5',
            font: 'inherit',
            cursor: 'pointer',
          }}
        >
          Forgot password?
        </button>
      </form>
    </main>
  )
}

export function PasswordRecovery({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [passwordSaved, setPasswordSaved] = useState(false)

  async function handlePasswordUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage('')

    if (password !== confirmPassword) {
      setErrorMessage('The passwords do not match.')
      return
    }

    setIsLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setIsLoading(false)

    if (error) {
      setErrorMessage(error.message)
      return
    }

    setPasswordSaved(true)
  }

  const cardStyle = {
    display: 'grid',
    gap: '16px',
    width: '100%',
    maxWidth: '400px',
    padding: '28px',
    border: '1px solid #e2e8f0',
    borderRadius: '12px',
    background: 'white',
    color: '#172033',
  } as const

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '24px',
      }}
    >
      {passwordSaved ? (
        <section style={cardStyle}>
          <div>
            <h1 style={{ margin: '0 0 8px' }}>Password updated</h1>
            <p style={{ margin: 0, color: '#64748b' }}>
              Your admin password is ready. Continue to the ticket dashboard.
            </p>
          </div>
          <button className="primary-button" type="button" onClick={onComplete}>
            Continue to dashboard
          </button>
        </section>
      ) : (
        <form onSubmit={handlePasswordUpdate} style={cardStyle}>
          <div>
            <h1 style={{ margin: '0 0 8px' }}>Set a new password</h1>
            <p style={{ margin: 0, color: '#64748b' }}>
              Choose a password for your QA Ticket Management account.
            </p>
          </div>

          <label style={{ display: 'grid', gap: '6px' }}>
            New password
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          <label style={{ display: 'grid', gap: '6px' }}>
            Confirm new password
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>

          {errorMessage && (
            <p role="alert" style={{ margin: 0, color: '#b91c1c' }}>
              {errorMessage}
            </p>
          )}

          <button className="primary-button" type="submit" disabled={isLoading}>
            {isLoading ? 'Saving password…' : 'Save new password'}
          </button>
        </form>
      )}
    </main>
  )
}

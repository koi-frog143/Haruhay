import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { AuthField, WelcomePanel } from './AuthShared'
import { useFormFeedback } from './FormFeedback'
import { api, ApiError } from './registrationApi'
import { clearWorkspaceSession } from './workspaceSession'
import artwork from './auth-artwork.json'

export default function PasswordRecovery({ token }: { token?: string }) {
  const completing = token !== undefined
  const title = completing ? 'Choose a new password' : 'Forgot your password?'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [requested, setRequested] = useState<{ localDelivery: boolean }>()
  const [linkUnavailable, setLinkUnavailable] = useState(completing && !/^[A-Za-z0-9_-]{43}$/.test(token))
  const feedback = useFormFeedback()
  useEffect(() => { document.title = `${title} | Haruhay` }, [title])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || linkUnavailable) return
    const form = event.currentTarget
    const data = new FormData(form)
    const password = String(data.get('password') ?? '')
    const confirmation = String(data.get('confirmation') ?? '')
    const mismatches = []
    if (completing && new TextEncoder().encode(password).length > 72)
      mismatches.push({ name: 'password', label: 'New password', message: 'Use a password of at most 72 UTF-8 bytes.' })
    if (completing && password !== confirmation)
      mismatches.push({ name: 'confirmation', label: 'Confirm new password', message: 'Enter the same password in both fields.' })
    if (!feedback.validate(form, mismatches)) return

    setBusy(true)
    setError('')
    setRequested(undefined)
    try {
      if (completing) {
        await api('/public/password-reset/complete', { token, password, confirmation })
        form.reset()
        clearWorkspaceSession()
        window.location.replace('#/login?password-reset=complete')
      } else {
        setRequested(await api<{ localDelivery: boolean }>('/public/password-reset/request',
          { email: String(data.get('email') ?? '').trim() }))
      }
    } catch (error) {
      if (completing && error instanceof ApiError && error.status === 410) {
        form.reset()
        setLinkUnavailable(true)
      } else {
        setError(error instanceof Error ? error.message : 'Password recovery is unavailable. Try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-shell live-auth" data-design-node="18:217">
    <WelcomePanel screen="reset" />
    <section className="form-panel reset" aria-labelledby="password-recovery-title">
      <div className="auth-content">
        <header className="auth-header">
          <span className="badge">RESET ACCESS</span>
          <h1 id="password-recovery-title">{title}</h1>
          <p>{completing ? 'Use at least 12 characters for your new password.' : 'Enter your sign-in email to request a secure reset link.'}</p>
        </header>
        {linkUnavailable ? <div className="onboarding-auth-status">
          <p className="form-error" role="alert">This reset link is invalid, expired, or already used.</p>
          <a className="admin-primary" href="#/forgot-password">Request a new link</a>
        </div> : <form className="auth-form" noValidate onSubmit={submit} onChange={event => {
          if (event.target instanceof HTMLInputElement) feedback.clear(event.target.name)
        }}>
          {feedback.summary}
          {completing ? <>
            <AuthField id="reset-password" name="password" label="New password" icon={artwork.login.IconLock}
              type="password" autoComplete="new-password" minLength={12} maxLength={72} disabled={busy}
              {...feedback.fieldProps('password')} error={feedback.fieldError('password')} />
            <AuthField id="reset-confirmation" name="confirmation" label="Confirm new password" icon={artwork.login.IconLock}
              type="password" autoComplete="new-password" minLength={12} maxLength={72} disabled={busy}
              {...feedback.fieldProps('confirmation')} error={feedback.fieldError('confirmation')} />
          </> : <AuthField id="reset-email" name="email" label="Email address" icon={artwork.reset.IconMail} type="email"
            placeholder="you@example.com" autoComplete="email" maxLength={254} disabled={busy}
            {...feedback.fieldProps('email')} error={feedback.fieldError('email')} />}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" disabled={busy}>
            {completing ? busy ? 'Updating…' : 'Update password' : busy ? 'Requesting…' : requested ? 'Request another link' : 'Send reset link'}
          </button>
          {requested && <div className="form-notice" role="status">
            {requested.localDelivery
              ? 'Local development delivery uses the backend mail folder. If the address matches an account, look for a file ending in .password-reset.txt.'
              : 'If the address matches an account, check your inbox and spam folder for a reset link.'}
          </div>}
        </form>}
        <nav className="auth-nav" aria-label="Account">
          <a href="#/login">Back to sign in <span aria-hidden="true">→</span></a>
        </nav>
      </div>
    </section>
  </main>
}

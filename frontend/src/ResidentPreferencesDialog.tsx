import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import NotificationPreferencesFields from './NotificationPreferencesFields'
import type { NotificationPreferences } from './NotificationPreferencesFields'
import ResidentDialog from './ResidentDialog'
import { api } from './registrationApi'

const path = '/resident/notifications/preferences'

export default function ResidentPreferencesDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [preferences, setPreferences] = useState<NotificationPreferences>()
  const [retry, setRetry] = useState(0)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let current = true
    api<NotificationPreferences>(path).then(data => {
      if (current) setPreferences(data)
    }).catch(error => {
      if (current) setLoadError(error instanceof Error ? error.message : 'Could not load your preferences.')
    })
    return () => { current = false }
  }, [retry])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      await api(path, { announcements: data.has('announcements'), maintenance: data.has('maintenance'), payments: data.has('payments') }, 'PUT')
      window.dispatchEvent(new Event('haruhay-notification-preferences-updated'))
      onSaved()
    } catch (error) {
      setBusy(false)
      setError(error instanceof Error ? error.message : 'Could not save your preferences. Try again.')
    }
  }

  return <ResidentDialog title="Notification preferences" eyebrow="RESIDENT ACCOUNT" onClose={onClose}
    busy={busy} dismissOnBackdrop={false} footerNote="">
    <p>Choose which updates you see in your Haruhay inbox. Community, maintenance and billing records are still available in their workspaces.</p>
    {loadError ? <div className="ux-status" data-tone="error" role="alert">
      <p>{loadError}</p>
      <button type="button" className="admin-secondary" onClick={() => { setLoadError(''); setRetry(value => value + 1) }}>Retry</button>
    </div> : preferences ? <form className="registration-form" onSubmit={save}>
      <NotificationPreferencesFields preferences={preferences} />
      {error && <p className="ux-status" data-tone="error" role="alert">{error}</p>}
      <button className="dialog-primary" disabled={busy}>{busy ? 'Saving…' : 'Save preferences'}</button>
    </form> : <p role="status">Loading your preferences…</p>}
  </ResidentDialog>
}

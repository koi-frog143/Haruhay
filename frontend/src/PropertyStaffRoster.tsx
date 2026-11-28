import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from './registrationApi'

type Staff = { id: string; full_name: string; email: string; enabled: boolean; can_review?: boolean }

export default function PropertyStaffRoster({ property, kind, busy, setBusy, onUpdated }: {
  property: string; kind: 'guard' | 'technician'; busy: boolean; setBusy: (value: boolean) => void; onUpdated?: () => void
}) {
  const guards = kind === 'guard'
  const title = guards ? 'Guards' : 'Technicians'
  const path = guards ? `/logbook/properties/${property}/guards` : `/maintenance/properties/${property}/technicians`
  const [roster, setRoster] = useState<Staff[]>()
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let current = true
    api<Staff[]>(path).then(records => {
      if (current) { setRoster(records); setLoadError('') }
    }).catch(error => {
      if (current) setLoadError(error instanceof Error ? error.message : 'Could not load assignments.')
    })
    return () => { current = false }
  }, [path, reload])

  async function save(action: () => Promise<void>, success: string) {
    setBusy(true)
    setNotice('')
    setActionError('')
    try {
      await action()
      setReload(value => value + 1)
      setNotice(success)
      onUpdated?.()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update staff access.')
    } finally {
      setBusy(false)
    }
  }

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    void save(async () => {
      const credentials = { email: data.get('email'), password: data.get('password') }
      const name = data.get('name')
      await api(path, guards ? { ...credentials, fullName: name, canReview: data.has('canReview') } : { ...credentials, name })
      form.reset()
    }, `${guards ? 'Guard' : 'Technician'} account created. Share their login details privately.`)
  }

  function update(member: Staff, enabled: boolean, canReview = Boolean(member.can_review)) {
    void save(async () => {
      await api(`${path}/${member.id}`, guards ? { enabled, canReview } : { enabled })
    }, `Access updated for ${member.full_name}.`)
  }

  return <section className="registration-form">
    <h3>{title}</h3>
    {loadError ? <div role="alert" className="ux-status" data-tone="error">
      <p>{loadError}</p>
      <button type="button" className="admin-secondary" disabled={busy} onClick={() => { setLoadError(''); setReload(value => value + 1) }}>Retry loading {title.toLowerCase()}</button>
    </div> : !roster ? <p role="status">Loading {title.toLowerCase()}…</p> : !roster.length ? <p>No {title.toLowerCase()} assigned to this property.</p> :
      <ul className="dialog-list">{roster.map(member => <li key={member.id}>
        <strong>{member.full_name}</strong><small>{member.email}</small>
        <small>{member.enabled ? 'Enabled' : 'Disabled'}{guards && ` · ${member.can_review ? 'Visitor review allowed' : 'Visitor review restricted'}`}</small>
        <div className="visitor-actions">
          <button type="button" className="admin-secondary" disabled={busy} onClick={() => update(member, !member.enabled)}>{member.enabled ? 'Disable' : 'Enable'} {member.full_name}</button>
          {guards && <button type="button" className="admin-secondary" disabled={busy} onClick={() => update(member, member.enabled, !member.can_review)}>{member.can_review ? 'Remove review permission' : 'Allow visitor review'}</button>}
        </div>
      </li>)}</ul>}
    <form className="registration-form" onSubmit={add}>
      <h4>Add a {kind}</h4>
      <label>Full name<input name="name" required maxLength={100} /></label>
      <label>Dedicated staff email<input name="email" type="email" required maxLength={254} /></label>
      <label>Initial password<input name="password" type="password" required minLength={12} maxLength={72} autoComplete="new-password" /></label>
      {guards && <label className="settings-check"><input name="canReview" type="checkbox" />Can review visitor requests and authorize walk-ins</label>}
      {actionError && <p className="ux-status" data-tone="error" role="alert">{actionError}</p>}
      {notice && <p role="status">{notice}</p>}
      <button className="admin-primary" disabled={busy}>Create {kind} account</button>
    </form>
  </section>
}

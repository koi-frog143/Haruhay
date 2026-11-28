import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import NotificationPreferencesFields from './NotificationPreferencesFields'
import type { NotificationPreferences } from './NotificationPreferencesFields'
import PropertyStaffRoster from './PropertyStaffRoster'
import ResidentDialog from './ResidentDialog'
import { api } from './registrationApi'
import { philippineTime } from './visitorApi'
import { getWorkspaceSession, loadWorkspaceSession } from './workspaceSession'
import type { SettingsKind } from './AdminSettings'

type Kind = Exclude<SettingsKind, 'reports'>
type Props = { kind: Kind; title: string; eyebrow: string; onClose: () => void; onSaved: (message: string) => void }
type Settings = {
  details: { name: string; contact: string; amenities: string; houseRules: string }
  billing: { dueDay: number; graceDays: number }
  notifications: NotificationPreferences
  records: { retentionDays: number | null }
}
type AuditEntry = { id: string; action: string; actor: string; occurredAt: string; details: string }
const sections = { property: 'details', billing: 'billing', notifications: 'notifications', security: 'records' } as const

export default function LivePropertySettings({ kind, title, eyebrow, onClose, onSaved }: Props) {
  const properties = getWorkspaceSession()?.properties.filter(property => !property.sample) ?? []
  const [property, setProperty] = useState(properties[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  return <ResidentDialog title={title} eyebrow={eyebrow} onClose={onClose} busy={busy}
    dismissOnBackdrop={false} footerNote="">
    {properties.length ? <>
      <div className="registration-form">
        <label>Property<select value={property} disabled={busy} onChange={event => setProperty(event.target.value)}>
          {properties.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select></label>
      </div>
      {kind === 'staff' ? <div className="registration-form" key={property}>
        <p>Staff access applies to this property. Disabling an assignment takes effect on the next request, including for signed-in staff.</p>
        <PropertyStaffRoster property={property} kind="guard" busy={busy} setBusy={setBusy} />
        <PropertyStaffRoster property={property} kind="technician" busy={busy} setBusy={setBusy} />
      </div> : <SettingsForm key={property} property={property} kind={kind} busy={busy} setBusy={setBusy} onSaved={onSaved} />}
    </> : <p><a href="#/admin/property">Add a property</a> to manage its settings.</p>}
  </ResidentDialog>
}

function SettingsForm({ property, kind, busy, setBusy, onSaved }: {
  property: string; kind: Exclude<Kind, 'staff'>; busy: boolean; setBusy: (value: boolean) => void; onSaved: Props['onSaved']
}) {
  const path = `/owner/properties/${property}/settings`
  const [settings, setSettings] = useState<Settings>()
  const [history, setHistory] = useState<AuditEntry[]>([])
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let current = true
    Promise.all([api<Settings>(path), kind === 'security' ? api<AuditEntry[]>(path + '/history') : []]).then(([data, entries]) => {
      if (current) { setSettings(data); setHistory(entries); setLoadError('') }
    }).catch(error => {
      if (current) setLoadError(error instanceof Error ? error.message : 'Could not load settings.')
    })
    return () => { current = false }
  }, [path, kind, retry])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const body = {
      property: { name: data.get('name'), contact: data.get('contact'), amenities: data.get('amenities'), houseRules: data.get('houseRules') },
      billing: { dueDay: Number(data.get('dueDay')), graceDays: Number(data.get('graceDays')) },
      notifications: { announcements: data.has('announcements'), maintenance: data.has('maintenance'), payments: data.has('payments') },
      security: { retentionDays: data.get('retentionDays') ? Number(data.get('retentionDays')) : null },
    }[kind]
    setBusy(true)
    setError('')
    try {
      await api(`${path}/${sections[kind]}`, body, 'PUT')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save settings. Try again.')
      setBusy(false)
      return
    }
    if (kind === 'property' || kind === 'billing') {
      try { await loadWorkspaceSession() }
      catch { onSaved('Settings saved. Refresh the workspace to load the latest values.'); return }
    }
    onSaved('Property settings saved.')
  }

  if (loadError) return <div className="ux-status" data-tone="error" role="alert">
    <p>{loadError}</p>
    <button type="button" className="admin-secondary" onClick={() => { setLoadError(''); setRetry(value => value + 1) }}>Retry</button>
  </div>
  if (!settings) return <p role="status">Loading property settings…</p>
  const { details, billing, notifications, records } = settings
  return <div className="registration-form">
    <form className="registration-form" onSubmit={save}>
      {kind === 'property' && <>
        <label>Property name<input name="name" required maxLength={160} defaultValue={details.name} /></label>
        <label>Contact information<input name="contact" maxLength={200} defaultValue={details.contact} /></label>
        <label>Amenities<textarea name="amenities" maxLength={1000} defaultValue={details.amenities} /></label>
        <label>House rules<textarea name="houseRules" maxLength={2000} defaultValue={details.houseRules} /></label>
        <p>Manage capacity, availability and pricing in <a href="#/admin/property">Property &amp; rooms</a>.</p>
      </>}
      {kind === 'billing' && <>
        <p>Haruhay uses these defaults when you post a new bill. Rent and charges come from the resident’s accepted room agreement.</p>
        <label>Default due day<input type="number" name="dueDay" min={1} max={28} required defaultValue={billing.dueDay} /><small>Choose a day from 1 through 28 so it works every month.</small></label>
        <label>Grace period (days)<input type="number" name="graceDays" min={0} max={30} required defaultValue={billing.graceDays} /><small>Starts after the due date. Use 0 for no grace period.</small></label>
      </>}
      {kind === 'notifications' && <>
        <p>Choose what appears in residents’ Haruhay inboxes for this property. Residents can also set their own preferences.</p>
        <NotificationPreferencesFields preferences={notifications} />
      </>}
      {kind === 'security' && <>
        <h3>Active safeguards</h3>
        <ul>
          <li>Owners and staff are limited to authorized properties and actions.</li>
          <li>Staff confirm identity at visitor check-in and package release.</li>
          <li>Haruhay records changes to property settings and staff access.</li>
        </ul>
        <label>Record retention policy (days)<input type="number" name="retentionDays" min={1} max={3650} defaultValue={records.retentionDays ?? ''} />
          <small>Optional policy record for planning. Deletion is manual.</small>
        </label>
      </>}
      {error && <p className="ux-status" data-tone="error" role="alert">{error}</p>}
      <button className="dialog-primary" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
    </form>
    {kind === 'security' && <section className="registration-form">
      <h3>Recent changes</h3>
      {history.length ? <ul className="dialog-list">{history.map(entry => <li key={entry.id}>
        <strong>{entry.action}</strong><small>{entry.actor} · {philippineTime(entry.occurredAt)} PHT</small><span>{entry.details}</span>
      </li>)}</ul> : <p>No settings or staff changes have been recorded for this property yet.</p>}
    </section>}
  </div>
}

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { AdminStatus } from './AdminUI'
import { api } from './registrationApi'
import ResidentDialog from './ResidentDialog'
import SupportConversation from './SupportConversation'
import { supportStatus } from './supportApi'
import type { SupportDetail, SupportSummary } from './supportApi'
import { philippineTime } from './visitorApi'
import { getWorkspaceSession } from './workspaceSession'

type View = 'list' | 'compose' | { id: string; initial?: SupportDetail }

export default function LiveResidentSupport({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<View>('list')
  const [busy, setBusy] = useState(false)
  const title = view === 'list' ? 'My support requests' : view === 'compose' ? 'New support request' : 'Support conversation'
  return <ResidentDialog key={title} title={title} eyebrow="RESIDENT SUPPORT" onClose={onClose} busy={busy}
    dismissOnBackdrop={false} footerNote="">
    {view === 'list' ? <>
      <div className="support-actions">
        <button type="button" className="admin-primary" onClick={() => setView('compose')}>New support request</button>
        <a href="#/resident/maintenance/new" onClick={onClose}>Report a maintenance issue</a>
      </div>
      <ResidentRequests onOpen={id => setView({ id })} />
    </> : view === 'compose' ? <>
      <p>Send your question to your property owner. For repairs, <a href="#/resident/maintenance/new" onClick={onClose}>report a maintenance issue</a>.</p>
      <CreateSupport busy={busy} setBusy={setBusy} onCreated={detail => setView({ id: detail.request.id, initial: detail })} />
    </> : <>
      <button type="button" className="admin-secondary" disabled={busy} onClick={() => setView('list')}>Back to my requests</button>
      <SupportConversation role="resident" id={view.id} initialDetail={view.initial} busy={busy} setBusy={setBusy} />
    </>}
  </ResidentDialog>
}

function ResidentRequests({ onOpen }: { onOpen: (id: string) => void }) {
  const [requests, setRequests] = useState<SupportSummary[]>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let current = true
    api<SupportSummary[]>('/resident/support').then(records => {
      if (current) { setRequests(records); setError('') }
    }).catch(error => {
      if (current) setError(error instanceof Error ? error.message : 'Could not load your support requests.')
    })
    return () => { current = false }
  }, [retry])
  function refresh() {
    setError('')
    setRequests(undefined)
    setRetry(value => value + 1)
  }
  return <div className="registration-form">
    {error ? <div className="ux-status" data-tone="error" role="alert">
      <p>{error}</p><button type="button" className="admin-secondary" onClick={refresh}>Retry</button>
    </div> : !requests ? <p role="status">Loading your requests…</p> : <>
      <button type="button" className="admin-secondary support-refresh" onClick={refresh}>Refresh requests</button>
      {requests.length ? <ul className="dialog-list">{requests.map(request => <li key={request.id}>
        <div className="support-summary">
          <strong>{request.subject}</strong>
          <small>{request.propertyName} · {philippineTime(request.updatedAt)} PHT</small>
          <AdminStatus>{supportStatus[request.status]}</AdminStatus>
        </div>
        <button type="button" className="admin-secondary" onClick={() => onOpen(request.id)} aria-label={`Open request ${request.subject}`}>View conversation</button>
      </li>)}</ul> : <p>No support requests yet. Start a request to contact your property owner.</p>}
    </>}
  </div>
}

function CreateSupport({ busy, setBusy, onCreated }: {
  busy: boolean; setBusy: (value: boolean) => void; onCreated: (detail: SupportDetail) => void
}) {
  const properties = Array.from(new Map((getWorkspaceSession()?.applications ?? [])
    .filter(stay => stay.tenancy_status === 'ACTIVE' && !stay.sample)
    .map(stay => [stay.property_id, stay.property_name])).entries())
  const [requestId] = useState(() => crypto.randomUUID())
  const [error, setError] = useState('')

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const data = new FormData(event.currentTarget)
    const subject = String(data.get('subject') ?? '').trim()
    const message = String(data.get('message') ?? '').trim()
    if (!subject || !message) { setError('Enter a subject and a message.'); return }
    setBusy(true)
    setError('')
    try {
      onCreated(await api<SupportDetail>('/resident/support', { requestId, propertyId: data.get('propertyId'), subject, message }))
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not submit your support request. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!properties.length) return <p>Support requests are available for active stays.</p>
  return <form className="registration-form" onSubmit={create}>
    {properties.length === 1 ? <>
      <p>Property <strong>{properties[0][1]}</strong></p>
      <input type="hidden" name="propertyId" value={properties[0][0]} />
    </> : <label>Property<select name="propertyId" required defaultValue="" disabled={busy}>
      <option value="" disabled>Choose a property</option>
      {properties.map(([id, name]) => <option value={id} key={id}>{name}</option>)}
    </select></label>}
    <label>Subject<input name="subject" required maxLength={100} disabled={busy} /></label>
    <label>Message<textarea name="message" required maxLength={1000} rows={4} disabled={busy} /></label>
    {error && <p role="alert" className="ux-status" data-tone="error">{error}</p>}
    <button className="dialog-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit request'}</button>
  </form>
}

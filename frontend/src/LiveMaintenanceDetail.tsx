import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { AdminHeading, AdminIcon, AdminStatus } from './AdminUI'
import ResidentDialog from './ResidentDialog'
import { api, ApiError } from './registrationApi'
import { philippineTime } from './visitorApi'
import { isArchived, maintenanceError, maintenancePriority, maintenanceStatus, refreshMaintenance, ticketPath, ticketTitle, uploadMaintenancePhoto } from './maintenanceApi'
import type { MaintenanceRole, Technician, TicketAction, TicketDetail } from './maintenanceApi'

const eventNames: Record<string, string> = {
  SUBMITTED: 'Request submitted', ASSIGNED: 'Assigned to maintenance', REASSIGNED: 'Technician changed',
  STARTED: 'Repair in progress', PROGRESS: 'Progress update', READY: 'Ready for confirmation',
  CLOSED: 'Ticket closed', CANCELLED: 'Request cancelled', REOPENED: 'Ticket reopened',
  COMMENT: 'Comment', ESCALATED: 'External escalation recorded', PRIORITY_CHANGED: 'Priority updated', PHOTO_ADDED: 'Photo added',
}
const actionLabels = {
  ASSIGN: 'Save assignment', ESCALATE: 'Record escalation', START: 'Start work', PROGRESS: 'Post progress update',
  READY: 'Ready for confirmation', REOPEN: 'Still having the issue', CLOSE: 'Close ticket', CANCEL: 'Cancel request',
  COMMENT: 'Add a comment',
}
type Action = keyof typeof actionLabels
const photoPath = (ticket: string, photo: string) => '/api/maintenance/tickets/' + ticket + '/photos/' + photo

export default function LiveMaintenanceDetail({ id, role, setNotice }: { id: string; role: MaintenanceRole; setNotice: (message: string) => void }) {
  const [ticket, setTicket] = useState<TicketDetail>()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    api<TicketDetail>('/maintenance/tickets/' + encodeURIComponent(id)).then(value => {
      if (active) { setTicket(value); setLoadError('') }
    }).catch(error => {
      if (active) {
        setTicket(undefined)
        setLoadError(error instanceof ApiError && [400, 403, 404].includes(error.status)
          ? 'This ticket is unavailable or you no longer have access.' : maintenanceError(error))
      }
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id, refresh])

  function reload() { setLoading(true); setRefresh(value => value + 1) }
  return <>
    <a className="maintenance-back" href={ticketPath(role)}>← {role === 'technician' ? 'My jobs' : 'Back to maintenance'}</a>
    {loading ? <p role="status">Loading ticket…</p> : ticket
      ? <TicketContent ticket={ticket} role={role} reload={reload} setNotice={setNotice} />
      : <section className="admin-panel"><h1>Maintenance ticket</h1><p role="alert">{loadError || 'Ticket not found.'}</p><button className="admin-secondary" onClick={reload}>Retry</button></section>}
  </>
}

function TicketContent({ ticket, role, reload, setNotice }: { ticket: TicketDetail; role: MaintenanceRole; reload: () => void; setNotice: (message: string) => void }) {
  const [action, setAction] = useState<Action>()
  const [file, setFile] = useState<File>()
  const [busy, setBusy] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const archived = isArchived(ticket)
  const owner = role === 'owner'
  const canUpdate = role !== 'resident' || ticket.resident_can_update !== false
  const ready = ticket.status === 'READY'
  const assignmentAllowed = owner && ['SUBMITTED', 'ASSIGNED', 'IN_PROGRESS'].includes(ticket.status)
  const next = archived ? 'This ticket is in the maintenance history.'
    : !canUpdate ? 'The property team will handle this request after your stay ends.'
    : ready ? (ticket.resident_can_update === false ? 'The property team can verify the completed repair.' : 'The technician has reported the repair complete. The resident can now confirm the fix.')
      : ticket.needs_assignment ? 'The property team will assign a technician.'
        : ticket.status === 'ASSIGNED' ? 'The assigned technician will start the work.'
          : 'The technician will post progress here.'
  const actions = <>
    {assignmentAllowed && <button className="admin-primary" onClick={() => setAction('ASSIGN')}>{ticket.technician_id ? 'Manage assignment' : 'Assign technician'}</button>}
    {owner && !archived && ticket.priority === 'CRITICAL' && ticket.technician_id && !ticket.needs_assignment && <button className="admin-secondary" onClick={() => setAction('ESCALATE')}>Record escalation</button>}
    {role === 'technician' && ticket.status === 'ASSIGNED' && <button className="admin-primary" onClick={() => setAction('START')}>Start work</button>}
    {role === 'technician' && ticket.status === 'IN_PROGRESS' && <>
      <button className="admin-primary" onClick={() => setAction('READY')}>Ready for confirmation</button>
      <button className="admin-secondary" onClick={() => setAction('PROGRESS')}>Post progress update</button>
    </>}
    {ready && role === 'resident' && canUpdate && <>
      <button className="admin-primary" onClick={() => setAction('CLOSE')}>It’s fixed</button>
      <button className="admin-secondary" onClick={() => setAction('REOPEN')}>Still having the issue</button>
    </>}
    {ready && owner && <button className="admin-primary" onClick={() => setAction('CLOSE')}>Close as verified</button>}
    {!archived && (owner || (role === 'resident' && canUpdate && ['SUBMITTED', 'ASSIGNED'].includes(ticket.status))) && <button className="admin-secondary" onClick={() => setAction('CANCEL')}>Cancel request</button>}
  </>
  async function addPhoto(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file || busy) return
    setBusy(true)
    setPhotoError('')
    try {
      await uploadMaintenancePhoto(ticket.id, file)
      setNotice('Photo added to the ticket.')
      reload()
    } catch (error) {
      setPhotoError(maintenanceError(error))
    } finally {
      setBusy(false)
    }
  }

  return <>
    <AdminHeading eyebrow={'Maintenance / ' + ticket.ticket_number} title={ticketTitle(ticket)}
      description={ticket.category_label + ' · ' + ticket.property_name + ' · ' + ticket.location}
      action={<button className="admin-secondary" onClick={reload}>Refresh ticket</button>} />
    <div className="maintenance-detail-badges"><AdminStatus>{maintenanceStatus[ticket.status]}</AdminStatus><AdminStatus>{maintenancePriority[ticket.priority]}</AdminStatus></div>
    <div className="admin-maintenance-grid maintenance-live-detail">
      <section className="admin-panel admin-manage-ticket">
        <h2>{owner ? 'Manage ticket' : 'Next step'}</h2>
        <p>{next}</p>
        {!archived && <p className="visitor-muted">{ticket.technician_name ? 'Assigned to ' + ticket.technician_name : 'Awaiting assignment'}</p>}
        <div className="maintenance-next-actions">{actions}</div>
      </section>
      <div className="admin-maintenance-main">
        <section className="admin-panel">
          <h2>{owner ? 'Reported concern' : 'Issue summary'}</h2>
          <div className="admin-reported"><AdminIcon node="18:2308" name="imgIconZap" /><p>{ticket.description}</p></div>
          <div className="admin-meta">{role !== 'resident' && <span>Reported by {ticket.resident_name}</span>}<span>Reported {philippineTime(ticket.submitted_at)}</span></div>
        </section>
        {(ticket.photos.length > 0 || (!archived && canUpdate)) && <section className="admin-panel">
          <h2>Photos</h2>
          {ticket.photos.length > 0 && <ul className="maintenance-photos">{ticket.photos.map((photo, index) => <li key={photo.id}>
            <a href={photoPath(ticket.id, photo.id)} target="_blank" rel="noreferrer"><img src={photoPath(ticket.id, photo.id)} alt={'Open issue photo ' + (index + 1)} loading="lazy" /></a>
          </li>)}</ul>}
          {!archived && canUpdate && ticket.photos.length < 4 && <form className="admin-form" onSubmit={addPhoto}>
            <label>Add a photo<input type="file" accept="image/jpeg,image/png" onChange={event => setFile(event.target.files?.[0])} /></label>
            {photoError && <p role="alert" className="admin-error">{photoError}</p>}
            <button className="admin-secondary" disabled={!file || busy}>{busy ? 'Uploading…' : photoError ? 'Retry photo upload' : 'Upload photo'}</button>
          </form>}
        </section>}
        <section className="admin-panel">
          <h2>Activity timeline</h2>
          <ol className="admin-timeline maintenance-live-timeline">{ticket.activity.map(event => <li key={event.id}>
            <span className="admin-timeline-icon"><AdminIcon node="18:2308" name={event.kind === 'SUBMITTED' || event.kind === 'CLOSED' ? 'imgIconCheck' : 'imgIconClock'} /></span>
            <div><strong>{eventNames[event.kind] || 'Ticket updated'}</strong><small>{event.actor} · {philippineTime(event.occurred_at)} PHT</small>
              {event.message && <p>{event.message}</p>}
              {event.materials && <p>Materials used · {event.materials}</p>}
            </div>
          </li>)}</ol>
          {!archived && canUpdate && <button className="admin-secondary" onClick={() => setAction('COMMENT')}>Add a comment</button>}
        </section>
      </div>
    </div>
    {action && <TicketActionDialog key={action} action={action} ticket={ticket} role={role} onClose={() => setAction(undefined)} onRefresh={reload} onSaved={async () => {
      setAction(undefined)
      setNotice(action === 'READY' ? 'Repair submitted for resident confirmation.' : action === 'COMMENT' ? 'Comment posted.' : action === 'CLOSE' ? 'Ticket closed and saved to history.' : 'Ticket updated.')
      reload()
      await refreshMaintenance()
    }} />}
  </>
}

function TicketActionDialog({ action, ticket, role, onClose, onRefresh, onSaved }: {
  action: Action; ticket: TicketDetail; role: MaintenanceRole; onClose: () => void; onRefresh: () => void; onSaved: () => Promise<void>
}) {
  const [staff, setStaff] = useState<Technician[]>()
  const [error, setError] = useState('')
  const [stale, setStale] = useState(false)
  const [busy, setBusy] = useState(false)
  const [technician, setTechnician] = useState(ticket.technician_id || '')
  const [staffRetry, setStaffRetry] = useState(0)

  useEffect(() => {
    if (action !== 'ASSIGN') return
    let active = true
    api<Technician[]>('/maintenance/properties/' + ticket.property_id + '/technicians').then(rows => {
      if (active) setStaff(rows.filter(row => row.enabled))
    }).catch(error => { if (active) setError(maintenanceError(error)) })
    return () => { active = false }
  }, [action, ticket.property_id, staffRetry])

  const reassignment = action === 'ASSIGN' && !!ticket.technician_id && technician !== ticket.technician_id
  const noteLabel = reassignment ? 'Reason for reassignment'
    : action === 'ESCALATE' ? 'External technician and follow-up details'
      : action === 'PROGRESS' ? 'What changed?'
        : action === 'READY' ? 'What was fixed?'
          : action === 'REOPEN' ? 'What still needs attention?'
            : action === 'CANCEL' ? 'Reason for cancellation'
              : action === 'CLOSE' && role === 'owner' ? 'How was the repair verified?'
                : action === 'COMMENT' ? 'Comment' : ''
  const title = action === 'CLOSE' && role === 'resident' ? 'Confirm the repair' : action === 'ASSIGN' ? 'Assign and prioritize' : actionLabels[action]
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || stale) return
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      const path = '/maintenance/tickets/' + ticket.id
      if (action === 'COMMENT') await api(path + '/comments', { message: form.get('note') })
      else await api(path + '/actions', {
        action: action as TicketAction, version: ticket.version, technicianId: form.get('technicianId'),
        priority: form.get('priority'), note: form.get('note'), materials: form.get('materials'),
      })
      await onSaved()
    } catch (error) {
      setStale(error instanceof ApiError && [404, 409].includes(error.status))
      setError(maintenanceError(error))
    } finally {
      setBusy(false)
    }
  }
  return <ResidentDialog title={title} busy={busy} onClose={onClose} footerNote="">
    <form className="admin-form maintenance-live-form" onSubmit={submit}>
      {action === 'ASSIGN' && <>
        <label>Technician<select name="technicianId" required value={staff?.some(member => member.id === technician) ? technician : ''} onChange={event => setTechnician(event.target.value)}>
          <option value="" disabled>{staff ? 'Choose an available technician' : 'Loading technicians…'}</option>
          {staff?.map(member => <option key={member.id} value={member.id}>{member.full_name} · {member.email}</option>)}
        </select></label>
        {staff?.length === 0 && <p>Add an enabled technician from <a href={ticketPath('owner')}>the maintenance queue</a> first.</p>}
        {!staff && error && <button type="button" className="admin-secondary" onClick={() => { setError(''); setStaffRetry(value => value + 1) }}>Retry loading technicians</button>}
        <label>Priority<select name="priority" defaultValue={ticket.priority}>{Object.entries(maintenancePriority).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      </>}
      {action === 'START' && <p>This accepts the assignment and moves the ticket to In progress.</p>}
      {action === 'CLOSE' && role === 'resident' && <p>Confirm that the repair is complete and close this ticket.</p>}
      {noteLabel && <label>{noteLabel}<textarea name="note" required maxLength={['COMMENT', 'PROGRESS', 'READY'].includes(action) ? 2000 : 1000} /></label>}
      {action === 'READY' && <label>Materials used (optional)<input name="materials" maxLength={500} /></label>}
      {error && <p className="ux-status" data-tone="error" role="alert">{error}</p>}
      {stale ? <button type="button" className="admin-secondary" onClick={onRefresh}>Reload current ticket</button>
        : <button className="admin-primary" disabled={busy || (action === 'ASSIGN' && !staff?.length)}>{busy ? 'Saving…' : actionLabels[action]}</button>}
    </form>
  </ResidentDialog>
}

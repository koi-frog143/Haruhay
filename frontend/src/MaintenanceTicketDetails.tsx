import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import ResidentLayout from './ResidentLayout'
import { getMaintenanceTicket } from './maintenanceData'
import type { MaintenanceStatus } from './maintenanceData'
import './Maintenance.css'

const asset = (name: string) => `./assets/dashboard/${name}`

function ticketIdFromHash() {
  return decodeURIComponent(window.location.hash.replace('#/resident/maintenance/', ''))
}

function statusClass(status: MaintenanceStatus) {
  return status.toLowerCase().replace(' ', '-')
}

const stageByStatus: Record<MaintenanceStatus, number> = {
  Submitted: 0,
  Assigned: 1,
  'In progress': 2,
  Resolved: 3,
}

export default function MaintenanceTicketDetails() {
  const [notice, setNotice] = useState('')
  const [ticket] = useState(() => getMaintenanceTicket(ticketIdFromHash()))
  const [comments, setComments] = useState([ticket.comment])
  const [commentOpen, setCommentOpen] = useState(false)

  useEffect(() => {
    document.title = `${ticket.title} | Haruhay maintenance`
  }, [ticket.title])

  const currentStage = stageByStatus[ticket.status]
  const timeline = [
    { title: 'Request submitted', detail: ticket.id === 'TCK-1042' ? 'Oct 7 • 8:20 AM' : ticket.submitted },
    { title: 'Assigned to staff', detail: ticket.id === 'TCK-1042' ? 'Oct 7 • 10:45 AM' : currentStage >= 1 ? 'Maintenance team notified' : 'Awaiting assignment' },
    { title: 'Repair in progress', detail: ticket.id === 'TCK-1042' ? 'Oct 8 • 1:00 PM' : currentStage >= 2 ? 'Work has started' : 'Waiting for staff update' },
    { title: 'Resolved', detail: currentStage >= 3 ? 'Repair completed' : 'Awaiting final update' },
  ]

  function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const message = String(data.get('comment') ?? '').trim()
    if (!message) return
    setComments(previous => [...previous, message])
    event.currentTarget.reset()
    setCommentOpen(false)
    setNotice('Your comment was added to this frontend preview.')
  }

  return <ResidentLayout
    activeSection="Maintenance"
    breadcrumb="Maintenance"
    notice={notice}
    onNotice={setNotice}
    onDismissNotice={() => setNotice('')}
  >
    <div className="resident-content maintenance-content">
      <header className="resident-page-heading maintenance-detail-heading">
        <span>MAINTENANCE / {ticket.id}</span>
        <h1>{ticket.title}</h1>
        <p>{ticket.categoryLabel} • {ticket.location} • Reported {ticket.submitted}</p>
      </header>

      <span className={`maintenance-detail-status ${statusClass(ticket.status)}`}>{ticket.status.toUpperCase()}</span>

      <div className="maintenance-detail-layout">
        <div className="maintenance-detail-main">
          <section className="maintenance-issue-summary">
            <h2>Issue summary</h2>
            <p>{ticket.description}</p>
            <div className="maintenance-summary-meta">
              <span>Category: {ticket.category}</span>
              <span>Assigned to: {ticket.assignedTo}</span>
            </div>
          </section>

          <section className="maintenance-comments">
            <h2>Updates &amp; comments</h2>
            <div className="maintenance-comment-list">
              {comments.map((comment, index) => <article className="maintenance-comment" key={`${comment}-${index}`}>
                <img src={asset('maintenance-message.svg')} width="25" height="25" alt="" />
                <div><strong>{index === 0 ? 'Front desk' : 'You'}</strong><p>{comment}</p></div>
              </article>)}
            </div>
            {commentOpen ? <form className="maintenance-comment-form" onSubmit={addComment}>
              <label htmlFor="maintenance-comment">Add a comment</label>
              <div><input id="maintenance-comment" name="comment" maxLength={300} autoFocus required placeholder="Write an update or question..." /><button type="submit">Post</button></div>
            </form> : <button className="maintenance-comment-button" type="button" onClick={() => setCommentOpen(true)}>Add a comment</button>}
          </section>
        </div>

        <aside className="maintenance-timeline" aria-labelledby="maintenance-timeline-title">
          <h2 id="maintenance-timeline-title">Activity timeline</h2>
          <ol>
            {timeline.map((step, index) => {
              const done = index <= currentStage
              return <li className={done ? 'done' : 'pending'} key={step.title}>
                <span className="maintenance-timeline-icon"><img src={asset(done ? 'maintenance-check-timeline.svg' : 'maintenance-clock-timeline.svg')} width="19" height="19" alt="" /></span>
                <div><strong>{step.title}</strong><span>{step.detail}</span></div>
              </li>
            })}
          </ol>
        </aside>
      </div>
    </div>
  </ResidentLayout>
}

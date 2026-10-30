import { useEffect, useMemo, useState } from 'react'
import ResidentLayout from './ResidentLayout'
import { getMaintenanceTickets } from './maintenanceData'
import type { MaintenanceStatus } from './maintenanceData'
import './Maintenance.css'

const asset = (name: string) => `./assets/dashboard/${name}`
type TicketFilter = 'All' | 'In progress' | 'Resolved'

function statusClass(status: MaintenanceStatus) {
  return status.toLowerCase().replace(' ', '-')
}

export default function MaintenanceTickets() {
  const [filter, setFilter] = useState<TicketFilter>('All')
  const [notice, setNotice] = useState('')
  const [tickets] = useState(getMaintenanceTickets)

  useEffect(() => {
    document.title = 'Maintenance tickets | Haruhay'
  }, [])

  const activeCount = tickets.filter(ticket => ticket.status !== 'Resolved').length
  const totalCount = tickets.length + 4
  const visibleTickets = useMemo(() => tickets.filter(ticket => {
    if (filter === 'Resolved') return ticket.status === 'Resolved'
    if (filter === 'In progress') return ticket.status !== 'Resolved'
    return true
  }), [filter, tickets])

  const metrics = [
    { value: String(totalCount).padStart(2, '0'), label: 'Total requests', icon: 'icon-ticket-metric.svg' },
    { value: String(activeCount).padStart(2, '0'), label: 'In progress', icon: 'maintenance-clock-metric.svg' },
    { value: '06', label: 'Resolved', icon: 'maintenance-check-metric.svg', mint: true },
  ]

  return <ResidentLayout
    activeSection="Maintenance"
    breadcrumb="Maintenance"
    notice={notice}
    onNotice={setNotice}
    onDismissNotice={() => setNotice('')}
  >
    <div className="resident-content maintenance-content">
      <header className="resident-page-heading maintenance-page-heading">
        <span>REPAIR AND CARE</span>
        <h1>Maintenance tickets</h1>
        <p>Raise concerns and follow each repair from start to finish.</p>
        <a className="maintenance-primary-action" href="#/resident/maintenance/new">New ticket</a>
      </header>

      <section className="maintenance-summary" aria-label="Maintenance summary">
        {metrics.map(metric => <article className="maintenance-metric-card" key={metric.label}>
          <span className={'resident-card-icon ' + (metric.mint ? 'mint' : '')}><img src={asset(metric.icon)} width="24" height="24" alt="" /></span>
          <strong>{metric.value}</strong>
          <span>{metric.label}</span>
        </article>)}
      </section>

      <section className="maintenance-requests" aria-labelledby="maintenance-requests-title">
        <div className="maintenance-section-heading">
          <h2 id="maintenance-requests-title">My requests</h2>
          <button type="button" onClick={() => setNotice('Your complete maintenance history is represented in this frontend preview.')}>See history <span aria-hidden="true">→</span></button>
        </div>

        <div className="maintenance-filters" aria-label="Filter maintenance tickets">
          {(['All', 'In progress', 'Resolved'] as TicketFilter[]).map(option => <button
            className={`${filter === option ? 'active ' : ''}${option === 'In progress' ? 'progress' : ''}`}
            type="button"
            key={option}
            aria-pressed={filter === option}
            onClick={() => setFilter(option)}
          >{option === 'All' ? `All (${totalCount})` : option}</button>)}
        </div>

        <div className="maintenance-table-wrap">
          <table className="maintenance-table">
            <caption className="visually-hidden">Your maintenance requests</caption>
            <colgroup><col /><col /><col /><col /><col /></colgroup>
            <thead><tr><th>Issue</th><th>Ticket ID</th><th>Submitted</th><th>Category</th><th>Status</th></tr></thead>
            <tbody>
              {visibleTickets.map(ticket => <tr key={ticket.id}>
                <th scope="row" data-label="Issue"><a href={`#/resident/maintenance/${ticket.id}`}>{ticket.title}</a></th>
                <td data-label="Ticket ID">{ticket.id}</td>
                <td data-label="Submitted">{ticket.submitted}</td>
                <td data-label="Category">{ticket.category}</td>
                <td data-label="Status"><span className={`maintenance-status ${statusClass(ticket.status)}`}>{ticket.status}</span></td>
              </tr>)}
              {visibleTickets.length === 0 && <tr><td className="maintenance-empty" colSpan={5}>No maintenance requests match this filter.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </ResidentLayout>
}

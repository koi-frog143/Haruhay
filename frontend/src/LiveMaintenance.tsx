import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import AdminLayout from './AdminLayout'
import { AdminHeading, AdminMetrics, AdminStatus, AdminTable } from './AdminUI'
import ResidentLayout from './ResidentLayout'
import ResidentDialog from './ResidentDialog'
import LiveMaintenanceDetail from './LiveMaintenanceDetail'
import MaintenanceReport from './MaintenanceReport'
import MaintenanceNotifications from './MaintenanceNotifications'
import PropertyStaffRoster from './PropertyStaffRoster'
import { downloadCsv, usePreviewData } from './previewStore'
import { getWorkspaceSession, signOutWorkspace } from './workspaceSession'
import { philippineTime } from './visitorApi'
import { isArchived, maintenanceError, maintenancePriority, maintenanceSnapshot, maintenanceStatus, refreshMaintenance, ticketPath, ticketTitle } from './maintenanceApi'
import type { MaintenanceRole } from './maintenanceApi'
import art from './landing-artwork.json'
import './Maintenance.css'
import './LiveMaintenance.css'

function reportedAge(value: string) {
  const elapsed = Math.max(0, Date.now() - Date.parse(value))
  const minutes = Math.floor(elapsed / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return minutes + ' min ago'
  if (minutes < 1440) return Math.floor(minutes / 60) + ' hr ago'
  const days = Math.floor(minutes / 1440)
  return days + (days === 1 ? ' day ago' : ' days ago')
}

export default function LiveMaintenance({ role, id, report }: { role: MaintenanceRole; id?: string; report?: boolean }) {
  const [notice, setNotice] = useState('')
  let content: ReactNode
  if (report) content = <MaintenanceReport />
  else if (id !== undefined) content = <LiveMaintenanceDetail id={id} role={role} setNotice={setNotice} />
  else content = <TicketList role={role} />
  if (role === 'owner') return <AdminLayout active="Maintenance" node={id !== undefined ? '18:2308' : '18:2184'} notice={notice} onDismissNotice={() => setNotice('')}>
    <div className="maintenance-live">{content}</div>
  </AdminLayout>
  if (role === 'technician') return <TechnicianFrame notice={notice} setNotice={setNotice}>{content}</TechnicianFrame>
  return <ResidentLayout activeSection="Maintenance" breadcrumb="Maintenance" notice={notice} onNotice={setNotice} onDismissNotice={() => setNotice('')}>
    <div className="resident-content maintenance-content maintenance-live">{content}</div>
  </ResidentLayout>
}

function TechnicianFrame({ children, notice, setNotice }: { children: ReactNode; notice: string; setNotice: (message: string) => void }) {
  const [notifications, setNotifications] = useState(false)
  const { notices } = usePreviewData(maintenanceSnapshot)
  const unread = notices.filter(notice => !notice.read_at).length
  const name = getWorkspaceSession()?.account.full_name
  useEffect(() => { document.title = 'Maintenance jobs | Haruhay' }, [])
  return <main className="guard-shell maintenance-technician">
    <a className="ux-skip" href="#technician-main" onClick={event => { event.preventDefault(); document.getElementById('technician-main')?.focus() }}>Skip to content</a>
    <header className="guard-header">
      <div className="guard-brand"><a className="maintenance-brand-link" href={ticketPath('technician')}>
        <img className="maintenance-brand-mark" src={art.HaruhayFinalWebFallbackMark} width="38" height="38" alt="" />
        <img className="maintenance-brand-wordmark" src={art.HaruhayFinalWebFallbackWordmark} width="116" height="31" alt="Haruhay" />
      </a><strong>Maintenance</strong></div>
      <div className="maintenance-inline-actions"><span>{name}</span><button className="admin-secondary" onClick={() => setNotifications(true)}>Notifications{unread > 0 ? ' (' + unread + ')' : ''}</button>
        <button className="admin-secondary" onClick={() => void signOutWorkspace().catch(error => setNotice(maintenanceError(error)))}>Sign out</button></div>
    </header>
    {notice && <div className="ux-toast" role="status">{notice}<button className="admin-link-button" onClick={() => setNotice('')}>Dismiss</button></div>}
    <div className="maintenance-live" id="technician-main" tabIndex={-1}>{children}</div>
    {notifications && <ResidentDialog title="Notifications" footerNote="" onClose={() => setNotifications(false)}>
      <MaintenanceNotifications role="technician" onNavigate={() => setNotifications(false)} />
    </ResidentDialog>}
  </main>
}

function TicketList({ role }: { role: MaintenanceRole }) {
  const { tickets, error } = usePreviewData(maintenanceSnapshot)
  const owner = role === 'owner'
  const technician = role === 'technician'
  const [filter, setFilter] = useState(owner ? 'Needs assignment' : technician ? 'All' : 'Active')
  const [query, setQuery] = useState('')
  const [property, setProperty] = useState('')
  const [staffOpen, setStaffOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const properties = getWorkspaceSession()?.properties ?? []
  const scoped = tickets.filter(ticket => !property || ticket.property_id === property)
  const open = scoped.filter(ticket => !isArchived(ticket))
  const awaiting = open.filter(ticket => ticket.status === 'READY')
  const unassigned = open.filter(ticket => ticket.needs_assignment)
  const urgent = open.filter(ticket => ticket.priority !== 'ROUTINE')
  const filters = owner ? ['Needs assignment', 'All', 'Urgent', 'In progress', 'Awaiting confirmation', 'History']
    : technician ? ['All', 'Assigned', 'In progress', 'Awaiting confirmation'] : ['Active', 'Awaiting confirmation', 'History']
  const visible = scoped.filter(ticket => {
    const matches = filter === 'Needs assignment' ? ticket.needs_assignment
      : filter === 'Urgent' ? ticket.priority !== 'ROUTINE' && !isArchived(ticket)
        : filter === 'History' ? isArchived(ticket)
          : filter === 'In progress' ? ticket.status === 'IN_PROGRESS'
            : filter === 'Assigned' ? ticket.status === 'ASSIGNED'
              : filter === 'Awaiting confirmation' ? ticket.status === 'READY'
                : filter === 'Active' ? !isArchived(ticket) : true
    return matches && [ticket.ticket_number, ticket.description, ticket.category_label, ticket.location, ticket.property_name, ticket.technician_name, ticket.resident_name]
      .join(' ').toLowerCase().includes(query.trim().toLowerCase())
  })
  async function refresh() {
    setRefreshing(true)
    await refreshMaintenance()
    setRefreshing(false)
  }
  return <>
    <AdminHeading eyebrow={owner ? 'Repair operations' : 'Repair and care'} title={owner ? 'Maintenance queue' : technician ? 'My jobs' : 'Maintenance tickets'}
      description={owner ? 'Assign, prioritize and track repairs for your properties.' : technician ? 'Start your assigned jobs and keep residents updated.' : 'Report an issue and follow your repairs.'}
      action={owner ? <button className="admin-secondary" onClick={() => setStaffOpen(true)}>Manage technicians</button>
        : !technician && <a className="admin-primary" href={ticketPath(role) + '/new'}>Report an issue</a>} />
    {owner ? <AdminMetrics node="18:2184" items={[
      { value: unassigned.length, label: 'Needs assignment', icon: 'imgIconTicket' },
      { value: urgent.length, label: 'Urgent issues', icon: 'imgIconZap', tone: 'red' },
      { value: awaiting.length, label: 'Awaiting confirmation', icon: 'imgIconCheck', tone: 'mint' },
    ]} /> : <section className="maintenance-summary" aria-label="Maintenance summary">
      {[
        { label: technician ? 'Assigned jobs' : 'Active requests', value: open.length, icon: 'icon-ticket-metric.svg' },
        { label: 'In progress', value: open.filter(ticket => ticket.status === 'IN_PROGRESS').length, icon: 'maintenance-clock-metric.svg' },
        { label: 'Awaiting confirmation', value: awaiting.length, icon: 'maintenance-check-metric.svg' },
      ].map(metric => <article className="maintenance-metric-card" key={metric.label}><span className="resident-card-icon"><img width="24" height="24" src={'./assets/dashboard/' + metric.icon} alt="" /></span><strong>{metric.value}</strong><span>{metric.label}</span></article>)}
    </section>}
    <section className="maintenance-list" aria-labelledby="maintenance-queue-heading" aria-busy={refreshing}>
      <div className="admin-section-heading">
        <h2 id="maintenance-queue-heading">{filter === 'History' ? 'Maintenance history' : technician ? 'Assigned work' : owner ? 'Maintenance requests' : 'My requests'}</h2>
        {owner && visible.length > 0 && <button className="admin-link-button" onClick={() => downloadCsv('maintenance-requests.csv', [
          ['Ticket', 'Property', 'Location', 'Category', 'Issue', 'Priority', 'Status'],
          ...visible.map(ticket => [ticket.ticket_number, ticket.property_name, ticket.location, ticket.category_label, ticket.description, maintenancePriority[ticket.priority], maintenanceStatus[ticket.status]]),
        ])}>Export CSV</button>}
      </div>
      <div className="admin-tabs" aria-label="Filter tickets">{filters.map(option => <button type="button" key={option} aria-pressed={filter === option} className={filter === option ? 'active' : ''} onClick={() => setFilter(option)}>{option}</button>)}</div>
      <div className="admin-toolbar maintenance-live-toolbar">
        <label>Search tickets<input type="search" placeholder="Issue, ticket number or location" value={query} onChange={event => setQuery(event.target.value)} /></label>
        {owner && properties.length > 1 && <label>Property<select value={property} onChange={event => setProperty(event.target.value)}>
          <option value="">All properties</option>{properties.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select></label>}
        <div className="maintenance-inline-actions">
          {(query || property) && <button className="admin-secondary" onClick={() => { setQuery(''); setProperty('') }}>Clear filters</button>}
          <button className="admin-secondary" disabled={refreshing} onClick={() => void refresh()}>Refresh tickets</button>
        </div>
      </div>
      {error && <p className="ux-status" data-tone="error" role="alert">{error}</p>}
      <p className="ux-results-count" role="status">{visible.length} {visible.length === 1 ? 'ticket' : 'tickets'}</p>
      <AdminTable columns={['Issue', 'Ticket', 'Location', 'Status']} rows={visible.map(ticket => ({
        key: ticket.id,
        cells: [
          <div className="maintenance-issue-cell"><a href={ticketPath(role, ticket.id)}>{ticketTitle(ticket)}</a><small>{ticket.category_label}</small></div>,
          <div className="maintenance-issue-cell">{ticket.ticket_number}<small><time dateTime={ticket.submitted_at} title={philippineTime(ticket.submitted_at) + ' PHT'}>{reportedAge(ticket.submitted_at)}</time></small></div>,
          <div className="maintenance-issue-cell">{ticket.location}<small>{ticket.property_name}{owner && ticket.technician_name ? ' · ' + ticket.technician_name : ''}</small></div>,
          <div className="maintenance-ticket-status"><AdminStatus>{maintenanceStatus[ticket.status]}</AdminStatus>{(owner || ticket.priority !== 'ROUTINE') && <AdminStatus>{maintenancePriority[ticket.priority]}</AdminStatus>}</div>,
        ],
      }))} empty={error ? 'Ticket records could not be refreshed.' : filter === 'Needs assignment' ? 'No requests need assignment.' : filter === 'History' ? 'No closed or cancelled tickets match your filters.' : 'No maintenance tickets match your filters.'} />
    </section>
    {staffOpen && <StaffManager onClose={() => setStaffOpen(false)} />}
  </>
}

function StaffManager({ onClose }: { onClose: () => void }) {
  const properties = getWorkspaceSession()?.properties ?? []
  const [property, setProperty] = useState(properties[0]?.id || '')
  const [busy, setBusy] = useState(false)
  return <ResidentDialog title="Manage technicians" busy={busy} onClose={onClose} footerNote="">
    {properties.length === 0 ? <p>Create a property before adding technicians.</p> : <>
      <label className="maintenance-staff-property">Property<select value={property} disabled={busy} onChange={event => setProperty(event.target.value)}>
        {properties.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <PropertyStaffRoster key={property} property={property} kind="technician" busy={busy} setBusy={setBusy} onUpdated={() => void refreshMaintenance()} />
    </>}
  </ResidentDialog>
}

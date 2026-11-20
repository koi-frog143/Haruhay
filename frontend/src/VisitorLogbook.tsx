import { useEffect, useMemo, useState } from 'react'
import ResidentLayout from './ResidentLayout'
import './VisitorLogbook.css'
import { accessRecords, getVisitorEntries, getVisitorRequests, cancelVisitorRequest } from './residentData'
import { getResidentProfile } from './profileData'
import { downloadCsv, usePreviewData } from './previewStore'
import ResidentDialog from './ResidentDialog'

const asset = (name: string) => `./assets/dashboard/${name}`

type ActivityFilter = 'All activity' | 'Visitors' | 'Residents'

export default function VisitorLogbook() {
  const [filter, setFilter] = useState<ActivityFilter>('All activity')
  const [notice, setNotice] = useState('')
  const profile = usePreviewData(getResidentProfile)
  const requests = usePreviewData(getVisitorRequests)
  const visitorEntries = usePreviewData(getVisitorEntries)
  const [cancelId, setCancelId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const entries = useMemo(() => [...visitorEntries, ...accessRecords.map(record => ({ person: profile.fullName, type: 'Resident', dateTime: `${record.date} · ${record.time}`, location: record.entryPoint, status: record.activity === 'Resident check-out' ? 'Checked out' : 'Verified', isoDate: record.isoDate }))].sort((a, b) => b.isoDate.localeCompare(a.isoDate)), [profile.fullName, visitorEntries])
  const metrics = [
    { value: String(visitorEntries.length).padStart(2, '0'), label: 'Recorded guest visits', icon: 'icon-users-metric.svg' },
    { value: String(visitorEntries.filter(entry => entry.status === 'Checked in').length).padStart(2, '0'), label: 'Guest on premises', icon: 'icon-user-metric.svg' },
    { value: String(entries.length).padStart(2, '0'), label: 'Recorded entries', icon: 'icon-book-metric.svg' },
  ]

  useEffect(() => {
    document.title = 'Visitor logbook | Haruhay'
  }, [])

  const visibleEntries = useMemo(() => entries.filter(entry => {
    if (filter === 'Visitors') return entry.type === 'Guest'
    if (filter === 'Residents') return entry.type === 'Resident'
    return true
  }), [filter, entries])

  function exportEntries() {
    const rows = [
      ['Person', 'Visit type', 'Date and time', 'Room / area', 'Status'],
      ...visibleEntries.map(entry => [entry.person, entry.type, entry.dateTime, entry.location, entry.status]),
    ]
    downloadCsv(`haruhay-logbook-${filter.toLowerCase().replace(' ', '-')}.csv`, rows)
    setNotice(`${filter} entries exported as a CSV file.`)
  }

  return <ResidentLayout
    activeSection="Logbook"
    breadcrumb="Logbook"
    notice={notice}
    onNotice={setNotice}
    onDismissNotice={() => setNotice('')}
  >
    <div className="resident-content logbook-content">
      <header className="resident-page-heading logbook-page-heading">
        <span>VISITORS AND ACCESS</span>
        <h1>Your logbook</h1>
        <p>Know when your guests arrive and when you enter your home.</p>
        <a className="logbook-add-visitor" href="#/resident/logbook/register">Add visitor</a>
      </header>

      <section className="logbook-summary" aria-label="Logbook summary">
        {metrics.map(metric => <article className="logbook-metric-card" key={metric.label}>
          <span className="resident-card-icon"><img src={asset(metric.icon)} width="24" height="24" alt="" /></span>
          <strong>{metric.value}</strong>
          <span>{metric.label}</span>
        </article>)}
        <article className="logbook-safety-card">
          <h2>Safety first</h2>
          <div>
            <img src={asset('icon-shield-safety.svg')} width="26" height="26" alt="" />
            <strong>Verified guest records</strong>
          </div>
        </article>
      </section>

      <section className="logbook-activity" aria-labelledby="logbook-recent-title">
        <div className="logbook-section-heading">
          <h2 id="logbook-recent-title">Recent entries</h2>
          <div className="logbook-section-actions">
            <a href="#/resident/logbook/access-history">Access history</a>
            <button type="button" onClick={exportEntries}>Export <span aria-hidden="true">→</span></button>
          </div>
        </div>

        <div className="logbook-filters" aria-label="Filter recent entries">
          {(['All activity', 'Visitors', 'Residents'] as ActivityFilter[]).map(option => <button
            className={filter === option ? 'active' : ''}
            type="button"
            key={option}
            aria-pressed={filter === option}
            onClick={() => setFilter(option)}
          >{option}</button>)}
        </div>

        <div className="logbook-table-wrap">
          <table className="logbook-table">
            <caption className="visually-hidden">Recent visitor and resident access entries</caption>
            <colgroup><col /><col /><col /><col /><col /></colgroup>
            <thead>
              <tr><th>Person</th><th>Visit type</th><th>Date and time</th><th>Room / area</th><th>Status</th></tr>
            </thead>
            <tbody>
              {visibleEntries.map(entry => <tr key={`${entry.person}-${entry.dateTime}`}>
                <th scope="row" data-label="Person">{entry.person}</th>
                <td data-label="Visit type">{entry.type}</td>
                <td data-label="Date and time">{entry.dateTime}</td>
                <td data-label="Room / area">{entry.location}</td>
                <td data-label="Status"><span className={`logbook-status ${entry.status === 'Checked out' ? 'checked-out' : ''}`}>{entry.status}</span></td>
              </tr>)}
              {visibleEntries.length === 0 && <tr><td className="logbook-empty" colSpan={5}>No entries match this filter.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <section className="resident-pending-requests" aria-labelledby="visitor-requests-title">
        <h2 id="visitor-requests-title">Visitor requests</h2>
        <p>Local preview · pending requests are not check-ins and do not increase guest counts. Arrival times use Philippine time.</p>
        {error && <p className="dialog-error" role="alert">{error}</p>}
        {!requests.length ? <p>No visitor requests yet. <a href="#/resident/logbook/register">Register a visitor</a></p> : <ul className="dialog-list">{requests.map(request => <li key={request.id}><div><strong>{request.fullName}</strong><small>{request.expectedArrival.replace('T', ' ')} · {request.purpose}</small><span>{request.status}</span></div>{request.status === 'Pending review' && <button className="dialog-secondary" onClick={() => { setError(''); setCancelId(request.id) }}>Cancel request for {request.fullName}</button>}</li>)}</ul>}
      </section>
      <p className="resident-preview-label">Sample recorded activity · October 2026</p>
    </div>
    {cancelId && <ResidentDialog title="Cancel visitor request?" eyebrow="VISITOR REQUEST" onClose={() => setCancelId(null)}>
      <div className="dialog-body"><p>This cancels the locally saved request. Recorded check-ins remain unchanged.</p></div>
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <button className="dialog-primary" onClick={() => { try { cancelVisitorRequest(cancelId); setCancelId(null); setNotice('Visitor request cancelled locally.') } catch (error) { setError(error instanceof Error ? error.message : 'Could not cancel the request.') } }}>Confirm cancellation</button>
    </ResidentDialog>}
  </ResidentLayout>
}

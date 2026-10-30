import { useEffect, useMemo, useState } from 'react'
import ResidentLayout from './ResidentLayout'
import './VisitorLogbook.css'

const asset = (name: string) => `./assets/dashboard/${name}`

type ActivityFilter = 'All activity' | 'Visitors' | 'Residents'
type Entry = {
  person: string
  type: 'Guest' | 'Resident'
  dateTime: string
  location: string
  status: 'Checked in' | 'Checked out' | 'Verified'
}

const entries: Entry[] = [
  { person: 'Maria Santos', type: 'Guest', dateTime: 'Oct 8 • 10:32 AM', location: 'Room 204', status: 'Checked in' },
  { person: 'Andrea Santos', type: 'Resident', dateTime: 'Oct 8 • 8:14 AM', location: 'Main entrance', status: 'Verified' },
  { person: 'John Mercado', type: 'Guest', dateTime: 'Oct 7 • 4:45 PM', location: 'Room 204', status: 'Checked out' },
  { person: 'Andrea Santos', type: 'Resident', dateTime: 'Oct 7 • 7:03 AM', location: 'Main entrance', status: 'Verified' },
]

const metrics = [
  { value: '03', label: 'Visits this week', icon: 'icon-users-metric.svg' },
  { value: '01', label: 'Guest on premises', icon: 'icon-user-metric.svg' },
  { value: '24', label: 'Entries this month', icon: 'icon-book-metric.svg' },
]

export default function VisitorLogbook() {
  const [filter, setFilter] = useState<ActivityFilter>('All activity')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    document.title = 'Visitor logbook | Haruhay'
  }, [])

  const visibleEntries = useMemo(() => entries.filter(entry => {
    if (filter === 'Visitors') return entry.type === 'Guest'
    if (filter === 'Residents') return entry.type === 'Resident'
    return true
  }), [filter])

  function exportEntries() {
    const rows = [
      ['Person', 'Visit type', 'Date and time', 'Room / area', 'Status'],
      ...visibleEntries.map(entry => [entry.person, entry.type, entry.dateTime, entry.location, entry.status]),
    ]
    const csv = rows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `haruhay-logbook-${filter.toLowerCase().replace(' ', '-')}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
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
        <button className="logbook-add-visitor" type="button" onClick={() => setNotice('Visitor registration is designed and ready for the next implementation phase.')}>Add visitor</button>
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
          <button type="button" onClick={exportEntries}>Export <span aria-hidden="true">→</span></button>
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
    </div>
  </ResidentLayout>
}

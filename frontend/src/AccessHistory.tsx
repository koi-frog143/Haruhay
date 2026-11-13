import { useEffect, useMemo, useState } from 'react'
import ResidentLayout from './ResidentLayout'
import './AccessHistory.css'

type AccessFilter = 'All records' | 'Check-ins' | 'Check-outs'
type AccessRecord = {
  date: string
  time: string
  activity: 'Resident check-in' | 'Resident check-out'
  entryPoint: string
  verification: 'Verified'
}

const records: AccessRecord[] = [
  { date: 'Oct 12, 2026', time: '8:11 AM', activity: 'Resident check-in', entryPoint: 'Main entrance', verification: 'Verified' },
  { date: 'Oct 12, 2026', time: '7:19 AM', activity: 'Resident check-out', entryPoint: 'Main entrance', verification: 'Verified' },
  { date: 'Oct 11, 2026', time: '9:25 PM', activity: 'Resident check-in', entryPoint: 'Main entrance', verification: 'Verified' },
  { date: 'Oct 11, 2026', time: '8:03 AM', activity: 'Resident check-out', entryPoint: 'Main entrance', verification: 'Verified' },
  { date: 'Oct 10, 2026', time: '7:14 PM', activity: 'Resident check-in', entryPoint: 'Main entrance', verification: 'Verified' },
]

const filters: AccessFilter[] = ['All records', 'Check-ins', 'Check-outs']
const asset = (name: string) => `./assets/dashboard/${name}`

export default function AccessHistory() {
  const [filter, setFilter] = useState<AccessFilter>('All records')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    document.title = 'Resident access history | Haruhay'
  }, [])

  const visibleRecords = useMemo(() => records.filter(record => {
    if (filter === 'Check-ins') return record.activity === 'Resident check-in'
    if (filter === 'Check-outs') return record.activity === 'Resident check-out'
    return true
  }), [filter])

  function downloadLog() {
    const rows = [
      ['Date', 'Time', 'Activity', 'Entry point', 'Verification'],
      ...visibleRecords.map(record => [record.date, record.time, record.activity, record.entryPoint, record.verification]),
    ]
    const csv = rows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `haruhay-access-history-${filter.toLowerCase().replaceAll(' ', '-')}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    setNotice(`${filter} downloaded as a CSV file.`)
  }

  return <ResidentLayout
    activeSection="Logbook"
    breadcrumb="Logbook"
    notice={notice}
    onNotice={setNotice}
    onDismissNotice={() => setNotice('')}
  >
    <div className="resident-content access-history-content">
      <header className="resident-page-heading">
        <span>LOGBOOK RECORDS</span>
        <h1>Resident access history</h1>
        <p>Your recorded check-ins and check-outs, organized by date.</p>
      </header>

      <div className="access-history-toolbar">
        <div className="access-history-filters" aria-label="Filter access history">
          {filters.map(option => <button
            className={filter === option ? 'active' : ''}
            type="button"
            key={option}
            aria-pressed={filter === option}
            onClick={() => setFilter(option)}
          >{option}</button>)}
        </div>
        <button className="access-download" type="button" onClick={downloadLog}>Download log</button>
      </div>

      <div className="access-table-wrap">
        <table className="access-table">
          <caption className="visually-hidden">Resident check-in and check-out history</caption>
          <colgroup><col /><col /><col /><col /><col /></colgroup>
          <thead>
            <tr><th>Date</th><th>Time</th><th>Activity</th><th>Entry point</th><th>Verification</th></tr>
          </thead>
          <tbody>
            {visibleRecords.map(record => <tr key={`${record.date}-${record.time}`}>
              <th scope="row" data-label="Date">{record.date}</th>
              <td data-label="Time">{record.time}</td>
              <td data-label="Activity">{record.activity}</td>
              <td data-label="Entry point">{record.entryPoint}</td>
              <td data-label="Verification"><span className="access-verified">{record.verification}</span></td>
            </tr>)}
            {visibleRecords.length === 0 && <tr><td className="access-empty" colSpan={5}>No access records match this filter.</td></tr>}
          </tbody>
        </table>
      </div>

      <aside className="access-privacy-note">
        <img src={asset('access-lock.svg')} width="27" height="27" alt="" />
        <p>Your access history is only visible to authorized property administrators.</p>
      </aside>
    </div>
  </ResidentLayout>
}

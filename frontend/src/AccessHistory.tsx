import { isLiveWorkspace } from './workspaceSession'
import { useEffect, useMemo, useState } from 'react'
import ResidentLayout from './ResidentLayout'
import './AccessHistory.css'
import ResidentDialog from './ResidentDialog'
import { accessRecords as records } from './residentData'
import { downloadCsv } from './previewStore'

type AccessFilter = 'All records' | 'Check-ins' | 'Check-outs'

const filters: AccessFilter[] = ['All records', 'Check-ins', 'Check-outs']
const asset = (name: string) => `./assets/dashboard/${name}`

export default function AccessHistory() {
  const [filter, setFilter] = useState<AccessFilter>('All records')
  const [notice, setNotice] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  const [start, setStart] = useState(isLiveWorkspace() ? '' : '2026-10-10')
  const [end, setEnd] = useState(isLiveWorkspace() ? '' : '2026-10-12')

  useEffect(() => {
    document.title = 'Resident access history | Haruhay'
  }, [])

  const visibleRecords = useMemo(() => records.filter(record => {
    if (filter === 'Check-ins') return record.activity === 'Resident check-in'
    if (filter === 'Check-outs') return record.activity === 'Resident check-out'
    return true
  }), [filter])

  const invalidRange = !start || !end || start > end
  const exportRecords = invalidRange ? [] : visibleRecords.filter(record => record.isoDate >= start && record.isoDate <= end)

  function downloadLog() {
    if (!exportRecords.length) return
    const rows = [
      ['Date', 'Time', 'Activity', 'Entry point', 'Verification'],
      ...exportRecords.map(record => [record.date, record.time, record.activity, record.entryPoint, record.verification]),
    ]
    downloadCsv(`haruhay-access-history-${start}-to-${end}.csv`, rows)
    setExportOpen(false)
    setNotice(`Downloaded ${exportRecords.length} access records as CSV.`)
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
        <button className="access-download" type="button" onClick={() => setExportOpen(true)}>Download log</button>
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
        <p>{isLiveWorkspace() ? 'Access history will appear here when entrance records are connected.' : 'This preview shows sample records locally. Real access history requires authorized account access.'}</p>
      </aside>
      <p className="resident-preview-label">{isLiveWorkspace() ? 'No sample records are loaded. Module test changes stay in this browser.' : <>Sample access records · October 2026</>}</p>
    </div>
    {exportOpen && <ResidentDialog title="Export access log" eyebrow="ACCESS HISTORY" onClose={() => setExportOpen(false)}>
      <form onSubmit={event => { event.preventDefault(); downloadLog() }}>
        <div className="dialog-body">
          <p>Choose a date range, then download a CSV copy of your records. Current filter: {filter}.</p>
          <label>From<input type="date" value={start} onChange={event => setStart(event.target.value)} required /></label>
          <label>Through<input type="date" value={end} min={start} onChange={event => setEnd(event.target.value)} required /></label>
          {invalidRange ? <p className="dialog-error" role="alert">Choose a valid start and end date.</p> : <p role="status">{exportRecords.length} matching records{exportRecords.length ? '' : '. Try October 10–12, 2026 or another activity filter'}.</p>}
        </div>
        <button className="dialog-primary" disabled={!exportRecords.length}>Download CSV</button>
      </form>
    </ResidentDialog>}
  </ResidentLayout>
}

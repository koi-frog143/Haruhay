import { isLiveWorkspace } from './workspaceSession'
import { useEffect, useMemo, useState } from 'react'
import ResidentLayout from './ResidentLayout'
import './AccessHistory.css'
import ResidentDialog from './ResidentDialog'
import { accessRecords } from './residentData'
import { downloadCsv, manilaInputDate } from './previewStore'
import { api } from './registrationApi'
import { accessDate, buildAccessExport } from './residentAccess'
import type { AccessMovement } from './residentAccess'

type AccessFilter = 'All records' | 'Check-ins' | 'Check-outs'

const filters: AccessFilter[] = ['All records', 'Check-ins', 'Check-outs']
const asset = (name: string) => `./assets/dashboard/${name}`
const PAGE_SIZE = 25

export default function AccessHistory() {
  const live = isLiveWorkspace()
  const today = manilaInputDate().slice(0, 10)
  const [filter, setFilter] = useState<AccessFilter>('All records')
  const [notice, setNotice] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  const [start, setStart] = useState(live ? today.slice(0, 7) + '-01' : '2026-10-10')
  const [end, setEnd] = useState(live ? today : '2026-10-12')
  const [liveRecords, setLiveRecords] = useState<AccessMovement[]>()
  const [loadError, setLoadError] = useState('')
  const [retry, setRetry] = useState(0)
  const [page, setPage] = useState(0)

  useEffect(() => {
    document.title = 'Resident access history | Haruhay'
  }, [])

  useEffect(() => {
    if (!live) return
    let current = true
    api<AccessMovement[]>('/resident/access-history').then(records => {
      if (current) setLiveRecords(records)
    }).catch(error => {
      if (current) setLoadError(error instanceof Error ? error.message : 'Could not load your access history.')
    })
    return () => { current = false }
  }, [live, retry])

  const visibleRecords = useMemo(() => {
    const records = live ? (liveRecords ?? []).map(record => ({
      ...accessDate(record.occurredAt),
      id: record.id,
      activity: record.direction === 'ENTRY' ? 'Resident check-in' : 'Resident check-out',
      entryPoint: record.entryPoint,
      verification: record.identityConfirmed ? 'Verified' : 'Unverified',
      propertyName: record.propertyName,
      roomLabel: record.roomLabel,
    })) : accessRecords.map(record => ({ ...record, id: record.date + record.time, propertyName: '', roomLabel: '' }))
    return records.filter(record => {
      if (filter === 'Check-ins') return record.activity === 'Resident check-in'
      if (filter === 'Check-outs') return record.activity === 'Resident check-out'
      return true
    })
  }, [filter, live, liveRecords])
  const invalidRange = !start || !end || start > end
  const exportData = exportOpen && !invalidRange ? buildAccessExport(visibleRecords, start, end, live) : null
  const loading = live && !liveRecords && !loadError
  const pageRecords = visibleRecords.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  function reload() {
    setLiveRecords(undefined)
    setLoadError('')
    setPage(0)
    setRetry(value => value + 1)
  }

  function downloadLog() {
    if (!exportData?.count) return
    downloadCsv(`haruhay-access-history-${start}-to-${end}.csv`, exportData.rows)
    setExportOpen(false)
    setNotice(`Downloaded ${exportData.count} access records as CSV.`)
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
        <p>Your recorded check-ins and check-outs in Philippine time.</p>
      </header>

      <div className="access-history-toolbar">
        <div className="access-history-filters" aria-label="Filter access history">
          {filters.map(option => <button
            className={filter === option ? 'active' : ''}
            type="button"
            key={option}
            aria-pressed={filter === option}
            onClick={() => { setFilter(option); setPage(0) }}
          >{option}</button>)}
        </div>
        <button className="access-download" type="button" disabled={loading || Boolean(loadError)} onClick={() => setExportOpen(true)}>Download log</button>
      </div>

      {loadError && <div className="ux-status" data-tone="error" role="alert">
        <p>{loadError}</p><button type="button" className="admin-secondary" onClick={reload}>Retry loading history</button>
      </div>}
      <div className="access-table-wrap" aria-busy={loading}>
        <table className="access-table">
          <caption className="visually-hidden">Resident check-in and check-out history</caption>
          <colgroup><col /><col /><col /><col /><col /></colgroup>
          <thead>
            <tr><th>Date</th><th>Time</th><th>Activity</th><th>Entry point</th><th>Verification</th></tr>
          </thead>
          <tbody>
            {pageRecords.map(record => <tr key={record.id}>
              <th scope="row" data-label="Date">{record.date}</th>
              <td data-label="Time">{record.time}</td>
              <td data-label="Activity">{record.activity}</td>
              <td data-label="Entry point"><span>{record.entryPoint}{live && <small className="access-location">{record.propertyName} · {record.roomLabel}</small>}</span></td>
              <td data-label="Verification"><span className="access-verified">{record.verification}</span></td>
            </tr>)}
            {!loadError && !pageRecords.length && <tr><td className="access-empty" colSpan={5}>
              {loading ? <span role="status">Loading access history…</span> : filter === 'All records' ? 'No access records for your current stays yet.' : 'No access records match this filter.'}
            </td></tr>}
          </tbody>
        </table>
      </div>
      {visibleRecords.length > PAGE_SIZE && <div className="visitor-actions access-pagination" aria-label="Access history pages">
        <button type="button" className="admin-secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
        <span role="status">Page {page + 1} of {Math.ceil(visibleRecords.length / PAGE_SIZE)}</span>
        <button type="button" className="admin-secondary" disabled={(page + 1) * PAGE_SIZE >= visibleRecords.length} onClick={() => setPage(page + 1)}>Next</button>
      </div>}

      <aside className="access-privacy-note">
        <img src={asset('access-lock.svg')} width="27" height="27" alt="" />
        <p>{live ? 'You can see your own records for current stays. Property owners can review records for properties they manage.' : 'This preview shows sample records locally. Real access history requires authorized account access.'}</p>
      </aside>
      {!live && <p className="resident-preview-label">Sample access records · October 2026</p>}
    </div>
    {exportOpen && <ResidentDialog title="Export access log" eyebrow="ACCESS HISTORY" protectEdits={false}
      footerNote={live ? 'The CSV includes matching records across all pages.' : 'Sample records are used in this preview.'} onClose={() => setExportOpen(false)}>
      <form onSubmit={event => { event.preventDefault(); downloadLog() }}>
        <div className="dialog-body">
          <p>Choose a date range in Philippine time. The CSV uses your current {filter.toLowerCase()} filter.</p>
          <label>From<input type="date" value={start} onChange={event => setStart(event.target.value)} required /></label>
          <label>Through<input type="date" value={end} min={start} onChange={event => setEnd(event.target.value)} required /></label>
          {invalidRange ? <p className="dialog-error" role="alert">Choose a valid start and end date.</p> :
            <p role="status">{exportData?.count ?? 0} matching records{exportData?.count ? '' : '. Try another date range or activity filter'}.</p>}
        </div>
        <button className="dialog-primary" disabled={!exportData?.count}>Download CSV</button>
      </form>
    </ResidentDialog>}
  </ResidentLayout>
}

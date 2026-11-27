import { useState } from 'react'
import type { FormEvent } from 'react'
import ResidentDialog from './ResidentDialog'
import { AdminTable } from './AdminUI'
import { money } from './billingData'
import { downloadBlob, manilaInputDate } from './previewStore'
import { api } from './registrationApi'
import { getWorkspaceSession } from './workspaceSession'
import './LiveReports.css'

const reports = {
  COLLECTIONS: { label: 'Billing and collections', dates: 'Ledger dates determine verified collections and reversals. Outstanding balances include all posted bills.' },
  OCCUPANCY: { label: 'Room occupancy', dates: 'Current capacity, occupants, and reservations for this property.' },
  RESIDENTS: { label: 'Resident stays', dates: 'Dates are based on when each stay started, including room transfers.' },
  VISITORS: { label: 'Visitor activity', dates: 'Dates are based on actual check-ins and checkouts.' },
  MAINTENANCE: { label: 'Maintenance', dates: 'Dates are based on ticket submission. The report shows each ticket’s current status.' },
  HOLDING: { label: 'Holding Station', dates: 'Dates are based on item receipt. The report shows each item’s current pickup status.' },
} as const
type ReportKind = keyof typeof reports
type Preview = {
  report: string
  property: string
  from: string | null
  through: string | null
  columns: string[]
  summary: { label: string; value: number; currency: boolean }[]
  rows: (string | number)[][]
  rowCount: number
  snapshot: string
}

export default function LiveReportDialog({ onClose, onDownload }: { onClose: () => void; onDownload: (message: string) => void }) {
  const properties = getWorkspaceSession()?.properties.filter(property => !property.sample) ?? []
  const [today] = useState(() => manilaInputDate().slice(0, 10))
  const [property, setProperty] = useState(properties.length === 1 ? properties[0].id : '')
  const [type, setType] = useState<ReportKind>('COLLECTIONS')
  const [from, setFrom] = useState(today.slice(0, 7) + '-01')
  const [through, setThrough] = useState(today)
  const [preview, setPreview] = useState<{ query: string; data: Preview } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'preview' | 'download' | null>(null)
  const dated = type !== 'OCCUPANCY'
  const query = new URLSearchParams(dated ? { propertyId: property, type, from, through } : { propertyId: property, type }).toString()
  const current = preview?.query === query ? preview.data : null

  async function fetchPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    if (!property || (dated && (!from || !through || from > through))) {
      setError('Select a property and a valid date range.')
      return
    }
    setError('')
    setBusy('preview')
    setPreview(null)
    try {
      setPreview({ query, data: await api<Preview>('/owner/reports/preview?' + query) })
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not load this report. Try again.')
    } finally {
      setBusy(null)
    }
  }

  async function download() {
    if (!current || busy) return
    setError('')
    setBusy('download')
    try {
      const params = new URLSearchParams(query)
      params.set('snapshot', current.snapshot)
      const response = await fetch('/api/owner/reports/csv?' + params, { credentials: 'same-origin', cache: 'no-store' })
      if (!response.ok) {
        const details = await response.json().catch(() => null) as { message?: string; code?: string } | null
        if (details?.code === 'REPORT_CHANGED') setPreview(null)
        throw new Error(details?.message || 'Could not download this report. Try again.')
      }
      if (!response.headers.get('content-type')?.includes('text/csv')) throw new Error('Could not download this report. Try again.')
      const range = current.from ? current.from + '-to-' + current.through : 'current'
      downloadBlob(`haruhay-${type.toLowerCase()}-${range}.csv`, await response.blob())
      onDownload('Report downloaded as CSV.')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not download this report. Try again.')
    } finally {
      setBusy(null)
    }
  }

  return <ResidentDialog title="Export & reports" eyebrow="REPORTING TOOLS" className="owner-report-dialog" footerNote=""
    protectEdits={false} busy={Boolean(busy)} onClose={onClose}>
    {!properties.length ? <div className="dialog-body">
      <p>Add a property to generate reports.</p><a href="#/admin/property" onClick={onClose}>Open property setup</a>
    </div> : <>
      <form className="admin-form" onSubmit={fetchPreview} onChange={() => setError('')}>
        <div className="dialog-body">
          <fieldset className="owner-report-filters" disabled={Boolean(busy)}>
            <label>Property<select required value={property} onChange={event => setProperty(event.target.value)}>
              <option value="">Choose a property</option>
              {properties.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
            <label>Report<select value={type} onChange={event => setType(event.target.value as ReportKind)}>
              {Object.entries(reports).map(([key, report]) => <option key={key} value={key}>{report.label}</option>)}
            </select></label>
            {dated && <>
              <label>From (PHT)<input type="date" required value={from} onChange={event => setFrom(event.target.value)} /></label>
              <label>Through (PHT)<input type="date" required min={from || undefined} value={through} onChange={event => setThrough(event.target.value)} /></label>
            </>}
          </fieldset>
          <p>{reports[type].dates}</p>
        </div>
        <button className={current ? 'admin-secondary' : 'dialog-primary'} type="submit" disabled={Boolean(busy)}>
          {busy === 'preview' ? 'Loading report…' : current ? 'Refresh preview' : 'Preview report'}
        </button>
      </form>
      {error && <p className="ux-status" data-tone="error" role="alert">{error}</p>}
      {busy === 'preview' && <p role="status">Loading report records…</p>}
      {current && <section className="owner-report-result" aria-label="Report preview">
        <h3>{current.report}</h3>
        <p>{current.property} · {current.from ? current.from + ' through ' + current.through + ' (PHT)' : 'Current snapshot'}</p>
        <dl className="owner-report-summary">{current.summary.map(metric => <div key={metric.label}>
          <dt>{metric.label}</dt><dd>{metric.currency ? money(metric.value) : metric.value.toLocaleString('en-PH')}</dd>
        </div>)}</dl>
        {current.rowCount > 0 && <p role="status">
          {current.rows.length < current.rowCount ? `Showing ${current.rows.length} of ${current.rowCount} records. CSV includes all matching records.`
            : `${current.rowCount} ${current.rowCount === 1 ? 'record' : 'records'}`}
        </p>}
        <AdminTable columns={current.columns} rows={current.rows.map((cells, index) => ({ key: String(index), cells: cells.map(cell => cell === '' ? '—' : cell) }))}
          empty="No records match this report. The summary is available to download." />
        <button type="button" className="dialog-primary" disabled={Boolean(busy)} onClick={() => void download()}>
          {busy === 'download' ? 'Preparing CSV…' : 'Download CSV report'}
        </button>
      </section>}
    </>}
  </ResidentDialog>
}

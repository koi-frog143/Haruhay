import { useEffect, useState } from 'react'
import { usePreviewData } from './previewStore'
import { maintenanceError, maintenanceSnapshot, readMaintenanceNotice, refreshMaintenance, ticketPath } from './maintenanceApi'
import type { MaintenanceRole } from './maintenanceApi'

export default function MaintenanceNotifications({ role, onNavigate }: { role: MaintenanceRole; onNavigate: () => void }) {
  const { notices, error: loadingError } = usePreviewData(maintenanceSnapshot)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { void refreshMaintenance() }, [])
  async function mark(id?: string) {
    setError('')
    setBusy(true)
    try { await readMaintenanceNotice(id) }
    catch (error) { setError(maintenanceError(error)) }
    finally { setBusy(false) }
  }
  return <section className="maintenance-notifications" aria-label="Maintenance updates">
    <h3>Maintenance updates</h3>
    {(error || loadingError) && <p className="admin-error" role="alert">{error || loadingError}</p>}
    {notices.length ? <ul className="dialog-list">{notices.map(notice => <li key={notice.id}>
      <a href={ticketPath(role, notice.ticket_id)} onClick={event => {
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
        event.preventDefault()
        void (async () => {
          try { if (!notice.read_at) await readMaintenanceNotice(notice.id) }
          catch { /* Opening the ticket is still useful if marking it read fails. */ }
          onNavigate()
          window.location.hash = ticketPath(role, notice.ticket_id).slice(1)
        })()
      }}>{notice.message}</a>
      <small>{notice.read_at ? 'Read' : 'Unread'}</small>
    </li>)}</ul> : <p>No maintenance updates yet.</p>}
    {notices.some(notice => !notice.read_at) && <button className="admin-secondary" disabled={busy} onClick={() => void mark()}>Mark maintenance updates as read</button>}
  </section>
}

import { useEffect, useState } from 'react'
import ResidentDialog from './ResidentDialog'
import { announcementLink } from './announcementApi'
import { ticketPath } from './maintenanceApi'
import { receiptLink } from './paymentApi'
import { api } from './registrationApi'

type Notification = {
  id: string
  type: 'ANNOUNCEMENT' | 'MAINTENANCE' | 'PAYMENT_APPROVED' | 'PAYMENT_DECLINED' | 'PAYMENT_REVERSED'
  targetId: string
  title: string
  context: string
  createdAt: string
  readAt: string | null
}

const inboxPath = '/resident/notifications'
const dateFormat = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila',
})

function destination(item: Notification) {
  switch (item.type) {
    case 'ANNOUNCEMENT': return announcementLink(item.targetId)
    case 'MAINTENANCE': return ticketPath('resident', item.targetId)
    case 'PAYMENT_DECLINED': return '#/resident/payments/history'
    default: return receiptLink(item.targetId)
  }
}

export default function ResidentInbox({ onClose, onUnreadChange }: {
  onClose: () => void; onUnreadChange: (count: number) => void
}) {
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [revision, setRevision] = useState(0)
  const unread = items.filter(item => item.readAt === null).length
  const canMark = !loading && !busy && !loadError

  useEffect(() => {
    let active = true
    api<Notification[]>(inboxPath).then(rows => {
      if (!active) return
      setItems(rows)
      onUnreadChange(rows.filter(item => item.readAt === null).length)
    }).catch(error => {
      if (active) setLoadError(error instanceof Error ? error.message : 'Could not load notifications.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [revision, onUnreadChange])

  function refresh() {
    setLoading(true)
    setLoadError('')
    setSaveError('')
    setRevision(value => value + 1)
  }

  async function markRead(id?: string) {
    if (!canMark) return
    setBusy(true)
    setSaveError('')
    try {
      await (id ? api(inboxPath + '/read', { id }) : api(inboxPath + '/read-all', {}))
      refresh()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not update notifications.')
    } finally {
      setBusy(false)
    }
  }

  return <ResidentDialog title="Notifications" footerNote="" busy={busy} onClose={onClose}>
    <div className="dialog-body">
      {loading ? <p role="status">Loading notifications…</p> : !loadError && items.length > 0 &&
        <p role="status">{unread} unread</p>}
      {loadError && <div role="alert"><p>{loadError}</p><button className="admin-secondary" onClick={refresh}>Try again</button></div>}
      {saveError && <div role="alert"><p>{saveError}</p><button className="admin-secondary" onClick={refresh}>Refresh notifications</button></div>}
      {!loading && !loadError && !items.length && <p>You’re all caught up. New updates will appear here.</p>}
      {items.length > 0 && <ul className="dialog-list resident-inbox">
        {items.map(item => <li key={item.id}>
          <a href={destination(item)} onClick={event => {
            if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) onClose()
          }}>{item.title}</a>
          <small>{item.context}</small>
          <small><time dateTime={item.createdAt}>{dateFormat.format(new Date(item.createdAt))} PHT</time> · {item.readAt ? 'Read' : 'Unread'}</small>
          {!item.readAt && <button type="button" className="admin-secondary" disabled={!canMark}
            aria-label={`Mark as read: ${item.title}`} onClick={() => void markRead(item.id)}>Mark as read</button>}
        </li>)}
      </ul>}
    </div>
    {items.length > 0 && <button type="button" className="dialog-primary" disabled={!canMark || !unread}
      onClick={() => void markRead()}>Mark all as read</button>}
  </ResidentDialog>
}

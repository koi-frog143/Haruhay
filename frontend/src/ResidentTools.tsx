import { useState } from 'react'
import ResidentDialog from './ResidentDialog'
import MaintenanceNotifications from './MaintenanceNotifications'
import { isLiveWorkspace } from './workspaceSession'
import { getNotifications, getSearchEntries, residentServices } from './residentToolsData'
import { getReadNotifications, getSupportRequests, markNotificationsRead, saveSupportRequest } from './residentData'
import { usePreviewData } from './previewStore'

type Props = { mode: 'search' | 'support' | 'services' | 'notifications'; initialQuery?: string; onClose: () => void }
export default function ResidentTools({ mode, initialQuery = '', onClose }: Props) {
  const [query, setQuery] = useState(initialQuery)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const searchEntries = usePreviewData(getSearchEntries)
  const notifications = usePreviewData(getNotifications)
  const readIds = usePreviewData(getReadNotifications)
  const support = usePreviewData(getSupportRequests)
  const terms = query.trim().toLowerCase().split(/\s+/u).filter(Boolean)
  const results = terms.length ? searchEntries.filter(item => terms.every(term => `${item.title} ${item.description}`.toLowerCase().includes(term))) : []
  const title = { search: 'Search Haruhay', support: 'Resident support', services: 'All services', notifications: 'Notifications' }[mode]
  function markRead(ids: string[]) {
    try { markNotificationsRead(ids); setError(''); return true }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not update notifications.'); return false }
  }
  function saveDraft(form: HTMLFormElement) {
    setSaved(false)
    const data = new FormData(form)
    try {
      saveSupportRequest(String(data.get('subject') ?? ''), String(data.get('message') ?? ''))
      setError('')
      setSaved(true)
      form.reset()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save your support draft.')
    }
  }
  return <ResidentDialog title={title} onClose={onClose} preserveDraftOnClose={saved} footerNote="">
    {mode === 'search' && <div className="dialog-body"><label>Search pages and your records<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Try plumbing, package or visitor…" /></label><p role="status">{terms.length ? `${results.length} results` : 'Enter a search term to find services, tickets, packages, payments and visitor requests.'}</p><ul className="dialog-list">{results.map((item, index) => <li key={`${item.href}-${index}`}><a href={item.href} onClick={onClose}>{item.title}</a><small>{item.description}</small></li>)}</ul>{terms.length > 0 && !results.length && <p>No matches. Try a name, ticket number or service such as payments.</p>}</div>}
    {mode === 'services' && <div className="dialog-body"><p>Everything for your stay.</p><ul className="dialog-list">{residentServices.map(item => <li key={item.href}><a href={item.href} onClick={onClose}>{item.title}</a><small>{item.description}</small></li>)}</ul></div>}
    {mode === 'notifications' && <><div className="dialog-body">{isLiveWorkspace() && <MaintenanceNotifications role="resident" onNavigate={onClose} />}<p>{isLiveWorkspace() ? 'Other account updates.' : 'Local updates from your preview records.'} Manage reminder categories in <a href="#/resident/profile" onClick={onClose}>My profile</a>.</p>{notifications.length > 0 ? <ul className="dialog-list">{notifications.map(item => <li key={item.id}><a href={item.href} onClick={event => { if (markRead([item.id])) onClose(); else event.preventDefault() }}>{item.title}</a><small>{item.description}</small><small>{readIds.includes(item.id) ? 'Read' : 'Unread'}</small></li>)}</ul> : <p>You’re all caught up. New updates will appear here.</p>}</div><button className="dialog-primary" onClick={() => markRead(notifications.map(item => item.id))} disabled={notifications.every(item => readIds.includes(item.id))}>Mark all as read</button></>}
    {mode === 'support' && <form noValidate onInput={() => setSaved(false)} onSubmit={event => {
      event.preventDefault()
      saveDraft(event.currentTarget)
    }}>
      <div className="dialog-body">
        <p>For help, contact your property’s front desk. Save a draft here if you want to prepare what to say.</p>
        <a href="#/resident/maintenance/new" onClick={onClose}>Report a maintenance issue</a>
        <label>Subject<input name="subject" required maxLength={100} /></label>
        <label>Message<textarea name="message" required maxLength={1000} /></label>
        {saved && <p role="status">Draft saved locally. No staff were notified.</p>}
        {support.length > 0 && <><strong>Saved drafts</strong><ul className="dialog-list">{support.map(item => <li key={item.id}><strong>{item.subject}</strong><span>{item.message}</span><small>{item.created.replace('T', ' ')} · Philippine time</small></li>)}</ul></>}
      </div>
      <button className="dialog-primary" type="submit">Save support draft</button>
    </form>}
    {error && <p role="alert" className="dialog-error">{error}</p>}
  </ResidentDialog>
}

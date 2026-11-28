import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { AdminStatus } from './AdminUI'
import { api } from './registrationApi'
import type { SupportDetail, SupportRole, SupportStatus } from './supportApi'
import { supportStatus } from './supportApi'
import { philippineTime } from './visitorApi'
import './Support.css'

export default function SupportConversation({ role, id, initialDetail, busy, setBusy, onChanged }: {
  role: SupportRole; id: string; initialDetail?: SupportDetail; busy: boolean
  setBusy: (value: boolean) => void; onChanged?: () => void
}) {
  const [detail, setDetail] = useState(initialDetail)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(initialDetail ? 'Support request submitted.' : '')
  const [retry, setRetry] = useState(0)
  const [message, setMessage] = useState('')
  const replyKey = useRef<string | null>(null)
  const statusKey = useRef<{ from: SupportStatus; to: SupportStatus; id: string } | null>(null)
  const path = `/${role}/support/${id}`

  useEffect(() => {
    if (initialDetail && retry === 0) return
    let current = true
    api<SupportDetail>(path).then(data => {
      if (current) { setDetail(data); setLoadError('') }
    }).catch(error => {
      if (current) setLoadError(error instanceof Error ? error.message : 'Could not load this conversation.')
    })
    return () => { current = false }
  }, [initialDetail, path, retry])

  function refresh() {
    setDetail(undefined)
    setLoadError('')
    setError('')
    setNotice('')
    setRetry(value => value + 1)
  }

  async function sendReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = message.trim()
    if (busy) return
    if (!text) { setError('Enter a reply before sending.'); return }
    replyKey.current ??= crypto.randomUUID()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      setDetail(await api<SupportDetail>(path + '/replies', { requestId: replyKey.current, message: text }))
      setMessage('')
      replyKey.current = null
      setNotice('Reply sent.')
      onChanged?.()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not send your reply. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function changeStatus(status: SupportStatus) {
    if (!detail || busy) return
    const expectedStatus = detail.request.status
    if (statusKey.current?.from !== expectedStatus || statusKey.current.to !== status) {
      statusKey.current = { from: expectedStatus, to: status, id: crypto.randomUUID() }
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      setDetail(await api<SupportDetail>(path + '/status', { requestId: statusKey.current.id, expectedStatus, status }, 'PUT'))
      statusKey.current = null
      setNotice(status === 'OPEN' ? 'Request reopened.' : 'Request status updated.')
      onChanged?.()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not update the status. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (loadError) return <div className="ux-status" data-tone="error" role="alert">
    <p>{loadError}</p><button type="button" className="admin-secondary" onClick={refresh}>Retry loading conversation</button>
  </div>
  if (!detail) return <p role="status">Loading conversation…</p>
  const { request, events } = detail
  const resolved = request.status === 'RESOLVED'
  return <section className="registration-form support-conversation" aria-label="Support conversation">
    <header className="support-summary">
      <h3>{request.subject}</h3>
      <p>{request.propertyName}{role === 'owner' && ` · ${request.residentName}`}</p>
      <AdminStatus>{supportStatus[request.status]}</AdminStatus>
    </header>
    <div className="support-actions">
      <button type="button" className="admin-secondary" disabled={busy} onClick={refresh}>Refresh conversation</button>
      {resolved ? <button type="button" className="admin-primary" disabled={busy} onClick={() => void changeStatus('OPEN')}>Reopen request</button> :
        role === 'owner' && <>
          {request.status === 'OPEN' && <button type="button" className="admin-secondary" disabled={busy}
            onClick={() => void changeStatus('WAITING_FOR_RESIDENT')}>Mark as waiting for resident</button>}
          <button type="button" className="admin-secondary" disabled={busy} onClick={() => void changeStatus('RESOLVED')}>Resolve request</button>
        </>}
    </div>
    {error && <p role="alert" className="ux-status" data-tone="error">{error}</p>}
    {notice && <p role="status" className="ux-status">{notice}</p>}
    <ol className="dialog-list" aria-label="Messages and status changes">
      {events.map(event => <li key={event.id}>
        <strong>{event.author} <small>· {event.authorRole === 'OWNER' ? 'Property owner' : 'Resident'}</small></strong>
        <small><time dateTime={event.occurredAt}>{philippineTime(event.occurredAt)} PHT</time></small>
        {event.message && <p className="support-message">{event.message}</p>}
        {event.newStatus && event.previousStatus && <small>Status changed from {supportStatus[event.previousStatus]} to {supportStatus[event.newStatus]}.</small>}
      </li>)}
    </ol>
    {resolved ? <p>Reopen this request to continue the conversation.</p> :
      <form className="registration-form" onSubmit={sendReply}>
        <label>Your reply<textarea required maxLength={1000} rows={3} value={message} disabled={busy}
          onChange={event => setMessage(event.target.value)} /></label>
        <button className="dialog-primary" disabled={busy}>{busy ? 'Saving…' : 'Send reply'}</button>
      </form>}
  </section>
}

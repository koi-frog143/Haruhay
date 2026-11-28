import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import AdminLayout from './AdminLayout'
import { AdminHeading, AdminStatus, AdminTable } from './AdminUI'
import { api } from './registrationApi'
import ResidentDialog from './ResidentDialog'
import SupportConversation from './SupportConversation'
import { supportStatus } from './supportApi'
import type { SupportPage, SupportSummary } from './supportApi'
import { philippineTime } from './visitorApi'
import { getWorkspaceSession } from './workspaceSession'

export default function OwnerSupportInbox() {
  const properties = getWorkspaceSession()?.properties.filter(property => !property.sample) ?? []
  const [property, setProperty] = useState(properties[0]?.id ?? '')
  return <AdminLayout active="Support" node="18:2184">
    <AdminHeading eyebrow="RESIDENT SERVICES" title="Support inbox" description="Review requests and reply to residents at your properties." />
    {properties.length ? <div className="support-inbox">
      <div className="admin-panel registration-form">
        <label>Property<select value={property} onChange={event => setProperty(event.target.value)}>
          {properties.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
      </div>
      <PropertyInbox key={property} property={property} />
    </div> : <p><a href="#/admin/property">Add a property</a> to receive support requests.</p>}
  </AdminLayout>
}

function PropertyInbox({ property }: { property: string }) {
  const [filters, setFilters] = useState('')
  const [page, setPage] = useState(0)
  const [retry, setRetry] = useState(0)
  const [data, setData] = useState<SupportPage>()
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<SupportSummary>()
  const [busy, setBusy] = useState(false)
  const [replyDraft, setReplyDraft] = useState(false)
  useEffect(() => {
    let current = true
    const params = new URLSearchParams(filters)
    params.set('propertyId', property)
    params.set('page', String(page))
    api<SupportPage>('/owner/support?' + params).then(result => {
      if (current) { setData(result); setError('') }
    }).catch(error => {
      if (current) setError(error instanceof Error ? error.message : 'Could not load support requests.')
    })
    return () => { current = false }
  }, [property, filters, page, retry])

  function refresh() {
    setData(undefined)
    setError('')
    setRetry(value => value + 1)
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const params = new URLSearchParams()
    fields.forEach((value, name) => { if (typeof value === 'string' && value.trim()) params.set(name, value.trim()) })
    setFilters(params.toString())
    setPage(0)
    refresh()
  }

  function movePage(next: number) {
    setPage(next)
    setData(undefined)
    setError('')
  }

  return <>
    <form className="admin-panel registration-form support-filters" onSubmit={apply}>
      <label>Search requests<input type="search" name="query" placeholder="Resident name or subject" maxLength={100} /></label>
      <label>Status<select name="status">
        <option value="">All statuses</option>
        {Object.entries(supportStatus).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <div className="support-actions">
        <button className="admin-primary">Apply filters</button>
        <button type="reset" className="admin-secondary" onClick={() => { setFilters(''); setPage(0); refresh() }}>Clear filters</button>
      </div>
    </form>
    {error ? <div className="ux-status" data-tone="error" role="alert">
      <p>{error}</p><button type="button" className="admin-secondary" onClick={refresh}>Retry</button>
    </div> : !data ? <p role="status">Loading support requests…</p> : <>
      <AdminTable columns={['Subject', 'Resident', 'Status', 'Latest activity (PHT)', 'Action']}
        empty={filters ? 'No requests match these filters.' : 'No support requests for this property yet.'}
        rows={data.requests.map(request => ({ key: request.id, cells: [
          <strong className="support-message">{request.subject}</strong>, request.residentName,
          <AdminStatus>{supportStatus[request.status]}</AdminStatus>,
          <time dateTime={request.updatedAt}>{philippineTime(request.updatedAt)}</time>,
          <button type="button" className="admin-secondary" onClick={() => setSelected(request)}
            aria-label={`Open request ${request.subject}`}>View conversation</button>,
        ] }))} />
      {(page > 0 || data.hasNext) && <div className="support-actions" aria-label="Support inbox pages">
        <button type="button" className="admin-secondary" disabled={page === 0} onClick={() => movePage(page - 1)}>Previous</button>
        <span role="status">Page {page + 1}</span>
        <button type="button" className="admin-secondary" disabled={!data.hasNext} onClick={() => movePage(page + 1)}>Next</button>
      </div>}
    </>}
    {selected && <ResidentDialog title="Support conversation" eyebrow="RESIDENT SUPPORT" busy={busy} hasUnsavedChanges={replyDraft}
      onClose={() => { setReplyDraft(false); setSelected(undefined) }} dismissOnBackdrop={false} footerNote="">
      <SupportConversation key={selected.id} role="owner" id={selected.id} busy={busy} setBusy={setBusy}
        onDraftChange={setReplyDraft} onChanged={() => { setPage(0); refresh() }} />
    </ResidentDialog>}
  </>
}

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import AdminLayout from './AdminLayout'
import { AdminHeading, AdminTable } from './AdminUI'
import { manilaInputDate } from './previewStore'
import { api } from './registrationApi'
import ResidentDialog from './ResidentDialog'
import { accessDirection, accessPath } from './residentAccess'
import type { AccessAudit, AccessHistoryPage, StaffMovement } from './residentAccess'
import { philippineTime } from './visitorApi'
import { getWorkspaceSession } from './workspaceSession'

export default function OwnerResidentAccess({ initialProperty }: { initialProperty: string }) {
  const properties = getWorkspaceSession()?.properties.filter(property => !property.sample) ?? []
  const [property, setProperty] = useState(() => properties.find(item => item.id === initialProperty)?.id ?? properties[0]?.id ?? '')
  const [notice, setNotice] = useState('')
  return <AdminLayout active="Visitor logbook" node="18:2055" notice={notice} onDismissNotice={() => setNotice('')}>
    <AdminHeading title="Resident access history" eyebrow="FRONT DESK RECORDS" description="Review resident entry and exit records in Philippine time."
      action={<a className="admin-secondary" href="#/admin/logbook">Back to logbook</a>} />
    {properties.length ? <div className="visitor-live">
      <div className="visitor-property-bar">
        <label>Property <select value={property} onChange={event => { setProperty(event.target.value); setNotice('') }}>
          {properties.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
      </div>
      <PropertyAccessHistory key={property} property={property} onSaved={setNotice} />
    </div> : <p>You have no properties with resident access records.</p>}
  </AdminLayout>
}

function PropertyAccessHistory({ property, onSaved }: { property: string; onSaved: (message: string) => void }) {
  const [dates] = useState(() => ({
    from: manilaInputDate(new Date(Date.now() - 6 * 86400000)).slice(0, 10),
    through: manilaInputDate().slice(0, 10),
  }))
  const [filters, setFilters] = useState(() => new URLSearchParams(dates).toString())
  const [page, setPage] = useState(0)
  const [retry, setRetry] = useState(0)
  const [history, setHistory] = useState<AccessHistoryPage>()
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<StaffMovement>()
  const path = accessPath(property) + '/history'

  useEffect(() => {
    let current = true
    api<AccessHistoryPage>(`${path}?${filters}&page=${page}`).then(data => {
      if (current) { setHistory(data); setError('') }
    }).catch(error => {
      if (current) setError(error instanceof Error ? error.message : 'Could not load this property’s access history.')
    })
    return () => { current = false }
  }, [path, filters, page, retry])

  function refresh() {
    setHistory(undefined)
    setError('')
    setRetry(value => value + 1)
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const params = new URLSearchParams()
    form.forEach((value, key) => { if (typeof value === 'string' && value.trim()) params.set(key, value.trim()) })
    setFilters(params.toString())
    setPage(0)
    refresh()
  }

  function changePage(next: number) {
    setPage(next)
    setHistory(undefined)
    setError('')
  }

  return <>
    <form className="visitor-toolbar access-owner-filters" onSubmit={apply}>
      <label>Resident or room<input type="search" name="query" maxLength={100} /></label>
      <label>Movement<select name="direction"><option value="">All movements</option>
        <option value="ENTRY">Entry</option><option value="EXIT">Exit</option>
      </select></label>
      <label>From<input type="date" name="from" defaultValue={dates.from} /></label>
      <label>Through<input type="date" name="through" defaultValue={dates.through} /></label>
      <button className="admin-primary">Apply filters</button>
    </form>
    {error ? <div className="ux-status" data-tone="error" role="alert">
      <p>{error}</p><button type="button" className="admin-secondary" onClick={refresh}>Retry loading history</button>
    </div> : history ? <AdminTable columns={['Resident', 'Movement', 'Recorded at (PHT)', 'Entry or exit point', 'Action']}
      empty="No resident access records match these filters." rows={history.records.map(row => ({
        key: row.movement.id,
        cells: [
          <div><strong>{row.residentName}</strong><br /><small>{row.movement.roomLabel}</small></div>,
          <div>{accessDirection[row.movement.direction]}{row.voided ? <small> · Voided</small> : row.revision > 0 && <small> · Corrected</small>}</div>,
          philippineTime(row.movement.occurredAt),
          row.movement.entryPoint,
          <button type="button" className="admin-secondary" onClick={() => setSelected(row)}>Review record</button>,
        ],
      }))} /> : <p role="status">Loading resident access history…</p>}
    {history && (history.hasNext || page > 0) && <div className="visitor-actions" aria-label="Access history pages">
      <button type="button" className="admin-secondary" disabled={page === 0} onClick={() => changePage(page - 1)}>Previous</button>
      <span role="status">Page {page + 1}</span>
      <button type="button" className="admin-secondary" disabled={!history.hasNext} onClick={() => changePage(page + 1)}>Next</button>
    </div>}
    {selected && <MovementAudit selected={selected} path={`${path}/${selected.movement.id}`} onClose={() => setSelected(undefined)}
      onSaved={() => { setSelected(undefined); refresh(); onSaved('Resident access correction saved.') }} />}
  </>
}

function MovementAudit({ selected, path, onClose, onSaved }: {
  selected: StaffMovement; path: string; onClose: () => void; onSaved: () => void
}) {
  const [audit, setAudit] = useState<AccessAudit>()
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [busy, setBusy] = useState(false)
  const [voided, setVoided] = useState(false)
  useEffect(() => {
    let current = true
    api<AccessAudit>(path).then(data => {
      if (current) setAudit(data)
    }).catch(error => {
      if (current) setLoadError(error instanceof Error ? error.message : 'Could not load movement details.')
    })
    return () => { current = false }
  }, [path, retry])
  const latest = audit?.corrections.at(-1)
  const current = latest ?? audit?.original

  async function correct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!current || busy) return
    const data = new FormData(event.currentTarget)
    const reason = String(data.get('reason') ?? '').trim()
    if (!reason) { setError('Enter a reason for the correction.'); return }
    setError('')
    setBusy(true)
    try {
      await api(path + '/corrections', {
        revision: latest?.revision ?? 0,
        direction: voided ? current.direction : data.get('direction'),
        entryPoint: voided ? current.entryPoint : data.get('entryPoint'),
        voided, reason,
      })
      onSaved()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save the correction. Try again.')
      setBusy(false)
    }
  }

  return <ResidentDialog title="Review resident movement" eyebrow="ACCESS RECORD" busy={busy} dismissOnBackdrop={false} onClose={onClose} footerNote="">
    {loadError ? <div role="alert" className="ux-status" data-tone="error">
      <p>{loadError}</p><button className="admin-secondary" onClick={() => { setLoadError(''); setRetry(value => value + 1) }}>Retry</button>
    </div> : !audit || !current ? <p role="status">Loading movement details…</p> : <div className="visitor-form">
      <div className="visitor-card">
        <strong>{selected.residentName}</strong>
        <p>{audit.original.propertyName} · {audit.original.roomLabel}</p>
        <p>{philippineTime(audit.original.occurredAt)} PHT</p>
      </div>
      <h3>Movement history</h3>
      <ul className="dialog-list">
        <li>
          <strong>Original {accessDirection[audit.original.direction].toLowerCase()} · {audit.original.entryPoint}</strong>
          <small>Confirmed by {audit.recordedBy}</small>
        </li>
        {audit.corrections.map(change => <li key={change.revision}>
          <strong>{change.voided ? 'Voided movement' : `Corrected to ${accessDirection[change.direction].toLowerCase()} · ${change.entryPoint}`}</strong>
          <small>{change.correctedBy} · {philippineTime(change.correctedAt)} PHT</small>
          <span>{change.reason}</span>
        </li>)}
      </ul>
      {!latest?.voided && <form className="visitor-form" onSubmit={correct}>
        <h3>Correct this movement</h3>
        <label>Action<select value={voided ? 'void' : 'edit'} disabled={busy} onChange={event => setVoided(event.target.value === 'void')}>
          <option value="edit">Correct direction or entry point</option><option value="void">Void this movement</option>
        </select></label>
        {voided ? <p>Voiding removes this movement from the resident’s history. The original remains in the owner audit.</p> : <>
          <label>Movement<select name="direction" defaultValue={current.direction} disabled={busy}>
            <option value="ENTRY">Entry</option><option value="EXIT">Exit</option>
          </select></label>
          <label>Entry or exit point<input name="entryPoint" required maxLength={80} defaultValue={current.entryPoint} disabled={busy} /></label>
        </>}
        <label>Reason<textarea name="reason" required maxLength={1000} disabled={busy} /></label>
        {error && <p role="alert" className="ux-status" data-tone="error">{error}</p>}
        <button className="dialog-primary" disabled={busy}>{busy ? 'Saving…' : voided ? 'Void movement' : 'Save correction'}</button>
      </form>}
    </div>}
  </ResidentDialog>
}

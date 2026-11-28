import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from './registrationApi'
import ResidentDialog from './ResidentDialog'
import { accessDirection, accessPath } from './residentAccess'
import type { AccessResident } from './residentAccess'

export default function RecordResidentMovement({ property, propertyName, onClose, onRecorded }: {
  property: string; propertyName: string; onClose: () => void; onRecorded: (message: string) => void
}) {
  const [residents, setResidents] = useState<AccessResident[]>()
  const [selected, setSelected] = useState<AccessResident>()
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const focus = useRef<HTMLInputElement>(null)
  const directionInput = useRef<HTMLSelectElement>(null)
  const request = useRef<{ id: string; payload: string }>(null)
  const path = accessPath(property)

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const term = query.trim()
    if (!term) { setError('Enter a resident name or room.'); return }
    setBusy(true)
    setError('')
    setResidents(undefined)
    try {
      setResidents(await api<AccessResident[]>(path + '/residents?' + new URLSearchParams({ query: term })))
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not find residents. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function record(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || busy) return
    const data = new FormData(event.currentTarget)
    const direction = data.get('direction') === 'EXIT' ? 'EXIT' : 'ENTRY'
    const entryPoint = String(data.get('entryPoint') ?? '').trim()
    if (!entryPoint) { setError('Enter the entry or exit point.'); return }
    const body = { tenancyId: selected.tenancyId, direction, entryPoint, identityConfirmed: data.has('identity') }
    const payload = JSON.stringify(body)
    if (request.current?.payload !== payload) request.current = { id: crypto.randomUUID(), payload }
    setBusy(true)
    setError('')
    try {
      await api(path + '/movements', { ...body, requestId: request.current.id })
      onRecorded(`${accessDirection[direction]} recorded for ${selected.name}.`)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not record this movement. Try again.')
      setBusy(false)
    }
  }

  return <ResidentDialog title="Record resident entry or exit" eyebrow="FRONT DESK"
    busy={busy} protectEdits={Boolean(selected)} dismissOnBackdrop={false} onClose={onClose} footerNote="">
    {selected ? <form className="visitor-form" onSubmit={record}>
      <div className="visitor-card"><strong>{selected.name}</strong><p>{selected.propertyName} · {selected.roomLabel}</p>
        <button type="button" className="admin-secondary" disabled={busy} onClick={() => {
          setSelected(undefined); setError(''); requestAnimationFrame(() => focus.current?.focus())
        }}>Choose another resident</button>
      </div>
      <label>Movement<select name="direction" ref={directionInput} required disabled={busy} defaultValue="">
        <option value="" disabled>Choose entry or exit</option>
        <option value="ENTRY">Entry</option><option value="EXIT">Exit</option>
      </select></label>
      <label>Entry or exit point<input name="entryPoint" required maxLength={80} defaultValue="Main entrance" disabled={busy} /></label>
      <label className="visitor-check"><input name="identity" type="checkbox" required disabled={busy} />I checked the resident’s identity.</label>
      {error && <p className="ux-status" data-tone="error" role="alert">{error}</p>}
      <button className="dialog-primary" disabled={busy}>{busy ? 'Recording…' : 'Confirm movement'}</button>
    </form> : <div className="visitor-form">
      <p>Search for an active resident at {propertyName}.</p>
      <form className="visitor-form" onSubmit={search}>
        <label>Resident name or room<input ref={focus} type="search" value={query} required maxLength={100} disabled={busy}
          onChange={event => { setQuery(event.target.value); setResidents(undefined); setError('') }} /></label>
        <button className="admin-secondary" disabled={busy}>{busy ? 'Searching…' : 'Find resident'}</button>
      </form>
      {error && <p className="ux-status" data-tone="error" role="alert">{error}</p>}
      {residents && (residents.length ? <ul className="dialog-list" aria-label="Matching active residents">
        {residents.map(resident => <li key={resident.tenancyId}>
          <strong>{resident.name}</strong><small>{resident.propertyName} · {resident.roomLabel}</small>
          <button type="button" className="admin-secondary" onClick={() => {
            setSelected(resident); requestAnimationFrame(() => directionInput.current?.focus())
          }}>Select {resident.name} in {resident.roomLabel}</button>
        </li>)}
      </ul> : <p role="status">No active residents match. Try another name or room.</p>)}
    </div>}
  </ResidentDialog>
}

import { useState } from 'react'
import ResidentDialog from './ResidentDialog'
import { getResidents, saveResident } from './residentsData'
import type { ResidentRecord, ResidentInput } from './residentsData'
import { getSettings } from './settingsData'
import { manilaInputDate, readPreview, savePreview } from './previewStore'

export function ResidentEditor({ resident, onClose, onSaved }: { resident?: ResidentRecord; onClose: () => void; onSaved: (id: string) => void }) {
  const [error, setError] = useState('')
  const [today] = useState(() => manilaInputDate().slice(0, 10))
  const rooms = getSettings().property.rooms
  return <ResidentDialog title={resident ? 'Edit resident record' : 'Add resident'} eyebrow={resident ? 'MANAGEMENT TOOLS' : 'RESIDENT MANAGEMENT'} onClose={onClose}>
    <form className="admin-form" onSubmit={event => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      const input: ResidentInput = { fullName: String(data.get('fullName') ?? '').trim(), email: String(data.get('email') ?? '').trim(), mobile: String(data.get('mobile') ?? '').trim(), room: String(data.get('room') ?? ''), moveIn: String(data.get('moveIn') ?? ''), status: data.get('status') as ResidentInput['status'], verified: data.has('verified') }
      try { const saved = saveResident(input, resident?.id); onSaved(saved.id) } catch (error) { setError(error instanceof Error ? error.message : 'Could not save this resident.') }
    }}><div className="dialog-body"><p>{resident ? 'Update room assignment and contact details.' : 'Create a local resident record and assign a room. No login account or invitation is created.'}</p><label>Full name<input name="fullName" defaultValue={resident?.fullName} maxLength={100} required /></label><label>Email address<input name="email" type="email" defaultValue={resident?.email} maxLength={254} required /></label><label>Mobile number<input name="mobile" type="tel" defaultValue={resident?.mobile} maxLength={25} required /></label><div className="admin-form-grid"><label>Room<select name="room" defaultValue={resident?.room ?? ''} required><option value="" disabled>Select a room</option>{rooms.map(room => <option key={room}>{room}</option>)}</select></label><label>Move-in date<input type="date" name="moveIn" defaultValue={resident?.moveIn ?? today} required /></label></div><label>Account status<select name="status" defaultValue={resident?.status ?? 'Active'}><option>Active</option><option>Inactive</option></select></label><label className="admin-check"><input name="verified" type="checkbox" defaultChecked={resident?.verified ?? false} />Identity verified (local record)</label></div>{error && <p className="admin-error" role="alert">{error}</p>}<button className="dialog-primary">{resident ? 'Save record (preview)' : 'Save resident (preview)'}</button></form>
  </ResidentDialog>
}
export type ResidentFilters = { name: string; room: string; status: string }
export function ResidentFilterDialog({ initial, onClose, onApply }: { initial: ResidentFilters; onClose: () => void; onApply: (filters: ResidentFilters) => void }) {
  return <ResidentDialog title="Filter residents" eyebrow="RESIDENT DIRECTORY" onClose={onClose}><form className="admin-form" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); onApply({ name: String(data.get('name') ?? '').trim(), room: String(data.get('room') ?? ''), status: String(data.get('status') ?? '') }) }}><div className="dialog-body"><p>Refine results by room, status or resident name.</p><label>Resident name<input name="name" defaultValue={initial.name} maxLength={100} /></label><label>Room<select name="room" defaultValue={initial.room}><option value="">All rooms</option>{getSettings().property.rooms.map(room => <option key={room}>{room}</option>)}</select></label><label>Status<select name="status" defaultValue={initial.status}><option value="">All statuses</option><option>Active</option><option>Inactive</option></select></label></div><button className="dialog-primary">Apply filters (preview)</button><button className="dialog-secondary" type="button" onClick={() => onApply({ name: '', room: '', status: '' })}>Reset filters</button></form></ResidentDialog>
}
export function ContactResidentDialog({ resident, onClose }: { resident: ResidentRecord; onClose: () => void }) {
  const key = `haruhay-contact-draft-${resident.id}`
  const [draft, setDraft] = useState(() => readPreview<string>(key, '', (value): value is string => typeof value === 'string'))
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  return <ResidentDialog title="Contact resident" eyebrow="COMMUNICATIONS" onClose={onClose}><form className="admin-form" onSubmit={event => { event.preventDefault(); try { if (!draft.trim()) throw new Error('Write a message before saving a draft.'); if (!getResidents().some(row => row.id === resident.id)) throw new Error('Resident not found.'); savePreview(key, draft.trim()); setSaved(true); setError('') } catch (error) { setError(error instanceof Error ? error.message : 'Could not save this draft.') } }}><div className="dialog-body"><p><strong>{resident.fullName}</strong><br />{resident.email}<br />{resident.mobile}</p><p>Prepare an update for the resident. Messages are not sent in this preview.</p><label>Message draft<textarea maxLength={1000} value={draft} onChange={event => { setDraft(event.target.value); setSaved(false) }} required /></label>{saved && <p role="status">Draft saved locally. No message was sent.</p>}</div>{error && <p className="admin-error" role="alert">{error}</p>}<button className="dialog-primary">Save draft (preview)</button><button type="button" className="dialog-secondary" onClick={onClose}>Close</button></form></ResidentDialog>
}

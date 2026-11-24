import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useFormFeedback } from './FormFeedback'
import { api } from './registrationApi'
import { maintenanceError, refreshMaintenance, ticketPath, uploadMaintenancePhoto } from './maintenanceApi'
import type { TicketDetail } from './maintenanceApi'

type Location = { id: string; property_name: string; room_label: string }
type Category = { code: string; label: string }
type Options = { locations: Location[]; categories: Category[] }
const asset = (icon: string) => './assets/dashboard/' + icon

export default function MaintenanceReport() {
  const [options, setOptions] = useState<Options>()
  const [retry, setRetry] = useState(0)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sharedArea, setSharedArea] = useState(false)
  const [photo, setPhoto] = useState<File>()
  const [savedId, setSavedId] = useState('')
  const [savedNumber, setSavedNumber] = useState('')
  const [photoError, setPhotoError] = useState('')
  const [requestKey] = useState(() => crypto.randomUUID())
  const feedback = useFormFeedback()

  useEffect(() => {
    let active = true
    Promise.all([api<Location[]>('/maintenance/locations'), api<Category[]>('/maintenance/categories')])
      .then(([locations, categories]) => { if (active) setOptions({ locations, categories }) })
      .catch(error => { if (active) setLoadError(maintenanceError(error)) })
    return () => { active = false }
  }, [retry])
  async function upload(id: string, file: File) {
    setPhotoError('')
    try {
      await uploadMaintenancePhoto(id, file)
      setPhoto(undefined)
    } catch (error) {
      setPhotoError(maintenanceError(error))
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || savedId || !feedback.validate(event.currentTarget)) return
    const data = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      const { id } = await api<{ id: string }>('/maintenance/tickets', {
        requestKey, tenancyId: options?.locations.length === 1 ? options.locations[0].id : data.get('tenancyId'),
        category: data.get('category'), sharedArea, location: data.get('location'), description: data.get('description'),
      })
      setSavedId(id)
      if (photo) await upload(id, photo)
      const detail = await api<TicketDetail>('/maintenance/tickets/' + id)
      setSavedNumber(detail.ticket_number)
      await refreshMaintenance()
    } catch (error) {
      setError(maintenanceError(error))
    } finally {
      setBusy(false)
    }
  }
  const location = options?.locations[0]

  return <>
    <header className="resident-page-heading maintenance-page-heading">
      <h1>Report an issue</h1>
      <p>Describe what happened so your property team can arrange a repair.</p>
    </header>
    {savedId ? <section className="maintenance-form-panel maintenance-live-result" aria-labelledby="maintenance-saved">
      <h2 id="maintenance-saved">Request submitted{savedNumber && ' · ' + savedNumber}</h2>
      <p role="status">{busy ? 'Saving request details…' : 'Submitted · Your property team will review and assign the repair.'}</p>
      {photoError && <p className="ux-status" data-tone="error" role="alert">The ticket is saved. {photoError}</p>}
      {error && <p className="ux-status" data-tone="error" role="alert">The ticket is saved. {error}</p>}
      <div className="maintenance-inline-actions">
        <a className="admin-primary" href={ticketPath('resident', savedId)}>View ticket</a>
        {photoError && photo && <button className="admin-secondary" disabled={busy} onClick={async () => {
          setBusy(true)
          await upload(savedId, photo)
          setBusy(false)
        }}>Retry photo upload</button>}
      </div>
    </section> : <div className="maintenance-create-layout">
      <section className="maintenance-form-panel">
        <h2>Describe your concern</h2>
        {loadError ? <div role="alert"><p>{loadError}</p><button className="admin-secondary" onClick={() => { setLoadError(''); setRetry(value => value + 1) }}>Retry loading form</button></div>
          : !options ? <p role="status">Loading your room details…</p>
            : !location ? <p>An active tenancy is required to report a maintenance issue.</p>
              : <form className="admin-form maintenance-live-form" noValidate onSubmit={submit} onChange={event => {
                if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) feedback.clear(event.target.name)
              }}>
                {feedback.summary}
                {error && <p className="ux-status" data-tone="error" role="alert">{error}</p>}
                <div className="maintenance-fields">
                  <label>Issue category<select name="category" required defaultValue="" {...feedback.fieldProps('category')}>
                    <option value="" disabled>Choose a category</option>
                    {options.categories.map(category => <option value={category.code} key={category.code}>{category.label}</option>)}
                  </select>{feedback.fieldError('category')}</label>
                  {options.locations.length === 1
                    ? <div className="maintenance-location"><span>Property and room</span><strong>{location.property_name} · {location.room_label}</strong></div>
                    : <label>Property and room<select name="tenancyId" required defaultValue="" {...feedback.fieldProps('tenancyId')}>
                      <option value="" disabled>Choose a property and room</option>
                      {options.locations.map(stay => <option value={stay.id} key={stay.id}>{stay.property_name} · {stay.room_label}</option>)}
                    </select>{feedback.fieldError('tenancyId')}</label>}
                </div>
                <label className="maintenance-checkbox"><input type="checkbox" checked={sharedArea} onChange={event => setSharedArea(event.target.checked)} /> This is in a shared area</label>
                {sharedArea && <label>Where in the shared area?<input name="location" required maxLength={200} placeholder="Example: second-floor hallway" {...feedback.fieldProps('location')} />{feedback.fieldError('location')}</label>}
                <label>What happened?<textarea name="description" required maxLength={2000} placeholder="Example: The kitchen faucet has been leaking since yesterday." {...feedback.fieldProps('description')} />{feedback.fieldError('description')}</label>
                <label>Photo (optional)<input type="file" accept="image/jpeg,image/png" onChange={event => setPhoto(event.target.files?.[0])} /><small>JPEG or PNG, up to 5 MB.</small></label>
                <div className="maintenance-inline-actions"><button className="admin-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit request'}</button><a href={ticketPath('resident')} className="admin-secondary">Back to tickets</a></div>
              </form>}
      </section>
      <aside className="maintenance-help">
        <section className="maintenance-useful-details">
          <h2>Useful details</h2>
          <ul>{[['location-tip', 'Where it happened'], ['clock-tip', 'When it started'], ['upload-tip', 'A photo, if available']].map(([icon, label]) => <li key={icon}>
            <span><img src={asset('maintenance-' + icon + '.svg')} alt="" width="20" height="20" /></span>{label}
          </li>)}</ul>
        </section>
        <section className="maintenance-caring-response"><h2>Urgent concern?</h2><p><img src={asset('maintenance-heart.svg')} alt="" width="21" height="21" />Contact your property’s front desk directly if the issue needs immediate attention.</p></section>
      </aside>
    </div>}
  </>
}

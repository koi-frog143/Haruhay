import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import ResidentLayout from './ResidentLayout'
import { createMaintenanceTicket, getMaintenanceDraft, saveMaintenanceDraft } from './maintenanceData'
import type { MaintenanceDraft } from './maintenanceData'
import './Maintenance.css'

const asset = (name: string) => `./assets/dashboard/${name}`

function formDraft(form: HTMLFormElement): MaintenanceDraft {
  const data = new FormData(form)
  return {
    category: String(data.get('category') ?? ''),
    location: String(data.get('location') ?? ''),
    title: String(data.get('title') ?? ''),
    description: String(data.get('description') ?? ''),
  }
}

export default function CreateMaintenanceTicket() {
  const [notice, setNotice] = useState('')
  const [draft] = useState(getMaintenanceDraft)

  useEffect(() => {
    document.title = 'Report a maintenance issue | Haruhay'
  }, [])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const ticket = createMaintenanceTicket(formDraft(event.currentTarget))
    window.location.hash = `/resident/maintenance/${ticket.id}`
  }

  function saveDraft(form: HTMLFormElement | null) {
    if (!form) return
    saveMaintenanceDraft(formDraft(form))
    setNotice('Your maintenance request draft was saved in this browser session.')
  }

  return <ResidentLayout
    activeSection="Maintenance"
    breadcrumb="Maintenance"
    notice={notice}
    onNotice={setNotice}
    onDismissNotice={() => setNotice('')}
  >
    <div className="resident-content maintenance-content">
      <header className="resident-page-heading">
        <span>MAINTENANCE</span>
        <h1>Report an issue</h1>
        <p>Tell us what happened. Your comfort and wellbeing matter.</p>
      </header>

      <div className="maintenance-create-layout">
        <form className="maintenance-form-panel" onSubmit={submit}>
          <h2>Describe your concern</h2>
          <p>The more details you give, the easier it is to help.</p>

          <div className="maintenance-first-fields">
            <label className="maintenance-form-group">
              <span>Issue category</span>
              <span className="maintenance-field">
                <img src={asset('maintenance-wrench-field.svg')} width="19" height="19" alt="" />
                <select name="category" defaultValue={draft?.category ?? ''} required>
                  <option value="" disabled>Electrical / water / furniture...</option>
                  <option>Plumbing</option>
                  <option>Electrical</option>
                  <option>Air conditioning</option>
                  <option>Furniture</option>
                  <option>General repair</option>
                </select>
              </span>
            </label>

            <label className="maintenance-form-group">
              <span>Room or location</span>
              <span className="maintenance-field">
                <img src={asset('maintenance-location-field.svg')} width="19" height="19" alt="" />
                <input name="location" defaultValue={draft?.location ?? 'Room 204, second floor'} placeholder="Room 204, second floor" maxLength={100} required />
              </span>
            </label>
          </div>

          <label className="maintenance-form-group maintenance-title-field">
            <span>Short issue title</span>
            <span className="maintenance-field">
              <img src={asset('maintenance-file-field.svg')} width="19" height="19" alt="" />
              <input name="title" defaultValue={draft?.title ?? ''} placeholder="e.g. Water pressure is very low" maxLength={120} required />
            </span>
          </label>

          <label className="maintenance-form-group maintenance-description-field">
            <span>What happened?</span>
            <textarea name="description" defaultValue={draft?.description ?? ''} placeholder="Describe the issue, when you noticed it, and any important details..." maxLength={1000} required />
          </label>

          <div className="maintenance-form-actions">
            <button className="maintenance-submit" type="submit">Submit request</button>
            <button className="maintenance-save-draft" type="button" onClick={event => saveDraft(event.currentTarget.form)}>Save as draft</button>
          </div>
        </form>

        <aside className="maintenance-create-aside" aria-label="Maintenance request guidance">
          <section className="maintenance-useful-details">
            <h2>Useful details</h2>
            <div><span><img src={asset('maintenance-location-tip.svg')} width="20" height="20" alt="" /></span><strong>Where it happened</strong></div>
            <div><span><img src={asset('maintenance-clock-tip.svg')} width="20" height="20" alt="" /></span><strong>When it started</strong></div>
            <div><span><img src={asset('maintenance-upload-tip.svg')} width="20" height="20" alt="" /></span><strong>Photos, if available</strong></div>
          </section>
          <section className="maintenance-caring-response">
            <h2>A caring response</h2>
            <div><img src={asset('maintenance-heart.svg')} width="28" height="28" alt="" /><span>We will keep you updated.</span></div>
          </section>
        </aside>
      </div>
    </div>
  </ResidentLayout>
}

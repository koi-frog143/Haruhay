import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import ResidentLayout from './ResidentLayout'
import './RegisterVisitor.css'
import { createVisitorRequest } from './residentData'
import { getResidentProfile } from './profileData'
import { manilaInputDate, usePreviewData } from './previewStore'
import { getCurrentResident } from './residentsData'

const asset = (name: string) => `./assets/dashboard/${name}`

type VisitorRequest = {
  fullName: string
  contactNumber: string
  purpose: string
  expectedArrival: string
}


function value(data: FormData, key: string) {
  return String(data.get(key) ?? '').trim()
}

export default function RegisterVisitor() {
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const profile = usePreviewData(getResidentProfile)
  const resident = usePreviewData(getCurrentResident)
  const [arrivalDefaults] = useState(() => ({ min: manilaInputDate(), next: manilaInputDate(new Date(Date.now() + 3600000)) }))

  useEffect(() => {
    document.title = 'Register a visitor | Haruhay'
  }, [])

  function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNotice('')

    const form = event.currentTarget
    const data = new FormData(form)
    const request: VisitorRequest = {
      fullName: value(data, 'fullName'),
      contactNumber: value(data, 'contactNumber'),
      purpose: value(data, 'purpose'),
      expectedArrival: value(data, 'expectedArrival'),
    }

    if (!/^09\d{9}$/.test(request.contactNumber.replace(/[\s-]/g, ''))) {
      setError('Enter an 11-digit Philippine mobile number beginning with 09.')
      const contactField = form.elements.namedItem('contactNumber')
      if (contactField instanceof HTMLInputElement) contactField.focus()
      return
    }

    try {
      createVisitorRequest(request)
      setNotice(`Request for ${request.fullName} saved locally as pending review. No staff were notified.`)
      form.reset()
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save the visitor request.') }
  }

  return <ResidentLayout
    activeSection="Logbook"
    breadcrumb="Logbook"
    notice={notice}
    onNotice={setNotice}
    onDismissNotice={() => setNotice('')}
  >
    <div className="resident-content visitor-register-content">
      <header className="resident-page-heading">
        <span>VISITOR ACCESS</span>
        <h1>Register a visitor</h1>
        <p>Help your guest enjoy a smooth and safe visit.</p>
      </header>

      <div className="visitor-register-layout">
        <form className="visitor-register-panel" onSubmit={submitRequest}>
          <header>
            <h2>Visitor information</h2>
            <p>Use your guest’s details exactly as shown on their ID.</p>
          </header>

          <div className="visitor-register-fields">
            <label>
              <span>Full name</span>
              <span className="visitor-input-wrap">
                <img src={asset('visitor-user.svg')} width="19" height="19" alt="" />
                <input name="fullName" type="text" placeholder="e.g. Maria Santos" autoComplete="name" maxLength={100} required />
              </span>
            </label>

            <label>
              <span>Contact number</span>
              <span className="visitor-input-wrap">
                <img src={asset('visitor-phone.svg')} width="19" height="19" alt="" />
                <input name="contactNumber" type="tel" placeholder="09XX XXX XXXX" autoComplete="tel" inputMode="tel" maxLength={15} required />
              </span>
            </label>

            <label>
              <span>Purpose of visit</span>
              <span className="visitor-input-wrap">
                <img src={asset('visitor-book.svg')} width="19" height="19" alt="" />
                <select name="purpose" defaultValue="Personal visit" required>
                  <option>Personal visit</option>
                  <option>Family visit</option>
                  <option>Study or group work</option>
                  <option>Delivery or service</option>
                  <option>Other</option>
                </select>
              </span>
            </label>

            <label>
              <span>Expected arrival</span>
              <span className="visitor-input-wrap">
                <img src={asset('visitor-calendar.svg')} width="19" height="19" alt="" />
                <input name="expectedArrival" type="datetime-local" aria-label="Expected arrival (Philippine time)" min={arrivalDefaults.min} defaultValue={arrivalDefaults.next} required />
              </span>
            </label>

            <label>
              <span>Resident / host</span>
              <span className="visitor-input-wrap visitor-input-readonly">
                <img src={asset('visitor-users.svg')} width="19" height="19" alt="" />
                <input value={profile.fullName} aria-label="Resident or host" readOnly />
              </span>
            </label>

            <label>
              <span>Room to visit</span>
              <span className="visitor-input-wrap visitor-input-readonly">
                <img src={asset('visitor-building.svg')} width="19" height="19" alt="" />
                <input value={`Room ${resident.room}`} aria-label="Room to visit" readOnly />
              </span>
            </label>
          </div>

          <div className="visitor-consent-note">
            <img src={asset('icon-shield.svg')} width="24" height="24" alt="" />
            <p>Guests are verified by the front desk. Please remind them to bring a valid ID.</p>
          </div>

          <p className="resident-preview-label">Arrival times use Philippine time. Requests stay pending until registered in the administrator preview. No real notifications are sent. <a href="#/resident/logbook">View requests</a></p>
          {error && <p className="visitor-form-error" role="alert">{error}</p>}

          <div className="visitor-register-actions">
            <button type="submit">Submit visitor request</button>
            <a href="#/resident/logbook">Cancel</a>
          </div>
        </form>

        <aside className="visitor-welcome-card">
          <h2>A thoughtful welcome</h2>
          <img className="visitor-welcome-heart" src={asset('visitor-heart.svg')} width="31" height="31" alt="" />
          <h3>Safety is a shared effort.</h3>
          <p>Your visitor request helps the front desk verify who enters and keeps the whole community informed.</p>
          <img className="visitor-welcome-stars" src={asset('visitor-stars.svg')} width="65" height="81" alt="" />
        </aside>
      </div>
    </div>
  </ResidentLayout>
}

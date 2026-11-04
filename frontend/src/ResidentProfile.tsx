import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import ResidentLayout from './ResidentLayout'
import { getResidentProfile, profileInitials, saveResidentProfile } from './profileData'
import './ResidentProfile.css'

type DialogMode = 'edit' | 'preferences'

const preferences = [
  { key: 'paymentReminders', title: 'Payment reminders', description: 'Upcoming rent and utility due dates.' },
  { key: 'maintenanceUpdates', title: 'Maintenance updates', description: 'Progress and comments on your requests.' },
  { key: 'communityAnnouncements', title: 'Community announcements', description: 'House notices and community events.' },
] as const

export default function ResidentProfile() {
  const [profile, setProfile] = useState(getResidentProfile)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [mode, setMode] = useState<DialogMode>('edit')
  const dialog = useRef<HTMLDialogElement>(null)
  const form = useRef<HTMLFormElement>(null)

  useEffect(() => {
    document.title = 'My profile | Haruhay'
    const update = () => setProfile(getResidentProfile())
    window.addEventListener('haruhay-profile-updated', update)
    return () => window.removeEventListener('haruhay-profile-updated', update)
  }, [])

  function openDialog(nextMode: DialogMode) {
    setMode(nextMode)
    setError('')
    // Reset unsaved edits each time the native dialog opens.
    form.current?.reset()
    dialog.current?.showModal()
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const updated = mode === 'edit' ? {
      ...profile,
      fullName: String(data.get('fullName') ?? '').trim(),
      email: String(data.get('email') ?? '').trim(),
      mobile: String(data.get('mobile') ?? '').trim(),
    } : {
      ...profile,
      paymentReminders: data.has('paymentReminders'),
      maintenanceUpdates: data.has('maintenanceUpdates'),
      communityAnnouncements: data.has('communityAnnouncements'),
    }
    if (mode === 'edit' && !updated.fullName) {
      setError('Please enter your full name.')
      event.currentTarget.querySelector<HTMLInputElement>('[name="fullName"]')?.focus()
      return
    }
    if (mode === 'edit' && !/^\+?[\d\s()-]{7,25}$/u.test(updated.mobile)) {
      setError('Enter a valid mobile number using 7–15 digits.')
      event.currentTarget.querySelector<HTMLInputElement>('[name="mobile"]')?.focus()
      return
    }
    const digits = updated.mobile.replace(/\D/gu, '').length
    if (mode === 'edit' && (digits < 7 || digits > 15)) {
      setError('Enter a valid mobile number using 7–15 digits.')
      return
    }
    try {
      saveResidentProfile(updated)
      setProfile(updated)
      dialog.current?.close()
      setNotice(mode === 'edit' ? 'Your profile was saved for this browser session.' : 'Your notification preferences were saved for this browser session.')
    } catch {
      setError('Your changes could not be saved. Please check that browser storage is enabled and try again.')
    }
  }

  return <ResidentLayout activeSection="My profile" breadcrumb="My profile" notice={notice} onNotice={setNotice} onDismissNotice={() => setNotice('')}>
    <div className="resident-content profile-content">
      <header className="resident-page-heading">
        <span>PERSONAL INFORMATION</span>
        <h1>My Haruhay profile</h1>
        <p>Your details, preferences and current residence.</p>
      </header>

      <div className="profile-grid">
        <section className="profile-panel profile-account" aria-labelledby="profile-account-title">
          <h2 id="profile-account-title">Resident account</h2>
          <div className="profile-avatar" aria-hidden="true">
            <img src="./assets/dashboard/profile-avatar.svg" width="127" height="127" alt="" />
            <span>{profileInitials(profile.fullName)}</span>
          </div>
          <h3>{profile.fullName}</h3>
          <p>Room 204 • Resident</p>
          <span className="profile-verified">ACTIVE &amp; VERIFIED</span>
          <button className="profile-edit" type="button" onClick={() => openDialog('edit')}>Edit profile</button>
        </section>

        <div className="profile-details-column">
          <section className="profile-panel profile-details" aria-labelledby="profile-details-title">
            <h2 id="profile-details-title">Personal details</h2>
            <dl>
              <div><dt>Email</dt><dd>{profile.email}</dd></div>
              <div><dt>Mobile</dt><dd>{profile.mobile}</dd></div>
              <div><dt>Residence</dt><dd>Haruhay Residences</dd></div>
              <div><dt>Room</dt><dd>204 • 2nd floor</dd></div>
              <div><dt>Move-in date</dt><dd><time dateTime="2026-06-15">June 15, 2026</time></dd></div>
            </dl>
          </section>
          <section className="profile-panel profile-preferences" aria-labelledby="profile-preferences-title">
            <h2 id="profile-preferences-title">Your preferences</h2>
            <button type="button" onClick={() => openDialog('preferences')}>
              <img src="./assets/dashboard/profile-bell.svg" width="22" height="22" alt="" />
              <span>Notification preferences &amp; reminders</span>
            </button>
          </section>
        </div>
      </div>
    </div>

    <dialog className="profile-dialog" ref={dialog} aria-labelledby="profile-dialog-title" aria-describedby="profile-dialog-description" onClick={event => { if (event.target === event.currentTarget) dialog.current?.close() }}>
      <div className="profile-dialog-heading">
        <h2 id="profile-dialog-title">{mode === 'edit' ? 'Edit my profile' : 'Notification preferences'}</h2>
        <button type="button" aria-label="Close dialog" onClick={() => dialog.current?.close()}>×</button>
      </div>
      <p className="profile-dialog-eyebrow">RESIDENT ACCOUNT</p>
      <p className="profile-dialog-description" id="profile-dialog-description">{mode === 'edit' ? 'Update your contact information and personal details.' : 'Choose which updates and reminders you would like to receive.'}</p>
      <form ref={form} key={mode + JSON.stringify(profile)} onSubmit={save}>
        {mode === 'edit' ? <div className="profile-form-fields">
          <label>Full name<input name="fullName" autoComplete="name" defaultValue={profile.fullName} maxLength={100} required /></label>
          <label>Email address<input name="email" type="email" autoComplete="email" defaultValue={profile.email} maxLength={254} required /></label>
          <label>Mobile number<input name="mobile" type="tel" autoComplete="tel" defaultValue={profile.mobile} maxLength={25} required /></label>
        </div> : <div className="profile-preference-options">
          {preferences.map(preference => <label key={preference.key}>
            <input name={preference.key} type="checkbox" defaultChecked={profile[preference.key]} />
            <span><strong>{preference.title}</strong><small>{preference.description}</small></span>
          </label>)}
        </div>}
        {error && <p className="profile-form-error" role="alert">{error}</p>}
        <p className="profile-session-note">Saved in this browser session. {mode === 'preferences' ? 'Notification delivery is not connected yet.' : 'No account changes are sent to a server.'}</p>
        <div className="profile-dialog-actions">
          <button type="button" onClick={() => dialog.current?.close()}>Cancel</button>
          <button type="submit">{mode === 'edit' ? 'Save profile' : 'Save preferences'}</button>
        </div>
      </form>
    </dialog>
  </ResidentLayout>
}


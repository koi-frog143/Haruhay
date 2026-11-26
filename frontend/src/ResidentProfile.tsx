import { ConfirmedAgreement } from './RoomFlow'
import { isLiveWorkspace, loadWorkspaceSession } from './workspaceSession'
import { api } from './registrationApi'
import type { Account, Delivery } from './registrationApi'
import { ResidentTransferOffers } from './ResidentTenancy'
import ResidentDialog from './ResidentDialog'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import ResidentLayout from './ResidentLayout'
import { getResidentProfile, profileInitials, saveResidentProfile } from './profileData'
import './ResidentProfile.css'
import { getCurrentResident } from './residentsData'
import { getSettings } from './settingsData'
import { usePreviewData } from './previewStore'

type DialogMode = 'edit' | 'preferences'

const preferences = [
  { key: 'paymentReminders', title: 'Payment reminders', description: 'Upcoming rent and utility due dates.' },
  { key: 'maintenanceUpdates', title: 'Maintenance updates', description: 'Progress and comments on your requests.' },
  { key: 'communityAnnouncements', title: 'Community announcements', description: 'House notices and community events.' },
] as const

export default function ResidentProfile() {
  const [profile, setProfile] = useState(getResidentProfile)
  const resident = usePreviewData(getCurrentResident)
  const settings = usePreviewData(getSettings)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [mode, setMode] = useState<DialogMode>('edit')
  const [busy, setBusy] = useState(false)
  const [changeEmail, setChangeEmail] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const live = isLiveWorkspace()

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

  function closeDialog() {
    if (busy) return
    setError('')
    form.current?.reset()
    dialog.current?.close()
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const updated = mode === 'edit' ? {
      ...profile,
      fullName: String(data.get('fullName') ?? '').trim(),
      email: live ? profile.email : String(data.get('email') ?? '').trim(),
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
      if (mode === 'edit' && live) {
        setBusy(true); setError('')
        const account = await api<Account>('/resident/profile', { fullName: updated.fullName, mobile: updated.mobile }, 'PUT')
        await loadWorkspaceSession(account)
        window.dispatchEvent(new Event('haruhay-profile-updated'))
      } else saveResidentProfile(updated)
      setProfile(updated)
      dialog.current?.close()
      setNotice(mode === 'edit' ? live ? 'Your profile was saved.' : 'Your profile was saved for this browser session.' : 'Your notification preferences were saved for this browser session.')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save your changes. Try again.')
    } finally {
      setBusy(false)
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
          <p>{live ? resident.room : 'Room ' + resident.room} · Resident</p>
          <span className="profile-verified">{resident.status.toUpperCase()}{resident.verified ? ' · VERIFIED' : ' · NOT VERIFIED'}</span>
          <button className="profile-edit" type="button" onClick={() => openDialog('edit')}>Edit profile</button>
        </section>

        <div className="profile-details-column">
          <section className="profile-panel profile-details" aria-labelledby="profile-details-title">
            <h2 id="profile-details-title">Personal details</h2>
            <dl>
              <div><dt>Email</dt><dd>{profile.email}</dd></div>
              <div><dt>Mobile</dt><dd>{profile.mobile}</dd></div>
              <div><dt>Residence</dt><dd>{resident.property ?? settings.property.name}</dd></div>
              <div><dt>Room</dt><dd>{resident.room}</dd></div>
              <div><dt>Move-in date</dt><dd><time dateTime={resident.moveIn}>{resident.moveIn}</time></dd></div>
            </dl>
            {live && <button className="profile-edit" type="button" onClick={() => setChangeEmail(true)}>Change sign-in email</button>}
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
      {live && <><ResidentTransferOffers /><ConfirmedAgreement /></>}
    </div>

    <dialog className="profile-dialog" ref={dialog} aria-labelledby="profile-dialog-title" aria-describedby="profile-dialog-description" onCancel={event => { if (busy) event.preventDefault() }} onClick={event => { if (event.target === event.currentTarget) closeDialog() }}>
      <div className="profile-dialog-heading">
        <h2 id="profile-dialog-title">{mode === 'edit' ? 'Edit my profile' : 'Notification preferences'}</h2>
        <button type="button" aria-label="Close dialog" onClick={closeDialog} disabled={busy}>×</button>
      </div>
      <p className="profile-dialog-eyebrow">RESIDENT ACCOUNT</p>
      <p className="profile-dialog-description" id="profile-dialog-description">{mode === 'edit' ? 'Update your contact information and personal details.' : 'Choose which updates and reminders you would like to receive.'}</p>
      <form ref={form} key={mode + JSON.stringify(profile)} onSubmit={save}>
        {mode === 'edit' ? <div className="profile-form-fields">
          <label>Full name<input name="fullName" autoComplete="name" defaultValue={profile.fullName} maxLength={100} required /></label>
          {!live && <label>Email address<input name="email" type="email" autoComplete="email" defaultValue={profile.email} maxLength={254} required /></label>}
          <label>Mobile number<input name="mobile" type="tel" autoComplete="tel" defaultValue={profile.mobile} maxLength={25} required /></label>
        </div> : <div className="profile-preference-options">
          {preferences.map(preference => <label key={preference.key}>
            <input name={preference.key} type="checkbox" defaultChecked={profile[preference.key]} />
            <span><strong>{preference.title}</strong><small>{preference.description}</small></span>
          </label>)}
        </div>}
        {error && <p className="profile-form-error" role="alert">{error}</p>}
        {!(live && mode === 'edit') && <p className="profile-session-note">{mode === 'edit'
          ? 'Interaction preview • changes are saved only in this browser session'
          : 'Saved in this browser session • notification delivery is not connected yet'}</p>}
        <div className="profile-dialog-actions">
          {mode === 'preferences' && <button type="button" onClick={closeDialog}>Cancel</button>}
          <button type="submit" disabled={busy}>{mode === 'edit' ? busy ? 'Saving…' : live ? 'Save profile' : 'Save profile (preview)' : 'Save preferences'}</button>
        </div>
      </form>
    </dialog>
    {changeEmail && <EmailChangeDialog onClose={() => setChangeEmail(false)} onSaved={message => { setNotice(message); setChangeEmail(false) }} />}
  </ResidentLayout>
}

function EmailChangeDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (message: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <ResidentDialog title="Change sign-in email" eyebrow="RESIDENT ACCOUNT" busy={busy} dismissOnBackdrop={false} onClose={onClose} footerNote="">
    <p>Keep signing in with your current email until you confirm the new address.</p>
    <form className="registration-form" onSubmit={async event => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      setBusy(true); setError('')
      try {
        const result = await api<Delivery>('/resident/profile/email', { email: String(data.get('email')).trim(), currentPassword: data.get('password') })
        onSaved(result.delivery === 'LOCAL_FILE' ? 'Verification link written to the local development mail folder. No email was sent.' : 'Check the new inbox for your confirmation link.')
      } catch (error) { setError(error instanceof Error ? error.message : 'Could not send verification. Try again.') }
      finally { setBusy(false) }
    }}>
      <label>New email address<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
      <label>Current password<input name="password" type="password" autoComplete="current-password" maxLength={72} required /></label>
      {error && <p className="admin-error" role="alert">{error}</p>}
      <button className="dialog-primary" disabled={busy}>{busy ? 'Sending…' : 'Send confirmation link'}</button>
    </form>
  </ResidentDialog>
}


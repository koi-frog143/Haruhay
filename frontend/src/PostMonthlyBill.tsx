import { useState } from 'react'
import type { FormEvent } from 'react'
import ResidentDialog from './ResidentDialog'
import { api } from './registrationApi'
import { getWorkspaceSession, loadWorkspaceSession } from './workspaceSession'
import { money } from './billingData'
import { manilaInputDate } from './previewStore'

export default function PostMonthlyBill({ onClose, onSaved }: { onClose: () => void; onSaved: (message: string) => void }) {
  const workspace = getWorkspaceSession()
  const applications = workspace?.applications.filter(item => item.tenancy_status === 'ACTIVE' && item.tenancy_offer?.accepted_at) ?? []
  const [id, setId] = useState(applications[0]?.id ?? '')
  const [period, setPeriod] = useState(() => manilaInputDate().slice(0, 7))
  const [dueDate, setDueDate] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const application = applications.find(item => item.id === id)
  const terms = application?.tenancy_offer?.terms
  const property = workspace?.properties.find(item => item.id === application?.property_id)
  const defaultDueDay = property?.billing_due_day ?? 1
  const graceDays = property?.billing_grace_days ?? 0
  const defaultDueDate = period ? `${period}-${String(defaultDueDay).padStart(2, '0')}` : ''
  const monthly = terms?.applicant_monthly_rent
  const fixed = (terms?.charges ?? []).filter(charge => charge.basis === 'FIXED_MONTHLY').reduce((sum, charge) => sum + Number(charge.amount ?? 0), 0)

  async function post(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('/owner/bills', { applicationId: id, period, dueDate })
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not post the bill.')
      setBusy(false)
      return
    }
    try { await loadWorkspaceSession() }
    catch { onSaved('Monthly bill saved. Refresh billing to see the latest records.'); return }
    onSaved('Monthly bill is available to the resident. A bill for this month can only be posted once.')
  }

  return <ResidentDialog busy={busy} dismissOnBackdrop={false} title="Post monthly bill" eyebrow="BILLING & PAYMENTS"
    footerNote="Posting saves the bill to property records. Residents can report their payments from Billing &amp; payments." onClose={onClose}>
    <form className="registration-form" onSubmit={post}>
      {!applications.length ? <p>No active tenancies with accepted room terms.</p> : <>
        <label>Resident<select required value={id} disabled={busy} onChange={event => { setId(event.target.value); setDueDate(null) }}>
          {applications.map(item => <option value={item.id} key={item.id}>{item.full_name} · {item.property_name} / {item.room_label}</option>)}
        </select></label>
        <div className="room-review-summary">
          <p>Accepted monthly rent <strong>{monthly == null ? 'To be confirmed' : money(Number(monthly))}</strong></p>
          <p>Fixed monthly charges <strong>{money(fixed)}</strong></p>
          <p>Bill total <strong>{monthly == null ? 'To be confirmed' : money(Number(monthly) + fixed)}</strong></p>
          <small>Deposit, advance rent, metered and unconfirmed charges are excluded from the monthly total.</small>
        </div>
        <label>Billing month<input name="period" type="month" required disabled={busy} value={period} onChange={event => { setPeriod(event.target.value); setDueDate(null) }} /></label>
        <label>Due date<input name="dueDate" type="date" required disabled={busy || !period} value={dueDate ?? defaultDueDate}
          onChange={event => setDueDate(event.target.value)} />
          <small>Property default is day {defaultDueDay}. You can change the date within the billing month.</small>
        </label>
        <p>{graceDays ? `Property grace period is ${graceDays} ${graceDays === 1 ? 'day' : 'days'} after the due date.` : 'This property has no billing grace period.'}</p>
        <p>Each resident agreement has one bill per month, including after a transfer.</p>
      </>}
      {error && <p role="alert" className="form-error">{error}</p>}
      <button className="dialog-primary" disabled={busy || !id || monthly == null}>{busy ? 'Posting…' : 'Post bill'}</button>
    </form>
  </ResidentDialog>
}

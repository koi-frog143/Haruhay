import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from './registrationApi'
import type { Admission } from './registrationApi'
import { Terms } from './RoomFlow'
import type { RoomOffer, RoomTerms } from './RoomFlow'
import ResidentDialog from './ResidentDialog'
import { AdminStatus } from './AdminUI'
import { clearWorkspaceSession, loadWorkspaceSession } from './workspaceSession'
import { money } from './billingData'
import './ResidentTenancy.css'

type MoveOutSummary = {
  property_name: string; room_label: string; open_bills: number; outstanding_balance: number
  unclaimed_packages: number; open_repairs: number; pending_visits: number; ready_passes: number; guests_inside: number
}
type Transfer = {
  id: string; status: 'PROPOSED' | 'ACCEPTED' | 'COMPLETED' | 'CANCELLED'
  source_tenancy_id: string; source_room_label: string; destination_room_label: string
  completed_at: string | null; offer: RoomOffer
}

const shortDate = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Try again.'

export function OwnerTenancyActions({ admission, onSaved }: { admission: Admission; onSaved: (message: string) => void }) {
  const [modal, setModal] = useState<'move-out' | 'propose' | 'complete' | null>(null)
  const [transfers, setTransfers] = useState<Transfer[] | null>(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const tenancy = admission.tenancy_id
  const active = admission.tenancy_status === 'ACTIVE'
  const path = '/owner/tenancies/' + tenancy
  const pending = transfers?.find(transfer => transfer.source_tenancy_id === tenancy && ['PROPOSED', 'ACCEPTED'].includes(transfer.status))
  const completed = transfers?.filter(transfer => transfer.status === 'COMPLETED') ?? []

  useEffect(() => {
    if (!tenancy) return
    let mounted = true
    api<Transfer[]>(path + '/transfers').then(rows => {
      if (mounted) { setTransfers(rows); setError('') }
    }).catch(error => { if (mounted) setError(errorText(error)) })
    return () => { mounted = false }
  }, [path, tenancy, reload])

  if (!tenancy) return null

  function saved(message: string, refreshStay: boolean) {
    setModal(null)
    setReload(previous => previous + 1)
    onSaved(message)
    if (refreshStay) void loadWorkspaceSession().catch(error => setError(errorText(error)))
  }

  return <section className="admin-panel admin-quick tenancy-panel">
    <h2>Tenancy management</h2>
    {active ? <div className="admin-actions">
      <button type="button" className="admin-secondary" onClick={() => setModal('propose')}>{pending ? 'Propose different terms' : 'Propose room transfer'}</button>
      <button type="button" className="admin-secondary tenancy-destructive" onClick={() => setModal('move-out')}>End tenancy</button>
    </div> : <p>Tenancy ended{admission.tenancy_ended_at ? ' on ' + shortDate.format(new Date(admission.tenancy_ended_at)) : ''}. Past bills and service records remain available to authorized staff.</p>}
    {active && <button type="button" className="admin-link-button" onClick={() => setReload(previous => previous + 1)}>Refresh transfers</button>}
    {!transfers && !error && <p role="status">Loading transfers…</p>}
    {error && <p className="admin-error" role="alert">{error}</p>}
    {pending && <div className="tenancy-summary">
      <div><strong>{pending.source_room_label} → {pending.destination_room_label}</strong><p>{pending.status === 'ACCEPTED' ? 'The resident accepted the proposed terms.' : 'Waiting for the resident to accept the room terms in My profile.'}</p></div>
      {pending.status === 'ACCEPTED' && <button type="button" className="admin-primary" onClick={() => setModal('complete')}>Review & complete transfer</button>}
    </div>}
    {completed.length > 0 && <details className="tenancy-history"><summary>Transfer history ({completed.length})</summary>
      <ul>{completed.map(transfer => <li key={transfer.id}>{transfer.source_room_label} → {transfer.destination_room_label}{transfer.completed_at ? ' · ' + shortDate.format(new Date(transfer.completed_at)) : ''}</li>)}</ul>
    </details>}
    {modal === 'move-out' && <MoveOutDialog path={path} onClose={() => setModal(null)} onSaved={() => saved('Tenancy ended. The room slot was released.', true)} />}
    {modal === 'propose' && <ProposeTransfer path={path} admission={admission} replacing={Boolean(pending)} onClose={() => setModal(null)} onSaved={() => saved('Transfer proposed. The resident can review the terms in My profile.', false)} />}
    {modal === 'complete' && pending && <CompleteTransfer path={path} transfer={pending} onClose={() => setModal(null)} onSaved={() => saved('Room transfer completed. Future bills will use the accepted terms.', true)} />}
  </section>
}

function MoveOutDialog({ path, onClose, onSaved }: { path: string; onClose: () => void; onSaved: () => void }) {
  const [summary, setSummary] = useState<MoveOutSummary | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let mounted = true
    api<MoveOutSummary>(path + '/move-out').then(data => { if (mounted) setSummary(data) })
      .catch(error => { if (mounted) setError(errorText(error)) })
    return () => { mounted = false }
  }, [path, reload])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setBusy(true); setError('')
    try {
      await api(path + '/move-out', { reason: String(data.get('reason')).trim(), confirmed: data.has('confirmed') })
      onSaved()
    } catch (error) { setError(errorText(error)) } finally { setBusy(false) }
  }

  return <ResidentDialog title="End tenancy" eyebrow="TENANCY MANAGEMENT" dismissOnBackdrop={false} busy={busy} onClose={onClose} footerNote="">
    {!summary && !error && <p role="status">Checking what needs attention…</p>}
    {error && <p className="admin-error" role="alert">{error}</p>}
    {!summary && error && <button type="button" className="admin-secondary" onClick={() => { setError(''); setReload(reload + 1) }}>Retry summary</button>}
    {summary && <form className="registration-form" onSubmit={submit}>
      <p><strong>{summary.property_name} · {summary.room_label}</strong></p>
      <dl className="tenancy-facts">
        <div><dt>Outstanding bills</dt><dd>{summary.open_bills} · {money(summary.outstanding_balance)}</dd></div>
        <div><dt>Unclaimed packages</dt><dd>{summary.unclaimed_packages}</dd></div>
        <div><dt>Open maintenance tickets</dt><dd>{summary.open_repairs}</dd></div>
        <div><dt>Pending visit requests</dt><dd>{summary.pending_visits}</dd></div>
        <div><dt>Approved visits awaiting arrival</dt><dd>{summary.ready_passes}</dd></div>
        <div><dt>Guests still inside</dt><dd>{summary.guests_inside}</dd></div>
      </dl>
      <p>Ending this stay releases the room slot and closes guest entry. Staff can still check guests out and handle packages and repairs. The resident can pay existing bills and open their receipts.</p>
      <label>Reason for ending tenancy<textarea name="reason" required maxLength={1000} rows={3} /></label>
      <label className="room-check"><input type="checkbox" name="confirmed" required />I confirm this tenancy should end immediately.</label>
      <button className="dialog-primary tenancy-destructive-primary" disabled={busy}>{busy ? 'Ending tenancy…' : 'Confirm end tenancy'}</button>
    </form>}
  </ResidentDialog>
}

function ProposeTransfer({ path, admission, replacing, onClose, onSaved }: {
  path: string; admission: Admission; replacing: boolean; onClose: () => void; onSaved: () => void
}) {
  const [rooms, setRooms] = useState<RoomTerms[] | null>(null)
  const [roomId, setRoomId] = useState('')
  const [quote, setQuote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let mounted = true
    api<RoomTerms[]>('/owner/rooms').then(data => {
      if (mounted) setRooms(data.filter(room => room.property_id === admission.property_id && room.id !== admission.room_id && room.available > 0))
    }).catch(error => { if (mounted) setError(errorText(error)) })
    return () => { mounted = false }
  }, [admission.property_id, admission.room_id, reload])
  const selected = rooms?.find(room => room.id === roomId)
  const quotedRoom = selected && quote.trim() ? { ...selected, applicant_monthly_rent: Number(quote) } : selected

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    setBusy(true); setError('')
    try {
      await api(path + '/transfers', { roomId, version: selected.terms_version, monthlyRent: quote.trim() || null })
      onSaved()
    } catch (error) { setError(errorText(error)) } finally { setBusy(false) }
  }

  return <ResidentDialog title="Propose room transfer" eyebrow="TENANCY MANAGEMENT" dismissOnBackdrop={false} busy={busy} onClose={onClose} footerNote="">
    <p>The resident must accept the destination room and its terms before you complete the transfer. Availability is checked again at completion.{replacing ? ' Saving this proposal closes the previous one.' : ''}</p>
    {!rooms && !error && <p role="status">Checking available rooms…</p>}
    {error && <p role="alert" className="admin-error">{error}</p>}
    {!rooms && error && <button type="button" className="admin-secondary" onClick={() => { setError(''); setReload(reload + 1) }}>Retry room list</button>}
    {rooms?.length === 0 && <p>No other rooms in this property have an available slot.</p>}
    {Boolean(rooms?.length) && <form className="registration-form" onSubmit={submit}>
      <label>Destination room<select required value={roomId} onChange={event => { setRoomId(event.target.value); setQuote('') }}>
        <option value="">Choose a room</option>
        {rooms?.map(room => <option key={room.id} value={room.id}>{room.label} · {room.available} available</option>)}
      </select></label>
      {selected && <label>Monthly rent for this resident (₱)<input type="number" min="0" max="9999999999.99" step="0.01" value={quote}
        onChange={event => setQuote(event.target.value)}
        required={selected.applicant_monthly_quote == null && (selected.monthly_rent == null || (selected.capacity > 1 && selected.pricing_basis === 'PER_ROOM'))} />
        <small>Leave blank to use the room’s configured rate when available.</small>
      </label>}
      {quotedRoom && <details className="room-agreement"><summary>Review the proposed room terms</summary><Terms room={quotedRoom} compact /></details>}
      <button className="dialog-primary" disabled={busy || !selected}>{busy ? 'Saving proposal…' : 'Send transfer proposal'}</button>
    </form>}
  </ResidentDialog>
}

function CompleteTransfer({ path, transfer, onClose, onSaved }: { path: string; transfer: Transfer; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <ResidentDialog title="Complete room transfer" eyebrow="TENANCY MANAGEMENT" dismissOnBackdrop={false} busy={busy} onClose={onClose} footerNote="">
    <p>Move this resident from <strong>{transfer.source_room_label}</strong> to <strong>{transfer.destination_room_label}</strong> now. Existing bills and service records stay with the original room.</p>
    <details className="room-agreement"><summary>Review the accepted terms</summary><Terms room={transfer.offer.terms} compact /></details>
    {error && <p role="alert" className="admin-error">{error}</p>}
    <button type="button" className="dialog-primary" disabled={busy} onClick={async () => {
      setBusy(true); setError('')
      try { await api(path + '/transfers/' + transfer.id + '/complete', {}); onSaved() }
      catch (error) { setError(errorText(error)) } finally { setBusy(false) }
    }}>{busy ? 'Completing transfer…' : 'Confirm room transfer'}</button>
  </ResidentDialog>
}

export function ResidentTransferOffers() {
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [selected, setSelected] = useState<Transfer | null>(null)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let mounted = true
    api<Transfer[]>('/resident/transfers').then(data => { if (mounted) { setTransfers(data); setLoadError('') } })
      .catch(error => { if (mounted) setLoadError(errorText(error)) })
    return () => { mounted = false }
  }, [reload])

  if (!transfers.length && !loadError) return null
  return <section className="profile-panel tenancy-panel">
    <h2>Room transfer</h2>
    {loadError && <p role="alert">{loadError} <button className="admin-link-button" onClick={() => setReload(reload + 1)}>Try again</button></p>}
    {transfers.map(transfer => <div className="tenancy-summary" key={transfer.id}>
      <div><strong>{transfer.source_room_label} → {transfer.destination_room_label}</strong><p>{transfer.offer.terms.property_name}</p>
      <AdminStatus>{transfer.status === 'PROPOSED' ? 'Review needed' : 'Waiting for owner'}</AdminStatus></div>
      <button className="admin-secondary" onClick={() => { setError(''); setSelected(transfer) }}>Review transfer terms</button>
    </div>)}
    {selected && <ResidentDialog title="Review transfer terms" eyebrow="YOUR STAY" dismissOnBackdrop={false} busy={busy} onClose={() => setSelected(null)} footerNote="">
      <Terms room={selected.offer.terms} compact />
      {error && <p className="admin-error" role="alert">{error}</p>}
      {selected.status === 'ACCEPTED' ? <p role="status">You accepted these terms. Your room changes when the owner completes the transfer.</p> :
        <form className="registration-form" onSubmit={async event => {
          event.preventDefault(); setBusy(true); setError('')
          try {
            const accepted = await api<Transfer>('/resident/transfers/' + selected.id + '/accept', {})
            setSelected(accepted); setReload(previous => previous + 1)
          } catch (error) { setError(errorText(error)) } finally { setBusy(false) }
        }}>
          <label className="room-check"><input type="checkbox" required />I accept the destination room and these exact terms.</label>
          <button className="dialog-primary" disabled={busy}>{busy ? 'Accepting…' : 'Accept transfer terms'}</button>
        </form>}
    </ResidentDialog>}
  </section>
}

export function VerifySignInEmail() {
  const token = new URLSearchParams(window.location.hash.split('?')[1]).get('token')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [verified, setVerified] = useState(false)
  useEffect(() => { document.title = 'Confirm sign-in email | Haruhay' }, [])
  return <main className="registration-shell">
    <section className="registration-card tenancy-verification">
      <img src="./assets/dashboard/haruhay-wordmark.png" width="140" alt="Haruhay" />
      <h1>Confirm sign-in email</h1>
      {verified ? <p role="status">Your email address is updated. Sign in with your new email and your existing password.</p>
        : <p>{token ? 'Confirm this address while signed in with your current email. Once confirmed, use the new address to sign in.' : 'This link is missing its verification code. Open the link from your email.'}</p>}
      {error && <p role="alert" className="admin-error">{error}</p>}
      {token && !verified && <button className="admin-primary" disabled={busy} onClick={async () => {
        setBusy(true); setError('')
        try { await api('/public/profile/email/verify', { token }); clearWorkspaceSession(); setVerified(true) }
        catch (error) { setError(errorText(error)) } finally { setBusy(false) }
      }}>{busy ? 'Confirming…' : 'Confirm my new email'}</button>}
      {verified || error ? <a href="#/login">Go to sign in</a> : null}
    </section>
  </main>
}

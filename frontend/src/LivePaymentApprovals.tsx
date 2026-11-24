import { useEffect, useState } from 'react'
import AdminLayout from './AdminLayout'
import { AdminHeading, AdminIcon, AdminStatus, AdminTable } from './AdminUI'
import ResidentDialog from './ResidentDialog'
import { money, periodLabel } from './billingData'
import { getWorkspaceSession, refreshPaymentRecords } from './workspaceSession'
import { usePreviewData } from './previewStore'
import { api, ApiError } from './registrationApi'
import { paymentDateLabel, paymentMethod, paymentPath, paymentStatus, proofLink, receiptLink, receiptNumber } from './paymentApi'
import type { Payment } from './paymentApi'

export default function LivePaymentApprovals({ residentId }: { residentId: string }) {
  const workspace = usePreviewData(getWorkspaceSession)
  const records = (workspace?.payments ?? []).filter(record => !residentId || record.application_id === residentId)
  const [filter, setFilter] = useState<Payment['status'] | ''>(residentId ? '' : 'PENDING')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('')
  const [notice, setNotice] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const visible = records.filter(record => (!filter || record.status === filter) &&
    [record.resident_name, record.property_name, record.reference, record.room_label, record.period, periodLabel(record.period)]
      .join(' ').toLowerCase().includes(query.trim().toLowerCase()))
  async function refresh() {
    setRefreshing(true)
    try { await refreshPaymentRecords() }
    catch { /* The workspace publishes a billing refresh error. */ }
    finally { setRefreshing(false) }
  }

  return <AdminLayout active="Billing & payments" node="18:2667" notice={notice} onDismissNotice={() => setNotice('')}>
    <AdminHeading eyebrow="Incoming collections" title="Payment approvals" description="Verify reported payments against your own records."
      action={<button className="admin-secondary" disabled={refreshing} onClick={() => void refresh()}>Refresh payments</button>} />
    <div className="admin-tabs payment-queue-tabs" aria-label="Filter payments">
      {([['PENDING', 'Needs review (' + records.filter(record => record.status === 'PENDING').length + ')'],
        ['APPROVED', 'Approved'], ['DECLINED', 'Declined'], ['REVERSED', 'Reversed'], ['', 'All']] as [Payment['status'] | '', string][])
        .map(([status, label]) => <button key={status} className={filter === status ? 'active' : ''} aria-pressed={filter === status} onClick={() => setFilter(status)}>{label}</button>)}
    </div>
    {residentId && <p><a href="#/admin/payments/approvals">View all residents</a></p>}
    <div className="admin-toolbar payment-queue-toolbar"><label>Search payments<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Resident, reference, or billing month" /></label>
      {query && <button className="admin-secondary" onClick={() => setQuery('')}>Clear search</button>}</div>
    {workspace?.paymentError && <p className="ux-status" data-tone="error" role="alert">{workspace.paymentError}</p>}
    <p className="ux-results-count" role="status">{visible.length} matching payments</p>
    <AdminTable columns={['Resident', 'Room / property', 'Billing month', 'Amount', 'Status', 'Action']} rows={visible.map(payment => ({
      key: payment.id, cells: [
        payment.resident_name, <div>{payment.room_label}<br /><small>{payment.property_name}</small></div>, periodLabel(payment.period), money(payment.amount),
        <div className="payment-state-stack"><AdminStatus>{paymentStatus[payment.status]}</AdminStatus>
          {payment.status === 'PENDING' && payment.duplicate_reference && <small>Possible duplicate reference</small>}</div>,
        <button className="admin-secondary" onClick={() => setSelected(payment.id)}>{payment.status === 'PENDING' ? 'Review payment' : 'View details'}</button>,
      ],
    }))} empty="No payments match this view." />
    <section className="admin-panel payment-live-section"><h2>A trustworthy process</h2><div className="admin-reported">
      <AdminIcon node="18:2667" name="imgIconShield1" /><p>Check the amount, reference and payment date against your records before approving.</p></div></section>
    {selected && <ReviewPayment key={selected} id={selected} onClose={() => setSelected('')} onSaved={async message => {
      setSelected('')
      setNotice(message)
      await refresh()
    }} />}
  </AdminLayout>
}

function ReviewPayment({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: (notice: string) => Promise<void> }) {
  const [payment, setPayment] = useState<Payment>()
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState('')
  const [stale, setStale] = useState(false)
  const [busy, setBusy] = useState(false)
  const [verified, setVerified] = useState(false)
  const [reason, setReason] = useState('')
  useEffect(() => {
    let active = true
    api<Payment>(paymentPath('owner', id)).then(record => { if (active) setPayment(record) })
      .catch(error => { if (active) setError(error instanceof Error ? error.message : 'Could not load this payment.') })
    return () => { active = false }
  }, [attempt, id])

  async function review(action: 'approve' | 'decline' | 'reverse') {
    if (!payment || busy || stale) return
    if (action === 'approve' && !verified) { setError('Confirm you checked the payment against your own records.'); return }
    if (action !== 'approve' && !reason.trim()) { setError('Enter a reason for this decision.'); return }
    setError('')
    setBusy(true)
    try {
      await api(paymentPath('owner', id) + '/' + action, { expectedBalance: payment.balance, verified, reason })
      await onSaved(action === 'approve' ? 'Payment verified. The balance and receipt are updated.' : action === 'decline' ? 'Payment declined. The resident can see your reason.' : 'Payment reversed. The bill balance was restored.')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save the decision.')
      setStale(error instanceof ApiError && error.status === 409)
    } finally {
      setBusy(false)
    }
  }
  function reload() { setPayment(undefined); setStale(false); setVerified(false); setError(''); setAttempt(value => value + 1) }
  const pending = payment?.status === 'PENDING'
  return <ResidentDialog className="payment-review-dialog" title={pending || !payment ? 'Review payment' : 'Payment details'} footerNote="" busy={busy} onClose={onClose}>
    {!payment && !error && <p role="status">Loading payment…</p>}
    {payment && <>
      <dl className="payment-facts payment-context">
        <div><dt>Resident</dt><dd>{payment.resident_name}</dd></div>
        <div><dt>Property / room</dt><dd>{payment.property_name} · {payment.room_label}</dd></div>
        <div><dt>Bill</dt><dd>{periodLabel(payment.period)} · {money(payment.total)}<br />Due {paymentDateLabel(payment.due_date)}</dd></div>
        <div><dt>Remaining</dt><dd>{money(payment.balance)}</dd></div>
        <div><dt>Reported payment</dt><dd>{money(payment.amount)} · {paymentMethod[payment.method]}</dd></div>
        <div><dt>Date paid</dt><dd>{paymentDateLabel(payment.payment_date)}</dd></div>
        <div><dt>Reference</dt><dd>{payment.reference}</dd></div>
        <div><dt>Status</dt><dd>{paymentStatus[payment.status]}</dd></div>
      </dl>
      {payment.has_proof ? <p><a href={proofLink('owner', id)} target="_blank" rel="noreferrer">Open private proof</a></p> : <p>No payment proof attached.</p>}
      {pending && payment.duplicate_reference && <p className="ux-status" data-tone="warning">Another submission at this property uses this method and reference. Check your records for a duplicate.</p>}
      {payment.decline_reason && <p>Decline reason · {payment.decline_reason}</p>}
      {payment.reversal_reason && <p>Reversal reason · {payment.reversal_reason}</p>}
      {payment.receipt_number != null && <p><a href={receiptLink(id).replace('/resident/', '/admin/')}>Receipt {receiptNumber(payment.receipt_number)}</a></p>}
      {(pending || payment.status === 'APPROVED') && <div className="admin-form payment-live-form">
        {pending && <label className="payment-verification"><input type="checkbox" checked={verified} onChange={event => { setVerified(event.target.checked); if (!stale) setError('') }} disabled={busy} />I checked this payment against my own records.</label>}
        <label>{pending ? 'Reason for declining' : 'Reason for reversing'}<textarea maxLength={1000} value={reason} onChange={event => { setReason(event.target.value); if (!stale) setError('') }} disabled={busy} /></label>
      </div>}
    </>}
    {error && <p className="ux-status" data-tone="error" role="alert">{error}</p>}
    <div className="payment-live-actions">
      {(stale || !payment && error) && <button className="admin-secondary" disabled={busy} onClick={reload}>Reload payment</button>}
      {pending && <><button className="admin-primary" disabled={busy || stale} onClick={() => void review('approve')}>Approve payment</button>
        <button className="admin-secondary" disabled={busy || stale} onClick={() => void review('decline')}>Decline payment</button></>}
      {payment?.status === 'APPROVED' && <button className="admin-secondary" disabled={busy || stale} onClick={() => void review('reverse')}>Reverse approval</button>}
    </div>
  </ResidentDialog>
}

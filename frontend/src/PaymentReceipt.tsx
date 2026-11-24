import { useEffect, useState } from 'react'
import AdminLayout from './AdminLayout'
import ResidentLayout from './ResidentLayout'
import { api, ApiError } from './registrationApi'
import { money, periodLabel } from './billingData'
import { paymentDateLabel, paymentMethod, paymentPath, receiptNumber } from './paymentApi'
import type { PaymentRole, Receipt } from './paymentApi'
import { philippineTime } from './visitorApi'
import artwork from './landing-artwork.json'

export default function PaymentReceipt({ id, role }: { id: string; role: PaymentRole }) {
  const [receipt, setReceipt] = useState<Receipt>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    api<Receipt>(paymentPath(role, id) + '/receipt').then(result => { if (active) setReceipt(result) }).catch(error => {
      if (active) setError(error instanceof ApiError && [400, 403, 404].includes(error.status) ? 'This receipt is unavailable.' : 'Could not load the receipt. Try again.')
    })
    return () => { active = false }
  }, [id, retry, role])
  const back = role === 'owner' ? '#/admin/payments/approvals' : '#/resident/payments/history'
  const content = <div className="payment-receipt-page">
    <div className="payment-live-actions payment-receipt-controls"><a href={back}>← {role === 'owner' ? 'Back to approvals' : 'Back to payment history'}</a>
      {receipt && <button className="admin-primary" onClick={() => window.print()}>Print receipt</button>}</div>
    {error ? <section className="admin-panel"><h1>Payment acknowledgment</h1><p role="alert">{error}</p><button className="admin-secondary" onClick={() => { setError(''); setRetry(value => value + 1) }}>Try again</button></section>
      : !receipt ? <p role="status">Loading receipt…</p>
        : <article className="admin-panel payment-receipt">
          <div className="payment-receipt-brand"><img src={artwork.HaruhayFinalWebFallbackMark} width="40" height="40" alt="" /><strong>Haruhay</strong></div>
          <h1>Payment acknowledgment</h1>
          <p><strong>Receipt {receiptNumber(receipt.number)}</strong></p>
          {receipt.status === 'REVERSED' && <p className="ux-status" data-tone="warning"><strong>Reversed</strong><br />
            {receipt.reversed_at && philippineTime(receipt.reversed_at) + ' PHT · '}{receipt.reversal_reason}</p>}
          <dl className="payment-facts">
            <div><dt>Resident</dt><dd>{receipt.resident_name}</dd></div>
            <div><dt>Property / room</dt><dd>{receipt.property_name} · {receipt.room_label}</dd></div>
            <div><dt>Billing month</dt><dd>{periodLabel(receipt.period)}</dd></div>
            <div><dt>Bill due date</dt><dd>{paymentDateLabel(receipt.due_date)}</dd></div>
            <div><dt>Verified amount</dt><dd>{money(receipt.amount)}</dd></div>
            <div><dt>Method</dt><dd>{paymentMethod[receipt.method]}</dd></div>
            <div><dt>Reference</dt><dd>{receipt.reference}</dd></div>
            <div><dt>Date paid</dt><dd>{paymentDateLabel(receipt.payment_date)}</dd></div>
            <div><dt>Verified at</dt><dd>{philippineTime(receipt.issued_at)} PHT</dd></div>
          </dl>
        </article>}
  </div>
  return role === 'owner' ? <AdminLayout active="Billing & payments" node="18:2541">{content}</AdminLayout>
    : <ResidentLayout activeSection="Payments" breadcrumb="Payment acknowledgment" notice="" onNotice={() => {}} onDismissNotice={() => {}}>
      <div className="resident-content billing-content">{content}</div>
    </ResidentLayout>
}
